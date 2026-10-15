const assert = require('node:assert/strict');
const { test } = require('node:test');
const User = require('../models/User');
const service = require('./marketingEmailService');

const previousSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
process.env.EMAIL_UNSUBSCRIBE_SECRET = '12345678901234567890123456789012';
const now = new Date('2026-10-15T00:00:00.000Z');
const user = {
  _id: '507f1f77bcf86cd799439011', email: 'member@example.test', isActive: true,
  moderationStatus: 'active', userType: 'player', lastSeen: new Date('2026-10-09T00:00:00.000Z'),
  emailPreferences: { promotionalEnabled: true, marketingConsentAt: new Date('2026-10-01T00:00:00.000Z'), withdrawnAt: null, suppressedAt: null }
};

test('re-engagement requires affirmative consent and five full inactive days', () => {
  assert.equal(service.marketingEligibility(user, now), true);
  assert.equal(service.marketingEligibility({ ...user, lastSeen: new Date('2026-10-12T00:00:00.000Z') }, now), false);
  assert.equal(service.marketingEligibility({ ...user, emailPreferences: { ...user.emailPreferences, promotionalEnabled: false } }, now), false);
  assert.equal(service.marketingEligibility({ ...user, emailPreferences: { ...user.emailPreferences, marketingConsentAt: null } }, now), false);
  assert.equal(service.marketingEligibility({ ...user, isActive: false }, now), false);
  assert.equal(service.marketingEligibility({ ...user, moderationStatus: 'suspended' }, now), false);
});

test('opaque unsubscribe token reveals no user ID or email and changes with renewed consent', () => {
  const token = service.tokenForUser(user);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(token, /507f1f77|member/);
  assert.notEqual(token, service.tokenForUser({ ...user, emailPreferences: { ...user.emailPreferences, marketingConsentAt: new Date('2026-10-02T00:00:00.000Z') } }));
});

test('one-click unsubscribe is an idempotent database update', async () => {
  const original = User.updateOne;
  const calls = [];
  User.updateOne = async (...args) => { calls.push(args); return { matchedCount: calls.length === 1 ? 1 : 0 }; };
  try {
    const token = service.tokenForUser(user);
    assert.equal(await service.unsubscribeByToken(token), true);
    assert.equal(await service.unsubscribeByToken(token), false);
    assert.equal(await service.unsubscribeByToken('invalid'), false);
    assert.equal(calls[0][0]['emailPreferences.unsubscribeTokenHash'], service.hashToken(token));
    assert.equal(calls[0][1].$set['emailPreferences.promotionalEnabled'], false);
  } finally { User.updateOne = original; }
});

process.on('exit', () => {
  if (previousSecret === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  else process.env.EMAIL_UNSUBSCRIBE_SECRET = previousSecret;
});
