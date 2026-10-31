'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const check = (ok, code) => { if (!ok) throw Error(code); };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const CONTENT = 'e97f4a2f4a90620f7294855689df2313c56f5a59700c24b769efc844d8126b22';
const FIXTURE = '0dc4f0364b721ee47361d11f885393117905475750c9bc30dfc429003bb556a3';
const DB = 'worker7_local_rehearsal';
function endpoints(uri, port, password) {
  const u = new URL(uri);
  check(u.protocol === 'mongodb:' && u.hostname === '127.0.0.1' && u.port === '27018'
    && u.pathname === '/' + DB && u.search === '?authSource=admin'
    && decodeURIComponent(u.username) === 'worker7_local' && u.password, 'LOCAL_DATABASE_ONLY');
  check(port === 16379 && password === 'worker7-local-redis-not-a-cloud-secret', 'LOCAL_REDIS_ONLY');
}
function credentials(env) {
  for (const [key, value] of Object.entries(env)) {
    if (/^(AWS_|GOOGLE_|FIREBASE_|EXPO_ACCESS_TOKEN|SMTP_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key) && value)
      check(key === 'AWS_EC2_METADATA_DISABLED' && value === 'true', 'CLOUD_OR_PROXY_ENVIRONMENT_FORBIDDEN');
  }
}
function verify(root, fixture) {
  check(path.isAbsolute(root) && fs.statSync(root).isDirectory(), 'ABSOLUTE_FROZEN_ROOT_REQUIRED');
  const m = JSON.parse(fs.readFileSync(path.join(root, '.source-manifest.json')));
  check(m.contentSha256 === CONTENT && m.files.length === 755, 'FROZEN_CONTENT_REQUIRED');
  const seen = new Set();
  for (const f of m.files) {
    check(typeof f.path === 'string' && !path.isAbsolute(f.path) && !f.path.includes('\\')
      && f.path.split('/').every(p => p && p !== '.' && p !== '..') && !seen.has(f.path), 'SAFE_MANIFEST_PATH_REQUIRED');
    seen.add(f.path);
    const file = path.join(root, f.path), stat = fs.lstatSync(file);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size === f.bytes
      && hash(fs.readFileSync(file)) === f.sha256, 'FROZEN_FILE_CHANGED');
  }
  check(fs.statSync(fixture).size === 5939073 && hash(fs.readFileSync(fixture)) === FIXTURE, 'APPROVED_FIXTURE_REQUIRED');
  return { filesVerified: m.files.length, contentSha256: CONTENT, fixtureSha256: FIXTURE };
}
module.exports = { check, hash, endpoints, credentials, verify, DB, CONTENT, FIXTURE };
