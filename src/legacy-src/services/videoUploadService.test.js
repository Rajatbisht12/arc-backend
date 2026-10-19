const assert = require('node:assert/strict');
const test = require('node:test');
const { generateKeyPairSync } = require('crypto');
const service = require('./videoUploadService');
const { PART_SIZE } = require('../utils/postVideoPolicy');
const owner = 'a'.repeat(24), id = 'b'.repeat(24);
const oldEnvironment = { ...process.env };
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const setupEnvironment = () => Object.assign(process.env, { POST_VIDEO_UPLOADS_ENABLED: 'false', AWS_S3_BUCKET: 'test-bucket', POST_VIDEO_PRIVATE_DELIVERY_ENABLED: 'true', POST_VIDEO_CLOUDFRONT_URL: 'https://media.example.com', POST_VIDEO_API_ORIGIN: 'https://api.example.com', POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID: 'test-key', POST_VIDEO_CLOUDFRONT_PRIVATE_KEY: privateKey, POST_VIDEO_PLAYBACK_TOKEN_SECRET: 'test-secret-with-at-least-thirty-two-characters' });
const query = result => ({ select() { return Promise.resolve(result); }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } });
const mockSession = overrides => ({ _id: id, owner, status: 'UPLOADING', size: PART_SIZE + 3, partSize: PART_SIZE, partCount: 2, expiresAt: new Date(Date.now() + 60_000), objectKey: `post-video-sources/${owner}/${id}/source.mp4`, mimeType: 'video/mp4', multipartUploadId: 'stored-s3-upload', attempts: 0, ...overrides });
const mockModel = row => {
  const changes = [];
  const match = filter => row && Object.entries(filter).every(([key, value]) => key === '$or' || key === 'completionLeaseToken' || key === 'status' && value?.$in ? true : value === null ? row[key] == null : String(row[key]) === String(value));
  return {
    changes,
    findOne(filter) { return query(match(filter) ? row : null); },
    findOneAndUpdate(filter, update) {
      if (!match(filter)) return query(null);
      changes.push({ filter, update }); Object.assign(row, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete row[key];
      return query(row);
    },
    async updateOne(filter, update) { changes.push({ filter, update }); return { matchedCount: match(filter) ? 1 : 0 }; },
  };
};
test.beforeEach(setupEnvironment);
test.afterEach(() => { service.__setDependenciesForTests(); for (const key of Object.keys(process.env)) if (!(key in oldEnvironment)) delete process.env[key]; Object.assign(process.env, oldEnvironment); });
test('rollback disables new sessions but continues authorized part signing for existing sessions', async () => {
  const row = mockSession(); const signed = [];
  service.__setDependenciesForTests({ Session: mockModel(row), storage: { presignVideoPart: async (...args) => { signed.push(args); return 'https://s3.example/part'; } } });
  assert.equal(service.policy().enabled, false);
  assert.equal((await service.signParts(owner, id, [1, 2])).length, 2);
  assert.equal(signed[1][3], 3);
  await assert.rejects(service.createSession(owner, {}), { code: 'VIDEO_UPLOADS_UNAVAILABLE' });
});
test('ownership and expiry checked before S3 signing; batch is bounded', async () => {
  service.__setDependenciesForTests({ Session: mockModel(mockSession()), storage: { presignVideoPart: () => { throw new Error('must not sign'); } } });
  await assert.rejects(service.signParts('c'.repeat(24), id, [1]), { code: 'UPLOAD_NOT_FOUND' });
  for (const parts of [[0], [3], [1, 1], [1, 2, 3, 4, 5]]) await assert.rejects(service.signParts(owner, id, parts), { code: 'INVALID_PART_NUMBER' });
  service.__setDependenciesForTests({ Session: mockModel(mockSession({ expiresAt: new Date(0) })) });
  await assert.rejects(service.signParts(owner, id, [1]), { code: 'UPLOAD_EXPIRED' });
});
test('complete reconciles authoritative S3 parts and enqueues once; repeated completion is idempotent', async () => {
  const row = mockSession(); let finished = false, completed = 0, queued = 0;
  service.__setDependenciesForTests({ Session: mockModel(row), enqueue: async () => { queued++; }, storage: {
    headVideoSource: async () => { if (!finished) throw Object.assign(new Error('not found'), { name: 'NotFound' }); return { size: row.size, sessionId: id, contentType: row.mimeType }; },
    listVideoParts: async () => [{ partNumber: 1, size: PART_SIZE, etag: 'server-etag-1' }, { partNumber: 2, size: 3, etag: 'server-etag-2' }],
    completeVideoMultipart: async (_, uploadId, parts) => { assert.equal(uploadId, 'stored-s3-upload'); assert.equal(parts[1].etag, 'server-etag-2'); completed++; finished = true; },
  } });
  assert.equal((await service.completeSession(owner, id)).status, 'QUEUED');
  assert.equal((await service.completeSession(owner, id)).status, 'QUEUED');
  assert.equal(completed, 1); assert.equal(queued, 1);
});
test('completion rejects missing parts and size mismatch without enqueue', async () => {
  const row = mockSession(); let queued = 0;
  service.__setDependenciesForTests({ Session: mockModel(row), enqueue: async () => { queued++; }, storage: {
    headVideoSource: async () => { throw Object.assign(new Error('not found'), { name: 'NotFound' }); }, listVideoParts: async () => [],
  } });
  await assert.rejects(service.completeSession(owner, id), { code: 'UPLOAD_INCOMPLETE' }); assert.equal(queued, 0);
  service.__setDependenciesForTests({ Session: mockModel(row), storage: { headVideoSource: async () => ({ size: row.size + 1, sessionId: id, contentType: row.mimeType }) } });
  await assert.rejects(service.completeSession(owner, id), { code: 'UPLOAD_SIZE_MISMATCH' });
});
test('published/claimed sessions cannot be cancelled and DTO never reveals storage credentials or keys', async () => {
  const row = mockSession({ claimedPostId: 'd'.repeat(24), postId: 'd'.repeat(24) });
  service.__setDependenciesForTests({ Session: mockModel(row) });
  await assert.rejects(service.cancelSession(owner, id), { code: 'UPLOAD_ALREADY_PUBLISHED' });
  const dto = await service.getSession(owner, id);
  assert.equal(dto.objectKey, undefined); assert.equal(dto.multipartUploadId, undefined); assert.equal(dto.owner, undefined);
});
