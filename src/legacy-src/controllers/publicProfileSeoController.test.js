const assert = require('node:assert/strict');
const test = require('node:test');
const User = require('../models/User');
const UsernameRegistry = require('../models/UsernameRegistry');
const controller = require('./publicProfileSeoController');
const { clearLocalCursors } = require('../utils/publicSitemapPagination');

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
  clearLocalCursors();
  const originalFind = User.find;
  const originalCount = User.countDocuments;
  let filter;
  const reads = [];
  User.countDocuments = async nextFilter => {
    assert.equal(nextFilter['privacySettings.profileVisibility'], 'public');
    return 20001;
  };
  User.find = nextFilter => {
    filter = nextFilter;
    const read = { filter: nextFilter };
    reads.push(read);
    const query = {
      sort(value) { read.sort = value; return query; },
      limit(value) { read.limit = value; return query; },
      select(value) { read.select = value; return query; },
      async lean() { return read.select === '_id'
        ? Array.from({ length: 10000 }, (_, index) => ({ _id: index.toString(16).padStart(24, '0') }))
        : [user(), { ...user(), username: 'PrivateOne', privacySettings: { profileVisibility: 'private' } }]; }
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
    assert.equal(reads.length, 2);
    assert(reads.every(read => read.limit === 10000));
    assert(reads.every(read => !('skip' in read)));
    assert.deepEqual(reads[1].sort, { _id: 1 });
    assert.equal(reads[1].filter._id.$gt, '00000000000000000000270f');
    assert.deepEqual(pageResponse.body.data.usernames, ['GamerOne']);
  } finally {
    User.find = originalFind;
    User.countDocuments = originalCount;
  }
});
