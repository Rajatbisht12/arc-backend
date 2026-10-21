/** Real client-aborted PUT and S3 ETag/LastModified reuse. Round-2 staging only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { UploadEntry, UploadTransport } from '../../frontend/src/features/post-upload/videoUploads.ts';
const require = createRequire(import.meta.url);
const { uploadVideo, sourceFingerprint } = require('../../frontend/src/features/post-upload/videoUploads.ts');
assert.equal(process.argv[2], '--approved-round2'); assert.equal(process.argv.length, 5);
const m = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
assert.equal(m.round, 2); assert.equal(m.account, '906446637180');
assert.equal(m.bucket, 'squadhunt-video-staging-r2-906446637180-us-east-1');
assert.ok(Date.now() < Date.parse(m.expiresAt));
const aws = (...args: string[]) => JSON.parse(execFileSync('aws', [...args, '--region', m.region, '--output', 'json'], { encoding: 'utf8' }));
assert.equal(aws('sts', 'get-caller-identity').Account, m.account);
const c = JSON.parse(await fs.readFile(path.join(m.root, 'qa-owner-credentials.json'), 'utf8')); assert.equal(c.apiOrigin, m.api.ApiOrigin);
let token = '';
const call = async (route: string, method = 'GET', body?: unknown) => {
  assert.ok(route.startsWith('/api/'));
  const r = await fetch(m.api.ApiOrigin + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(r.ok, `Stage API rejected: ${r.status}`); return r.json();
};
const login = (await call('/api/auth/login', 'POST', { email: c.email, password: c.password })).data; token = login.token;
const source = new File([await openAsBlob(process.argv[4], { type: 'video/mp4' })], 'staging-part-recovery.mp4', { type: 'video/mp4', lastModified: 1 });
assert.equal(source.size, 9892321);
const base = '/api/posts/video-uploads';
const session = (await call(base, 'POST', { clientUploadId: randomUUID(), filename: source.name, mimeType: source.type, size: source.size })).data.session;
const route = `${base}/${session.id}`;
const signed = (await call(route + '/parts', 'POST', { partNumbers: [1, 2] })).data.parts;
for (const p of signed) { const u = new URL(p.url); assert.equal(u.hostname, m.bucket + '.s3.us-east-1.amazonaws.com'); assert.ok(u.pathname.startsWith('/post-video-sources/')); }
const first = await fetch(signed.find((p: any) => p.partNumber === 1).url, { method: 'PUT', body: source.slice(0, session.partSize) }); assert.equal(first.status, 200);
const prefix = `post-video-sources/${login.user._id}/${session.id}/`;
const uploads = aws('s3api', 'list-multipart-uploads', '--bucket', m.bucket, '--prefix', prefix).Uploads;
assert.equal(uploads.length, 1); const upload = uploads[0]; assert.ok(upload.Key.startsWith(prefix));
const physicalParts = () => aws('s3api', 'list-parts', '--bucket', m.bucket, '--key', upload.Key, '--upload-id', upload.UploadId).Parts || [];
const before = physicalParts(); assert.equal(before.length, 1); assert.equal(before[0].Size, session.partSize);
const tail = source.slice(session.partSize), abort = new AbortController(); let pulledBytes = 0, cancelled = false;
const interruptedBody = new ReadableStream({
  async pull(controller) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (cancelled || abort.signal.aborted) return;
    if (pulledBytes >= 262144) { abort.abort(); return; }
    const chunk = new Uint8Array(await tail.slice(pulledBytes, pulledBytes + 32768).arrayBuffer());
    pulledBytes += chunk.byteLength; controller.enqueue(chunk);
  },
  cancel() { cancelled = true; },
});
await assert.rejects(fetch(signed.find((p: any) => p.partNumber === 2).url, { method: 'PUT', body: interruptedBody, duplex: 'half', signal: abort.signal, headers: { 'Content-Length': String(tail.size) } } as RequestInit), { name: 'AbortError' });
assert.equal(abort.signal.aborted, true); assert.equal(pulledBytes, 262144);
const interrupted = physicalParts(); assert.equal(interrupted.length, 1); assert.deepEqual(interrupted[0], before[0]);
let entry: UploadEntry = { fingerprint: sourceFingerprint(source), filename: source.name, clientUploadId: randomUUID(), uploadedBytes: session.partSize, session };
let successfulRetryPuts = 0; let acceptedBeforeCompletion: any[] = [];
const transport: UploadTransport = {
  create: async () => { throw Error('Resume cannot create a second session'); },
  getSession: async id => (await call(`${base}/${id}`)).data.session,
  parts: async id => (await call(`${base}/${id}/parts`)).data.parts,
  sign: async (id, numbers) => { assert.deepEqual(numbers, [2]); return (await call(`${base}/${id}/parts`, 'POST', { partNumbers: numbers })).data.parts; },
  put: async (url, body, signal, changed) => { assert.equal(new URL(url).hostname, m.bucket + '.s3.us-east-1.amazonaws.com'); const r = await fetch(url, { method: 'PUT', body, signal }); assert.equal(r.status, 200); successfulRetryPuts++; changed(body.size); },
  complete: async id => { acceptedBeforeCompletion = physicalParts(); assert.equal(acceptedBeforeCompletion.length, 2); assert.deepEqual(acceptedBeforeCompletion[0], before[0]); return (await call(`${base}/${id}/complete`, 'POST', {})).data.session; },
  retry: async () => { throw Error('No processing failure expected'); },
  wait: async signal => { signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 2000)); },
};
await uploadVideo(source, entry, new AbortController().signal, next => { entry = next; }, transport);
assert.equal(entry.session!.status, 'READY'); assert.equal(successfulRetryPuts, 1);
const postKey = randomUUID(); const publish = async () => { const form = new FormData(); form.set('text', 'Controlled round2 interrupted-part synthetic fixture'); form.set('clientPostId', postKey); form.set('videoUploadIds', JSON.stringify([session.id])); const r = await fetch(m.api.ApiOrigin + '/api/posts', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }); assert.ok(r.ok); return (await r.json()).data.post; };
const published = await publish(); assert.equal(String((await publish())._id), String(published._id));
const sanitize = (part: any) => ({ number: part.PartNumber, bytes: part.Size, etag: part.ETag, lastModified: part.LastModified });
const result = { at: new Date().toISOString(), sessionId: session.id, sourceBytes: source.size, clientAbortAfterBodyBytesPulled: pulledBytes, interruptedPartNotAccepted: true, successfulRetryPuts, firstPartBefore: sanitize(before[0]), firstPartAfter: sanitize(acceptedBeforeCompletion[0]), secondPart: sanitize(acceptedBeforeCompletion[1]), firstPartExactlyUnchanged: true, status: 'READY', postId: String(published._id), publicationRetrySamePost: true, note: 'Actual client-aborted HTTP PUT and physical S3 ListParts evidence. Body bytes pulled are not proof of how many bytes reached S3. This is not physical Wi-Fi/cellular loss or Android background evidence.' };
await fs.writeFile(path.join(m.root, 'part-interruption-recovery-evidence.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
