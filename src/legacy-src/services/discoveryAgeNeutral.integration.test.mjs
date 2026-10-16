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
const { getDiscoveryPage, sessionKey, DELIVERY_TTL_MS } = require('./discoveryRankingService');
const { getRecommendedPosts, scorePost } = require('./recommendationService');
const { recordContentExposure } = require('./contentExposureService');
require('../utils/logger').debug = () => {};
const DAY = 24 * 60 * 60 * 1000;
let db, viewer, author;
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([Exposure.syncIndexes(), Delivery.syncIndexes(), State.syncIndexes()]);
  [viewer, author] = await User.create(['viewer', 'author'].map(name => ({
    username: `age${name}`, email: `age-${name}@example.invalid`, password: 'fixture-password',
    userType: 'player', isActive: true, profile: { displayName: name },
  })));
});
after(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  await Promise.all([Post.deleteMany({}), Exposure.deleteMany({}), Delivery.deleteMany({}), State.deleteMany({})]);
});
const makePost = (daysOld, extra = {}) => Post.create({
  author: author._id, visibility: 'public', isActive: true,
  createdAt: new Date(Date.now() - daysOld * DAY),
  content: { text: 'Age-neutral fixture', media: [{ type: 'video', url: 'https://example.invalid/fixture.mp4', publicId: 'fixture' }] },
  ...extra,
});
const context = mode => ({ mode, relationship: { currentUserId: String(viewer._id), followingIds: new Set() },
  interestProfile: { authorWeights: new Map(), postTypeWeights: new Map(), tagWeights: new Map(), interactionMap: new Map() },
  seed: 'age-neutral-test', sessionId: 'age-neutral-test', seenMap: new Map(), boostDeliveryMap: new Map() });

for (const mode of ['feed', 'clips']) {
  test(`${mode}: today and 30-day-old unseen videos share tier 1; quality determines order`, async () => {
    const today = await makePost(0);
    const older = await makePost(30, { views: 1_000_000 });
    const result = await getRecommendedPosts({ user: viewer, mode, query: { limit: 10, sessionSeed: `age-${mode}` } });
    assert.deepEqual(result.posts.map(p => p._ranking.tier), [1, 1]);
    assert.equal(String(result.posts[0]._id), String(older._id), 'upload age must not override stronger quality/engagement');
    assert.equal(result.posts.some(p => String(p._id) === String(today._id)), true);
    assert.equal(result.recommendation.signals.includes('fresh_unseen_7d'), false);
    assert.equal(result.recommendation.rankingPolicy, 'unseen-age-neutral-v1');
  });
  test(`${mode}: score is unchanged by upload age, while personalization still matters`, async () => {
    const post = (await makePost(0)).toObject();
    const ctx = context(mode);
    const score = scorePost(post, ctx);
    for (const days of [1, 6, 7, 8, 30, 365]) {
      assert.equal(scorePost({ ...post, createdAt: new Date(Date.now() - days * DAY) }, ctx), score, `age ${days}d must not affect automatic ranking`);
    }
    assert.ok(scorePost(post, { ...ctx, relationship: { ...ctx.relationship, followingIds: new Set([String(author._id)]) } }) > score);
    assert.ok(scorePost(post, { ...ctx, interestProfile: { ...ctx.interestProfile, authorWeights: new Map([[String(author._id), 100]]) } }) > score);
  });
  test(`${mode}: actual recommendation score is invariant when only the upload date changes`, async () => {
    const post = await makePost(0);
    const request = () => getRecommendedPosts({ user: viewer, mode, query: { sessionSeed: 'same-scoring-context' } });
    const today = await request();
    await Promise.all([Delivery.deleteMany({}), State.deleteMany({})]);
    await Post.collection.updateOne({ _id: post._id }, { $set: { createdAt: new Date(Date.now() - 30 * DAY) } });
    const older = await request();
    assert.equal(older.posts[0]._ranking.tier, 1);
    assert.equal(older.posts[0]._ranking.rankingScore, today.posts[0]._ranking.rankingScore);
  });
}

test('bounded candidate enumeration does not depend on upload dates', async () => {
  const posts = await Post.insertMany(Array.from({ length: 250 }, (_, index) => ({
    author: author._id, visibility: 'public', isActive: true,
    content: { text: `Window ${index}`, media: [] }, createdAt: new Date(Date.now() - index * DAY),
  })));
  const rank = candidates => candidates.slice(0, 1).map(post => ({ post, score: 0 }));
  const request = seed => getDiscoveryPage({ userId: viewer._id, mode: 'feed', seed,
    baseFilter: { isActive: true, visibility: 'public' }, limit: 1, rank });
  const first = await request('before-age-swap');
  await Post.collection.bulkWrite(posts.map((post, index) => ({ updateOne: { filter: { _id: post._id },
    update: { $set: { createdAt: new Date(Date.now() - (250 - index) * DAY) } } } })));
  const second = await request('after-age-swap');
  assert.equal(String(first.selected[0].post._id), String(second.selected[0].post._id));
});

test('three priorities retain persistent video exclusion and unchanged delivery TTL', async () => {
  const unseen = await makePost(30);
  const viewed = await makePost(0, { content: { text: 'Viewed non-video', media: [] } });
  const interacted = await makePost(0, { content: { text: 'Interacted non-video', media: [] } });
  const watched = await makePost(0);
  await recordContentExposure({ userId: viewer._id, postId: viewed._id, contentType: 'post', durationMs: 1000 });
  await recordContentExposure({ userId: viewer._id, postId: interacted._id, contentType: 'post', interaction: true });
  await recordContentExposure({ userId: viewer._id, postId: watched._id, contentType: 'video', durationMs: 1000 });
  const startedAt = Date.now();
  const result = await getRecommendedPosts({ user: viewer, mode: 'feed', query: { sessionSeed: 'new-priorities' } });
  assert.deepEqual(result.posts.map(p => String(p._id)), [unseen, viewed, interacted].map(p => String(p._id)));
  assert.deepEqual(result.posts.map(p => p._ranking.tier), [1, 2, 3]);
  for (const mode of ['feed', 'clips']) for (let refresh = 0; refresh < 6; refresh++) {
    const page = await getRecommendedPosts({ user: viewer, mode, query: { sessionSeed: `${mode}-reload-${refresh}` } });
    assert.equal(page.posts.some(p => String(p._id) === String(watched._id)), false);
  }
  const reservation = await Delivery.findOne({ session: sessionKey(viewer._id, 'feed', 'new-priorities') }).lean();
  assert.equal(DELIVERY_TTL_MS, 7 * DAY);
  assert.ok(reservation.expiresAt.getTime() >= startedAt + 7 * DAY);
  assert.ok(reservation.expiresAt.getTime() <= Date.now() + 7 * DAY);
  assert.ok(Delivery.schema.indexes().some(([, options]) => options.expireAfterSeconds === 0));
  assert.equal(Exposure.schema.indexes().some(([, options]) => 'expireAfterSeconds' in options), false);
});

test('old exhaustion checkpoints are revalidated without resetting delivery reservations', async () => {
  const post = await makePost(30);
  const seed = 'existing-session';
  const session = sessionKey(viewer._id, 'feed', seed);
  const baseFilter = { isActive: true, visibility: 'public' };
  const { createHash } = require('node:crypto');
  await State.create({ _id: session, user: viewer._id,
    filterHash: createHash('sha256').update(JSON.stringify(baseFilter)).digest('hex'),
    unseenCheckedAt: new Date(Date.now() + DAY), expiresAt: new Date(Date.now() + 60_000) });
  const page = await getDiscoveryPage({ userId: viewer._id, mode: 'feed', seed, baseFilter, limit: 10,
    rank: candidates => candidates.map(post => ({ post, score: 0 })) });
  assert.equal(page.selected.some(item => String(item.post._id) === String(post._id)), true);
  assert.equal(page.session, session);
  const next = await getDiscoveryPage({ userId: viewer._id, mode: 'feed', seed, baseFilter, limit: 10,
    rank: candidates => candidates.map(post => ({ post, score: 0 })) });
  assert.equal(next.selected.length, 0, 'same session must still honor previously reserved IDs');
});
