const { createHmac, createSign, timingSafeEqual } = require('crypto');
const path = require('path');
const { uploadError } = require('./postVideoPolicy');
const PREFIX = /^post-video-playback\/[a-f0-9]{24}\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+\//;
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : ''; }
  catch { return ''; }
};
const config = (environment = process.env) => ({
  cdn: safeUrl(environment.POST_VIDEO_CLOUDFRONT_URL),
  api: safeUrl(environment.POST_VIDEO_API_ORIGIN),
  keyPairId: String(environment.POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID || ''),
  privateKey: String(environment.POST_VIDEO_CLOUDFRONT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  tokenSecret: String(environment.POST_VIDEO_PLAYBACK_TOKEN_SECRET || ''),
});
const privateDeliveryReady = (environment = process.env) => {
  const cfg = config(environment);
  if (environment.POST_VIDEO_PRIVATE_DELIVERY_ENABLED !== 'true' || !cfg.cdn || !cfg.api || !cfg.keyPairId || cfg.tokenSecret.length < 32 || !cfg.privateKey) return false;
  try { createSign('RSA-SHA1').update('readiness').sign(cfg.privateKey); return true; } catch { return false; }
};
const assertDeliveryReady = () => { if (!privateDeliveryReady()) throw uploadError('VIDEO_DELIVERY_NOT_CONFIGURED', 'Video uploading is being prepared. Please try again later.', 503); };
const normalizedPlaybackKey = value => {
  const key = String(value || '');
  if (!PREFIX.test(key) || key.includes('..') || key.includes('\\') || /[?#\x00-\x20]/.test(key)) return '';
  return key;
};
const tokenForPrefix = (prefix, expiresAt, environment, viewerId = '') => {
  const payload = Buffer.from(JSON.stringify({ prefix, exp: expiresAt, viewerId: /^[a-f0-9]{24}$/.test(String(viewerId)) ? String(viewerId) : '' })).toString('base64url');
  const signature = createHmac('sha256', config(environment).tokenSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};
const verifyPlaybackToken = (token, environment = process.env, now = Date.now()) => {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra || payload.length > 1024 || config(environment).tokenSecret.length < 32) throw uploadError('PLAYBACK_EXPIRED', 'Playback authorization has expired.', 403);
  const expected = createHmac('sha256', config(environment).tokenSecret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw uploadError('PLAYBACK_EXPIRED', 'Playback authorization has expired.', 403);
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw uploadError('PLAYBACK_EXPIRED', 'Playback authorization has expired.', 403); }
  if (!Number.isSafeInteger(data.exp) || data.exp <= now / 1000 || !PREFIX.test(data.prefix) || data.prefix.match(PREFIX)?.[0] !== data.prefix) throw uploadError('PLAYBACK_EXPIRED', 'Playback authorization has expired.', 403);
  return data;
};
const cfBase64 = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
const signPlaybackAsset = (key, expiresAt, environment = process.env) => {
  if (!normalizedPlaybackKey(key)) throw uploadError('INVALID_PLAYBACK_PATH', 'Invalid playback asset.', 403);
  const cfg = config(environment);
  const url = `${cfg.cdn}/${key}`;
  const policy = JSON.stringify({ Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': expiresAt } } }] });
  const signature = createSign('RSA-SHA1').update(policy).sign(cfg.privateKey);
  return `${url}?Expires=${expiresAt}&Signature=${cfBase64(signature)}&Key-Pair-Id=${encodeURIComponent(cfg.keyPairId)}`;
};
const manifestUrl = (key, token, environment) => `${config(environment).api}/api/posts/video-playback/${key.split('/').slice(1).map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`;
// Called only after the surrounding API has authorized the post/session viewer.
const resolvePlaybackKey = (key, environment = process.env, viewerId = '') => {
  if (!normalizedPlaybackKey(key)) return key;
  if (!privateDeliveryReady(environment)) throw uploadError('VIDEO_DELIVERY_NOT_CONFIGURED', 'Video playback is temporarily unavailable.', 503);
  // Stable within a 15-minute window so feed refreshes do not reset a player.
  const expiresAt = Math.floor(Date.now() / 900000) * 900 + 3600;
  const prefix = key.match(PREFIX)[0];
  return key.endsWith('.m3u8') ? manifestUrl(key, tokenForPrefix(prefix, expiresAt, environment, viewerId), environment) : signPlaybackAsset(key, expiresAt, environment);
};
const rewriteManifest = (text, key, token, environment = process.env) => {
  const grant = verifyPlaybackToken(token, environment);
  if (!normalizedPlaybackKey(key) || !key.startsWith(grant.prefix) || !key.endsWith('.m3u8')) throw uploadError('INVALID_PLAYBACK_PATH', 'Invalid playback manifest.', 403);
  const rewrite = uri => {
    if (!uri || uri.includes('\\') || /[?#\x00-\x20]/.test(uri) || uri.startsWith('/') || /^[a-z]+:/i.test(uri)) throw uploadError('INVALID_PLAYBACK_MANIFEST', 'Invalid playback manifest.', 503);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(key), uri));
    if (!target.startsWith(grant.prefix) || !normalizedPlaybackKey(target)) throw uploadError('INVALID_PLAYBACK_PATH', 'Invalid playback manifest.', 503);
    return target.endsWith('.m3u8') ? manifestUrl(target, token, environment) : signPlaybackAsset(target, grant.exp, environment);
  };
  return String(text).split('\n').map(line => line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewrite(uri)}"`) : line.trim() ? rewrite(line.trim()) : line).join('\n');
};
module.exports = { privateDeliveryReady, assertDeliveryReady, normalizedPlaybackKey, resolvePlaybackKey, verifyPlaybackToken, rewriteManifest, signPlaybackAsset, tokenForPrefix };
