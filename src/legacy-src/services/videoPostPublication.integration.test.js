const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, generateKeyPairSync } = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Session = require('../models/VideoUploadSession');
const Post = require('../models/Post');
const User = require('../models/User');
const Follow = require('../models/Follow');
const publication = require('./videoPostPublicationService');
const service = require('./videoUploadService');
const controller = require('../controllers/videoUploadController');
const { tokenForPrefix } = require('../utils/postVideoDelivery');
const oldEnvironment = { ...process.env };
const systemBinary = process.env.MONGOMS_SYSTEM_BINARY || '/opt/homebrew/bin/mongod';
const available = fs.existsSync(systemBinary);
let db;
const owner = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
const newReady = async () => {
  const _id = new mongoose.Types.ObjectId();
  const prefix = `post-video-playback/${owner}/${_id}/version`;
  return Session.create({ _id, owner, clientUploadId: randomUUID(), filename: 'video.mp4', mimeType: 'video/mp4', size: 1024, partSize: 8388608, partCount: 1, objectKey: `post-video-sources/${owner}/${_id}/source.mp4`, status: 'READY', expiresAt: new Date(Date.now() + 3600000), metadata: { width: 640, height: 360, duration: 2 }, output: { prefix, hlsKey: `${prefix}/master.m3u8`, fallbackKey: `${prefix}/fallback.mp4`, thumbnailKey: `${prefix}/thumbnail.jpg`, renditions: [] } });
};
test.before(async () => {
  if (!available) return;
  db = await MongoMemoryServer.create({ binary: { systemBinary, version: '8.3.7' }, instance: { storageEngine: 'wiredTiger' } });
  await mongoose.connect(db.getUri()); await Session.createIndexes(); await Post.createIndexes();
  Object.assign(process.env, { POST_VIDEO_UPLOADS_ENABLED: 'true', AWS_S3_BUCKET: 'isolated-test', POST_VIDEO_PRIVATE_DELIVERY_ENABLED: 'true', POST_VIDEO_CLOUDFRONT_URL: 'https://media.example.com', POST_VIDEO_API_ORIGIN: 'https://api.example.com', POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID: 'test-key', POST_VIDEO_CLOUDFRONT_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), POST_VIDEO_PLAYBACK_TOKEN_SECRET: 'isolated-test-secret-at-least-thirty-two-characters' });
  await User.create({ _id: owner, username: 'video_owner_fixture', email: 'video_owner@example.invalid', password: 'Fixture!123', userType: 'player', profile: { displayName: 'Fixture' }, isActive: true });
});
test.after(async () => {
  controller.__setManifestReaderForTests(); service.__setDependenciesForTests();
  await mongoose.disconnect(); if (db) await db.stop();
  for (const key of Object.keys(process.env)) if (!(key in oldEnvironment)) delete process.env[key]; Object.assign(process.env, oldEnvironment);
});
test('READY-only ownership and same-post lease protect reservation and compensate failures', { skip: !available }, async () => {
  const session = await newReady();
  const postId = publication.postIdentity(owner, randomUUID());
  const lease = await publication.acquirePublication(owner, postId);
  await assert.rejects(publication.acquirePublication(owner, postId), { code: 'POST_PUBLICATION_BUSY' });
  await assert.rejects(publication.reserveReadyVideos({ owner: other, ids: [String(session._id)], postId }), { code: 'UPLOAD_NOT_FOUND' });
  const media = await publication.reserveReadyVideos({ owner, ids: [String(session._id)], postId, claimToken: lease.token });
  assert.equal(media[0].playback.status, 'ready'); assert.equal(media[0].url, session.output.fallbackKey);
  await assert.rejects(service.cancelSession(owner, String(session._id)), { code: 'UPLOAD_ALREADY_PUBLISHED' });
  await publication.finishPublication(lease);
  const released = await Session.findById(session._id); assert.equal(released.claimedPostId, undefined);
  service.__setDependenciesForTests({ storage: { abortVideoMultipart: async () => {} } });
  assert.equal((await service.cancelSession(owner, String(session._id))).status, 'CANCELLED');
});
test('concurrent cancellation versus publication permits only one winning transition', { skip: !available }, async () => {
  const session = await newReady(); const postId = publication.postIdentity(owner, randomUUID());
  const lease = await publication.acquirePublication(owner, postId);
  const results = await Promise.allSettled([
    publication.reserveReadyVideos({ owner, ids: [String(session._id)], postId, claimToken: lease.token }),
    service.cancelSession(owner, String(session._id)),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  await publication.finishPublication(lease);
});
test('successful publication preserves association and private manifest access is revoked after privacy/delete changes', { skip: !available }, async () => {
  const session = await newReady(); const postId = publication.postIdentity(owner, randomUUID());
  const lease = await publication.acquirePublication(owner, postId);
  const media = await publication.reserveReadyVideos({ owner, ids: [String(session._id)], postId, claimToken: lease.token });
  await Post.create({ _id: postId, author: owner, clientPostId: randomUUID(), content: { text: 'Local fixture', media }, visibility: 'public' });
  await publication.finishPublication(lease);
  assert.equal(String((await Session.findById(session._id)).postId), String(postId));
  const prefix = `${session.output.prefix}/`;
  const token = tokenForPrefix(prefix, Math.floor(Date.now() / 1000) + 300, process.env);
  const request = { params: { 0: `${owner}/${session._id}/version/master.m3u8` }, query: { token } };
  controller.__setManifestReaderForTests(async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000\n360p/index.m3u8');
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, type() { return this; }, send(value) { this.body = value; return this; }, end() { return this; }, json(value) { this.body = value; return this; } });
  const publicResponse = response(); await controller.playbackManifest(request, publicResponse); assert.equal(publicResponse.statusCode, 200); assert.match(publicResponse.body, /token=/);
  await User.updateOne({ _id: owner }, { $set: { 'privacySettings.profileVisibility': 'private' } });
  const privateResponse = response(); await controller.playbackManifest(request, privateResponse); assert.equal(privateResponse.statusCode, 403);
  const ownerRequest = { ...request, query: { token: tokenForPrefix(prefix, Math.floor(Date.now() / 1000) + 300, process.env, String(owner)) } };
  const ownerResponse = response(); await controller.playbackManifest(ownerRequest, ownerResponse); assert.equal(ownerResponse.statusCode, 200);
  await Post.updateOne({ _id: postId }, { $set: { isActive: false } });
  const deletedResponse = response(); await controller.playbackManifest(ownerRequest, deletedResponse); assert.equal(deletedResponse.statusCode, 403);
});
test('cleanup is delayed, idempotent and never removes a live post reference', { skip: !available }, async () => {
  await Session.deleteMany({}); await Post.deleteMany({});
  const deleted = [];
  service.__setDependenciesForTests({ storage: { deletePrefix: async prefix => deleted.push(prefix), abortVideoMultipart: async () => {} } });
  const active = await newReady(), recent = await newReady(), old = await newReady(), orphan = await newReady();
  const attach = async (session, isActive, oldTimestamp = false) => {
    const post = await Post.create({ author: owner, isActive, content: { text: 'Cleanup fixture', media: [{ type: 'video', url: session.output.fallbackKey, publicId: session.output.fallbackKey, uploadSessionId: session._id }] } });
    if (oldTimestamp) await Post.collection.updateOne({ _id: post._id }, { $set: { updatedAt: new Date(Date.now() - 2 * 86400000) } });
    await Session.updateOne({ _id: session._id }, { $set: { postId: post._id } });
    return post;
  };
  await attach(active, true); await attach(recent, false); await attach(old, false, true);
  await Session.updateOne({ _id: orphan._id }, { $set: { postId: new mongoose.Types.ObjectId() } });
  await service.cleanupVideoUploads();
  assert.deepEqual(deleted, [`${old.output.prefix}/`, `post-video-sources/${owner}/${old._id}/`]);
  assert.equal((await Session.findById(active._id)).derivativesCleanedAt, undefined);
  assert.equal((await Session.findById(recent._id)).derivativesCleanedAt, undefined);
  assert.ok((await Session.findById(orphan._id)).orphanedAt);
  await service.cleanupVideoUploads(); assert.equal(deleted.length, 2, 'already cleaned output is not deleted twice');
  await Session.updateOne({ _id: orphan._id }, { $set: { orphanedAt: new Date(Date.now() - 2 * 86400000) } });
  await service.cleanupVideoUploads(); assert.ok(deleted.includes(`${orphan.output.prefix}/`));
});
test('expired unpublished sources are collected, while an active publication lease prevents cleanup', { skip: !available }, async () => {
  await Session.deleteMany({}); await Post.deleteMany({});
  const deleted = [];
  service.__setDependenciesForTests({ storage: { deletePrefix: async prefix => deleted.push(prefix), abortVideoMultipart: async () => {} } });
  const expired = await newReady(), claimed = await newReady();
  const postId = publication.postIdentity(owner, randomUUID());
  const lease = await publication.acquirePublication(owner, postId);
  await publication.reserveReadyVideos({ owner, ids: [String(claimed._id)], postId, claimToken: lease.token });
  await Session.updateMany({ _id: { $in: [expired._id, claimed._id] } }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await service.cleanupVideoUploads();
  assert.ok(deleted.includes(`post-video-sources/${owner}/${expired._id}/`));
  assert.ok(deleted.includes(`${expired.output.prefix}/`));
  assert.ok(!deleted.some(prefix => prefix.includes(String(claimed._id))));
  await publication.finishPublication(lease);
});
test('stale worker leases recover and duplicate deliveries publish outputs only once', { skip: !available }, async () => {
  await Session.deleteMany({}); await Post.deleteMany({});
  const row = await newReady(); const queued = []; let generations = 0;
  await Session.updateOne({ _id: row._id }, { $set: { status: 'PROCESSING', attempts: 1, uploadVerifiedAt: new Date(), leaseExpiresAt: new Date(0) }, $unset: { output: 1 } });
  service.__setDependenciesForTests({ enqueue: async (...args) => queued.push(args),
    storage: {
      headVideoSource: async () => ({ size: row.size, sessionId: String(row._id) }),
      downloadFile: async (_key, target) => fsp.writeFile(target, 'lifecycle-only fixture'),
      uploadMediaFile: async () => {}, deletePrefix: async () => {},
    },
    // Media validity is covered by real-FFmpeg tests; this injection isolates
    // durable job/lease behavior without encoding during a race test.
    generate: async ({ outputDir }) => {
      generations++; await fsp.mkdir(outputDir, { recursive: true });
      for (const name of ['master.m3u8', 'fallback.mp4', 'thumbnail.jpg']) await fsp.writeFile(path.join(outputDir, name), name);
      return { metadata: { duration: 2, width: 640, height: 360 }, renditions: [], outputBytes: { fallback: 12, thumbnail: 13, hls: 14, total: 39 } };
    },
  });
  assert.equal(await service.recoverVideoUploads(), 1); assert.equal(queued[0][1], '1');
  const results = await Promise.all([service.processVideoUploadJob({ sessionId: String(row._id) }), service.processVideoUploadJob({ sessionId: String(row._id) })]);
  assert.equal(results.filter(result => result.skipped).length, 1); assert.equal(generations, 1);
  const ready = await Session.findById(row._id); assert.equal(ready.status, 'READY'); assert.equal(ready.attempts, 2);
  assert.equal((await service.processVideoUploadJob({ sessionId: String(row._id) })).skipped, true);
  assert.equal(generations, 1);
});
test('READY maintenance removes only superseded attempt outputs and retries failed deletion', { skip: !available }, async () => {
  await Session.deleteMany({}); await Post.deleteMany({});
  const row = await newReady();
  const stale = `post-video-playback/${owner}/${row._id}/interrupted-attempt`;
  const outside = `post-video-playback/${other}/${row._id}/not-owned`;
  await Session.updateOne({ _id: row._id }, { $set: { outputPrefixes: [stale, row.output.prefix, outside] } });
  const deleted = []; let fail = true;
  service.__setDependenciesForTests({ storage: { deletePrefix: async prefix => {
    if (fail) throw new Error('Temporary storage error');
    deleted.push(prefix);
  } } });
  await service.cleanupVideoUploads();
  assert.ok((await Session.findById(row._id)).cleanupErrorAt);
  assert.ok((await Session.findById(row._id)).outputPrefixes.includes(stale));
  fail = false;
  await service.cleanupVideoUploads();
  await service.cleanupVideoUploads();
  assert.deepEqual(deleted, [`${stale}/`]);
  const after = await Session.findById(row._id);
  assert.equal(after.output.prefix, row.output.prefix);
  assert.ok(after.outputPrefixes.includes(row.output.prefix));
  assert.ok(after.outputPrefixes.includes(outside), 'unsafe paths are never deleted');
  assert.equal(after.sourceCleanedAt, undefined, 'live source retention is unchanged');
});

test('renewal rechecks current ACLs, requires a live publication and never trusts an old bearer', { skip: !available }, async () => {
  await User.updateOne({ _id: owner }, { $set: { 'privacySettings.profileVisibility': 'public', blockedUsers: [], isActive: true } });
  await User.create({ _id: other, username: 'renewal_viewer', email: 'renewal_viewer@example.invalid', password: 'Fixture!123', profile: { displayName: 'Renewal fixture' }, userType: 'player', isActive: true });
  const session = await newReady();
  const post = await Post.create({ author: owner, visibility: 'public', content: { text: 'Renewal fixture', media: [{ type: 'video', url: session.output.fallbackKey, publicId: session.output.fallbackKey, uploadSessionId: session._id }] } });
  await Session.updateOne({ _id: session._id }, { $set: { postId: post._id } });
  const request = async (viewer) => {
    const res = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await controller.renewPlaybackGrant({ params: { id: String(session._id) }, user: viewer ? { _id: viewer } : undefined, query: { token: 'old-bearer-is-not-authentication' } }, res);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    if (res.statusCode !== 200) assert.equal(res.body.data, undefined, 'denial never includes signed media');
    return res;
  };
  const publicGrant = await request(); assert.equal(publicGrant.statusCode, 200);
  const auth = publicGrant.body.data.playback.authorization;
  assert.equal(auth.renewalPath, `/api/posts/video-playback-grants/${session._id}`);
  assert.ok(auth.expiresInSeconds <= 300 && auth.expiresInSeconds > 269);
  assert.ok(auth.refreshAfterSeconds <= 240);
  assert.match(publicGrant.body.data.playback.fallbackMp4Url, /Expires=/);
  assert.ok(!JSON.stringify(publicGrant.body).includes('post-video-sources'));
  await User.updateOne({ _id: owner }, { $set: { 'privacySettings.profileVisibility': 'private' } });
  assert.equal((await request()).statusCode, 403);
  assert.equal((await request(other)).statusCode, 403);
  assert.equal((await request(owner)).statusCode, 200);
  await Follow.create({ follower: other, following: owner, status: 'accepted' });
  assert.equal((await request(other)).statusCode, 200);
  await User.updateOne({ _id: owner }, { $set: { blockedUsers: [other] } });
  assert.equal((await request(other)).statusCode, 403);
  await User.updateOne({ _id: owner }, { $set: { blockedUsers: [] } });
  await User.updateOne({ _id: other }, { $set: { isActive: false } });
  assert.equal((await request(other)).statusCode, 403);
  await User.updateOne({ _id: other }, { $set: { isActive: true } });
  await Post.updateOne({ _id: post._id }, { $set: { hiddenByAdmin: true } });
  assert.equal((await request(owner)).statusCode, 403);
  await Post.updateOne({ _id: post._id }, { $set: { hiddenByAdmin: false, isActive: false } });
  assert.equal((await request(owner)).statusCode, 403);
  await Post.updateOne({ _id: post._id }, { $set: { isActive: true, 'content.media': [] } });
  assert.equal((await request(owner)).statusCode, 403);
  await Session.updateOne({ _id: session._id }, { $set: { status: 'PROCESSING' } });
  assert.equal((await request(owner)).statusCode, 404);
});

test('heartbeat renews a healthy lease; cancellation during encoding cannot resurrect READY', { skip: !available }, async t => {
  await Session.deleteMany({}); await Post.deleteMany({});
  const row = await newReady();
  await Session.updateOne({ _id: row._id }, { $set: { status: 'QUEUED', attempts: 0, uploadVerifiedAt: new Date() }, $unset: { output: 1 } });
  let heartbeat, finish, started;
  const encoding = new Promise(resolve => { started = resolve; });
  const originalInterval = global.setInterval;
  t.mock.method(global, 'setInterval', (fn, delay, ...args) => delay === 30000 ? (heartbeat = fn, { unref() {} }) : originalInterval(fn, delay, ...args));
  const deleted = [];
  service.__setDependenciesForTests({ storage: {
    headVideoSource: async () => ({ size: row.size, sessionId: String(row._id) }),
    downloadFile: async (_key, target) => fsp.writeFile(target, 'lease-only fixture'),
    uploadMediaFile: async () => { throw Error('Cancelled output must never upload'); },
    deletePrefix: async prefix => deleted.push(prefix),
  }, generate: async ({ signal }) => {
    started(signal); return new Promise(resolve => { finish = resolve; });
  } });
  const running = service.processVideoUploadJob({ sessionId: String(row._id) });
  const signal = await encoding;
  const initial = await Session.findById(row._id);
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 120000);
  await heartbeat();
  const extended = await Session.findById(row._id);
  assert.ok(extended.leaseExpiresAt.getTime() >= initial.leaseExpiresAt.getTime() + 119000);
  assert.equal((await service.processVideoUploadJob({ sessionId: String(row._id) })).skipped, true);
  assert.equal((await service.cancelSession(owner, String(row._id))).status, 'CANCELLED');
  await heartbeat(); assert.equal(signal.aborted, true);
  finish({}); await assert.rejects(running, { code: 'PROCESSING_CANCELLED' });
  const after = await Session.findById(row._id);
  assert.equal(after.status, 'CANCELLED'); assert.equal(after.output, undefined);
  assert.equal(deleted.length, 1); assert.ok(!deleted[0].includes('post-video-sources'));
});

test('lost lease during output publication cannot replace the newer winner or remove its files', { skip: !available }, async () => {
  await Session.deleteMany({}); await Post.deleteMany({});
  const row = await newReady();
  await Session.updateOne({ _id: row._id }, { $set: { status: 'QUEUED', attempts: 0, uploadVerifiedAt: new Date() }, $unset: { output: 1 } });
  const winner = `post-video-playback/${owner}/${row._id}/different-winner`;
  const deleted = []; let changed = false;
  service.__setDependenciesForTests({ storage: {
    headVideoSource: async () => ({ size: row.size, sessionId: String(row._id) }),
    downloadFile: async (_key, target) => fsp.writeFile(target, 'publication-race-only fixture'),
    uploadMediaFile: async () => {
      if (!changed) { changed = true; await Session.updateOne({ _id: row._id }, { $set: { status: 'READY', leaseToken: 'different-lease', output: { prefix: winner } } }); }
    }, deletePrefix: async prefix => deleted.push(prefix),
  }, generate: async ({ outputDir }) => {
    await fsp.mkdir(outputDir, { recursive: true });
    for (const name of ['master.m3u8', 'fallback.mp4', 'thumbnail.jpg']) await fsp.writeFile(path.join(outputDir, name), name);
    return { metadata: { duration: 2, width: 640, height: 360 }, renditions: [] };
  } });
  const result = await service.processVideoUploadJob({ sessionId: String(row._id) });
  assert.equal(result.skipped, true);
  assert.equal((await Session.findById(row._id)).output.prefix, winner);
  assert.equal(deleted.length, 1); assert.ok(!deleted[0].includes('different-winner')); assert.ok(!deleted[0].includes('post-video-sources'));
});
