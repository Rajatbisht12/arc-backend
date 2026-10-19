const assert = require('node:assert/strict');
const test = require('node:test');
const { MAX_VIDEO_BYTES, PART_SIZE, validateVideoInput, verifyParts, expectedPartSize } = require('./postVideoPolicy');
const { parseIds, postIdentity, arrangeMedia } = require('../services/videoPostPublicationService');
const { generateKeyPairSync } = require('crypto');
const { privateDeliveryReady, resolvePlaybackKey, verifyPlaybackToken, rewriteManifest, tokenForPrefix } = require('./postVideoDelivery');
const owner = 'a'.repeat(24), id = 'b'.repeat(24);
const clientUploadId = '123e4567-e89b-42d3-a456-426614174000';

test('exact 500 MiB and maximum part boundary are accepted; extra byte rejected', () => {
  const data = validateVideoInput({ clientUploadId, filename: '../../movie.mp4', size: MAX_VIDEO_BYTES, mimeType: 'video/mp4' });
  assert.equal(data.partCount, 63); assert.equal(expectedPartSize(data, 63), 4 * 1024 * 1024);
  assert.equal(data.filename.includes('/'), false);
  for (const size of [0, -1, 1.5, MAX_VIDEO_BYTES + 1, Infinity]) assert.throws(() => validateVideoInput({ clientUploadId, size, mimeType: 'video/mp4' }), { code: 'VIDEO_SIZE_LIMIT' });
});
test('MIME allowlist and client id are checked independently of extension', () => {
  assert.throws(() => validateVideoInput({ clientUploadId, size: 8, filename: 'clip.mp4', mimeType: 'application/octet-stream' }), { code: 'UNSUPPORTED_VIDEO' });
  assert.throws(() => validateVideoInput({ clientUploadId: '../invalid', size: 8, mimeType: 'video/mp4' }), { code: 'INVALID_CLIENT_ID' });
  for (const mimeType of ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']) assert.equal(validateVideoInput({ clientUploadId, size: 1, mimeType }).mimeType, mimeType);
});
test('multipart completion rejects missing, duplicate, out-of-order size or excess parts', () => {
  const session = { size: PART_SIZE + 3, partSize: PART_SIZE, partCount: 2 };
  const parts = [{ partNumber: 2, size: 3, etag: 'last' }, { partNumber: 1, size: PART_SIZE, etag: 'first' }];
  assert.deepEqual(verifyParts(session, parts).map(row => row.partNumber), [1, 2]);
  for (const bad of [parts.slice(1), [parts[0], parts[0]], [{ ...parts[1], size: 1 }, parts[0]], [...parts, parts[0]]]) assert.throws(() => verifyParts(session, bad));
});
test('post identity is stable per owner and request; media order cannot omit or duplicate', () => {
  assert.equal(String(postIdentity(owner, clientUploadId)), String(postIdentity(owner, clientUploadId)));
  assert.notEqual(String(postIdentity(owner, clientUploadId)), String(postIdentity(id, clientUploadId)));
  assert.throws(() => parseIds(JSON.stringify([id, id])));
  assert.throws(() => parseIds('not-json'));
  const image = { type: 'image' }, video = { type: 'video', uploadSessionId: id };
  assert.deepEqual(arrangeMedia([image], [video], [{ type: 'video', sessionId: id }, { type: 'image', index: 0 }]), [video, image]);
  assert.throws(() => arrangeMedia([image], [video], [{ type: 'image', index: 0 }, { type: 'image', index: 0 }]));
  assert.throws(() => arrangeMedia([image, image, image, image, image], [video]));
});
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const environment = { POST_VIDEO_PRIVATE_DELIVERY_ENABLED: 'true', POST_VIDEO_CLOUDFRONT_URL: 'https://media.example.com', POST_VIDEO_API_ORIGIN: 'https://api.example.com', POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID: 'test-key', POST_VIDEO_CLOUDFRONT_PRIVATE_KEY: privateKey, POST_VIDEO_PLAYBACK_TOKEN_SECRET: 'test-secret-with-at-least-thirty-two-characters' };
const prefix = `post-video-playback/${owner}/${id}/version/`;
test('private delivery fails closed and grants are signed and expire', () => {
  assert.equal(privateDeliveryReady({}), false); assert.equal(privateDeliveryReady(environment), true);
  const url = resolvePlaybackKey(`${prefix}master.m3u8`, environment);
  assert.match(url, /^https:\/\/api\.example.com\/api\/posts\/video-playback\//);
  const token = new URL(url).searchParams.get('token');
  assert.equal(verifyPlaybackToken(token, environment).prefix, prefix);
  assert.throws(() => verifyPlaybackToken(`${token}x`, environment), { code: 'PLAYBACK_EXPIRED' });
  assert.throws(() => verifyPlaybackToken(tokenForPrefix(prefix, 1, environment), environment), { code: 'PLAYBACK_EXPIRED' });
  assert.match(resolvePlaybackKey(`${prefix}fallback.mp4`, environment), /Signature=.+&Key-Pair-Id=test-key/);
});
test('HLS master, variant, init and segment URI grants stay within authorized prefix', () => {
  const token = tokenForPrefix(prefix, Math.floor(Date.now() / 1000) + 300, environment);
  const master = rewriteManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000\n360p/index.m3u8\n', `${prefix}master.m3u8`, token, environment);
  assert.match(master, /api.example.com\/api\/posts\/video-playback\/.+360p\/index.m3u8\?token=/);
  const media = rewriteManifest('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nseg_000.m4s\n', `${prefix}360p/index.m3u8`, token, environment);
  assert.match(media, /URI="https:\/\/media.example.com\/.+init.mp4\?Expires=/);
  assert.match(media, /seg_000.m4s\?Expires=/);
  for (const uri of ['../../../../other.m3u8', 'https://evil.example/clip.ts', '/clip.ts', 'seg.ts?token=bad']) assert.throws(() => rewriteManifest(`#EXTM3U\n${uri}`, `${prefix}master.m3u8`, token, environment));
});
