'use strict';
const mongoose = require('mongoose');
const { readVideoQueueMetrics } = require('../../infrastructure/jobs/videoQueueMetrics');
const { uploadError, MAX_VIDEO_BYTES, MAX_POST_VIDEO_BYTES, UUID } = require('../utils/postVideoPolicy');
const KEY = 'video-global-admission:v1';
const LIMITS = Object.freeze({ pending: 40, bytes: 10 * 1024 ** 3, workSeconds: 14400, unknownWorkSeconds: 1800, ownerSessions: 5, ownerBytes: MAX_POST_VIDEO_BYTES, queueDepth: 40, queueAgeSeconds: 300, telemetryMs: 20000 });
const oid = x => /^[a-f0-9]{24}$/.test(String(x));
const stopped = () => uploadError('VIDEO_GLOBAL_ADMISSION_HELD', 'Video capacity is temporarily unavailable. Existing uploads and posts are preserved. Please try again later.', 503);
const capacity = () => uploadError('VIDEO_GLOBAL_CAPACITY', 'Video processing is at capacity. Existing uploads are preserved. Please try again later.', 429);
// The sole document is a bounded durable ledger. All counters and membership
// change atomically; no TTL or Redis eviction can release accepted work.
function initialDocument({ reviewReference, costUntil, reservations = [], now = Date.now() }) {
  if (!/^[a-f0-9]{64}$/.test(reviewReference || '') || !Number.isFinite(costUntil) || costUntil <= now || costUntil > now + 86400000 || reservations.length) throw stopped();
  // Empty initialization requires a separate fresh native zero-reservation
  // audit/review. This function returns bytes only and never writes/bootstraps.
  return { _id: KEY, version: 1, limits: LIMITS, revision: 0, reservations: [], owners: {}, count: 0, bytes: 0, workSeconds: 0,
    admissionOpen: false, costOpen: false, costUntil: new Date(costUntil), reviewReference, telemetryValid: false, telemetryAt: new Date(0), oldestQueuedAgeSeconds: null, queueOutstanding: null };
}
function create({ collection = () => mongoose.connection.collection('videoglobaladmission'), now = Date.now, env = process.env, readMetrics = readVideoQueueMetrics } = {}) {
  let telemetryHeld = false;
  const db = () => typeof collection === 'function' ? collection() : collection;
  const enabled = () => { if (env.POST_VIDEO_GLOBAL_ADMISSION_ENABLED !== 'true') throw stopped(); };
  const find = query => db().findOne(query, { readPreference: 'primary', maxTimeMS: 5000 });
  const same = (r, x) => r.sessionId === x.sessionId && r.owner === x.owner && r.clientUploadId === x.clientUploadId && r.bytes === x.bytes;
  function validLedger(d) {
    if (!d || d.version !== 1 || !Array.isArray(d.reservations) || d.reservations.length > LIMITS.pending || !Number.isSafeInteger(d.revision) || d.revision < 0 || !d.owners || typeof d.owners !== 'object') return false;
    const owners = {}, ids = new Set(), clients = new Set(); let bytes = 0, work = 0;
    for (const r of d.reservations) {
      const client = r.owner + ':' + r.clientUploadId;
      if ((r.manualHold !== undefined && r.manualHold !== true) || !oid(r.owner) || !oid(r.sessionId) || !UUID.test(r.clientUploadId || '') || ids.has(r.sessionId) || clients.has(client) || !Number.isSafeInteger(r.bytes) || r.bytes <= 0 || r.bytes > MAX_VIDEO_BYTES || r.workSeconds !== LIMITS.unknownWorkSeconds) return false;
      ids.add(r.sessionId); clients.add(client); bytes += r.bytes; work += r.workSeconds;
      const o = owners[r.owner] ||= { count: 0, bytes: 0 }; o.count++; o.bytes += r.bytes;
    }
    return d.count === d.reservations.length && d.bytes === bytes && d.workSeconds === work && bytes <= LIMITS.bytes && work <= LIMITS.workSeconds && Object.entries(owners).every(([id,o]) => o.count <= LIMITS.ownerSessions && o.bytes <= LIMITS.ownerBytes && d.owners[id]?.count === o.count && d.owners[id]?.bytes === o.bytes) && Object.entries(d.owners).every(([id,o]) => oid(id) && (owners[id] || o.count === 0 && o.bytes === 0));
  }
  async function reserve({ owner, sessionId, clientUploadId, bytes }) {
    enabled(); owner = String(owner); sessionId = String(sessionId);
    if (!oid(owner) || !oid(sessionId) || !UUID.test(clientUploadId || '') || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_VIDEO_BYTES) throw stopped();
    const x = { owner, sessionId, clientUploadId, bytes, workSeconds: LIMITS.unknownWorkSeconds, reservedAt: new Date(now()) };
    const ledger = await find({ _id: KEY });
    if (!validLedger(ledger)) throw stopped();
    const prior = ledger.reservations.find(r => r.sessionId === sessionId);
    if (prior) { if (!same(prior, x)) throw uploadError('GLOBAL_RESERVATION_ID_CONFLICT', 'Video reservation identity changed.', 409); return { reserved: true, reused: true }; }
    // A known collector failure must close this process even if persisting the
    // shared invalidation failed or its acknowledgement is unknown. Exact
    // accepted replay above remains available without allocating more work.
    if (telemetryHeld) throw stopped();
    let result;
    try {
      result = await db().findOneAndUpdate({ _id: KEY, version: 1, limits: LIMITS, admissionOpen: true, costOpen: true, costUntil: { $gt: new Date(now()) }, telemetryValid: true,
        telemetryAt: { $gte: new Date(now() - LIMITS.telemetryMs), $lte: new Date(now()) }, oldestQueuedAgeSeconds: { $lt: LIMITS.queueAgeSeconds }, queueOutstanding: { $lt: LIMITS.queueDepth },
        count: { $gte: 0, $lt: LIMITS.pending }, bytes: { $gte: 0, $lte: LIMITS.bytes - bytes }, workSeconds: { $gte: 0, $lte: LIMITS.workSeconds - x.workSeconds },
        ['owners.' + owner + '.count']: { $not: { $gte: LIMITS.ownerSessions } }, ['owners.' + owner + '.bytes']: { $not: { $gt: LIMITS.ownerBytes - bytes } },
        reservations: { $not: { $elemMatch: { $or: [{ sessionId }, { owner, clientUploadId }] } } },
      }, { $push: { reservations: x }, $inc: { revision: 1, count: 1, bytes, workSeconds: x.workSeconds, ['owners.' + owner + '.count']: 1, ['owners.' + owner + '.bytes']: bytes } }, { returnDocument: 'after', maxTimeMS: 5000 });
    } catch { throw stopped(); } // Lost ack remains reserved/unknown; never blindly compensate.
    if (result) return { reserved: true, reused: false };
    const current = await find({ _id: KEY });
    const raced = current?.reservations?.find(r => r.sessionId === sessionId);
    if (raced && same(raced, x)) return { reserved: true, reused: true };
    if (!current || !current.admissionOpen || !current.costOpen || !current.telemetryValid || now() - new Date(current.telemetryAt).getTime() > LIMITS.telemetryMs || new Date(current.costUntil).getTime() <= now()) throw stopped();
    throw capacity();
  }
  async function telemetry(queue) {
    if (env.POST_VIDEO_GLOBAL_ADMISSION_ENABLED !== 'true') return;
    try {
      // Read the same typed, stable full membership used by the read-only
      // scaling collector. Missing counts and transitional reads cannot become
      // zero backlog. Queue construction/claim behaviour is unchanged here.
      const metrics = await readMetrics(await queue.client, { now });
      const observed = new Date(metrics.checkedAt).getTime();
      if (metrics.collectorHealthy !== 1 || metrics.queuePaused !== 0 || !Number.isFinite(observed) || observed > now() || now() - observed > LIMITS.telemetryMs || !Number.isSafeInteger(metrics.outstandingJobs) || metrics.outstandingJobs < 0 || !Number.isFinite(metrics.oldestQueuedAgeSeconds) || metrics.oldestQueuedAgeSeconds < 0) throw stopped();
      const result = await db().updateOne({ _id: KEY, version: 1 }, { $set: { telemetryAt: new Date(observed), telemetryValid: true, oldestQueuedAgeSeconds: metrics.oldestQueuedAgeSeconds, queueOutstanding: metrics.outstandingJobs }, $inc: { revision: 1 } }, { maxTimeMS: 5000 });
      if (result?.matchedCount !== 1) throw stopped();
      telemetryHeld = false;
    } catch {
      telemetryHeld = true;
      await db().updateOne({ _id: KEY }, { $set: { telemetryValid: false }, $inc: { revision: 1 } }, { maxTimeMS: 5000 }).catch(() => {});
      throw stopped();
    }
  }
  async function reconcile({ sessions, posts, intents, queue }) {
    if (env.POST_VIDEO_GLOBAL_ADMISSION_ENABLED !== 'true') return { released: 0 };
    const ledger = await find({ _id: KEY }); if (!validLedger(ledger)) throw stopped();
    let released = 0;
    for (const r of ledger.reservations) {
      // Imported unresolved obligations remain charged until a separate exact
      // disposition clears the hold; ordinary terminal reconciliation cannot.
      if (r.manualHold === true) continue;
      const s = await sessions.findOne({ _id: r.sessionId, owner: r.owner, clientUploadId: r.clientUploadId }).read('primary').lean();
      if (!s || s.size !== r.bytes || s.status === 'PROCESSING' || [s.leaseExpiresAt, s.completionLeaseExpiresAt].some(t => t && new Date(t).getTime() > now())) continue;
      const pending = await intents.exists({ owner: r.owner, sessionIds: s._id, $or: [{ status: { $in: ['PENDING', 'PUBLISHING'] } }, { leaseExpiresAt: { $gt: new Date(now()) } }] }); if (pending) continue;
      const publicationIds = [s.postId, s.claimedPostId].filter(Boolean);
      if (publicationIds.length && await mongoose.connection.collection('videopostpublications').findOne({ _id: { $in: publicationIds }, expiresAt: { $gt: new Date(now()) } }, { readPreference: 'primary' })) continue;
      const published = s.status === 'READY' && s.postId && await posts.exists({ _id: s.postId, author: r.owner, 'content.media.uploadSessionId': s._id });
      const cleaned = ['CANCELLED', 'EXPIRED'].includes(s.status) && s.cleanedAt && s.sourceCleanedAt && !s.postId && !s.claimedPostId;
      if (!published && !cleaned) continue;
      let unsafe = false;
      for (let n = 0; n <= 3; n++) { const job = await queue.getJob('video-upload-' + r.sessionId + '-' + n); if (job && !['completed', 'failed'].includes(await job.getState())) unsafe = true; }
      // Fair-scheduler tickets are an independent potential owner of work.
      if (await mongoose.connection.collection('videoprocessingtickets').findOne({ _id: s._id, state: { $in: ['UPLOADING', 'PROBING', 'WAITING', 'DISPATCHED'] } }, { readPreference: 'primary' })) unsafe = true;
      if (unsafe) continue;
      const out = await db().updateOne({ _id: KEY, reservations: { $elemMatch: { sessionId: r.sessionId, owner: r.owner, clientUploadId: r.clientUploadId, bytes: r.bytes } } },
        { $pull: { reservations: { sessionId: r.sessionId } }, $inc: { revision: 1, count: -1, bytes: -r.bytes, workSeconds: -r.workSeconds, ['owners.' + r.owner + '.count']: -1, ['owners.' + r.owner + '.bytes']: -r.bytes } }, { maxTimeMS: 5000 });
      released += out.modifiedCount;
    }
    return { released };
  }
  return { reserve, telemetry, reconcile };
}
const service = create();
module.exports = { KEY, LIMITS, initialDocument, create, ...service };
