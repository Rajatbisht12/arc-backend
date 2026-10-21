/** Controlled transient source absence; approved disposable round-2 only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { UploadEntry, UploadTransport } from '../../frontend/src/features/post-upload/videoUploads.ts';
const require = createRequire(import.meta.url);
const { uploadVideo, sourceFingerprint } = require('../../frontend/src/features/post-upload/videoUploads.ts');
assert.equal(process.argv[2], '--approved-round2'); assert.equal(process.argv.length, 5);
const m = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
assert.equal(m.round, 2); assert.equal(m.account, '906446637180'); assert.equal(m.bucket, 'squadhunt-video-staging-r2-906446637180-us-east-1');
assert.ok(Date.now() < Date.parse(m.expiresAt));
const aws = (...args: string[]) => { const s = execFileSync('aws', [...args, '--region', m.region, '--output', 'json'], { encoding: 'utf8' }); return s.trim() ? JSON.parse(s) : {}; };
assert.equal(aws('sts', 'get-caller-identity').Account, m.account);
// Versioned output keys are NOT S3 bucket versioning. Do not enable/change it.
assert.equal(aws('s3api', 'get-bucket-versioning', '--bucket', m.bucket).Status, undefined);
const control = async (kind: 'queue-pause' | 'queue-resume' | 'queue-fail-hold', sessionId?: string) => {
  const task = JSON.parse(execFileSync(process.execPath, [path.join(m.root, 'staging-tasks.cjs'), kind, ...(sessionId ? [sessionId] : [])], { encoding: 'utf8' }).trim());
  const stream = 'staging-api/api/' + task.taskArn.split('/').at(-1);
  for (let i = 0; i < 60; i++) {
    try { const rows = aws('logs', 'get-log-events', '--log-group-name', 'squadhunt-video-staging-api-Logs-TdFN5C5n2xZR', '--log-stream-name', stream).events;
      const result = rows.map((r: any) => { try { return JSON.parse(r.message); } catch { return null; } }).find((r: any) => r?.event === 'approved_stage_queue_control');
      if (result) { assert.equal(result.paused, kind !== 'queue-resume'); return; }
    } catch (error: any) { if (!/ResourceNotFoundException/.test(String(error.stderr || error.message))) throw error; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('Stage queue control did not finish');
};
const c = JSON.parse(await fs.readFile(path.join(m.root, 'qa-owner-credentials.json'), 'utf8')); assert.equal(c.apiOrigin, m.api.ApiOrigin);
let token = '';
const call = async (route: string, method = 'GET', body?: unknown) => { assert.ok(route.startsWith('/api/')); const r = await fetch(m.api.ApiOrigin + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.ok(r.ok, `Stage API rejected: ${r.status}`); return r.json(); };
const login = (await call('/api/auth/login', 'POST', { email: c.email, password: c.password })).data; token = login.token;
const file = new File([await openAsBlob(process.argv[4], { type: 'video/mp4' })], 'staging-processing-retry.mp4', { type: 'video/mp4', lastModified: 1 }); assert.equal(file.size, 9892321);
const base = '/api/posts/video-uploads'; let hidden = false, key = '', backup = '', restored = false;
let original: any, session: any;
const expectedHash = createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
const restore = async () => {
  assert.ok(backup && key && backup.startsWith(key.slice(0, key.lastIndexOf('/') + 1)));
  aws('s3api', 'copy-object', '--bucket', m.bucket, '--key', key, '--copy-source', `${m.bucket}/${backup}`, '--metadata-directive', 'COPY', '--server-side-encryption', 'AES256');
  const head = aws('s3api', 'head-object', '--bucket', m.bucket, '--key', key);
  assert.equal(head.ContentLength, file.size); assert.equal(head.Metadata['upload-session'], session.id);
  const directory = await fs.mkdtemp(path.join(m.root, 'retry-source-verification-'));
  const local = path.join(directory, 'restored-synthetic-source.mp4');
  aws('s3api', 'get-object', '--bucket', m.bucket, '--key', key, local);
  assert.equal(createHash('sha256').update(await fs.readFile(local)).digest('hex'), expectedHash);
  restored = true; hidden = false;
};
try {
  await control('queue-pause');
  session = (await call(base, 'POST', { clientUploadId: randomUUID(), filename: file.name, mimeType: file.type, size: file.size })).data.session;
  const route = `${base}/${session.id}`;
  const parts = (await call(route + '/parts', 'POST', { partNumbers: [1, 2] })).data.parts;
  for (const p of parts) { const u = new URL(p.url); assert.equal(u.hostname, m.bucket + '.s3.us-east-1.amazonaws.com'); assert.ok(u.pathname.startsWith('/post-video-sources/')); const r = await fetch(p.url, { method: 'PUT', body: file.slice((p.partNumber - 1) * session.partSize, Math.min(file.size, p.partNumber * session.partSize)) }); assert.equal(r.status, 200); }
  // API verification/complete must happen while the original is still present.
  session = (await call(route + '/complete', 'POST', {})).data.session; assert.equal(session.status, 'QUEUED');
  key = `post-video-sources/${login.user._id}/${session.id}/source.mp4`;
  original = aws('s3api', 'head-object', '--bucket', m.bucket, '--key', key); assert.equal(original.ContentLength, file.size); assert.equal(original.Metadata['upload-session'], session.id);
  backup = key.replace('/source.mp4', '/retry-backup.mp4'); assert.notEqual(backup, key);
  aws('s3api', 'copy-object', '--bucket', m.bucket, '--key', backup, '--copy-source', `${m.bucket}/${key}`, '--metadata-directive', 'COPY', '--server-side-encryption', 'AES256');
  const preserved = aws('s3api', 'head-object', '--bucket', m.bucket, '--key', backup); assert.equal(preserved.ContentLength, file.size); assert.equal(preserved.Metadata['upload-session'], session.id);
  aws('s3api', 'delete-object', '--bucket', m.bucket, '--key', key); hidden = true;
  // Hold the queue inside the VPC immediately upon first failure. Waiting for
  // CloudWatch before pausing can otherwise let automatic retries win the race.
  await control('queue-fail-hold', session.id);
  let failed: any;
  for (let i = 0; i < 120; i++) { failed = (await call(route)).data.session; if (failed.status === 'FAILED') break; assert.ok(!['READY', 'CANCELLED', 'EXPIRED'].includes(failed.status)); await new Promise(resolve => setTimeout(resolve, 1000)); }
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.error.code, 'PROCESSING_FAILED');
  await restore();
  let retries = 0; let entry: UploadEntry = { fingerprint: sourceFingerprint(file), filename: file.name, clientUploadId: randomUUID(), uploadedBytes: file.size, session: failed };
  const transport: UploadTransport = {
    create: async () => { throw Error('No new upload after processing failure'); },
    getSession: async id => (await call(`${base}/${id}`)).data.session,
    parts: async () => { throw Error('Processing retry must not list or reupload source parts'); },
    sign: async () => { throw Error('Processing retry cannot sign parts'); },
    put: async () => { throw Error('Processing retry cannot reupload bytes'); },
    complete: async () => { throw Error('Processing retry cannot repeat multipart completion'); },
    retry: async id => { retries++; const next = (await call(`${base}/${id}/retry`, 'POST', {})).data.session; await control('queue-resume'); return next; },
    wait: async signal => { signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 2000)); },
  };
  await uploadVideo(file, entry, new AbortController().signal, next => { entry = next; }, transport); assert.equal(entry.session!.status, 'READY'); assert.equal(retries, 1);
  const requestKey = randomUUID(); const publish = async () => { const body = new FormData(); body.set('text', 'Controlled round2 transient processing retry synthetic fixture'); body.set('clientPostId', requestKey); body.set('videoUploadIds', JSON.stringify([session.id])); const r = await fetch(m.api.ApiOrigin + '/api/posts', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }); assert.ok(r.ok); return (await r.json()).data.post; };
  const post = await publish(); assert.equal(String((await publish())._id), String(post._id));
  const result = { at: new Date().toISOString(), sessionId: session.id, sourceBytes: file.size, observedFailure: failed.error.code, sourceTemporarilyMovedToStagingBackup: true, originalBytesAndMetadataRestored: true, sourceSha256: expectedHash, processingRetryCalls: retries, clientReuploadedBytesAfterFailure: 0, status: entry.session!.status, postId: String(post._id), publicationRetrySamePost: true, note: 'Real staging HeadObject failure, worker FAILED state, backup copy restoration verified by full SHA256 and actual retry API via the existing client engine. A server-side copy changes the multipart ETag; no claim of ETag/version identity. No production object/policy or bucket versioning was touched.' };
  await fs.writeFile(path.join(m.root, 'processing-failure-retry-evidence.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  if (hidden && backup && key) await restore();
  if (restored && backup) aws('s3api', 'delete-object', '--bucket', m.bucket, '--key', backup);
  await control('queue-resume');
  console.log(JSON.stringify({ faultRemoved: !hidden, stagingBackupRemoved: restored, stagingQueueResumed: true }));
}
