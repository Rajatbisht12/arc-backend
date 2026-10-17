import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
const require = createRequire(import.meta.url);
const User = require('../models/User');
const Post = require('../models/Post');
const Exposure = require('../models/ContentExposure');
const Delivery = require('../models/RecommendationDelivery');
const State = require('../models/RecommendationState');
const { getPosts, getClips, getPersonalizedFeed, recordRecommendationExposure, getPost } = require('../controllers/postController');
const { recordContentExposure } = require('./contentExposureService');
const { unseenCandidates, DELIVERY_TTL_MS } = require('./discoveryRankingService');
require('../utils/logger').debug = () => {};
const DAY = 86400000;
let db, viewer, author;
before(async () => {
  db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri());
  await Promise.all([Exposure.syncIndexes(), Delivery.syncIndexes(), State.syncIndexes()]);
  [viewer, author] = await User.create(['viewer', 'author'].map(name => ({ username: `permanent${name}`,
    email: `permanent-${name}@example.invalid`, password: 'fixture-password', userType: 'player', isActive: true, profile: { displayName: name } })));
});
after(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => { await Promise.all([Post.deleteMany({}), Exposure.deleteMany({}), Delivery.deleteMany({}), State.deleteMany({})]); });
const response = () => ({ code: 200, body: null, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const fixture = (type, days = 0) => ({ author: author._id, isActive: true, visibility: 'public', createdAt: new Date(Date.now() - days * DAY),
  content: { text: `Permanent ${type}`, media: type === 'text' ? [] : type === 'mixed'
    ? [{ type: 'image', url: 'https://example.invalid/image.jpg', publicId: 'image' }, { type: 'video', url: 'https://example.invalid/video.mp4', publicId: 'video' }]
    : [{ type, url: `https://example.invalid/${type}.${type === 'video' ? 'mp4' : 'jpg'}`, publicId: type }] } });
async function request(mode, seed, extra = {}) {
  const res = response(); await (mode === 'clips' ? getClips : getPosts)({ user: viewer, query: { limit: 10, sessionSeed: seed, ...extra } }, res);
  assert.equal(res.code, 200); return res.body.data;
}

test('text/image/video/mixed exposures never return on repeated refresh, session expiry or another surface', async () => {
  await Post.insertMany(Array.from({ length: 60 }, (_, i) => fixture(['text', 'image', 'video', 'mixed'][i % 4], i % 2 ? 60 : 1)));
  const consumed = new Set();
  for (let cycle = 0; cycle < 3; cycle++) {
    const page = await request('feed', `refresh-${cycle}`);
    assert.equal(page.posts.length, 10);
    for (const post of page.posts) {
      assert.equal(consumed.has(post._id), false, 'a new refresh must not recycle consumed non-video fallback');
      const ack = response(); await recordRecommendationExposure({ user: viewer, params: { id: post._id }, body: { context: 'feed', durationMs: 1000 } }, ack);
      assert.equal(ack.code, 200); consumed.add(post._id);
    }
    for (const mode of ['feed', 'clips']) {
      const next = await request(mode, `${mode}-cross-${cycle}`);
      assert.equal(next.posts.some(p => consumed.has(p._id)), false);
    }
  }
  await Promise.all([Delivery.deleteMany({}), State.deleteMany({})]);
  for (const mode of ['feed', 'clips']) assert.equal((await request(mode, `cold-device-${mode}`)).posts.some(p => consumed.has(p._id)), false);
  assert.equal(await Exposure.countDocuments({ user: viewer._id }), 30);
});

test('rapid active-tab refreshes continue the delivery session without replaying unexposed items', async () => {
  await Post.insertMany(Array.from({ length: 140 }, (_, i) => fixture(i % 2 ? 'image' : 'video')));
  const delivered = new Set();
  for (const mode of ['feed', 'clips']) {
    delivered.clear();
    for (let cycle = 0; cycle < 10; cycle++) {
      const page = await request(mode, `tab-reselect-${mode}`, { limit: 5 });
      assert.equal(page.posts.length, 5, `${mode} cycle ${cycle + 1} should have unseen inventory`);
      for (const post of page.posts) {
        assert.equal(delivered.has(post._id), false, `${mode} cycle ${cycle + 1} repeated a delivered Post ID`);
        delivered.add(post._id);
      }
    }
    assert.equal(delivered.size, 50);
  }
  assert.equal(await Exposure.countDocuments({ user: viewer._id }), 0,
    'delivery reservations must not masquerade as one-second exposure records');
});

test('viewed and interacted non-video records cause genuine exhaustion, never fallback', async () => {
  const posts = await Post.insertMany(['text', 'image', 'video', 'mixed'].map(type => fixture(type, 60)));
  for (const [i, post] of posts.entries()) await recordContentExposure({ userId: viewer._id, postId: post._id,
    contentType: i < 2 ? 'post' : 'video', durationMs: 1000, interaction: i % 2 === 1 });
  for (let cycle = 0; cycle < 6; cycle++) for (const mode of ['feed', 'clips']) {
    const page = await request(mode, `exhaustion-${cycle}-${mode}`, { includeViewed: 'true', page: 9 });
    assert.deepEqual(page.posts, []); assert.equal(page.pagination.hasMore, false);
  }
  const res = response(); await getPost({ user: viewer, params: { id: String(posts[0]._id) } }, res);
  assert.equal(res.code, 200, 'direct access remains available');
  assert.equal(DELIVERY_TTL_MS, 7 * DAY);
  assert.equal(Exposure.schema.indexes().some(([, opts]) => 'expireAfterSeconds' in opts), false);
});

test('45-day boundary partitions only unseen content and does not expire older content', async () => {
  const now = new Date(); const ages = [0, 7 * DAY, 45 * DAY, 45 * DAY + 1, 90 * DAY];
  const posts = await Post.insertMany(ages.map(age => ({ ...fixture('video'), createdAt: new Date(now - age) })));
  const query = { filter: { isActive: true, visibility: 'public' }, userId: viewer._id, session: 'boundary', now, candidateLimit: 10 };
  const recent = await unseenCandidates({ ...query, tier: 1 }); const older = await unseenCandidates({ ...query, tier: 2 });
  assert.deepEqual(new Set(recent.map(p => String(p._id))), new Set(posts.slice(0, 3).map(p => String(p._id))));
  assert.deepEqual(new Set(older.map(p => String(p._id))), new Set(posts.slice(3).map(p => String(p._id))));
  for (const mode of ['feed', 'clips']) {
    const page = await request(mode, `45-day-${mode}`);
    // The API's clock is later than the pinned query above; the exact-boundary
    // record has since aged into tier 2. Inclusive equality is tested above.
    assert.deepEqual(page.posts.map(p => p._ranking.tier), [1, 1, 2, 2, 2]);
    assert.equal(page.recommendation.rankingPolicy, 'unseen-only-45d-v1');
  }
});

test('text at position 1, image at 9 and mixed media at 50 are persistently excluded', async () => {
  const posts = await Post.insertMany(Array.from({ length: 65 }, (_, i) => fixture(i === 0 ? 'text' : i === 8 ? 'image' : 'mixed')));
  const ids = new Set([0, 8, 49].map(i => String(posts[i]._id)));
  for (const id of ids) for (let retry = 0; retry < 3; retry++) {
    const ack = response(); await recordRecommendationExposure({ user: viewer, params: { id }, body: { context: 'feed', durationMs: 1000 } }, ack); assert.equal(ack.code, 200);
  }
  assert.equal(await Exposure.countDocuments({ user: viewer._id }), 3);
  for (let refresh = 0; refresh < 3; refresh++) {
    const page = await request('feed', `positions-${refresh}`);
    assert.equal(page.posts.some(post => ids.has(String(post._id))), false);
  }
});

test('the personalized-feed compatibility controller cannot bypass all-content exclusion', async () => {
  const [seen, unseen] = await Post.insertMany([fixture('image'), fixture('text', 60)]);
  await recordContentExposure({ userId: viewer._id, postId: seen._id, durationMs: 1000 });
  const res = response();
  await getPersonalizedFeed({ user: viewer, query: { limit: 10, includeViewed: 'true', sessionSeed: 'legacy-feed' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.data.posts.map(p => String(p._id)), [String(unseen._id)]);
});

for (const type of ['text', 'image', 'video', 'mixed']) test(`${type}: acknowledged exposure during an in-flight recommendation is excluded`, async () => {
  const post = await Post.create(fixture(type)); const original = Delivery.bulkWrite; let acknowledged = false;
  Delivery.bulkWrite = async function (...args) {
    const result = await original.apply(this, args);
    if (!acknowledged) { await recordContentExposure({ userId: viewer._id, postId: post._id, durationMs: 1000 }); acknowledged = true; }
    return result;
  };
  try { const page = await request('feed', `race-${type}`); assert.equal(acknowledged, true); assert.deepEqual(page.posts, []); }
  finally { Delivery.bulkWrite = original; }
});
