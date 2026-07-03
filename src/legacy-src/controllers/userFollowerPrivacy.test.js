const assert = require('assert');
const mongoose = require('mongoose');

const User = require('../models/User');
const Follow = require('../models/Follow');
const FollowRequest = require('../models/FollowRequest');
const userController = require('./userController');

const targetId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const followerId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
const viewerId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');
const blockedId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439014');

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

const publicTarget = () => new User({
  _id: targetId,
  username: 'target_user',
  userType: 'player',
  isActive: true,
  blockedUsers: [],
  privacySettings: {
    profileVisibility: 'public',
    showPostsToFollowers: true
  }
});

const followerRecord = () => ({
  _id: followerId,
  username: 'follower_user',
  userType: 'player',
  isActive: true,
  blockedUsers: [],
  profile: { displayName: 'Follower User' },
  privacySettings: {
    profileVisibility: 'public',
    showOnlineStatus: true,
    allowFollowRequests: true
  }
});

const missingProfileFollower = () => ({
  _id: followerId,
  username: 'legacy_follower',
  userType: 'player',
  isActive: true,
  blockedUsers: [],
  privacySettings: { profileVisibility: 'public' }
});

const guestRequest = (id = String(targetId)) => ({
  params: { id },
  query: { page: '1', limit: '20' },
  user: {
    _id: 'guest_00000000-0000-4000-8000-000000000000',
    username: 'guest',
    userType: 'guest'
  }
});

(async () => {
  const originals = {
    findById: User.findById,
    findOne: User.findOne,
    userFind: User.find,
    isFollowing: Follow.isFollowing,
    getFollowers: Follow.getFollowers,
    getFollowing: Follow.getFollowing,
    followFind: Follow.find,
    followRequestFind: FollowRequest.find
  };

  let target = publicTarget();
  let followersResult = { users: [followerRecord()], total: 1, pages: 1, current: 1 };
  let followerQueries = 0;
  let followingQueries = 0;
  let relationshipQueryAttempted = false;

  User.findById = (id) => ({
    select: async () => {
      assert.strictEqual(String(id), String(targetId));
      return target;
    }
  });
  Follow.isFollowing = async () => {
    relationshipQueryAttempted = true;
    throw new Error('guest follower lists must not query viewer relationships');
  };
  Follow.find = () => {
    relationshipQueryAttempted = true;
    throw new Error('guest follower lists must not query viewer follows');
  };
  FollowRequest.find = () => {
    relationshipQueryAttempted = true;
    throw new Error('guest follower lists must not query follow requests');
  };
  Follow.getFollowers = async (id, options) => {
    followerQueries += 1;
    assert.strictEqual(String(id), String(targetId));
    assert.deepStrictEqual(options, { page: 1, limit: 20, search: '', excludeUserIds: [] });
    return followersResult;
  };
  Follow.getFollowing = async (id, options) => {
    followingQueries += 1;
    assert.strictEqual(String(id), String(targetId));
    assert.deepStrictEqual(options, { page: 1, limit: 20, search: '', excludeUserIds: [] });
    return { users: [followerRecord()], total: 1, pages: 1, current: 1 };
  };

  try {
    const followersResponse = responseRecorder();
    await userController.getFollowers(guestRequest(), followersResponse);
    assert.strictEqual(followersResponse.statusCode, 200);
    assert.strictEqual(followersResponse.body.success, true);
    assert.strictEqual(followersResponse.body.data.followers.length, 1);
    assert.strictEqual(followersResponse.body.data.followers[0]._id, String(followerId));
    assert.strictEqual(followersResponse.body.data.pagination.totalFollowers, 1);

    const followingResponse = responseRecorder();
    await userController.getFollowing(guestRequest(), followingResponse);
    assert.strictEqual(followingResponse.statusCode, 200);
    assert.strictEqual(followingResponse.body.success, true);
    assert.strictEqual(followingResponse.body.data.following.length, 1);
    assert.strictEqual(followingResponse.body.data.following[0]._id, String(followerId));
    assert.strictEqual(followingResponse.body.data.pagination.totalFollowing, 1);

    assert.strictEqual(followerQueries, 1);
    assert.strictEqual(followingQueries, 1);
    assert.strictEqual(relationshipQueryAttempted, false);

    followersResult = { users: [], total: 0, pages: 0, current: 1 };
    const emptyResponse = responseRecorder();
    await userController.getFollowers(guestRequest(), emptyResponse);
    assert.strictEqual(emptyResponse.statusCode, 200);
    assert.deepStrictEqual(emptyResponse.body.data.followers, []);
    assert.deepStrictEqual(emptyResponse.body.data.pagination, {
      current: 1,
      total: 0,
      count: 0,
      totalFollowers: 0
    });

    // Orphan/malformed aggregation rows and optional legacy profile data must
    // not turn an otherwise valid follower-list request into a 500.
    followersResult = {
      users: [null, {}, missingProfileFollower()],
      total: 1,
      pages: 1,
      current: 1
    };
    const malformedResponse = responseRecorder();
    await userController.getFollowers(guestRequest(), malformedResponse);
    assert.strictEqual(malformedResponse.statusCode, 200);
    assert.strictEqual(malformedResponse.body.data.followers.length, 1);
    assert.strictEqual(malformedResponse.body.data.followers[0].username, 'legacy_follower');
    assert.deepStrictEqual(malformedResponse.body.data.followers[0].profile, {});

    const queriesBeforeMalformedId = followerQueries;
    const malformedIdResponse = responseRecorder();
    await userController.getFollowers(guestRequest('not a valid identifier!'), malformedIdResponse);
    assert.strictEqual(malformedIdResponse.statusCode, 404);
    assert.strictEqual(followerQueries, queriesBeforeMalformedId, 'malformed identifiers must be rejected before list lookup');

    target = null;
    const missingResponse = responseRecorder();
    await userController.getFollowers(guestRequest(), missingResponse);
    assert.strictEqual(missingResponse.statusCode, 404);

    target = publicTarget();
    target.isActive = false;
    const deletedResponse = responseRecorder();
    await userController.getFollowers(guestRequest(), deletedResponse);
    assert.strictEqual(deletedResponse.statusCode, 404);

    target = new User({
      _id: targetId,
      username: 'private_target',
      userType: 'player',
      isActive: true,
      blockedUsers: [],
      privacySettings: { profileVisibility: 'private' }
    });
    const privateResponse = responseRecorder();
    await userController.getFollowers(guestRequest(), privateResponse);
    assert.strictEqual(privateResponse.statusCode, 403);
    assert.strictEqual(privateResponse.body.code, 'PRIVACY_RESTRICTED');
    const queriesAfterPrivate = followerQueries;

    target = new User({
      _id: targetId,
      username: 'followers_target',
      userType: 'player',
      isActive: true,
      blockedUsers: [],
      privacySettings: { profileVisibility: 'followers' }
    });
    const followersOnlyGuestResponse = responseRecorder();
    await userController.getFollowers(guestRequest(), followersOnlyGuestResponse);
    assert.strictEqual(followersOnlyGuestResponse.statusCode, 403);
    assert.strictEqual(followerQueries, queriesAfterPrivate, 'restricted targets must be rejected before list lookup');

    // Authenticated approved followers can view follower-only lists. Corrupt
    // optional blocked-user and relationship rows are ignored safely, while
    // valid block exclusions are passed into the canonical aggregation.
    const authenticatedRequest = {
      params: { id: String(targetId) },
      query: { page: '1', limit: '20' },
      user: { _id: viewerId, username: 'viewer', userType: 'player', blockedUsers: [blockedId] }
    };
    User.findById = (id) => ({
      select: () => {
        if (String(id) === String(targetId)) return Promise.resolve(target);
        return { lean: async () => ({ _id: viewerId, blockedUsers: [blockedId] }) };
      }
    });
    User.find = () => ({
      select: () => ({ lean: async () => [{ _id: null }, { _id: blockedId }] })
    });
    Follow.isFollowing = async (follower, following) => (
      String(follower) === String(viewerId) && String(following) === String(targetId)
    );
    Follow.find = () => ({
      select: () => ({ lean: async () => [{ following: null }, { following: followerId }] })
    });
    FollowRequest.find = () => ({
      select: () => ({ lean: async () => [{ target: null }] })
    });
    Follow.getFollowers = async (id, options) => {
      assert.strictEqual(String(id), String(targetId));
      assert.deepStrictEqual(options.excludeUserIds.map(String), [String(blockedId), String(blockedId)]);
      return { users: [missingProfileFollower()], total: 1, pages: 1, current: 1 };
    };
    const approvedFollowerResponse = responseRecorder();
    await userController.getFollowers(authenticatedRequest, approvedFollowerResponse);
    assert.strictEqual(approvedFollowerResponse.statusCode, 200);
    assert.strictEqual(approvedFollowerResponse.body.data.followers.length, 1);
    assert.strictEqual(approvedFollowerResponse.body.data.followers[0].isFollowing, true);

    console.log('user follower privacy tests passed');
  } finally {
    User.findById = originals.findById;
    User.findOne = originals.findOne;
    User.find = originals.userFind;
    Follow.isFollowing = originals.isFollowing;
    Follow.getFollowers = originals.getFollowers;
    Follow.getFollowing = originals.getFollowing;
    Follow.find = originals.followFind;
    FollowRequest.find = originals.followRequestFind;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
