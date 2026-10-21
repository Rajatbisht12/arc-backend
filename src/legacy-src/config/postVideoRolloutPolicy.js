const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isProduction = environment => environment.NODE_ENV === 'production'
  && environment.DEPLOYMENT_ENVIRONMENT !== 'staging';

const canaryOwners = environment => {
  const raw = String(environment.POST_VIDEO_CANARY_USER_IDS || '').trim();
  const owners = raw ? raw.split(',').map(value => value.trim()) : [];
  if (owners.some(value => !OBJECT_ID.test(value))) {
    throw new Error('POST_VIDEO_CANARY_USER_IDS must contain only comma-separated user IDs');
  }
  return new Set(owners.map(value => value.toLowerCase()));
};

const assertPostVideoRolloutConfiguration = (environment = process.env) => {
  if (environment.POST_VIDEO_UPLOADS_ENABLED !== 'true' || !isProduction(environment)) return;
  const mode = environment.POST_VIDEO_ROLLOUT_MODE || 'canary';
  if (mode !== 'canary' && mode !== 'all') throw new Error('Invalid POST_VIDEO_ROLLOUT_MODE');
  const owners = canaryOwners(environment);
  if (mode === 'canary' && owners.size === 0) {
    throw new Error('Production video-upload canary requires POST_VIDEO_CANARY_USER_IDS');
  }
  if (mode === 'all' && owners.size > 0) {
    throw new Error('Remove POST_VIDEO_CANARY_USER_IDS before an explicit all-account rollout');
  }
};

const isPostVideoOwnerAllowed = (owner, environment = process.env) => {
  if (!isProduction(environment)) return true;
  assertPostVideoRolloutConfiguration(environment);
  if ((environment.POST_VIDEO_ROLLOUT_MODE || 'canary') === 'all') return true;
  return canaryOwners(environment).has(String(owner || '').toLowerCase());
};

// A paused canary may still have READY sessions awaiting publication, so this
// restriction deliberately does not depend on POST_VIDEO_UPLOADS_ENABLED.
const requiresOwnerOnlyCanaryPost = (hasNewVideoUpload, environment = process.env) => Boolean(hasNewVideoUpload)
  && isProduction(environment)
  && (environment.POST_VIDEO_ROLLOUT_MODE || 'canary') === 'canary';

// A stale or older client must not publish an ordinary public legacy video
// from the QA owner while the new-video production canary is active.
const rejectsLegacyCanaryVideo = (owner, hasLegacyVideo, environment = process.env) => Boolean(hasLegacyVideo)
  && environment.POST_VIDEO_UPLOADS_ENABLED === 'true'
  && requiresOwnerOnlyCanaryPost(true, environment)
  && isPostVideoOwnerAllowed(owner, environment);

module.exports = { assertPostVideoRolloutConfiguration, isPostVideoOwnerAllowed, requiresOwnerOnlyCanaryPost, rejectsLegacyCanaryVideo };
