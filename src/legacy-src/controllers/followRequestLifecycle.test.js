const assert = require('node:assert/strict');
const test = require('node:test');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Follow = require('../models/Follow');
const FollowRequest = require('../models/FollowRequest');
const { publishFollowRequestUpdate, toggleFollow } = require('./userController');

const requester = '507f1f77bcf86cd799439011';
const target = '507f1f77bcf86cd799439012';
const requestId = '507f1f77bcf86cd799439013';
const notificationId = '507f1f77bcf86cd799439014';
const testUser = (id, visibility = 'private') => ({
  _id: id,
  username: id === requester ? 'alice' : 'bob',
  userType: 'player',
  isActive: true,
  blockedUsers: [],
  privacySettings: { profileVisibility: visibility, allowFollowRequests: true, showOnlineStatus: true }
});
const mockUserLookup = () => {
  const original = User.findById;
  User.findById = (id) => ({ select: () => ({ lean: async () => testUser(String(id)) }) });
  return () => { User.findById = original; };
};
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});
const followRequest = (method, query = {}) => ({
  method,
  params: { id: target },
  query,
  user: testUser(requester),
  app: { get: () => null }
});

test('acceptance converts the linked request notification without changing read state', async () => {
  const originalFindById = User.findById;
  const originalUpdate = Notification.findOneAndUpdate;
  const originalIsFollowing = Follow.isFollowing;
  const originalRequestExists = FollowRequest.exists;
  const events = [];
  const existing = { _id: notificationId, isRead: true, readAt: new Date('2025-01-01T00:00:00Z') };
  try {
    User.findById = () => ({ select: () => ({ lean: async () => ({ username: 'alice' }) }) });
    Follow.isFollowing = async () => true;
    FollowRequest.exists = async () => null;
    Notification.findOneAndUpdate = async (filter, update, options) => {
      assert.equal(filter.recipient, target);
      assert.equal(filter.sender, requester);
      assert.equal(filter['data.customData.followRequestId'], requestId);
      assert.equal(filter['data.customData.eventType'], 'follow_request');
      assert.equal(update.$set.message, 'alice started following you');
      assert.equal(update.$set['data.customData.eventType'], 'new_follower');
      assert.equal(update.$set.isRead, undefined);
      assert.equal(update.$set.readAt, undefined);
      assert.equal(options.new, true);
      return { ...existing, ...update.$set };
    };
    const io = { to: (room) => ({ emit: (name, payload) => events.push({ room, name, payload }) }) };
    await publishFollowRequestUpdate({
      req: { app: { get: () => io } },
      request: { _id: requestId, requester, target },
      status: 'accepted'
    });
    const changed = events.find((event) => event.name === 'notification-updated');
    assert.equal(changed.room, `user-${target}`);
    assert.equal(changed.payload.notificationId, notificationId);
    assert.equal(changed.payload.notification.isRead, true);
    assert.deepEqual(changed.payload.notification.readAt, existing.readAt);
    assert.equal(events.filter((event) => event.name === 'follow-request-updated').length, 2);
  } finally {
    User.findById = originalFindById;
    Notification.findOneAndUpdate = originalUpdate;
    Follow.isFollowing = originalIsFollowing;
    FollowRequest.exists = originalRequestExists;
  }
});

test('retraction invalidates only the pending notification linked to its request', async () => {
  const originalUpdate = Notification.findOneAndUpdate;
  const originalIsFollowing = Follow.isFollowing;
  const originalRequestExists = FollowRequest.exists;
  const restoreUserLookup = mockUserLookup();
  const events = [];
  try {
    Notification.findOneAndUpdate = async (filter, update) => {
      assert.equal(filter['data.customData.followRequestId'], requestId);
      assert.equal(filter['data.customData.eventType'], 'follow_request');
      assert.ok(update.$set.deletedAt instanceof Date);
      assert.equal(update.$set.isRead, undefined);
      assert.equal(update.$set.readAt, undefined);
      return { _id: notificationId, ...update.$set };
    };
    Follow.isFollowing = async () => false;
    FollowRequest.exists = async () => null;
    const io = { to: (room) => ({ emit: (name, payload) => events.push({ room, name, payload }) }) };
    await publishFollowRequestUpdate({
      req: { app: { get: () => io } },
      request: { _id: requestId, requester, target },
      status: 'cancelled'
    });
    const removed = events.find((event) => event.name === 'notification-deleted');
    assert.equal(removed.room, `user-${target}`);
    assert.equal(removed.payload.notificationId, notificationId);
    assert.equal(removed.payload.status, 'cancelled');
    assert.equal(events.filter((event) => event.name === 'follow-request-updated').length, 2);
  } finally {
    Notification.findOneAndUpdate = originalUpdate;
    Follow.isFollowing = originalIsFollowing;
    FollowRequest.exists = originalRequestExists;
    restoreUserLookup();
  }
});

test('guarded retraction cancels the pending request without unfollowing and allows a new request', async () => {
  const restoreUserLookup = mockUserLookup();
  const originalIsFollowing = Follow.isFollowing;
  const originalUnfollow = Follow.unfollow;
  const originalCount = Follow.getFollowerCount;
  const originalFindOneAndUpdate = FollowRequest.findOneAndUpdate;
  const originalNotificationUpdate = Notification.findOneAndUpdate;
  let pending = true;
  let unfollowCalls = 0;
  let cancelledNotifications = 0;
  try {
    Follow.isFollowing = async () => false;
    Follow.unfollow = async () => { unfollowCalls += 1; return false; };
    Follow.getFollowerCount = async () => 0;
    FollowRequest.findOneAndUpdate = async (filter, update) => {
      assert.equal(filter.status, 'pending');
      if (!pending) return null;
      assert.equal(update.$set.status, 'cancelled');
      pending = false;
      return { _id: requestId, requester, target, status: 'cancelled' };
    };
    Notification.findOneAndUpdate = async () => { cancelledNotifications += 1; return null; };

    const first = response();
    await toggleFollow(followRequest('DELETE', { expected: 'pending' }), first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.data.followStatus, 'none');
    assert.equal(first.body.data.followRequestPending, false);
    assert.equal(first.body.data.canFollow, true);
    assert.equal(unfollowCalls, 0);
    assert.equal(cancelledNotifications, 1);

    const repeated = response();
    await toggleFollow(followRequest('DELETE', { expected: 'pending' }), repeated);
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.data.followStatus, 'none');
    assert.equal(repeated.body.data.canFollow, true);
    assert.equal(unfollowCalls, 0);
    assert.equal(cancelledNotifications, 1);
  } finally {
    restoreUserLookup();
    Follow.isFollowing = originalIsFollowing;
    Follow.unfollow = originalUnfollow;
    Follow.getFollowerCount = originalCount;
    FollowRequest.findOneAndUpdate = originalFindOneAndUpdate;
    Notification.findOneAndUpdate = originalNotificationUpdate;
  }
});

test('guarded retraction never removes a follow that won the acceptance race', async () => {
  const restoreUserLookup = mockUserLookup();
  const originalIsFollowing = Follow.isFollowing;
  const originalUnfollow = Follow.unfollow;
  const originalCount = Follow.getFollowerCount;
  const originalFindOneAndUpdate = FollowRequest.findOneAndUpdate;
  let unfollowCalls = 0;
  try {
    Follow.isFollowing = async () => true;
    Follow.unfollow = async () => { unfollowCalls += 1; return true; };
    Follow.getFollowerCount = async () => 1;
    FollowRequest.findOneAndUpdate = async () => null;
    const result = response();
    await toggleFollow(followRequest('DELETE', { expected: 'pending' }), result);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.isFollowing, true);
    assert.equal(result.body.data.followStatus, 'accepted');
    assert.equal(unfollowCalls, 0);
  } finally {
    restoreUserLookup();
    Follow.isFollowing = originalIsFollowing;
    Follow.unfollow = originalUnfollow;
    Follow.getFollowerCount = originalCount;
    FollowRequest.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
