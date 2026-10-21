/** Approved disposable round-2 staging only. Waits for REAL API-issued S3 expiry. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { UploadEntry, UploadTransport } from '../../frontend/src/features/post-upload/videoUploads.ts';
const require = createRequire(import.meta.url);
const { uploadVideo, sourceFingerprint } = require('../../frontend/src/features/post-upload/videoUploads.ts');
if (process.argv[2] !== '--approved-round2' || process.argv.length !== 5) throw Error('Use --approved-round2 MANIFEST SYNTHETIC_10MIB_SOURCE');
const m = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
assert.equal(m.round, 2); assert.equal(m.account, '906446637180'); assert.ok(Date.now() < Date.parse(m.expiresAt));
assert.equal(m.bucket, 'squadhunt-video-staging-r2-906446637180-us-east-1');
const credentials = JSON.parse(await fs.readFile(path.join(m.root, 'qa-owner-credentials.json'), 'utf8'));
assert.equal(credentials.apiOrigin, m.api.ApiOrigin);
const api = credentials.apiOrigin; let token = '';
const call = async (route: string, method = 'GET', data?: unknown) => {
  assert.ok(route.startsWith('/api/'));
  const response = await fetch(api + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  assert.ok(response.ok, `Stage request rejected: ${response.status}`); return response.json();
};
token = (await call('/api/auth/login', 'POST', { email: credentials.email, password: credentials.password })).data.token;
const blob = await openAsBlob(process.argv[4], { type: 'video/mp4' });
assert.ok(blob.size > 8388608 && blob.size < 52428800);
const file = new File([blob], 'staging-expired-put.mp4', { type: 'video/mp4', lastModified: 1 });
const base = '/api/posts/video-uploads';
const session = (await call(base, 'POST', { clientUploadId: randomUUID(), filename: file.name, mimeType: file.type, size: file.size })).data.session;
const route = `${base}/${session.id}`;
const signed = (await call(route + '/parts', 'POST', { partNumbers: [1, 2] })).data.parts;
const validateTarget = (url: string) => {
  const target = new URL(url); assert.equal(target.protocol, 'https:'); assert.equal(target.hostname, `${m.bucket}.s3.us-east-1.amazonaws.com`); assert.ok(target.pathname.startsWith('/post-video-sources/')); return target;
};
const firstUrl = signed.find((p: any) => p.partNumber === 1).url;
const oldUrl = signed.find((p: any) => p.partNumber === 2).url;
validateTarget(firstUrl); const target = validateTarget(oldUrl);
const putFirst = await fetch(firstUrl, { method: 'PUT', body: file.slice(0, session.partSize) }); assert.equal(putFirst.status, 200);
const before = (await call(route + '/parts')).data.parts;
assert.equal(before.length, 1); assert.equal(before[0].size, session.partSize);
const date = target.searchParams.get('X-Amz-Date')!;
assert.match(date, /^\d{8}T\d{6}Z$/);
const issued = Date.UTC(+date.slice(0,4), +date.slice(4,6)-1, +date.slice(6,8), +date.slice(9,11), +date.slice(11,13), +date.slice(13,15));
const expiresSeconds = Number(target.searchParams.get('X-Amz-Expires')); assert.equal(expiresSeconds, 900);
const expiry = issued + expiresSeconds * 1000;
console.log(JSON.stringify({ event: 'waiting_for_real_s3_expiry', sessionId: session.id, acceptedParts: 1, acceptedBytes: session.partSize, signedLifetimeSeconds: expiresSeconds, expiresAt: new Date(expiry).toISOString() }));
while (Date.now() < expiry + 5000) { assert.ok(Date.now() < Date.parse(m.expiresAt)); await new Promise(resolve => setTimeout(resolve, Math.min(30000, expiry + 5000 - Date.now()))); }
const expired = await fetch(oldUrl, { method: 'PUT', body: file.slice(session.partSize) });
assert.equal(expired.status, 403); const xml = await expired.text(); assert.match(xml, /expired/i);
const rejectionCode = /<Code>([^<]+)<\/Code>/.exec(xml)?.[1];
let entry: UploadEntry = { fingerprint: sourceFingerprint(file), filename: file.name, clientUploadId: randomUUID(), uploadedBytes: session.partSize, session };
let successfulFreshPuts = 0, completionCalls = 0, lost = false;
const transport: UploadTransport = {
  create: async () => { throw Error('Resume must not create another session'); },
  getSession: async id => (await call(`${base}/${id}`)).data.session,
  parts: async id => (await call(`${base}/${id}/parts`)).data.parts,
  sign: async (id, numbers) => { assert.deepEqual(numbers, [2]); const parts = (await call(`${base}/${id}/parts`, 'POST', { partNumbers: numbers })).data.parts; assert.notEqual(parts[0].url, oldUrl); return parts; },
  put: async (url, body, signal, progress) => { validateTarget(url); const r = await fetch(url, { method: 'PUT', body, signal }); assert.equal(r.status, 200); successfulFreshPuts++; progress(body.size); },
  complete: async id => { completionCalls++; await call(`${base}/${id}/complete`, 'POST', {}); lost = true; throw Error('Controlled application acknowledgement loss after real complete HTTP success'); },
  retry: async () => { throw Error('No processing retry expected'); },
  wait: async signal => { signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 2000)); },
};
try { await uploadVideo(file, entry, new AbortController().signal, value => { entry = value; }, transport); } catch (e) { if (!lost) throw e; }
await uploadVideo(file, entry, new AbortController().signal, value => { entry = value; }, transport);
assert.equal(entry.session!.status, 'READY'); assert.equal(completionCalls, 1); assert.equal(successfulFreshPuts, 1);
const result = { at: new Date().toISOString(), sessionId: session.id, sourceBytes: file.size, actualApiUrlLifetimeSeconds: expiresSeconds, expiredPutStatus: expired.status, rejectionCode, preservedPart: before[0], successfulFreshPuts, completionCalls, completionAcknowledgementLost: true, status: entry.session!.status, note: 'Real S3 expiry wait; manual resume reauthorizes only missing part. Completion acknowledgement is deliberately discarded after a real successful HTTP response, not a claimed physical packet loss.' };
await fs.writeFile(path.join(m.root, 'expired-put-recovery-evidence.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
