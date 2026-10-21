import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
if (process.argv[2] !== '--approved-staging') throw Error('Requires --approved-staging MANIFEST SOURCE');
const manifest = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
assert.equal(manifest.account, '906446637180'); assert.ok(Date.now() < Date.parse(manifest.expiresAt));
const source = await openAsBlob(process.argv[4], { type: 'video/mp4' });
assert.ok(source.size > 8388608 && source.size < 52428800);
const api = manifest.api.ApiOrigin;
assert.match(api, /^https:\/\/d[a-z0-9]+\.cloudfront\.net$/);
const accounts = {}, records = [];
for (const role of ['owner', 'viewer']) {
  const credentials = JSON.parse(await fs.readFile(path.join(manifest.root, `qa-${role}-credentials.json`), 'utf8'));
  assert.equal(credentials.apiOrigin, api);
  const response = await fetch(api + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
  assert.equal(response.status, 200);
  accounts[role] = (await response.json()).data.token;
}
const call = async (role, route, method = 'GET', data) => {
  const response = await fetch(api + route, { method, headers: { Authorization: `Bearer ${accounts[role]}`,
    ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const base = '/api/posts/video-uploads';
const created = await call('owner', base, 'POST', { clientUploadId: randomUUID(), filename: 'staging-cancellation-fixture.mp4', mimeType: 'video/mp4', size: source.size });
assert.equal(created.status, 200);
const session = created.body.data.session, route = `${base}/${session.id}`;
for (const [method, suffix, data] of [['GET', ''], ['GET', '/parts'], ['POST', '/parts', { partNumbers: [1] }], ['DELETE', '']]) {
  assert.equal((await call('viewer', route + suffix, method, data)).status, 404);
}
records.push({ test: 'other owner cannot read/list/sign/cancel session', result: '4 x HTTP 404' });
const earlyForm = new FormData(); earlyForm.set('clientPostId', randomUUID()); earlyForm.set('videoUploadIds', JSON.stringify([session.id]));
const early = await fetch(api + '/api/posts', { method: 'POST', headers: { Authorization: `Bearer ${accounts.owner}` }, body: earlyForm });
assert.ok([409, 422].includes(early.status));
records.push({ test: 'unready video publication rejected', status: early.status });
const signed = await call('owner', route + '/parts', 'POST', { partNumbers: [1] });
assert.equal(signed.status, 200);
const url = signed.body.data.parts[0].url;
assert.equal(new URL(url).hostname, `${manifest.bucket}.s3.us-east-1.amazonaws.com`);
assert.equal((await fetch(url, { method: 'PUT', body: source.slice(0, 8388608) })).status, 200);
const parts = await call('owner', route + '/parts');
assert.equal(parts.body.data.parts.length, 1); assert.equal(parts.body.data.parts[0].size, 8388608);
const incomplete = await call('owner', route + '/complete', 'POST', {});
assert.equal(incomplete.status, 409); assert.equal(incomplete.body.code, 'UPLOAD_INCOMPLETE');
records.push({ test: 'real partial S3 upload cannot complete', acceptedBytes: 8388608, status: incomplete.status });
assert.equal((await call('owner', route, 'DELETE')).status, 200);
assert.equal((await call('owner', route)).body.data.session.status, 'CANCELLED');
assert.equal((await call('owner', route + '/parts')).status, 410);
records.push({ test: 'cancelled session rejects further parts', status: 410, sessionId: session.id });
const feed = await call('viewer', `/api/posts?sessionSeed=${randomUUID()}`);
assert.equal(feed.status, 200); assert.ok(feed.body.data.posts.length > 0);
const target = String(feed.body.data.posts[0]._id || feed.body.data.posts[0].id);
assert.equal((await call('viewer', `/api/posts/${target}/exposure`, 'POST', { durationMs: 2000, context: 'feed' })).status, 200);
for (const mode of ['', '/clips']) {
  for (let refresh = 0; refresh < 2; refresh++) {
    const result = await call('viewer', `/api/posts${mode}?sessionSeed=${randomUUID()}`);
    assert.equal(result.status, 200);
    assert.ok(result.body.data.posts.every(post => String(post._id || post.id) !== target));
  }
}
records.push({ test: 'meaningful Feed exposure excluded across Feed/Clips and fresh sessions', result: '4 live HTTP checks', postId: target });
const output = path.join(manifest.root, 'staging-controls-evidence.json');
await fs.writeFile(output, JSON.stringify({ sessionId: session.id, records }, null, 2));
console.log(JSON.stringify({ evidence: output, records }, null, 2));
