/** Mutates only named disposable staging fixtures. Never use production creds. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
if (process.argv[2] !== '--approved-staging') throw Error('Requires --approved-staging MANIFEST');
const manifest = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
assert.equal(manifest.account, '906446637180');
assert.ok(Date.now() < Date.parse(manifest.expiresAt));
const api = manifest.api.ApiOrigin;
assert.match(api, /^https:\/\/d[a-z0-9]+\.cloudfront\.net$/);
const accounts = {};
for (const role of ['owner', 'viewer', 'blocked']) {
  const credentials = JSON.parse(await fs.readFile(path.join(manifest.root, `qa-${role}-credentials.json`), 'utf8'));
  assert.equal(credentials.apiOrigin, api);
  const response = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
  assert.equal(response.status, 200);
  const body = await response.json();
  accounts[role] = { token: body.data.token, id: body.data.user._id || body.data.user.id };
}
const records = [];
const call = async (role, route, method = 'GET', data) => {
  const response = await fetch(api + route, { method, headers: {
    ...(role ? { Authorization: `Bearer ${accounts[role].token}` } : {}),
    ...(data ? { 'Content-Type': 'application/json' } : {}),
  }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const expect = (label, result, statuses) => {
  assert.ok(statuses.includes(result.status), `${label}: unexpected HTTP ${result.status}`);
  records.push({ test: label, status: result.status });
};
// Only a post created by the controlled synthetic upload harness may be used.
let fixture;
for (const directory of await fs.readdir(manifest.root)) {
  if (!directory.startsWith('aws-upload-evidence-')) continue;
  const result = await fs.readFile(path.join(manifest.root, directory, 'result.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (result?.source === 'staging-10mib-class.mp4' && result.publicationRetrySamePost) fixture = result;
}
assert.ok(fixture, 'No controlled disposable post fixture found');
const postId = fixture.postId;
assert.match(postId, /^[a-f0-9]{24}$/);
const route = `/api/posts/${postId}`;
expect('anonymous public video detail', await call(null, route), [200]);
expect('owner sets followers visibility', await call('owner', route, 'PUT', { visibility: 'followers' }), [200]);
try {
  expect('non-follower denied followers video', await call('viewer', route), [403, 404]);
  expect('viewer follows public owner', await call('viewer', `/api/users/${accounts.owner.id}/follow`, 'POST'), [200]);
  const permitted = await call('viewer', route);
  expect('accepted follower permitted', permitted, [200]);
  const media = permitted.body.data.post.content.media[0];
  const hls = media.playback.hlsUrl, mp4 = media.playback.fallbackMp4Url;
  assert.equal(new URL(hls).origin, api);
  assert.equal(new URL(mp4).origin, manifest.media.MediaOrigin);
  expect('blocked fixture blocks owner', await call('blocked', '/api/users/block/staging_video_owner', 'POST'), [200]);
  expect('blocked viewer denied', await call('blocked', route), [403, 404]);
  expect('owner makes video private', await call('owner', route, 'PUT', { visibility: 'private' }), [200]);
  expect('owner permitted private video', await call('owner', route), [200]);
  expect('follower denied owner-only private video', await call('viewer', route), [403, 404]);
  const manifestAfterPrivate = await fetch(hls);
  expect('previous viewer manifest denied after privacy change', { status: manifestAfterPrivate.status }, [403, 404]);
  // This is the documented bearer-grant revocation window, not a security pass.
  const priorAsset = await fetch(mp4, { headers: { Range: 'bytes=0-1023' } });
  assert.equal(priorAsset.status, 206);
  await priorAsset.body?.cancel();
  records.push({ test: 'previously issued MP4 remains valid after privacy change', status: 206, result: 'KNOWN POLICY BLOCKER: bearer grant valid until expiry' });
  expect('restore disposable fixture to public', await call('owner', route, 'PUT', { visibility: 'public' }), [200]);
  const deleted = await call('owner', route, 'DELETE');
  expect('delete controlled synthetic post', deleted, [200]);
  expect('deleted post unavailable', await call('owner', route), [403, 404]);
  const afterDelete = await fetch(hls);
  expect('old manifest unavailable after deletion', { status: afterDelete.status }, [403, 404]);
} finally {
  // Never remove actual media here; only the one soft-deleted fixture above.
  const output = path.join(manifest.root, 'staging-privacy-evidence.json');
  await fs.writeFile(output, JSON.stringify({ postId, records, note: 'Synthetic fixtures only; signed URLs/tokens deliberately omitted.' }, null, 2));
  console.log(JSON.stringify({ evidence: output, records }, null, 2));
}
