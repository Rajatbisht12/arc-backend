const assert = require('assert');
const {
  evaluateGroupAddPrivacy,
  resolveGroupAddPrivacy
} = require('./groupAddPrivacy');

const actorId = '507f1f77bcf86cd799439001';
const targetId = '507f1f77bcf86cd799439002';
const target = (setting, extras = {}) => ({
  _id: targetId,
  privacySettings: setting === undefined ? {} : { whoCanAddToGroup: setting },
  blockedUsers: [],
  ...extras
});

assert.strictEqual(evaluateGroupAddPrivacy({ actorId, target: target() }).allowed, true);
assert.strictEqual(evaluateGroupAddPrivacy({ actorId, target: target('anyone') }).allowed, true);
assert.strictEqual(evaluateGroupAddPrivacy({
  actorId,
  target: target('people_you_follow'),
  targetFollowsActor: true
}).allowed, true);

const followingDenied = evaluateGroupAddPrivacy({
  actorId,
  target: target('people_you_follow'),
  targetFollowsActor: false
});
assert.strictEqual(followingDenied.allowed, false);
assert.strictEqual(followingDenied.code, 'GROUP_ADD_PRIVACY_FOLLOW_REQUIRED');

const nobodyDenied = evaluateGroupAddPrivacy({ actorId, target: target('nobody') });
assert.strictEqual(nobodyDenied.allowed, false);
assert.strictEqual(nobodyDenied.code, 'GROUP_ADD_PRIVACY_NOBODY');

assert.strictEqual(evaluateGroupAddPrivacy({
  actorId,
  target: target('anyone', { blockedUsers: [actorId] })
}).allowed, false, 'block relationships must override Anyone');
assert.strictEqual(evaluateGroupAddPrivacy({
  actorId,
  target: target('anyone'),
  actorBlockedUsers: [targetId]
}).allowed, false, 'the actor blocking the target must also deny the add');

assert.strictEqual(evaluateGroupAddPrivacy({
  actorId,
  target: { _id: actorId, privacySettings: { whoCanAddToGroup: 'nobody' } }
}).allowed, true, 'Nobody must not prevent users creating their own group');

(async () => {
  let capturedQuery;
  const peopleTarget = target('people_you_follow');
  const result = await resolveGroupAddPrivacy({
    actor: { _id: actorId, blockedUsers: [] },
    targets: [peopleTarget],
    FollowModel: {
      find(query) {
        capturedQuery = query;
        return { distinct: async () => [targetId] };
      }
    }
  });
  assert.deepStrictEqual(capturedQuery, {
    follower: { $in: [targetId] },
    following: actorId
  }, 'People you follow must query target=follower and actor=following');
  assert.strictEqual(result[0].decision.allowed, true);

  const mixed = await resolveGroupAddPrivacy({
    actor: { _id: actorId, blockedUsers: [] },
    targets: [
      { _id: '507f1f77bcf86cd799439003', privacySettings: { whoCanAddToGroup: 'anyone' }, blockedUsers: [] },
      { _id: '507f1f77bcf86cd799439004', privacySettings: { whoCanAddToGroup: 'people_you_follow' }, blockedUsers: [] },
      { _id: '507f1f77bcf86cd799439005', privacySettings: { whoCanAddToGroup: 'nobody' }, blockedUsers: [] }
    ],
    FollowModel: {
      find() {
        return { distinct: async () => [] };
      }
    }
  });
  assert.deepStrictEqual(mixed.map(({ decision }) => decision.allowed), [true, false, false]);

  console.log('group add privacy tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
