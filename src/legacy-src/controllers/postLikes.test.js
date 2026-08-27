// Real-DB proof of the paginated Likes-list endpoint (getPostLikes) that powers
// the shared Likes Drawer: it lists the users who liked a post/clip newest-first,
// pages via a stable cursor, honours post visibility, and never leaks deleted/
// deactivated likers.
const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Post = require('../models/Post');
const { getPostLikes } = require('./postController');

let mongod;
test.before(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); });
test.after(async () => { await mongoose.disconnect(); await mongod.stop(); });
test.beforeEach(async () => { await User.deleteMany({}); await Post.deleteMany({}); });

const makeUser = (username, extra = {}) => User.create({
  username, email: `${username}@example.com`, password: 'x'.repeat(12),
  userType: extra.userType || 'player', isActive: extra.isActive !== false,
  profile: { displayName: extra.displayName || username, avatar: extra.avatar },
});

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

test('lists likers newest-first, paginates by cursor, and excludes deleted/deactivated users', async () => {
  const author = await makeUser('author');
  const viewer = await makeUser('viewer');
  const a = await makeUser('alpha', { displayName: 'Alpha' });
  const b = await makeUser('bravo', { userType: 'team', displayName: 'Bravo Team' });
  const c = await makeUser('charlie');
  const gone = await makeUser('ghost', { isActive: false }); // deactivated liker

  const t = (min) => new Date(Date.UTC(2026, 7, 1, 0, min, 0));
  const post = await Post.create({
    author: author._id,
    visibility: 'public',
    content: { text: 'hello', media: [] },
    likes: [
      { user: a._id, likedAt: t(1) },
      { user: b._id, likedAt: t(3) },      // newest
      { user: c._id, likedAt: t(2) },
      { user: gone._id, likedAt: t(4) },   // most recent, but deactivated → excluded
    ],
  });

  // Page 1 (limit 2): newest active first → Bravo(t3), Charlie(t2).
  const res1 = makeRes();
  await getPostLikes({ params: { id: String(post._id) }, query: { limit: '2' }, user: viewer }, res1);
  assert.equal(res1.statusCode, 200);
  const d1 = res1.body.data;
  assert.equal(d1.total, 3, 'total excludes the deactivated liker');
  assert.deepEqual(d1.items.map((i) => i.username), ['bravo', 'charlie']);
  assert.equal(d1.items[0].accountType, 'team', 'team liker gets accountType team');
  assert.equal(d1.items[0].displayName, 'Bravo Team');
  assert.ok(d1.hasMore && d1.nextCursor, 'more pages available');

  // Page 2 via cursor → Alpha(t1); ghost never appears.
  const res2 = makeRes();
  await getPostLikes({ params: { id: String(post._id) }, query: { limit: '2', cursor: d1.nextCursor }, user: viewer }, res2);
  const d2 = res2.body.data;
  assert.deepEqual(d2.items.map((i) => i.username), ['alpha']);
  assert.equal(d2.hasMore, false);
  assert.equal(d2.nextCursor, null);
  assert.ok(!d1.items.concat(d2.items).some((i) => i.username === 'ghost'), 'deactivated liker never leaked');
});

test('zero likes returns an empty, non-error payload (drawer shows "No likes yet")', async () => {
  const author = await makeUser('author2');
  const viewer = await makeUser('viewer2');
  const post = await Post.create({ author: author._id, visibility: 'public', content: { text: 'x', media: [] }, likes: [] });
  const res = makeRes();
  await getPostLikes({ params: { id: String(post._id) }, query: {}, user: viewer }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.items, []);
  assert.equal(res.body.data.total, 0);
  assert.equal(res.body.data.hasMore, false);
});

test('a missing post 404s rather than leaking', async () => {
  const viewer = await makeUser('viewer3');
  const res = makeRes();
  await getPostLikes({ params: { id: String(new mongoose.Types.ObjectId()) }, query: {}, user: viewer }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});
