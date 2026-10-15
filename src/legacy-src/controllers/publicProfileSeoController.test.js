const assert = require('node:assert/strict');
const test = require('node:test');
const User = require('../models/User');
const UsernameRegistry = require('../models/UsernameRegistry');
const controller = require('./publicProfileSeoController');

const user = () => ({
  username: 'GamerOne', userType: 'player', isActive: true,
  moderationStatus: 'active', privacySettings: { profileVisibility: 'public' },
  profile: { displayName: 'Gamer One', avatar: 'https://media.squadhunt.com/gaming-social/avatars/a.jpg', bio: 'Public bio' }
});

const response = () => ({
  headers: {},
  setHeader(key, value) { this.headers[key] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; }
});

test('public SEO endpoint emits only public fields and immediately withdraws private profiles', async () => {
  const originalFindOne = User.findOne;
  const originalClaim = UsernameRegistry.findOne;
  let record = user();
  let filter;
  UsernameRegistry.findOne = () => ({ select: () => ({ lean: async () => ({ kind: 'user', ownerId: '507f1f77bcf86cd799439011' }) }) });
  User.findOne = nextFilter => {
    filter = nextFilter;
    return { select: () => ({ lean: async () => record }) };
  };
  try {
    const publicResponse = response();
    await controller.getPublicProfileSeo({ params: { username: 'gamerone' } }, publicResponse);
    assert.equal(publicResponse.statusCode, 200);
    assert.deepEqual(publicResponse.body.data.user, {
      username: 'GamerOne', userType: 'player', profile: {
        displayName: 'Gamer One', avatar: 'https://media.squadhunt.com/gaming-social/avatars/a.jpg', bio: 'Public bio'
      }
    });
    assert.equal(filter['privacySettings.profileVisibility'], 'public');
    assert.equal(publicResponse.headers['Cache-Control'], 'private, no-store, max-age=0');

    record = { ...record, privacySettings: { profileVisibility: 'private' } };
    const privateResponse = response();
    await controller.getPublicProfileSeo({ params: { username: 'gamerone' } }, privateResponse);
    assert.equal(privateResponse.statusCode, 404);
    assert.equal(privateResponse.body.data, undefined);
  } finally {
    User.findOne = originalFindOne;
    UsernameRegistry.findOne = originalClaim;
  }
});

test('sitemap uses the identical eligibility filter and bounded page size', async () => {
  const originalFind = User.find;
  const originalCount = User.countDocuments;
  let filter;
  let skip;
  let limit;
  User.countDocuments = async nextFilter => {
    assert.equal(nextFilter['privacySettings.profileVisibility'], 'public');
    return 2001;
  };
  User.find = nextFilter => {
    filter = nextFilter;
    const query = {
      sort() { return query; },
      skip(value) { skip = value; return query; },
      limit(value) { limit = value; return query; },
      select() { return query; },
      async lean() { return [user(), { ...user(), username: 'PrivateOne', privacySettings: { profileVisibility: 'private' } }]; }
    };
    return query;
  };
  try {
    const countResponse = response();
    await controller.getPublicProfileSitemapCount({}, countResponse);
    assert.deepEqual(countResponse.body.data, { pages: 3 });
    const pageResponse = response();
    await controller.getPublicProfileSitemap({ query: { page: '2' } }, pageResponse);
    assert.equal(filter['privacySettings.profileVisibility'], 'public');
    assert.equal(skip, 1000);
    assert.equal(limit, 1000);
    assert.deepEqual(pageResponse.body.data.usernames, ['GamerOne']);
  } finally {
    User.find = originalFind;
    User.countDocuments = originalCount;
  }
});
