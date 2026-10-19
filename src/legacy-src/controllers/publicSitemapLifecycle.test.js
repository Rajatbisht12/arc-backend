const assert = require('node:assert/strict');
const test = require('node:test');
const User = require('../models/User');
const Post = require('../models/Post');
const profiles = require('./publicProfileSeoController');
const posts = require('./publicPostSeoController');
const { PAGE_SIZE, CURSOR_TTL_SECONDS, COUNT_TTL_SECONDS, clearLocalCursors } = require('../utils/publicSitemapPagination');

const id = number => number.toString(16).padStart(24, '0');
const publicUser = (number, username = `player_${number}`) => ({
  _id: id(number), username, userType: 'player', isActive: true,
  moderationStatus: 'active', deletedAt: null, needsProfileCompletion: false,
  privacySettings: { profileVisibility: 'public', showPostsToFollowers: true }
});
const publicPost = (number, author) => ({
  _id: id(number), visibility: 'public', isActive: true,
  hiddenByAdmin: false, author
});
const response = () => ({
  headers: {}, setHeader(key, value) { this.headers[key] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; }
});
const valueAt = (record, path) => path.split('.').reduce((value, part) => value?.[part], record);
const matches = (record, filter) => Object.entries(filter).every(([path, expected]) => {
  const actual = valueAt(record, path);
  if (expected instanceof RegExp) return expected.test(actual || '');
  if (expected && typeof expected === 'object') {
    if ('$gt' in expected) return String(actual) > String(expected.$gt);
    if ('$in' in expected) return expected.$in.includes(actual);
    if ('$ne' in expected) return actual !== expected.$ne;
  }
  return expected === null ? actual == null : actual === expected;
});

const withMutableCollections = async (users, records, run) => {
  clearLocalCursors();
  const originals = {
    userFind: User.find, userCount: User.countDocuments,
    postFind: Post.find, postCount: Post.countDocuments
  };
  const install = (Model, collection) => {
    Model.countDocuments = async filter => collection.filter(item => matches(item, filter)).length;
    Model.find = filter => {
      let limit = Infinity;
      const query = {
        sort(order) { assert.deepEqual(order, { _id: 1 }); return query; },
        limit(value) { assert(value <= PAGE_SIZE); limit = value; return query; },
        select() { return query; }, populate() { return query; },
        async lean() { return collection.filter(item => matches(item, filter))
          .sort((a, b) => String(a._id).localeCompare(String(b._id))).slice(0, limit); }
      };
      return query;
    };
  };
  install(User, users);
  install(Post, records);
  try { await run(); } finally {
    User.find = originals.userFind;
    User.countDocuments = originals.userCount;
    Post.find = originals.postFind;
    Post.countDocuments = originals.postCount;
    clearLocalCursors();
  }
};
const profilePage = async page => {
  const res = response();
  await profiles.getPublicProfileSitemap({ query: { page: String(page) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  return res.body.data.usernames;
};
const postPage = async page => {
  const res = response();
  await posts.getPublicPostSitemap({ query: { page: String(page) } }, res);
  assert.equal(res.statusCode, 200);
  return res.body.data.posts.map(post => post.id);
};

test('new public profiles and posts enter live pages; privacy, rename, moderation and deletion withdraw old URLs', async () => {
  const users = [publicUser(1, 'FirstUser')];
  const records = [publicPost(11, users[0])];
  await withMutableCollections(users, records, async () => {
    assert.deepEqual(await profilePage(1), ['FirstUser']);
    assert.deepEqual(await postPage(1), [id(11)]);

    const next = publicUser(2, 'NewUser');
    users.push(next);
    records.push(
      { ...publicPost(12, next), content: { text: 'Text post', media: [] } },
      { ...publicPost(13, next), content: { text: 'Image post', media: [{ type: 'image' }] } },
      { ...publicPost(14, next), content: { text: 'Video post', media: [{ type: 'video' }] } }
    );
    assert.deepEqual(await profilePage(1), ['FirstUser', 'NewUser']);
    assert.deepEqual(await postPage(1), [id(11), id(12), id(13), id(14)]);

    next.username = 'RenamedUser';
    assert.deepEqual(await profilePage(1), ['FirstUser', 'RenamedUser']);
    next.privacySettings.profileVisibility = 'private';
    assert.deepEqual(await profilePage(1), ['FirstUser']);
    assert.deepEqual(await postPage(1), [id(11)]);

    next.privacySettings.profileVisibility = 'public';
    records[1].isActive = false;
    records[2].hiddenByAdmin = true;
    records[3].visibility = 'private';
    assert.deepEqual(await postPage(1), [id(11)]);
    users[0].moderationStatus = 'suspended';
    assert.deepEqual(await profilePage(1), ['RenamedUser']);
    assert.deepEqual(await postPage(1), []);
  });
});

test('a visibility change at a 10,000-record boundary is complete once the short cursor expires', async () => {
  const users = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => publicUser(index + 1));
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await withMutableCollections(users, [], async () => {
      assert.equal((await profilePage(1)).length, PAGE_SIZE);
      assert.deepEqual(await profilePage(2), [`player_${PAGE_SIZE + 1}`]);

      // An older account can become public later, before the cached page boundary.
      users.push(publicUser(0, 'NewlyPublic'));
      now += (Math.max(COUNT_TTL_SECONDS, CURSOR_TTL_SECONDS) + 1) * 1000;
      const first = await profilePage(1);
      const second = await profilePage(2);
      const all = [...first, ...second];
      assert.equal(all.length, PAGE_SIZE + 2);
      assert.equal(new Set(all).size, all.length);
      assert(all.includes('NewlyPublic'));
      assert(all.includes(`player_${PAGE_SIZE + 1}`));
    });
  } finally { Date.now = originalNow; }
});
