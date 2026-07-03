const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { extractToken } = require('./jwt');

assert.equal(extractToken({ headers: {}, query: { token: 'must-not-be-accepted' } }), null);
assert.equal(extractToken({ headers: { authorization: 'Bearer header-token' } }), 'header-token');
assert.equal(extractToken({ headers: {}, cookies: { token: 'secure-cookie-token' } }), 'secure-cookie-token');

const backendRoot = path.resolve(__dirname, '../../..');
const noPayloadKey = spawnSync(process.execPath, ['-e', `
  delete process.env.ENCRYPTION_KEY;
  process.env.ENABLE_PAYLOAD_ENCRYPTION = 'true';
  require('./src/legacy-src/middleware/encryption');
`], { cwd: backendRoot, encoding: 'utf8', env: { ...process.env, ENABLE_PAYLOAD_ENCRYPTION: 'true', ENCRYPTION_KEY: '' } });
assert.notEqual(noPayloadKey.status, 0, 'Enabled payload encryption must fail closed without a key');

const bankRoundTrip = spawnSync(process.execPath, ['-e', `
  process.env.BANK_DETAILS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  const crypto = require('crypto');
  const Model = require('./src/legacy-src/models/CreatorBankDetails');
  const encrypted = Model.encryptSensitiveValue('1234567890');
  if (!encrypted.startsWith('v2:')) process.exit(2);
  if (Model.decryptAccountNumber(encrypted) !== '1234567890') process.exit(2);
  const tampered = encrypted.slice(0, -1) + (encrypted.endsWith('0') ? '1' : '0');
  try { Model.decryptAccountNumber(tampered); process.exit(3); } catch (_) {}
  const key = Buffer.from(process.env.BANK_DETAILS_ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const legacy = iv.toString('hex') + ':' + cipher.update('legacy-value', 'utf8', 'hex') + cipher.final('hex');
  if (Model.decryptAccountNumber(legacy) !== 'legacy-value') process.exit(4);
`], { cwd: backendRoot, encoding: 'utf8', env: { ...process.env, BANK_DETAILS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef' } });
assert.equal(bankRoundTrip.status, 0, bankRoundTrip.stderr);

console.log('Credential transport and encryption-key contracts passed');
