const mongoose = require('mongoose');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const VideoUploadSession = require('../models/VideoUploadSession');
const Post = require('../models/Post');
const { MAX_VIDEO_BYTES, MAX_POST_VIDEO_BYTES, MAX_VIDEOS, PART_SIZE, UUID, uploadError, validateVideoInput, expectedPartSize, verifyParts } = require('../utils/postVideoPolicy');
const { privateDeliveryReady, assertDeliveryReady } = require('../utils/postVideoDelivery');

const SESSION_SELECT = '+objectKey +multipartUploadId +leaseToken +completionLeaseToken';
const UPLOAD_STATES = ['CREATED', 'UPLOADING'];
const RETRYABLE = ['UPLOADED', 'QUEUED', 'FAILED'];
const TTL_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
let Session = VideoUploadSession;
let storageOverride;
let generateOverride;
let enqueueOverride;
const storage = () => storageOverride || require(path.join(__dirname, '../../../dist/infrastructure/storage/s3'));
const enqueue = (id, attempt = 0) => (enqueueOverride || require('../utils/jobQueue').enqueueVideoUpload)(String(id), String(attempt));
const enabled = () => process.env.POST_VIDEO_UPLOADS_ENABLED === 'true' && process.env.CLIP_HLS_WORKER_ENABLED === 'false' && privateDeliveryReady() && Boolean(process.env.AWS_S3_BUCKET);
const requireAvailable = () => { assertDeliveryReady(); if (!process.env.AWS_S3_BUCKET) throw uploadError('VIDEO_UPLOADS_UNAVAILABLE', 'Video uploading is temporarily unavailable.', 503); };
const requireEnabled = () => { if (!enabled()) throw uploadError('VIDEO_UPLOADS_UNAVAILABLE', 'Video uploading is being prepared. Please try again later.', 503); assertDeliveryReady(); };
const dto = session => ({
  id: String(session._id), status: session.status, size: session.size, partSize: session.partSize,
  partCount: session.partCount, expiresAt: new Date(session.expiresAt).toISOString(),
  ...(session.error?.code ? { error: { code: session.error.code, message: session.error.message } } : {}),
  ...(session.postId ? { postId: String(session.postId) } : {}),
});
const policy = () => ({ enabled: enabled(), maxVideoBytes: MAX_VIDEO_BYTES, maxPostVideoBytes: MAX_POST_VIDEO_BYTES, maxVideos: MAX_VIDEOS, partSize: PART_SIZE });
const owned = async (id, owner) => {
  if (!mongoose.isValidObjectId(id)) throw uploadError('UPLOAD_NOT_FOUND', 'Video upload not found.', 404);
  const session = await Session.findOne({ _id: id, owner }).select(SESSION_SELECT);
  if (!session) throw uploadError('UPLOAD_NOT_FOUND', 'Video upload not found.', 404);
  return session;
};
const assertLive = session => {
  if (session.postId) throw uploadError('UPLOAD_ALREADY_PUBLISHED', 'This video has already been published.', 409);
  if (['CANCELLED', 'EXPIRED'].includes(session.status) || new Date(session.expiresAt).getTime() <= Date.now()) throw uploadError('UPLOAD_EXPIRED', 'This upload has expired. Select the video again.', 410);
};

const lockSchema = new mongoose.Schema({ _id: mongoose.Schema.Types.ObjectId, token: String, expiresAt: Date }, { autoIndex: false });
const OwnerLock = mongoose.models.VideoUploadOwnerLock || mongoose.model('VideoUploadOwnerLock', lockSchema);
const createSession = async (owner, input) => {
  requireEnabled();
  const data = validateVideoInput(input);
  let session = await Session.findOne({ owner, clientUploadId: data.clientUploadId }).select(SESSION_SELECT);
  if (!session) {
    const token = randomUUID();
    let lock;
    try { lock = await OwnerLock.findOneAndUpdate({ _id: owner, $or: [{ expiresAt: { $lte: new Date() } }, { expiresAt: { $exists: false } }] }, { $set: { token, expiresAt: new Date(Date.now() + 60_000) } }, { upsert: true, new: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    if (!lock) throw uploadError('UPLOAD_BUSY', 'Another upload is being prepared. Try again shortly.', 409);
    try {
      session = await Session.findOne({ owner, clientUploadId: data.clientUploadId }).select(SESSION_SELECT);
      if (!session) {
        const active = await Session.find({ owner, postId: null, status: { $nin: ['CANCELLED', 'EXPIRED'] }, expiresAt: { $gt: new Date() } }).limit(MAX_VIDEOS + 1).select('size');
        if (active.length >= MAX_VIDEOS || active.reduce((sum, row) => sum + row.size, data.size) > MAX_POST_VIDEO_BYTES) throw uploadError('UPLOAD_QUOTA', 'Finish or cancel existing video uploads before adding more. Videos may total up to 1 GB per post.', 429);
        const _id = new mongoose.Types.ObjectId();
        session = await Session.create({ _id, owner, ...data, objectKey: `post-video-sources/${owner}/${_id}/source.${data.extension}`, expiresAt: new Date(Date.now() + TTL_MS), status: 'CREATED' });
      }
    } finally { await OwnerLock.deleteOne({ _id: owner, token }); }
  }
  if (session.size !== data.size || session.mimeType !== data.mimeType) throw uploadError('IDEMPOTENCY_CONFLICT', 'This upload identifier belongs to a different file.', 409);
  assertLive(session);
  if (!session.multipartUploadId && UPLOAD_STATES.includes(session.status)) {
    const token = randomUUID();
    const claim = await Session.findOneAndUpdate({ _id: session._id, status: 'CREATED', multipartUploadId: null, $or: [{ completionLeaseExpiresAt: null }, { completionLeaseExpiresAt: { $lte: new Date() } }] }, { $set: { completionLeaseToken: token, completionLeaseExpiresAt: new Date(Date.now() + 120_000) } }, { new: true }).select(SESSION_SELECT);
    if (!claim) throw uploadError('UPLOAD_BUSY', 'The video upload is being prepared. Try again shortly.', 409);
    let uploadId;
    try {
      uploadId = await storage().createVideoMultipart(session.objectKey, session.mimeType, String(session._id));
      session = await Session.findOneAndUpdate({ _id: session._id, completionLeaseToken: token, status: 'CREATED' }, { $set: { multipartUploadId: uploadId, status: 'UPLOADING' }, $unset: { completionLeaseToken: 1, completionLeaseExpiresAt: 1 } }, { new: true }).select(SESSION_SELECT);
      if (!session) { await storage().abortVideoMultipart(claim.objectKey, uploadId); throw uploadError('UPLOAD_CANCELLED', 'The video upload was cancelled.', 409); }
    } catch (error) {
      if (uploadId) await storage().abortVideoMultipart(claim.objectKey, uploadId).catch(() => {});
      await Session.updateOne({ _id: claim._id, completionLeaseToken: token }, { $unset: { completionLeaseToken: 1, completionLeaseExpiresAt: 1 } });
      throw error;
    }
  }
  return dto(session);
};
const getSession = async (owner, id) => dto(await owned(id, owner));
const listParts = async (owner, id) => {
  const session = await owned(id, owner); assertLive(session);
  if (!UPLOAD_STATES.includes(session.status)) return [];
  if (!session.multipartUploadId) return [];
  return storage().listVideoParts(session.objectKey, session.multipartUploadId);
};
const signParts = async (owner, id, partNumbers) => {
  requireAvailable();
  const session = await owned(id, owner); assertLive(session);
  if (!UPLOAD_STATES.includes(session.status) || !session.multipartUploadId) throw uploadError('INVALID_UPLOAD_STATE', 'This video is no longer accepting upload parts.', 409);
  if (!Array.isArray(partNumbers) || partNumbers.length < 1 || partNumbers.length > 4 || new Set(partNumbers).size !== partNumbers.length || partNumbers.some(part => !Number.isSafeInteger(part) || part < 1 || part > session.partCount)) throw uploadError('INVALID_PART_NUMBER', 'Request between one and four valid video parts.');
  return Promise.all(partNumbers.map(async partNumber => ({ partNumber, url: await storage().presignVideoPart(session.objectKey, session.multipartUploadId, partNumber, expectedPartSize(session, partNumber)) })));
};
const completeSession = async (owner, id) => {
  requireAvailable();
  let session = await owned(id, owner); assertLive(session);
  if (['QUEUED', 'PROCESSING', 'READY'].includes(session.status)) return dto(session);
  if (session.status === 'UPLOADED') {
    session = await Session.findOneAndUpdate({ _id: session._id, status: 'UPLOADED' }, { $set: { status: 'QUEUED' } }, { new: true }) || session;
    await enqueue(session._id); return dto(session);
  }
  if (!UPLOAD_STATES.includes(session.status) || !session.multipartUploadId) throw uploadError('INVALID_UPLOAD_STATE', 'Resume or restart this video upload.', 409);
  const token = randomUUID();
  const claim = await Session.findOneAndUpdate({ _id: session._id, status: { $in: UPLOAD_STATES }, $or: [{ completionLeaseExpiresAt: null }, { completionLeaseExpiresAt: { $lte: new Date() } }] }, { $set: { completionLeaseToken: token, completionLeaseExpiresAt: new Date(Date.now() + 120_000) } }, { new: true }).select(SESSION_SELECT);
  if (!claim) throw uploadError('UPLOAD_BUSY', 'This upload is already being verified. Check its status shortly.', 409);
  try {
    // A lost S3 completion acknowledgement is recovered by HEAD and the server-owned session metadata.
    let head;
    try { head = await storage().headVideoSource(session.objectKey); } catch (error) { if (!['NotFound', 'NoSuchKey'].includes(error.name) && error.$metadata?.httpStatusCode !== 404) throw error; }
    if (!head) {
      const parts = verifyParts(session, await storage().listVideoParts(session.objectKey, session.multipartUploadId));
      await storage().completeVideoMultipart(session.objectKey, session.multipartUploadId, parts);
      head = await storage().headVideoSource(session.objectKey);
    }
    if (head.size !== session.size || head.sessionId !== String(session._id) || head.contentType !== session.mimeType) throw uploadError('UPLOAD_SIZE_MISMATCH', 'The uploaded video does not match the selected file.', 422);
    session = await Session.findOneAndUpdate({ _id: session._id, completionLeaseToken: token, status: { $in: UPLOAD_STATES } }, { $set: { status: 'QUEUED', uploadVerifiedAt: new Date() }, $unset: { completionLeaseToken: 1, completionLeaseExpiresAt: 1, error: 1 } }, { new: true });
    if (!session) throw uploadError('UPLOAD_CANCELLED', 'The video upload was cancelled.', 409);
    await enqueue(session._id);
    return dto(session);
  } catch (error) {
    await Session.updateOne({ _id: claim._id, completionLeaseToken: token }, { $unset: { completionLeaseToken: 1, completionLeaseExpiresAt: 1 } });
    throw error;
  }
};
const cancelSession = async (owner, id) => {
  let current = await owned(id, owner);
  if (current.claimedPostId && !current.postId && await require('./videoPostPublicationService').releaseAbandonedClaim(current)) current = await owned(id, owner);
  if (current.postId || current.claimedPostId) throw uploadError('UPLOAD_ALREADY_PUBLISHED', 'This video is attached to a post and cannot be cancelled.', 409);
  const session = await Session.findOneAndUpdate({ _id: id, owner, postId: null, claimedPostId: null }, { $set: { status: 'CANCELLED' }, $unset: { leaseToken: 1, leaseExpiresAt: 1 } }, { new: true }).select(SESSION_SELECT);
  if (!session) throw uploadError('UPLOAD_ALREADY_PUBLISHED', 'This video is attached to a post.', 409);
  if (session.multipartUploadId) await storage().abortVideoMultipart(session.objectKey, session.multipartUploadId).catch(() => {});
  return dto(session);
};
const retrySession = async (owner, id) => {
  requireAvailable();
  const session = await owned(id, owner); assertLive(session);
  if (UPLOAD_STATES.includes(session.status)) return dto(session);
  if (['READY', 'PROCESSING'].includes(session.status)) return dto(session);
  if (!session.uploadVerifiedAt || !RETRYABLE.includes(session.status) || session.attempts >= MAX_ATTEMPTS) throw uploadError('RETRY_UNAVAILABLE', 'Select the video again to restart the upload.', 409);
  const claimed = await Session.findOneAndUpdate({ _id: id, owner, status: { $in: RETRYABLE } }, { $set: { status: 'QUEUED' }, $unset: { error: 1 } }, { new: true });
  if (!claimed) throw uploadError('UPLOAD_BUSY', 'Video processing has already restarted.', 409);
  await enqueue(id, claimed.attempts); return dto(claimed);
};

const listFiles = async root => {
  const result = [];
  const visit = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && !entry.name.endsWith('.tmp')) result.push(file);
    }
  };
  await visit(root); return result;
};
const publishOutputs = async (outputDir, prefix, generated) => {
  const files = await listFiles(outputDir);
  const required = ['master.m3u8', 'fallback.mp4', 'thumbnail.jpg'];
  if (required.some(relative => !files.includes(path.join(outputDir, relative)))) throw uploadError('INVALID_OUTPUT', 'Video processing did not produce the required outputs.', 422);
  files.sort((a, b) => (a.endsWith('master.m3u8') ? 2 : a.endsWith('.m3u8') ? 1 : 0) - (b.endsWith('master.m3u8') ? 2 : b.endsWith('.m3u8') ? 1 : 0));
  // Sequential bounded publication avoids hundreds of simultaneous S3 streams.
  for (const file of files) await storage().uploadMediaFile(file, `${prefix}/${path.relative(outputDir, file).split(path.sep).join('/')}`);
  return {
    prefix, hlsKey: `${prefix}/master.m3u8`, fallbackKey: `${prefix}/fallback.mp4`, thumbnailKey: `${prefix}/thumbnail.jpg`,
    outputBytes: generated.outputBytes,
    renditions: generated.renditions.map(row => ({ name: row.name, width: row.width, height: row.height, bandwidth: Math.ceil((row.maxRate + (row.hasAudio ? row.audioBitrate : 0)) * 1.1), averageBandwidth: row.videoBitrate + (row.hasAudio ? row.audioBitrate : 0), playlistUrl: `${prefix}/${row.name}/index.m3u8`, playlistPublicId: `${prefix}/${row.name}/index.m3u8` })),
  };
};
const processVideoUploadJob = async ({ sessionId }) => {
  if (!mongoose.isValidObjectId(sessionId)) throw new Error('Invalid video upload session ID');
  const leaseToken = randomUUID();
  const session = await Session.findOneAndUpdate({ _id: sessionId, ownerDeletedAt: null, uploadVerifiedAt: { $ne: null }, status: { $in: ['QUEUED', 'PROCESSING', 'FAILED'] }, attempts: { $lt: MAX_ATTEMPTS }, expiresAt: { $gt: new Date() }, $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: new Date() } }] }, { $set: { status: 'PROCESSING', leaseToken, leaseExpiresAt: new Date(Date.now() + LEASE_MS) }, $inc: { attempts: 1 }, $unset: { error: 1 } }, { new: true }).select(SESSION_SELECT);
  if (!session) return { skipped: true };
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-video-upload-'));
  const version = randomUUID();
  const prefix = `post-video-playback/${session.owner}/${session._id}/${version}`;
  await Session.updateOne({ _id: sessionId, status: 'PROCESSING', leaseToken }, { $addToSet: { outputPrefixes: prefix } });
  const controller = new AbortController();
  let heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const result = await Session.updateOne({ _id: sessionId, status: 'PROCESSING', leaseToken, ownerDeletedAt: null }, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
      if (!result.matchedCount) controller.abort();
    } catch { controller.abort(); } finally { heartbeatBusy = false; }
  }, 30_000);
  heartbeat.unref();
  try {
    const head = await storage().headVideoSource(session.objectKey);
    if (head.size !== session.size || head.size > MAX_VIDEO_BYTES || head.sessionId !== String(session._id)) throw uploadError('INVALID_VIDEO', 'The uploaded video failed validation.', 422);
    const inputPath = path.join(workDir, `source.${session.filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'video'}`);
    await storage().downloadFile(session.objectKey, inputPath);
    const outputDir = path.join(workDir, 'outputs');
    const generate = generateOverride || require('../utils/clipHlsProcessing').generateClipHls;
    const generated = await generate({ inputPath, outputDir, signal: controller.signal });
    if (controller.signal.aborted) throw uploadError('PROCESSING_CANCELLED', 'Video processing was cancelled.', 409);
    const output = await publishOutputs(outputDir, prefix, generated);
    const result = await Session.updateOne({ _id: sessionId, ownerDeletedAt: null, status: 'PROCESSING', leaseToken }, { $set: { status: 'READY', metadata: generated.metadata, output, completedAt: new Date() }, $unset: { leaseToken: 1, leaseExpiresAt: 1, error: 1 } });
    if (!result.matchedCount) { await storage().deletePrefix(`${prefix}/`); return { skipped: true, reason: 'cancelled' }; }
    return { sessionId, outputBytes: output.outputBytes };
  } catch (error) {
    await storage().deletePrefix(`${prefix}/`).catch(() => {});
    const invalid = /PROBE|INVALID|CORRUPT|UNSUPPORTED|DECODE|RESOURCE_LIMIT/.test(String(error.code || ''));
    await Session.updateOne({ _id: sessionId, status: 'PROCESSING', leaseToken }, { $set: { status: 'FAILED', error: { code: invalid ? 'INVALID_VIDEO' : 'PROCESSING_FAILED', message: invalid ? 'This video could not be validated. Select another video.' : 'Video processing failed. You can retry.' }, ...(invalid ? { attempts: MAX_ATTEMPTS } : {}) }, $unset: { leaseToken: 1, leaseExpiresAt: 1 } });
    throw error;
  } finally { clearInterval(heartbeat); controller.abort(); await fs.rm(workDir, { recursive: true, force: true }); }
};

const recoverVideoUploads = async () => {
  await Session.updateMany({ status: 'PROCESSING', attempts: { $gte: MAX_ATTEMPTS }, leaseExpiresAt: { $lte: new Date() } }, { $set: { status: 'FAILED', error: { code: 'PROCESSING_RETRIES_EXHAUSTED', message: 'Video processing could not finish. Select the video again to restart.' } }, $unset: { leaseToken: 1, leaseExpiresAt: 1 } });
  const sessions = await Session.find({ ownerDeletedAt: null, status: { $in: ['QUEUED', 'PROCESSING'] }, uploadVerifiedAt: { $ne: null }, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS }, $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: new Date() } }] }).sort({ updatedAt: 1, _id: 1 }).limit(100).select('_id attempts');
  for (const session of sessions) await enqueue(session._id, session.attempts);
  return sessions.length;
};
const cleanupVideoUploads = async () => {
  // Never TTL-delete source records: cancellation/expiry cleanup is resumable and private sources are retained unless explicitly configured.
  const sessions = await Session.find({ postId: null, cleanedAt: null, $or: [{ status: { $in: ['CANCELLED', 'EXPIRED'] } }, { expiresAt: { $lte: new Date() } }] }).sort({ expiresAt: 1, _id: 1 }).limit(50).select(SESSION_SELECT);
  let count = 0;
  for (const session of sessions) {
    try {
      if (session.claimedPostId && await Post.exists({ _id: session.claimedPostId })) {
        await Session.updateOne({ _id: session._id, claimedPostId: session.claimedPostId }, { $set: { postId: session.claimedPostId } }); continue;
      }
      if (session.claimedPostId && !await require('./videoPostPublicationService').releaseAbandonedClaim(session)) continue;
      // Publication claims and expiry compete on the same row. Never delete
      // outputs after a publisher acquired its reservation.
      const expired = await Session.findOneAndUpdate({ _id: session._id, postId: null, claimedPostId: null,
        $or: [{ status: { $in: ['CANCELLED', 'EXPIRED'] } }, { expiresAt: { $lte: new Date() } }] },
      { $set: { status: session.status === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED' }, $unset: { leaseToken: 1, leaseExpiresAt: 1 } }, { new: true });
      if (!expired) continue;
      if (session.multipartUploadId) await storage().abortVideoMultipart(session.objectKey, session.multipartUploadId);
      for (const prefix of new Set([...(session.outputPrefixes || []), session.output?.prefix].filter(Boolean))) await storage().deletePrefix(`${prefix}/`);
      await storage().deletePrefix(`post-video-sources/${session.owner}/${session._id}/`);
      await Session.updateOne({ _id: session._id, postId: null }, { $set: { cleanedAt: new Date(), sourceCleanedAt: new Date() } }); count++;
    } catch { await Session.updateOne({ _id: session._id }, { $set: { cleanupErrorAt: new Date() } }); }
  }
  // Scan attached sessions fairly without a full collection load. Soft-deleted
  // posts get a one-day grace; a live reference always prevents deletion.
  const attached = await Session.find({ postId: { $ne: null }, derivativesCleanedAt: null })
    .sort({ cleanupCheckedAt: 1, _id: 1 }).limit(50).select('_id owner postId output outputPrefixes orphanedAt ownerDeletedAt');
  for (const row of attached) {
    try {
      const post = await Post.findById(row.postId).select('isActive updatedAt').lean();
      const delay = 24 * 60 * 60 * 1000;
      const deletedOwner = row.ownerDeletedAt && new Date(row.ownerDeletedAt).getTime() + delay <= Date.now();
      if (!deletedOwner && post && (post.isActive !== false || new Date(post.updatedAt).getTime() + delay > Date.now())) continue;
      if (!post) {
        const tombstone = await Session.findOneAndUpdate({ _id: row._id, orphanedAt: null }, { $set: { orphanedAt: new Date() } }, { new: true });
        if (tombstone || !row.orphanedAt || new Date(row.orphanedAt).getTime() + delay > Date.now()) continue;
      }
      if (await Post.exists({ isActive: { $ne: false }, ...(deletedOwner ? { author: { $ne: row.owner } } : {}), 'content.media.uploadSessionId': row._id })) continue;
      for (const prefix of new Set([...(row.outputPrefixes || []), row.output?.prefix].filter(Boolean))) {
        if (!String(prefix).startsWith(`post-video-playback/${row.owner}/${row._id}/`)) throw new Error('Unsafe cleanup prefix');
        await storage().deletePrefix(`${prefix}/`);
      }
      // Deleted content has completed its grace period and has no other live
      // reference; its source is no longer retained for reprocessing either.
      await storage().deletePrefix(`post-video-sources/${row.owner}/${row._id}/`);
      await Session.updateOne({ _id: row._id }, { $set: { derivativesCleanedAt: new Date(), sourceCleanedAt: new Date() } });
    } catch { await Session.updateOne({ _id: row._id }, { $set: { cleanupErrorAt: new Date() } }); }
    finally { await Session.updateOne({ _id: row._id }, { $set: { cleanupCheckedAt: new Date() } }); }
  }
  // Source cleanup is independently tracked so enabling approved retention later
  // still collects old originals. Verified READY outputs never depend on source retention.
  const days = Number(process.env.POST_VIDEO_SOURCE_RETENTION_DAYS || 0);
  if (Number.isFinite(days) && days > 0) {
    const due = await Session.find({ sourceCleanedAt: null, createdAt: { $lte: new Date(Date.now() - days * 86400000) }, status: { $in: ['READY', 'CANCELLED', 'EXPIRED'] } }).sort({ createdAt: 1, _id: 1 }).limit(50).select('_id owner status cleanedAt');
    for (const row of due) {
      try {
        await storage().deletePrefix(`post-video-sources/${row.owner}/${row._id}/`);
        await Session.updateOne({ _id: row._id, status: { $in: ['READY', 'CANCELLED', 'EXPIRED'] } }, { $set: { sourceCleanedAt: new Date() } });
      } catch { await Session.updateOne({ _id: row._id }, { $set: { cleanupErrorAt: new Date() } }); }
    }
  }
  return count;
};
const __setDependenciesForTests = deps => { Session = deps?.Session || VideoUploadSession; storageOverride = deps?.storage; generateOverride = deps?.generate; enqueueOverride = deps?.enqueue; };
module.exports = { policy, createSession, getSession, listParts, signParts, completeSession, cancelSession, retrySession, processVideoUploadJob, recoverVideoUploads, cleanupVideoUploads, dto, __setDependenciesForTests };
