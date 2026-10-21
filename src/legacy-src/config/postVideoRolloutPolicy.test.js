const assert = require('node:assert/strict');
const test = require('node:test');
const { assertPostVideoRolloutConfiguration, isPostVideoOwnerAllowed, requiresOwnerOnlyCanaryPost, rejectsLegacyCanaryVideo } = require('./postVideoRolloutPolicy');

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

test('production canary video posts stay owner-only even after uploads are paused', () => {
  assert.equal(requiresOwnerOnlyCanaryPost(true, { ...production, POST_VIDEO_CANARY_USER_IDS: owner }), true);
  assert.equal(requiresOwnerOnlyCanaryPost(true, { ...production, POST_VIDEO_UPLOADS_ENABLED: 'false' }), true);
  assert.equal(requiresOwnerOnlyCanaryPost(false, production), false);
  assert.equal(requiresOwnerOnlyCanaryPost(true, { ...production, POST_VIDEO_ROLLOUT_MODE: 'all' }), false);
  assert.equal(requiresOwnerOnlyCanaryPost(true, { ...production, DEPLOYMENT_ENVIRONMENT: 'staging' }), false);
});

test('active canary rejects legacy video only for its allowlisted QA owner', () => {
  const canary = { ...production, POST_VIDEO_CANARY_USER_IDS: owner };
  assert.equal(rejectsLegacyCanaryVideo(owner, true, canary), true);
  assert.equal(rejectsLegacyCanaryVideo(other, true, canary), false);
  assert.equal(rejectsLegacyCanaryVideo(owner, false, canary), false);
  assert.equal(rejectsLegacyCanaryVideo(owner, true, { ...canary, POST_VIDEO_UPLOADS_ENABLED: 'false' }), false);
  assert.equal(rejectsLegacyCanaryVideo(owner, true, { ...canary, POST_VIDEO_ROLLOUT_MODE: 'all', POST_VIDEO_CANARY_USER_IDS: '' }), false);
  assert.equal(rejectsLegacyCanaryVideo(owner, true, { ...canary, DEPLOYMENT_ENVIRONMENT: 'staging' }), false);
});
