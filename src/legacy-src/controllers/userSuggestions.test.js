const test = require('node:test');
const assert = require('node:assert/strict');

const userPath = require.resolve('../models/User');
const followPath = require.resolve('../models/Follow');
const requestPath = require.resolve('../models/FollowRequest');
const countsPath = require.resolve('../services/discoverUserCounts');
const suggestionsPath = require.resolve('../services/userSuggestionService');
const controllerPath = require.resolve('./userController');
const User = require(userPath);
const Follow = require(followPath);
const FollowRequest = require(requestPath);
const counts = require(countsPath);
const suggestions = require(suggestionsPath);
const originals = {
  userFind: User.find, userFindById: User.findById,
  followFind: Follow.find, requestFind: FollowRequest.find,
  counts: counts.getVisibleFollowCounts, sample: suggestions.sampleSuggestedUsers,
  controller: require.cache[controllerPath],
};

const viewer = '000000000000000000000001';
const followed = '000000000000000000000002';
const blocked = '000000000000000000000003';
const blocking = '000000000000000000000004';
const older = '000000000000000000000005';
let sampledFilter;

User.findById = () => ({ select() { return this; }, async lean() { return { blockedUsers: [blocked] }; } });
User.find = (filter) => ({ select() { return this; }, async lean() {
  return filter.blockedUsers ? [{ _id: blocking }] : [];
} });
Follow.find = (filter) => ({
  async distinct() { return filter.follower ? [followed] : []; },
  select() { return this; },
  async lean() { return []; },
});
FollowRequest.find = () => ({ select() { return this; }, async lean() { return []; } });
counts.getVisibleFollowCounts = async () => ({ followers: new Map(), following: new Map() });
suggestions.sampleSuggestedUsers = async (_model, filter, limit) => {
  sampledFilter = filter;
  assert.equal(limit, 12);
  return [{ _id: older, username: 'older_user', userType: 'player', isActive: true,
    privacySettings: { profileVisibility: 'public', allowFollowRequests: true }, profile: { displayName: 'Older User' } }];
};
delete require.cache[controllerPath];
const { getUsers } = require(controllerPath);

test.after(() => {
  User.find = originals.userFind;
  User.findById = originals.userFindById;
  Follow.find = originals.followFind;
  FollowRequest.find = originals.requestFind;
  counts.getVisibleFollowCounts = originals.counts;
  suggestions.sampleSuggestedUsers = originals.sample;
  delete require.cache[controllerPath];
  if (originals.controller) require.cache[controllerPath] = originals.controller;
});

test('authenticated suggestions use the rotating endpoint and retain eligibility boundaries', async () => {
  let status, body;
  const headers = new Map();
  const res = {
    set(name, value) { headers.set(name, value); return this; },
    status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  };
  await getUsers({ query: { suggestions: 'true', limit: '12' }, user: { _id: viewer, userType: 'player' } }, res);
  assert.equal(status, 200);
  assert.equal(body.data.users[0]._id, older);
  assert.equal(headers.get('Cache-Control'), 'private, no-store');
  assert.equal(sampledFilter.isActive, true);
  assert.deepEqual(sampledFilter.moderationStatus.$nin, ['suspended', 'banned', 'soft_deleted']);
  assert.equal(sampledFilter.isSystemAccount.$ne, true);
  assert.deepEqual(sampledFilter.userType.$in, ['player', 'team', 'creator']);
  assert.equal(sampledFilter['privacySettings.allowFollowRequests'].$ne, false);
  assert.deepEqual(sampledFilter.$and.find(condition => condition._id?.$nin)._id.$nin.map(String),
    [viewer, followed, blocked, blocking]);
  assert.ok(sampledFilter.$and.some(condition => condition.$or?.some(branch =>
    branch['privacySettings.profileVisibility'] === 'public')));
});
