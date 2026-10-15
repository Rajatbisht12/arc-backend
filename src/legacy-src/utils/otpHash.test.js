const assert = require('node:assert/strict');
const { hashOtp, findMatchingOtp } = require('./otpHash');
const previous = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'test-only-key-for-email-otp-hashing';
(async () => {
try {
  const first = hashOtp('A@example.test', 'login', '123456');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, hashOtp('a@example.test', 'login', '123456'));
  assert.notEqual(first, hashOtp('a@example.test', 'forgot_password', '123456'));
  assert.notEqual(first, hashOtp('a@example.test', 'login', '654321'));
  const query = { filter: null };
  const model = { findOne: (filter) => {
    query.filter = filter;
    return { sort: () => ({ select: async () => ({ otpHash: first }) }) };
  } };
  const record = await findMatchingOtp(model, 'a@example.test', 'login', '123456');
  assert.ok(record);
  assert.equal(query.filter.purpose, 'login');
  assert.equal(JSON.stringify(query.filter).includes('123456'), false);
  assert.equal(await findMatchingOtp(model, 'a@example.test', 'login', '999999'), null);
  assert.equal(await findMatchingOtp(model, 'a@example.test', 'login', 'bad-code'), null);
  const legacyModel = { findOne: () => ({ sort: () => ({ select: async () => ({ otp: '123456' }) }) }) };
  assert.ok(await findMatchingOtp(legacyModel, 'a@example.test', 'login', '123456'));
  console.log('OTP hash and purpose separation tests passed');
} finally {
  if (previous === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previous;
}
})().catch((error) => { console.error(error); process.exitCode = 1; });
