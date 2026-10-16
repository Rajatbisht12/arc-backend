import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const User = require('../models/User');
const Post = require('../models/Post');
const Exposure = require('../models/ContentExposure');
const Delivery = require('../models/RecommendationDelivery');
const State = require('../models/RecommendationState');
const Engagement = require('../models/PostEngagement');
const { getRecommendedPosts, recordEngagementEvent } = require('./recommendationService');
const { recordContentExposure } = require('./contentExposureService');
const { FRESH_WINDOW_MS, unseenCandidates } = require('./discoveryRankingService');
const { recordRecommendationExposure, recordClipView, getPost, toggleSave } = require('../controllers/postController');
const { ensureDiscoveryCollections } = require('../utils/ensureDiscoveryCollections');
require('../utils/logger').debug = () => {};
const db = await MongoMemoryServer.create();
await mongoose.connect(db.getUri());
const HOUR = 36e5;
const metrics = {};
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
try {
  await ensureDiscoveryCollections();
  await Promise.all([Exposure.syncIndexes(), Delivery.syncIndexes(), State.syncIndexes(), Post.syncIndexes()]);
  const user = await User.create({ username: 'discoveryviewer', email: 'discoveryviewer@example.invalid', password: 'test-password', userType: 'player', isActive: true, profile: { displayName: 'Viewer' } });
  const author = await User.create({ username: 'discoveryauthor', email: 'discoveryauthor@example.invalid', password: 'test-password', userType: 'player', isActive: true, profile: { displayName: 'Author' } });
  let serial = 0;
  const makePost = (hours, extra = {}) => ({
    author: author._id, isActive: true, visibility: 'public',
    content: { text: `Fixture ${serial++}`, media: [{ type: 'video', url: 'https://example.invalid/fixture.mp4', publicId: 'fixture' }] },
    createdAt: new Date(Date.now() - hours * HOUR), ...extra
  });
  const feed = (seed, options = {}, mode = 'feed') => getRecommendedPosts({ user, query: { limit: 10, sessionSeed: seed, ...options }, mode });
  const clear = async () => Promise.all([Post.deleteMany({}), Exposure.deleteMany({}), Delivery.deleteMany({}), State.deleteMany({}), Engagement.deleteMany({})]);
  await clear();
  check(FRESH_WINDOW_MS === 7 * 24 * HOUR, 'fresh unseen window is seven days, not the legacy 48 hours');
  const boundaryNow = new Date();
  const boundaryPosts = await Post.insertMany([49 * HOUR, 6 * 24 * HOUR, FRESH_WINDOW_MS, FRESH_WINDOW_MS + 1].map(age =>
    makePost(0, { createdAt: new Date(boundaryNow.getTime() - age) })
  ));
  const boundaryQuery = {
    filter: { isActive: true, visibility: 'public' }, userId: user._id,
    session: 'seven-day-boundary', now: boundaryNow, candidateLimit: 10
  };
  const boundaryFresh = await unseenCandidates({ ...boundaryQuery, tier: 1 });
  const boundaryOlder = await unseenCandidates({ ...boundaryQuery, tier: 2 });
  check(boundaryFresh.length === 3 && boundaryPosts.slice(0, 3).every(post => boundaryFresh.some(item => String(item._id) === String(post._id))), '49-hour, six-day and exactly seven-day unseen content belongs to the fresh tier');
  check(boundaryOlder.length === 1 && String(boundaryOlder[0]._id) === String(boundaryPosts[3]._id), 'content older than seven days by one millisecond belongs to the older unseen tier');
  await clear();
  const fresh = await Post.insertMany(Array.from({ length: 23 }, (_, i) => makePost(i ? 49 : 167)));
  const older = await Post.insertMany(Array.from({ length: 17 }, (_, i) => makePost(i ? 30 * 24 : 169, { views: 1_000_000 })));
  const seen = await Post.insertMany([makePost(1), makePost(2)]);
  const acted = await Post.insertMany([makePost(1), makePost(2)]);
  for (let i = 0; i < seen.length; i++) await recordContentExposure({ userId: user._id, postId: seen[i]._id, durationMs: 1500, at: new Date(Date.now() - (10 - i) * HOUR), contentType: 'video' });
  await recordEngagementEvent({ userId: user._id, postId: acted[0]._id, authorId: author._id, eventType: 'like', context: 'feed' });
  await recordEngagementEvent({ userId: user._id, postId: acted[1]._id, authorId: author._id, eventType: 'comment', context: 'clips' });
  let cursor;
  const all = [];
  do {
    const result = await feed('tiers', cursor ? { cursor } : {});
    all.push(...result.posts);
    cursor = result.pagination.nextCursor;
    check(all.length <= 44, 'finite catalog cannot repeat within a session');
  } while (cursor);
  check(new Set(all.map(post => String(post._id))).size === 44, 'every canonical item is served exactly once');
  const tiers = all.map(post => post._ranking.tier);
  check(tiers.every((tier, i) => !i || tier >= tiers[i - 1]), 'strict tiers cannot be crossed by popularity, affinity or diversity');
  check(all.slice(0, 23).every(post => fresh.some(item => String(item._id) === String(post._id))), 'all fresh unseen precedes older unseen');
  check(all.slice(23, 40).every(post => older.some(item => String(item._id) === String(post._id))), 'older unseen precedes previously viewed/liked/commented');
  check(String(all[40]._id) === String(seen[0]._id), 'repeat tier prefers least recently viewed');
  check(tiers.slice(-2).every(tier => tier === 4), 'explicit actions are the final fallback');
  check(await Exposure.countDocuments({ user: user._id }) === 4, 'serving and prefetching do not create exposure');
  // A new authenticated session/device uses the SAME persistent exposure rows.
  const device = await feed('another-device', { includeViewed: 'true' }, 'clips');
  check(device.posts.every(post => post._ranking.tier === 1), 'legacy includeViewed cannot bypass fresh unseen rules');
  const selected = fresh[0];
  await recordContentExposure({ userId: user._id, postId: selected._id, durationMs: 1000, contentType: 'video' });
  const crossSurface = await feed('web-after-android', {}, 'clips');
  check(!crossSurface.posts.some(post => String(post._id) === String(selected._id)), 'Home exposure is recognized by Clips after logout/login/device changes');
  const target = await feed('intentional-target', { targetClipId: String(selected._id) }, 'clips');
  check(String(target.targetClip._id) === String(selected._id) && !target.posts.some(post => String(post._id) === String(selected._id)), 'directly selected video stays accessible and is reserved separately from discovery');
  await recordEngagementEvent({ userId: user._id, postId: selected._id, eventType: 'like', authorId: author._id });
  await recordEngagementEvent({ userId: user._id, postId: selected._id, eventType: 'unlike', authorId: author._id });
  check((await Exposure.findById(`${user._id}:${selected._id}`).lean()).interacted, 'unlike does not erase historical interaction');
  await recordContentExposure({ userId: String(user._id).toUpperCase(), postId: String(selected._id).toUpperCase(), interaction: true });
  check(await Exposure.countDocuments({ user: user._id, post: selected._id }) === 1, 'alternate ObjectId casing cannot split the canonical exposure identity');

  await clear();
  const legacyRemoved = await Post.create(makePost(1));
  await recordEngagementEvent({ userId: user._id, postId: legacyRemoved._id, authorId: author._id, eventType: 'unsave' });
  check((await Exposure.findById(`${user._id}:${legacyRemoved._id}`).lean()).interacted, 'removing a legacy saved item preserves proof of interaction even before backfill');
  await clear();
  const onlySeen = await Post.create(makePost(50));
  await recordContentExposure({ userId: user._id, postId: onlySeen._id, durationMs: 1000 });
  const repeatFirst = await feed('fresh-upload');
  check(repeatFirst.posts[0]._ranking.tier === 3, 'viewed is eligible when unique catalog is exhausted');
  const upload = await Post.create(makePost(0));
  const freshAfterRepeat = await feed('fresh-upload', { cursor: repeatFirst.pagination.nextCursor });
  check(String(freshAfterRepeat.posts[0]._id) === String(upload._id), 'new uploads enter ahead of repeats without restarting the application');
  const restoredVisibility = await Post.create(makePost(169, { visibility: 'private' }));
  await Post.updateOne({ _id: restoredVisibility._id }, { $set: { visibility: 'public' } });
  const olderAfterRepeat = await feed('fresh-upload');
  check(String(olderAfterRepeat.posts[0]._id) === String(restoredVisibility._id) && olderAfterRepeat.posts[0]._ranking.tier === 2, 'incremental exhaustion checks discover newly eligible older posts before repeats');
  const savedCheckpoint = await State.findOne({ user: user._id }).lean();
  check(savedCheckpoint && savedCheckpoint.expiresAt > new Date(), 'unseen exhaustion is checkpointed with explicit expiry');

  await clear();
  const allowed = await Post.create(makePost(1));
  const privatePost = await Post.create(makePost(1, { visibility: 'private' }));
  await Post.create(makePost(1, { hiddenByAdmin: true }));
  await Post.create(makePost(1, { isActive: false }));
  const blocked = await User.create({ username: 'blockedauthor', email: 'blocked@example.invalid', password: 'test-password', userType: 'player', isActive: true, blockedUsers: [user._id], profile: { displayName: 'Blocked' } });
  await Post.create(makePost(1, { author: blocked._id }));
  const suspended = await User.create({ username: 'suspendedauthor', email: 'suspended@example.invalid', password: 'test-password', userType: 'player', isActive: true, moderationStatus: 'suspended', profile: { displayName: 'Suspended' } });
  await Post.create(makePost(1, { author: suspended._id }));
  const eligibility = await feed('privacy');
  check(eligibility.posts.length === 1 && String(eligibility.posts[0]._id) === String(allowed._id), 'private, deleted, moderated, blocked and suspended content is excluded');
  const privateExposure = response();
  await recordRecommendationExposure({ user, params: { id: String(privatePost._id) }, body: { context: 'feed', durationMs: 1000 } }, privateExposure);
  check(privateExposure.code === 403, 'exposure endpoint checks content authorization');
  const short = response();
  await recordRecommendationExposure({ user, params: { id: String(allowed._id) }, body: { durationMs: 999 } }, short);
  check(short.code === 400 && await Exposure.countDocuments({}) === 0, 'short exposure is rejected');
  const publicView = response();
  await recordClipView({ user, params: { id: String(allowed._id) }, body: { context: 'clips' } }, publicView);
  check(publicView.code === 200 && await Exposure.countDocuments({}) === 0, 'legacy instant activation affects public views only');
  const counterBefore = (await Post.findById(allowed._id).lean()).views;
  const actual = response();
  await recordRecommendationExposure({ user, params: { id: String(allowed._id) }, body: { durationMs: 1000, context: 'feed', userId: author._id } }, actual);
  check(actual.code === 200 && await Exposure.countDocuments({ user: user._id }) === 1 && await Exposure.countDocuments({ user: author._id }) === 0, 'server authenticated user owns the exposure');
  check((await Post.findById(allowed._id).lean()).views === counterBefore, 'private exposure never inflates public view counters');
  const direct = response();
  await getPost({ user, params: { id: String(allowed._id) }, body: {} }, direct);
  check(direct.code === 200, 'intentional direct navigation still accesses previously seen content');
  const save = response();
  await toggleSave({ user, params: { id: String(allowed._id) }, body: { context: 'feed' } }, save);
  const unsave = response();
  await toggleSave({ user, params: { id: String(allowed._id) }, body: { context: 'feed' } }, unsave);
  const savedExposure = await Exposure.findById(`${user._id}:${allowed._id}`).lean();
  check(save.code === 200 && unsave.code === 200 && savedExposure.interacted && savedExposure.contentType === 'video', 'existing save/unsave endpoints retain permanent canonical video interaction');

  await clear();
  await Post.insertMany(Array.from({ length: 231 }, (_, i) => makePost(i / 100)));
  const concurrent = await Promise.all([feed('concurrent'), feed('concurrent')]);
  const concurrentIds = concurrent.flatMap(result => result.posts.map(post => String(post._id)));
  check(concurrentIds.length === 20 && new Set(concurrentIds).size === 20, 'concurrent session requests atomically reserve disjoint content');
  const restored = await getRecommendedPosts({ user, query: { limit: 10, cursor: concurrent[0].pagination.nextCursor }, mode: 'feed' });
  check(restored.posts.every(post => !concurrentIds.includes(String(post._id))), 'cursor alone restores the server session without re-serving earlier pages');
  const anonymous = await Promise.all([getRecommendedPosts({ user: null }), getRecommendedPosts({ user: null })]);
  check(anonymous.every(result => result.posts.length === 15), 'independent anonymous clients cannot exhaust each other’s implicit session');
  for (const mode of ['feed', 'clips']) {
    const seenIds = new Set(); const times = []; let next;
    do {
      const start = performance.now();
      const result = await feed(`long-${mode}`, next ? { cursor: next } : {}, mode);
      times.push(performance.now() - start);
      for (const post of result.posts) {
        check(!seenIds.has(String(post._id)), `${mode} never repeats a delivered id beyond client exclusion capacity`);
        seenIds.add(String(post._id));
      }
      next = result.pagination.nextCursor;
      check(times.length < 30, 'finite catalog cannot cause an API loop');
    } while (next);
    check(seenIds.size === 231, `${mode} reaches all 231 eligible records, beyond 150/200`);
    const sorted = [...times].sort((a, b) => a - b);
    metrics[mode] = { records: seenIds.size, pages: times.length, firstMs: +times[0].toFixed(2), medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2), p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2) };
  }
  await Exposure.insertMany(Array.from({ length: 20_000 }, (_, i) => {
    const post = new mongoose.Types.ObjectId();
    return { _id: `${user._id}:${post}`, user: user._id, post, contentType: 'video', interacted: false, firstViewedAt: new Date(Date.now() - i * 1000), lastViewedAt: new Date(Date.now() - i * 1000) };
  }));
  const largeStart = performance.now();
  const large = await feed('large-history');
  metrics.largeHistory = { historyRows: 20_000, requestMs: +(performance.now() - largeStart).toFixed(2) };
  check(large.posts.length === 10 && large.posts.every(post => post._ranking.tier === 1), 'large lifetime history does not need a truncated or in-memory exclusion array');
  await clear();
  const empty = await feed('empty', {}, 'clips');
  check(!empty.posts.length && !empty.pagination.nextCursor && !empty.pagination.hasMore, 'empty catalog stops without a continuation loop');
  console.log(JSON.stringify({ checks, metrics }, null, 2));
} finally { await mongoose.disconnect(); await db.stop(); }
