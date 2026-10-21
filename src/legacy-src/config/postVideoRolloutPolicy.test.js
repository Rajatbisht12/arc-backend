const assert = require('node:assert/strict');
const test = require('node:test');
const { assertPostVideoRolloutConfiguration, isPostVideoOwnerAllowed } = require('./postVideoRolloutPolicy');

const owner = 'a'.repeat(24);
const other = 'b'.repeat(24);
const production = { NODE_ENV: 'production', POST_VIDEO_UPLOADS_ENABLED: 'true' };

test('production canary fails closed without a valid nonempty owner list', () => {
  for (const value of [undefined, '', 'not-a-user-id', `${owner},invalid`]) {
    assert.throws(() => assertPostVideoRolloutConfiguration({ ...production, POST_VIDEO_CANARY_USER_IDS: value }));
  }
  assert.throws(() => assertPostVideoRolloutConfiguration({ ...production, POST_VIDEO_ROLLOUT_MODE: 'unknown', POST_VIDEO_CANARY_USER_IDS: owner }));
});

test('the canary grants only listed owners and explicit all-account rollout is distinct', () => {
  const canary = { ...production, POST_VIDEO_CANARY_USER_IDS: owner.toUpperCase() };
  assertPostVideoRolloutConfiguration(canary);
  assert.equal(isPostVideoOwnerAllowed(owner, canary), true);
  assert.equal(isPostVideoOwnerAllowed(other, canary), false);
  const everyone = { ...production, POST_VIDEO_ROLLOUT_MODE: 'all' };
  assert.equal(isPostVideoOwnerAllowed(other, everyone), true);
  assert.throws(() => assertPostVideoRolloutConfiguration({ ...everyone, POST_VIDEO_CANARY_USER_IDS: owner }));
});

test('disabled production and isolated staging preserve their existing policy', () => {
  assert.doesNotThrow(() => assertPostVideoRolloutConfiguration({ ...production, POST_VIDEO_UPLOADS_ENABLED: 'false' }));
  const stage = { ...production, DEPLOYMENT_ENVIRONMENT: 'staging' };
  assert.equal(isPostVideoOwnerAllowed(other, stage), true);
});
