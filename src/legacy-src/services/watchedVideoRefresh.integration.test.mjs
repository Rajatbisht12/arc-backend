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
const { getRecommendedPosts } = require('./recommendationService');
const { recordContentExposure } = require('./contentExposureService');
require('../utils/logger').debug = () => {};
let db, viewer, author;
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([Exposure.syncIndexes(), Delivery.syncIndexes(), State.syncIndexes()]);
  [viewer, author] = await User.create(['viewer', 'author'].map(name => ({
    username: `refresh${name}`, email: `${name}@example.invalid`, password: 'fixture-password',
    userType: 'player', isActive: true, profile: { displayName: name },
  })));
});
after(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  await Promise.all([Post.deleteMany({}), Exposure.deleteMany({}), Delivery.deleteMany({}), State.deleteMany({})]);
});
const makeVideo = () => Post.create({
  author: author._id, visibility: 'public', isActive: true,
  content: { text: 'Refresh regression video', media: [{ type: 'video', url: 'https://example.invalid/video.mp4', publicId: 'video' }] },
});
const feed = (mode, seed) => getRecommendedPosts({ user: viewer, query: { limit: 10, sessionSeed: seed }, mode });

test('frequent fresh sessions never return an acknowledged watched video on either surface', async () => {
  const video = await makeVideo();
  await recordContentExposure({ userId: viewer._id, postId: video._id, contentType: 'post', durationMs: 1000 });
  for (let refresh = 0; refresh < 12; refresh++) {
    for (const mode of ['feed', 'clips']) {
      const result = await feed(mode, `${mode}-refresh-${refresh}`);
      assert.deepEqual(result.posts, [], `watched video repeated on ${mode} refresh ${refresh}`);
      assert.equal(result.pagination.hasMore, false);
    }
  }
  await Promise.all([Delivery.deleteMany({}), State.deleteMany({})]);
  assert.deepEqual((await feed('clips', 'new-device-after-session-expiry')).posts, []);
  assert.equal(await Exposure.countDocuments({ user: viewer._id, post: video._id }), 1);
});

test('positions 1, 9 and 50 use canonical identity; 999ms/prefetch stay unseen; reports are idempotent', async () => {
  const catalog = await Promise.all(Array.from({ length: 65 }, makeVideo));
  for (const index of [0, 8, 49]) {
    for (let repeat = 0; repeat < 3; repeat++) await recordContentExposure({
      userId: viewer._id, postId: catalog[index]._id, contentType: 'video', durationMs: index === 49 ? 3000 : 1000,
    });
  }
  assert.equal(await Exposure.countDocuments({ user: viewer._id }), 3);
  await recordContentExposure({ userId: viewer._id, postId: catalog[1]._id, durationMs: 999 });
  const excluded = new Set([0, 8, 49].map(index => String(catalog[index]._id)));
  for (let refresh = 0; refresh < 6; refresh++) for (const mode of ['feed', 'clips']) {
    const ids = new Set();
    let cursor;
    do {
      const result = await getRecommendedPosts({ user: viewer, query: { limit: 30, sessionSeed: `${mode}-${refresh}`, cursor }, mode });
      for (const post of result.posts) {
        assert.equal(excluded.has(String(post._id)), false);
        assert.equal(ids.has(String(post._id)), false);
        ids.add(String(post._id));
      }
      cursor = result.pagination.nextCursor;
    } while (cursor);
    assert.equal(ids.size, 62);
    assert.equal(ids.has(String(catalog[1]._id)), true, 'sub-threshold watch must not invent an exposure');
    assert.equal(ids.has(String(catalog[2]._id)), true, 'metadata prefetch must remain eligible');
  }
});

for (const mode of ['feed', 'clips']) {
  test(`${mode} rechecks exposure acknowledged while a recommendation request is in flight`, async () => {
    const video = await makeVideo();
    const original = Delivery.bulkWrite;
    let acknowledged = false;
    Delivery.bulkWrite = async function (...args) {
      const result = await original.apply(this, args);
      if (!acknowledged) {
        await recordContentExposure({ userId: viewer._id, postId: video._id, contentType: 'video', durationMs: 1000 });
        acknowledged = true;
      }
      return result;
    };
    try {
      const result = await feed(mode, `concurrent-refresh-${mode}`);
      assert.equal(acknowledged, true);
      assert.equal(result.posts.some(post => String(post._id) === String(video._id)), false,
        'a candidate selected before exposure must not be delivered after that exposure is acknowledged');
    } finally { Delivery.bulkWrite = original; }
  });
}
