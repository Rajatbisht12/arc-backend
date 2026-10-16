const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  actualDate, buildExposureOperation, mergeExposureOperations, writeExposureBatch, migrate
} = require('./migrate-discovery-exposure');

test('historical operation builders preserve monotonic state without invented dates or conflicting paths', () => {
  const user = '507f1f77bcf86cd799439011';
  const post = '507f1f77bcf86cd799439012';
  const first = new Date('2020-01-01T00:00:00Z');
  const last = new Date('2026-01-01T00:00:00Z');
  assert.equal(actualDate(null), null);
  assert.equal(actualDate('invalid'), null);
  assert.equal(buildExposureOperation({ user, post }), null);
  const undated = buildExposureOperation({ user, post, interacted: true });
  assert.deepEqual(undated.updateOne.update.$max, { interacted: true });
  assert.equal(undated.updateOne.update.$min, undefined);
  const operations = mergeExposureOperations([
    buildExposureOperation({ user, post, firstViewedAt: last, lastViewedAt: last }),
    buildExposureOperation({ user, post, firstViewedAt: first, lastViewedAt: first, interacted: true, firstInteractedAt: first }),
    buildExposureOperation({ user, post, firstViewedAt: last, lastViewedAt: last })
  ]);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].updateOne.update.$max.interacted, true);
  assert.deepEqual(operations[0].updateOne.update.$min.firstViewedAt, first);
  assert.deepEqual(operations[0].updateOne.update.$max.lastViewedAt, last);
  const paths = new Set();
  for (const fields of Object.values(operations[0].updateOne.update)) {
    for (const path of Object.keys(fields)) {
      assert.ok(!paths.has(path), `conflicting MongoDB update path: ${path}`);
      paths.add(path);
    }
  }
});

test('concurrent upsert duplicate races retry safely while mixed failures surface', async () => {
  const operation = buildExposureOperation({
    user: '507f1f77bcf86cd799439011', post: '507f1f77bcf86cd799439012', interacted: true
  });
  const calls = [];
  const collection = {
    async bulkWrite(operations) {
      calls.push(operations);
      if (calls.length === 1) throw Object.assign(new Error('duplicate'), { writeErrors: [{ index: 0, code: 11000 }] });
    }
  };
  await writeExposureBatch(collection, [operation]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0].updateOne.upsert, false);
  await assert.rejects(writeExposureBatch({
    async bulkWrite() {
      throw Object.assign(new Error('mixed write failure'), { writeErrors: [{ index: 0, code: 11000 }, { index: 1, code: 121 }] });
    }
  }, [operation, operation]), /mixed write failure/);
});

test('migration audits without writing and idempotently backfills qualified canonical histories', async () => {
  mongoose.set('autoCreate', false);
  mongoose.set('autoIndex', false);
  const models = Object.fromEntries(['ContentExposure', 'RecommendationDelivery', 'RecommendationState', 'PostEngagement', 'Post', 'User']
    .map((name) => [name, require(`../src/legacy-src/models/${name}`)]));
  const database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), { autoCreate: false, autoIndex: false });
  try {
    const id = () => new mongoose.Types.ObjectId();
    const user = id();
    const inactive = id();
    const deleted = id();
    const [qualified, brief, zero, impression, legacyView, liked, undated, saved, removed, invalidViewer] = Array.from({ length: 10 }, id);
    const first = new Date('2020-01-01T00:00:00Z');
    const last = new Date('2026-01-01T00:00:00Z');
    await models.User.collection.insertMany([
      { _id: user, isActive: true, savedPosts: [{ post: saved, savedAt: first }] },
      { _id: inactive, isActive: false },
      { _id: deleted, isActive: true, deletedAt: last }
    ]);
    await models.Post.collection.insertMany([qualified, brief, zero, impression, legacyView, liked, undated, saved, invalidViewer].map((post) => ({
      _id: post,
      content: { media: post.equals(qualified) ? [{ type: 'video' }] : [] },
      ...(post.equals(legacyView) ? { viewedBy: [{ user, viewedAt: first }] } : {}),
      ...(post.equals(liked) ? { likes: [{ user, likedAt: first }] } : {}),
      ...(post.equals(undated) ? { comments: [{ user, text: 'historical action' }] } : {})
    })));
    await models.PostEngagement.collection.insertMany([
      { user, post: qualified, eventType: 'view', durationMs: 1200, createdAt: first, updatedAt: last },
      { user, post: brief, eventType: 'watch', durationMs: 999, createdAt: first },
      { user, post: zero, eventType: 'view', durationMs: 0, createdAt: first },
      { user, post: impression, eventType: 'impression', durationMs: 9999, createdAt: first },
      { user, post: liked, eventType: 'like', durationMs: 0, createdAt: last },
      { user, post: undated, eventType: 'unsave', durationMs: 0 },
      { user, post: removed, eventType: 'watch', durationMs: 1000, createdAt: first },
      { user: inactive, post: invalidViewer, eventType: 'watch', durationMs: 1000, createdAt: first },
      { user: deleted, post: invalidViewer, eventType: 'watch', durationMs: 1000, createdAt: first }
    ]);

    const audit = await migrate({ models, batchSize: 2 });
    assert.equal(await mongoose.connection.db.listCollections({ name: models.ContentExposure.collection.name }).hasNext(), false);
    assert.equal(await mongoose.connection.db.listCollections({ name: models.RecommendationDelivery.collection.name }).hasNext(), false);
    assert.equal(audit.writes, 0);
    const applied = await migrate({ models, apply: true, batchSize: 2 });
    assert.ok(applied.indexes.every((index) => index.compliant));
    assert.equal(await models.ContentExposure.countDocuments(), 4);
    const view = await models.ContentExposure.findById(`${user}:${qualified}`).lean();
    assert.equal(view.interacted, false);
    assert.equal(view.contentType, 'video');
    assert.deepEqual(view.firstViewedAt, first);
    assert.deepEqual(view.lastViewedAt, last);
    const like = await models.ContentExposure.findById(`${user}:${liked}`).lean();
    assert.equal(like.interacted, true);
    assert.deepEqual(like.firstInteractedAt, first);
    assert.deepEqual(like.lastInteractedAt, last);
    const missingDate = await models.ContentExposure.findById(`${user}:${undated}`).lean();
    assert.equal(missingDate.interacted, true);
    assert.equal(missingDate.firstViewedAt, undefined);
    for (const post of [brief, zero, impression, legacyView, removed, invalidViewer]) {
      assert.equal(await models.ContentExposure.findById(`${user}:${post}`), null);
    }
    const snapshot = JSON.stringify(await models.ContentExposure.find().sort({ _id: 1 }).lean());
    await migrate({ models, apply: true, batchSize: 2 });
    assert.equal(JSON.stringify(await models.ContentExposure.find().sort({ _id: 1 }).lean()), snapshot);
    const verified = await migrate({ models, verify: true });
    assert.ok(verified.indexes.every((index) => index.compliant));
    assert.equal(await models.RecommendationDelivery.countDocuments(), 0, 'backfill never reserves recommendations');

    await models.ContentExposure.collection.dropIndex('user_1_post_1');
    await models.ContentExposure.collection.createIndex({ user: 1, post: 1 });
    const conflict = await migrate({ models, verify: true });
    assert.equal(conflict.indexes[0].compliant, false, 'same index keys with wrong options fail verification');
    assert.ok(conflict.indexes[0].missing.some((index) => index.unique));
  } finally {
    await mongoose.disconnect();
    await database.stop();
  }
});
