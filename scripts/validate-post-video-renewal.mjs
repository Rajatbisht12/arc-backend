/** Real CloudFront/HTTP evidence. Disposable, approved round-2 staging only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
if (process.argv[2] !== '--approved-round2' || process.argv.length !== 5) throw Error('Use --approved-round2 MANIFEST CONTROLLED_UPLOAD_RESULT');
const m = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
assert.equal(m.round, 2); assert.equal(m.account, '906446637180'); assert.ok(Date.now() < Date.parse(m.expiresAt));
assert.equal(m.bucket, 'squadhunt-video-staging-r2-906446637180-us-east-1');
const fixture = JSON.parse(await fs.readFile(process.argv[4], 'utf8'));
assert.equal(fixture.source, 'staging-10mib-class.mp4'); assert.equal(fixture.status, 'READY');
assert.match(fixture.postId, /^[a-f0-9]{24}$/); assert.match(fixture.sessionId, /^[a-f0-9]{24}$/);
const api = m.api.ApiOrigin, accounts = {}, records = [];
const record = (test, detail) => { const row = { at: new Date().toISOString(), test, ...detail }; records.push(row); console.log(JSON.stringify(row)); };
for (const role of ['owner', 'viewer', 'blocked']) {
  const c = JSON.parse(await fs.readFile(path.join(m.root, `qa-${role}-credentials.json`), 'utf8')); assert.equal(c.apiOrigin, api);
  const r = await fetch(api + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) });
  assert.equal(r.status, 200); const data = (await r.json()).data; accounts[role] = { token: data.token, id: data.user._id, username: data.user.username };
}
const call = async (role, route, method = 'GET', body) => {
  const r = await fetch(api + route, { method, headers: { ...(role ? { Authorization: `Bearer ${accounts[role].token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, cacheControl: r.headers.get('cache-control'), body: await r.json().catch(() => null) };
};
const renewPath = `/api/posts/video-playback-grants/${fixture.sessionId}`, postPath = `/api/posts/${fixture.postId}`;
const renew = async (role, expected) => { const r = await call(role, renewPath); assert.equal(r.status, expected); assert.match(r.cacheControl || '', /no-store/); if (expected !== 200) assert.equal(r.body.data, undefined); return r.body?.data; };
const media = async (url, range = false, expected = range ? 206 : 200) => {
  assert.ok([api, m.media.MediaOrigin].includes(new URL(url).origin));
  const r = await fetch(url, { headers: { ...(range ? { Range: 'bytes=0-1023' } : {}), 'Cache-Control': 'no-cache', Origin: 'http://localhost:3001' } });
  assert.equal(r.status, expected, 'Unexpected authorized media status; URL deliberately omitted'); return r;
};
const validate = async data => {
  assert.equal(data.sessionId, fixture.sessionId);
  const p = data.playback, auth = p.authorization;
  assert.equal(auth.renewalPath, renewPath); assert.ok(auth.expiresInSeconds > 269 && auth.expiresInSeconds <= 300); assert.ok(auth.refreshAfterSeconds <= 240);
  const token = new URL(p.hlsUrl).searchParams.get('token'); const grant = JSON.parse(Buffer.from(token.split('.')[0], 'base64url'));
  const expiry = Number(new URL(p.fallbackMp4Url).searchParams.get('Expires'));
  assert.equal(expiry, grant.exp); assert.equal(grant.exp - grant.iat, 300); assert.ok(expiry * 1000 <= Date.now() + 300000);
  const master = await (await media(p.hlsUrl)).text(); const variant = master.split('\n').find(s => s && !s.startsWith('#'));
  const text = await (await media(variant)).text(); const segment = text.split('\n').find(s => s && !s.startsWith('#'));
  assert.equal(Number(new URL(segment).searchParams.get('Expires')), expiry);
  await (await media(segment)).body?.cancel();
  const mp4 = await media(p.fallbackMp4Url, true); assert.match(mp4.headers.get('content-range') || '', /^bytes 0-1023\//); assert.equal((await mp4.arrayBuffer()).byteLength, 1024);
  if (data.thumbnailUrl) { assert.equal(Number(new URL(data.thumbnailUrl).searchParams.get('Expires')), expiry); await (await media(data.thumbnailUrl)).body?.cancel(); }
  const unsigned = new URL(p.fallbackMp4Url); unsigned.search = ''; await (await media(unsigned, true, 403)).body?.cancel();
  return { expiry, grant, playback: p };
};
let following = false, blocking = false;
const began = Date.now();
try {
  const detail = await call('owner', postPath); assert.equal(detail.status, 200);
  assert.equal(detail.body.data.post.content.media[0].playback.authorization.renewalPath, renewPath);
  const publicViewer = await validate(await renew('viewer', 200));
  assert.equal((await call('blocked', `/api/users/block/${accounts.owner.username}`, 'POST')).status, 200); blocking = true;
  await renew('blocked', 403); record('blocked viewer denied renewal for public post', { status: 403 });
  assert.equal((await call('owner', '/api/users/privacy-settings', 'PUT', { profileVisibility: 'private' })).status, 200);
  await renew(null, 403); await renew('viewer', 403); await renew('owner', 200);
  assert.equal((await call('owner', '/api/users/privacy-settings', 'PUT', { profileVisibility: 'public' })).status, 200);
  record('profile privacy is rechecked for anonymous/non-follower/owner renewal', { denied: [403, 403], owner: 200 });
  assert.equal((await call('owner', postPath, 'PUT', { visibility: 'followers' })).status, 200); await renew('viewer', 403);
  assert.equal((await call('viewer', `/api/users/${accounts.owner.id}/follow`, 'POST')).status, 200); following = true; await renew('viewer', 200);
  record('accepted follower can renew, non-follower cannot', { nonFollower: 403, acceptedFollower: 200 });
  assert.equal((await call('owner', postPath, 'PUT', { visibility: 'private' })).status, 200); await renew('viewer', 403);
  await (await media(publicViewer.playback.hlsUrl, false, 403)).body?.cancel();
  await (await media(publicViewer.playback.fallbackMp4Url, true, 206)).body?.cancel();
  record('fresh renewal/manifest denied after post privacy change; old asset remains only until approved expiry', { freshRenewal: 403, oldManifest: 403, priorAssetBeforeExpiry: 206, remainingGrantSeconds: Math.max(0, publicViewer.expiry - Date.now()/1000) });
  let expiredChecked = false;
  for (let cycle = 0; cycle < 4; cycle++) {
    if (cycle) {
      const until = began + cycle * 210000;
      while (Date.now() < until) {
        assert.ok(Date.now() < Date.parse(m.expiresAt));
        if (!expiredChecked && Date.now() >= publicViewer.expiry * 1000 + 5000) {
          await (await media(publicViewer.playback.fallbackMp4Url, true, 403)).body?.cancel(); expiredChecked = true;
          record('previously issued CloudFront MP4 rejects NEW Range requests after expiry', { status: 403, elapsedSeconds: (Date.now()-began)/1000, maximumGrantSeconds: 300 });
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(15000, until-Date.now())));
      }
    }
    const allowed = await validate(await renew('owner', 200)); assert.equal(allowed.grant.viewerId, accounts.owner.id);
    record('authorized owner renewal sustains HLS child requests, thumbnail and MP4 Range delivery', { cycle, elapsedSeconds: (Date.now()-began)/1000, maxLifetimeSeconds: 300, hls: 200, child: 200, thumbnail: 200, mp4: 206, unsignedMp4: 403 });
  }
  assert.equal(expiredChecked, true);
  record('real renewal validation exceeded ten minutes', { elapsedSeconds: (Date.now()-began)/1000 });
} finally {
  await call('owner', '/api/users/privacy-settings', 'PUT', { profileVisibility: 'public' }).catch(() => {});
  await call('owner', postPath, 'PUT', { visibility: 'public' }).catch(() => {});
  if (following) await call('viewer', `/api/users/${accounts.owner.id}/follow`, 'DELETE').catch(() => {});
  if (blocking) await call('blocked', `/api/users/block/${accounts.owner.username}`, 'DELETE').catch(() => {});
  await fs.writeFile(path.join(m.root, 'renewal-privacy-evidence.json'), JSON.stringify({ postId: fixture.postId, sessionId: fixture.sessionId, records, note: 'Actual HTTP/S3/CloudFront grant evidence, NOT a claim of browser/native playback. No URLs, JWTs or signing material exported.' }, null, 2));
}
