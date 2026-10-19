const assert = require('node:assert/strict');
const test = require('node:test');
const User = require('../models/User');
const UsernameRegistry = require('../models/UsernameRegistry');
const { getUser } = require('./userController');
const { isPublicProfileSeoEligible } = require('../utils/publicProfileSeoPolicy');

test('the normal profile API distinguishes viewer access from public SEO eligibility', async () => {
  const originalUserFindOne = User.findOne;
  const originalClaimFindOne = UsernameRegistry.findOne;
  const privateUser = {
    _id: '507f1f77bcf86cd799439011', username: 'PrivateOne', userType: 'player',
    isActive: true, moderationStatus: 'active', deletedAt: null,
    profile: { displayName: 'Private One', bio: 'Not public' },
    privacySettings: { profileVisibility: 'followers', showPostsToFollowers: true },
  };
  UsernameRegistry.findOne = () => ({
    select: () => ({ lean: async () => ({ kind: 'user', ownerId: privateUser._id }) }),
  });
  User.findOne = async () => privateUser;
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  try {
    await getUser({ params: { identifier: 'PrivateOne' }, user: null }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.privacyAccess.restricted, true);
    assert.equal(res.body.data.publicSeoEligible, false);
    assert.equal(res.body.data.user.username, 'PrivateOne');
    assert.equal(res.body.data.user.profile.bio, undefined);
    assert.deepEqual(res.body.data.recentPosts, []);
    assert.equal(isPublicProfileSeoEligible({ ...privateUser,
      privacySettings: { profileVisibility: 'public', showPostsToFollowers: true },
    }), true);
  } finally {
    User.findOne = originalUserFindOne;
    UsernameRegistry.findOne = originalClaimFindOne;
  }
});
