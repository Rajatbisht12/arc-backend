const assert = require('node:assert/strict');
const test = require('node:test');
const { passwordPolicyError, passwordRequirements } = require('./passwordPolicy');

test('new password policy accepts all required symbols and long valid passwords', () => {
  for (const value of ['Squad@123', 'Hello#2026', 'Gaming!9A', 'A1!abcde', `A1!${'x'.repeat(200)}`]) {
    assert.equal(passwordPolicyError(value), '');
  }
  for (const symbol of `!@#$%^&*()_-+=[]{};:'",.<>/?\\|\`~`) {
    assert.equal(passwordPolicyError(`Example9${symbol}`), '', `symbol ${symbol}`);
  }
});

test('new password policy rejects every missing requirement and non-string input', () => {
  for (const value of ['abc123', 'password123', 'Password123', 'Password!', 'Pass1!', 'A1!😀😀😀', null]) {
    assert.match(passwordPolicyError(value), /^Password must include/);
  }
  assert.deepEqual(passwordRequirements('Password123'), { length: true, number: true, uppercase: true, symbol: false });
});
