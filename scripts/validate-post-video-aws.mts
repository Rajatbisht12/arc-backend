/** Approved staging ONLY. Real S3 HTTP bodies through the existing Web engine.
 * This is Node transport evidence, not browser XHR/native background evidence.
 * Run: node --import tsx scripts/validate-post-video-aws.mts --approved-staging MANIFEST SOURCE CREDENTIALS
 * CREDENTIALS is a mode-600 local JSON {apiOrigin,email,password}; never log it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { UploadEntry, UploadTransport } from '../../frontend/src/features/post-upload/videoUploads.ts';
const require = createRequire(import.meta.url);
const { uploadVideo, sourceFingerprint } = require('../../frontend/src/features/post-upload/videoUploads.ts');
if (process.argv[2] !== '--approved-staging' || process.argv.length !== 6) throw new Error('Requires --approved-staging MANIFEST SOURCE CREDENTIALS');
const manifest = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
assert.equal(manifest.account, '906446637180'); assert.equal(manifest.region, 'us-east-1');
assert.ok(Date.now() < Date.parse(manifest.expiresAt), 'Approved staging window expired');
const credentials = JSON.parse(await fs.readFile(process.argv[5], 'utf8'));
const api = manifest.api.ApiOrigin;
assert.equal(credentials.apiOrigin, api, 'Do not send test credentials to an unbound API');
assert.match(api, /^https:\/\/d[a-z0-9]+\.cloudfront\.net$/);
assert.match(manifest.bucket, /^squadhunt-video-staging-/);
const source = process.argv[4]; const size = (await fs.stat(source)).size;
assert.ok(size > 0 && size <= 524288000, 'Source must be a real supported video within 500 MiB');
let token = '';
async function request(route: string, options: RequestInit = {}) {
  assert.ok(route.startsWith('/api/'));
  const response = await fetch(api + route, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(`Stage API ${response.status}: ${body.code || 'request rejected'}`), { status: response.status, code: body.code });
  return body;
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const login = await request('/api/auth/login', json({ email: credentials.email, password: credentials.password }));
token = login.data.token; assert.ok(token);
const policy = (await request('/api/posts/video-uploads/policy')).data;
assert.equal(policy.enabled, true); assert.equal(policy.maxVideoBytes, 524288000);
// Real S3 initiation at the exact declared boundary, immediately aborted. This
// is an API boundary test, NOT proof that 500 MiB payload bytes were transferred.
const boundaryEvidence = path.join(manifest.root, 'api-boundary-evidence.json');
if (!(await fs.stat(boundaryEvidence).catch(() => null))) {
  const boundary = (await request('/api/posts/video-uploads', json({ clientUploadId: randomUUID(), filename: 'boundary.mp4', mimeType: 'video/mp4', size: 524288000 }))).data.session;
  await request(`/api/posts/video-uploads/${boundary.id}`, { method: 'DELETE' });
  await assert.rejects(request('/api/posts/video-uploads', json({ clientUploadId: randomUUID(), filename: 'over-limit.mp4', mimeType: 'video/mp4', size: 524288001 })), { status: 400, code: 'VIDEO_SIZE_LIMIT' });
  await fs.writeFile(boundaryEvidence, JSON.stringify({ at: new Date().toISOString(), policyMaxBytes: policy.maxVideoBytes,
    exactBoundarySessionCreatedAndCancelled: true, extraByteRejected: true, payloadBytesTransferred: 0 }, null, 2));
}

const file = new File([await openAsBlob(source, { type: source.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' })], path.basename(source), { type: source.endsWith('.mov') ? 'video/quicktime' : 'video/mp4', lastModified: 1 });
let entry: UploadEntry = { fingerprint: sourceFingerprint(file), filename: file.name, clientUploadId: randomUUID(), uploadedBytes: 0 };
console.log(JSON.stringify({ event: 'staging_upload_started', source: file.name, sourceBytes: size }));
const prefix = '/api/posts/video-uploads';
let puts = 0, active = 0, maxActive = 0, acknowledgedBytes = 0, injectedLoss = false;
let firstPutAt = 0, lastPutAckAt = 0, completedAt = 0;
const transport: UploadTransport = {
  create: async (file, key) => (await request(prefix, json({ clientUploadId: key, filename: file.name, mimeType: file.type, size: file.size }))).data.session,
  getSession: async id => (await request(`${prefix}/${id}`)).data.session,
  parts: async id => (await request(`${prefix}/${id}/parts`)).data.parts,
  sign: async (id, partNumbers) => (await request(`${prefix}/${id}/parts`, json({ partNumbers }))).data.parts,
  complete: async id => { const result = (await request(`${prefix}/${id}/complete`, json({}))).data.session; completedAt = Date.now(); return result; },
  retry: async id => (await request(`${prefix}/${id}/retry`, json({}))).data.session,
  put: async (url, body, signal, changed) => {
    const target = new URL(url);
    assert.equal(target.protocol, 'https:');
    assert.ok([`${manifest.bucket}.s3.us-east-1.amazonaws.com`, `${manifest.bucket}.s3.amazonaws.com`].includes(target.hostname), 'Signed upload must target the NEW staging bucket');
    assert.ok(target.pathname.startsWith('/post-video-sources/'));
    active++; maxActive = Math.max(maxActive, active);
    firstPutAt ||= Date.now();
    try {
      const response = await fetch(url, { method: 'PUT', body, signal });
      assert.equal(response.status, 200, 'S3 rejected upload part (signed URL omitted)');
      puts++; acknowledgedBytes += body.size; lastPutAckAt = Date.now(); changed(body.size);
      console.log(JSON.stringify({ event: 'staging_part_accepted', acceptedParts: puts, acknowledgedBytes }));
      if (puts === 2) { injectedLoss = true; throw new Error('Controlled acknowledgement loss after S3 accepted the part'); }
    } finally { active--; }
  },
  wait: async signal => { signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 2000)); signal.throwIfAborted(); },
};
const root = await fs.mkdtemp(path.join(manifest.root, 'aws-upload-evidence-'));
const started = Date.now();
let reusable = 0;
try {
  await uploadVideo(file, entry, new AbortController().signal, next => { entry = next; }, transport);
} catch (error) {
  if (!injectedLoss) throw error;
  const parts = await transport.parts(entry.session!.id, new AbortController().signal);
  const accepted = new Set(parts.map(part => part.partNumber)); reusable = accepted.size;
  assert.ok(reusable > 0);
  await fs.writeFile(path.join(root, 'draft.json'), JSON.stringify(entry), { mode: 0o600 });
  entry = JSON.parse(await fs.readFile(path.join(root, 'draft.json'), 'utf8'));
  const sign = transport.sign;
  transport.sign = (id, numbers, signal) => { assert.ok(numbers.every(number => !accepted.has(number)), 'Accepted S3 parts must not be uploaded again'); return sign(id, numbers, signal); };
  await uploadVideo(file, entry, new AbortController().signal, next => { entry = next; }, transport);
}
assert.equal(entry.session!.status, 'READY'); assert.equal(entry.uploadedBytes, size); assert.ok(maxActive <= 2);
assert.equal(acknowledgedBytes, size, 'Every source byte acknowledged exactly once across resume');
const clientPostId = randomUUID();
const form = () => { const body = new FormData(); body.set('text', `Controlled staging video fixture ${file.name}`); body.set('clientPostId', clientPostId); body.set('videoUploadIds', JSON.stringify([entry.session!.id])); body.set('mediaOrder', JSON.stringify([{ type: 'video', sessionId: entry.session!.id }])); return body; };
const first = (await request('/api/posts', { method: 'POST', body: form() })).data.post;
const second = (await request('/api/posts', { method: 'POST', body: form() })).data.post;
const postId = String(first._id || first.id); assert.equal(String(second._id || second.id), postId);
const detail = (await request(`/api/posts/${postId}`)).data.post;
const media = detail.content.media[0];
const hls = media.playback.hlsUrl, fallback = media.playback.fallbackMp4Url;
assert.ok(hls.startsWith(api + '/api/posts/video-playback/'));
assert.ok(fallback.startsWith(manifest.media.MediaOrigin + '/post-video-playback/'));
async function permitted(url: string, range = false) {
  const origin = new URL(url).origin;
  assert.ok([api, manifest.media.MediaOrigin].includes(origin));
  const response = await fetch(url, { headers: range ? { Range: 'bytes=0-1023', Origin: 'http://localhost:3001' } : {} });
  assert.equal(response.status, range ? 206 : 200, 'Playback denied; grant deliberately omitted');
  if (range) assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3001');
  return response;
}
const master = await (await permitted(hls)).text();
const variant = master.split('\n').find(line => line && !line.startsWith('#'))!;
const variantText = await (await permitted(variant)).text();
const segment = variantText.split('\n').find(line => line && !line.startsWith('#'))!;
const segmentResponse = await permitted(segment); await segmentResponse.body?.cancel();
const mp4 = await permitted(fallback, true); assert.equal((await mp4.arrayBuffer()).byteLength, 1024);
const unsigned = new URL(fallback); unsigned.search = '';
assert.equal((await fetch(unsigned)).status, 403, 'Unsigned playback must be denied');
const result = { platform: 'Node using production Web engine + real stage API/S3 (not browser/native)', source: file.name,
  sourceBytes: size, parts: entry.session!.partCount, successfulPuts: puts, acknowledgedBytes, maxConcurrentPuts: maxActive,
  reusedAcceptedParts: reusable, interruption: injectedLoss ? 'Controlled lost application acknowledgement after real successful S3 PUT' : 'Not exercised (small source)',
  wallSecondsUploadAndProcessing: (Date.now() - started) / 1000, status: entry.session!.status, sessionId: entry.session!.id, postId,
  s3PutWindowSeconds: (lastPutAckAt - firstPutAt) / 1000,
  uploadThroughCompletionSeconds: (completedAt - started) / 1000,
  publicationRetrySamePost: true, hlsManifestAndSegment: 'HTTP 200', optimizedMp4Range: 'HTTP 206 / 1024 bytes', unsignedPlayback: 'HTTP 403',
  boundary: '500 MiB session created/aborted; +1 byte rejected; exact 500 MiB PAYLOAD NOT claimed unless sourceBytes is 524288000' };
await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ evidence: path.join(root, 'result.json'), ...result }, null, 2));
