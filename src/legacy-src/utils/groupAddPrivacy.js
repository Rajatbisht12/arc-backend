const Follow = require('../models/Follow');
const User = require('../models/User');
const { idString, normalizeGroupAddAudience } = require('./privacyPolicy');

const GROUP_ADD_DENIALS = Object.freeze({
  blocked: Object.freeze({
    code: 'GROUP_ADD_BLOCKED',
    reason: 'privacy_blocked',
    message: 'This user cannot be added due to privacy settings.'
  }),
  people_you_follow: Object.freeze({
    code: 'GROUP_ADD_PRIVACY_FOLLOW_REQUIRED',
    reason: 'privacy_blocked',
    message: 'This user only allows people they follow to add them to groups.'
  }),
  nobody: Object.freeze({
    code: 'GROUP_ADD_PRIVACY_NOBODY',
    reason: 'privacy_blocked',
    message: 'This user does not allow others to add them to groups.'
  })
});

const includesId = (values, expectedId) => {
  const expected = idString(expectedId);
  return Array.isArray(values) && values.some((value) => idString(value) === expected);
};

const evaluateGroupAddPrivacy = ({
  actorId,
  target,
  actorBlockedUsers = [],
  targetFollowsActor = false
}) => {
  const targetId = idString(target);
  const normalizedActorId = idString(actorId);
  if (targetId && targetId === normalizedActorId) {
    return { allowed: true, setting: normalizeGroupAddAudience(target?.privacySettings?.whoCanAddToGroup) };
  }

  const setting = normalizeGroupAddAudience(target?.privacySettings?.whoCanAddToGroup);
  if (includesId(actorBlockedUsers, targetId) || includesId(target?.blockedUsers, normalizedActorId)) {
    return { allowed: false, setting, ...GROUP_ADD_DENIALS.blocked };
  }
  if (setting === 'nobody') {
    return { allowed: false, setting, ...GROUP_ADD_DENIALS.nobody };
  }
  if (setting === 'people_you_follow' && !targetFollowsActor) {
    return { allowed: false, setting, ...GROUP_ADD_DENIALS.people_you_follow };
  }
  return { allowed: true, setting };
};

/**
 * Resolve group-add eligibility in one batch. The canonical Follow edge is
 * directional: target=follower, actor=following. This method is shared by
 * both group creation and later member additions so neither path can bypass
 * the target user's setting.
 */
const resolveGroupAddPrivacy = async ({
  actor,
  targets,
  FollowModel = Follow,
  UserModel = User
}) => {
  const actorId = idString(actor);
  const candidates = Array.isArray(targets) ? targets.filter(Boolean) : [];
  let actorBlockedUsers = actor?.blockedUsers;
  if (!Array.isArray(actorBlockedUsers) && actorId) {
    const query = UserModel.findById(actorId).select('blockedUsers');
    const actorRecord = typeof query?.lean === 'function' ? await query.lean() : await query;
    actorBlockedUsers = actorRecord?.blockedUsers || [];
  }

  const followingRestrictedIds = candidates
    .filter((target) => (
      idString(target) !== actorId
      && normalizeGroupAddAudience(target?.privacySettings?.whoCanAddToGroup) === 'people_you_follow'
    ))
    .map((target) => target._id);
  const targetIdsFollowingActor = new Set((followingRestrictedIds.length > 0
    ? await FollowModel.find({
        follower: { $in: followingRestrictedIds },
        following: actorId
      }).distinct('follower')
    : []).map(idString));

  return candidates.map((target) => ({
    target,
    decision: evaluateGroupAddPrivacy({
      actorId,
      target,
      actorBlockedUsers,
      targetFollowsActor: targetIdsFollowingActor.has(idString(target))
    })
  }));
};

module.exports = {
  GROUP_ADD_DENIALS,
  evaluateGroupAddPrivacy,
  resolveGroupAddPrivacy
};
