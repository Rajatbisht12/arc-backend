const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PostEngagement = require('../models/PostEngagement');
const { trackInteraction } = require('../controllers/postController');
const {
  MAX_ENGAGEMENT_DURATION_MS,
  buildViewEngagementUpdate,
  normalizeCompletionRate,
  normalizeEngagementContext,
  normalizeEngagementDuration,
  recordEngagementEvent
} = require('./recommendationService');

const USER_ID = '507f1f77bcf86cd799439011';
const AUTHOR_ID = '507f1f77bcf86cd799439012';
const POST_ID = '507f1f77bcf86cd799439013';
const CONCURRENT_POST_ID = '507f1f77bcf86cd799439014';

function assertNoUpdatePathConflicts(update) {
  const mutations = [];
  Object.entries(update).forEach(([operator, fields]) => {
    if (!operator.startsWith('$') || !fields || typeof fields !== 'object') return;
    Object.keys(fields).forEach((path) => {
      for (const existing of mutations) {
        const conflicts = path === existing.path
          || path.startsWith(`${existing.path}.`)
          || existing.path.startsWith(`${path}.`);
        assert.strictEqual(
          conflicts,
          false,
          `${operator}.${path} conflicts with ${existing.operator}.${existing.path}`
        );
      }
      mutations.push({ operator, path });
    });
  });
}

function viewKey(filter) {
  return [filter.user, filter.post, filter.eventType, filter.context].map(String).join(':');
}

async function run() {
  const originalUpdateOne = PostEngagement.collection.updateOne;
  const originalInsertOne = PostEngagement.collection.insertOne;
  const originalBulkWrite = PostEngagement.collection.bulkWrite;
  const updateOneCalls = [];
  const insertedDocs = [];
  const bulkWriteCalls = [];
  const viewStore = new Map();
  let duplicateKeyRetries = 0;

  PostEngagement.collection.updateOne = async (filter, update, options) => {
    await new Promise((resolve) => setImmediate(resolve));
    assertNoUpdatePathConflicts(update);
    updateOneCalls.push({ filter, update, options });

    const key = viewKey(filter);
    const existing = viewStore.get(key);
    if (
      existing
      && options.upsert === true
      && String(filter.post) === CONCURRENT_POST_ID
      && update.$max?.durationMs === 5000
      && duplicateKeyRetries === 0
    ) {
      duplicateKeyRetries += 1;
      const duplicateError = new Error('simulated concurrent unique-index race');
      duplicateError.code = 11000;
      throw duplicateError;
    }
    const doc = existing || { ...filter, ...update.$setOnInsert };
    Object.entries(update.$max || {}).forEach(([path, value]) => {
      if (doc[path] == null || doc[path] < value) doc[path] = value;
    });
    Object.assign(doc, update.$set || {});
    viewStore.set(key, doc);

    return existing
      ? { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
      : { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
  };

  PostEngagement.collection.insertOne = async (doc) => {
    insertedDocs.push(doc);
    return { acknowledged: true, insertedId: doc._id };
  };

  PostEngagement.collection.bulkWrite = async (operations, options) => {
    operations.forEach((operation) => assertNoUpdatePathConflicts(operation.updateOne.update));
    bulkWriteCalls.push({ operations, options });
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: operations.length };
  };

  try {
    // New view: inspect the fully cast, timestamped update that reaches the collection.
    await recordEngagementEvent({
      userId: USER_ID,
      postId: POST_ID,
      authorId: AUTHOR_ID,
      eventType: 'view',
      context: 'clips',
      durationMs: 1500,
      completionRate: 0.25
    });
    assert.strictEqual(updateOneCalls.length, 1);
    const first = updateOneCalls[0];
    assert.strictEqual(first.options.upsert, true);
    assert.strictEqual(first.filter.context, 'clips');
    assert.strictEqual(Object.hasOwn(first.update.$setOnInsert, 'durationMs'), false);
    assert.strictEqual(Object.hasOwn(first.update.$setOnInsert, 'completionRate'), false);
    assert.deepStrictEqual(first.update.$max, { durationMs: 1500, completionRate: 0.25 });
    assert(first.update.$set.updatedAt instanceof Date);

    // Repeat view: a shorter observation cannot erase the best duration/progress.
    await recordEngagementEvent({
      userId: USER_ID,
      postId: POST_ID,
      authorId: AUTHOR_ID,
      eventType: 'view',
      context: 'clips',
      durationMs: 700,
      completionRate: 0.1
    });
    const repeatedView = viewStore.get(`${USER_ID}:${POST_ID}:view:clips`);
    assert.strictEqual(repeatedView.durationMs, 1500);
    assert.strictEqual(repeatedView.completionRate, 0.25);

    // Partial and full watch events remain append-only and normalize client contexts.
    await recordEngagementEvent({
      userId: USER_ID,
      postId: POST_ID,
      authorId: AUTHOR_ID,
      eventType: 'watch',
      context: 'team_profile',
      durationMs: '12000',
      completionRate: 0.4
    });
    await recordEngagementEvent({
      userId: USER_ID,
      postId: POST_ID,
      authorId: AUTHOR_ID,
      eventType: 'watch',
      context: 'profile-liked',
      durationMs: 30000,
      completionRate: 1
    });
    assert.strictEqual(insertedDocs.length, 2);
    assert.strictEqual(insertedDocs[0].context, 'profile');
    assert.strictEqual(insertedDocs[0].durationMs, 12000);
    assert.strictEqual(insertedDocs[0].completionRate, 0.4);
    assert.strictEqual(insertedDocs[1].context, 'profile');
    assert.strictEqual(insertedDocs[1].durationMs, 30000);
    assert.strictEqual(insertedDocs[1].completionRate, 1);

    // Concurrent view upserts all use atomic $max and converge on one unique record.
    await Promise.all([
      [100, 0.1],
      [5000, 0.8],
      [2500, 1],
      [900, 0.3]
    ].map(([durationMs, completionRate]) => recordEngagementEvent({
      userId: USER_ID,
      postId: CONCURRENT_POST_ID,
      authorId: AUTHOR_ID,
      eventType: 'view',
      context: 'clips',
      durationMs,
      completionRate
    })));
    const concurrentView = viewStore.get(`${USER_ID}:${CONCURRENT_POST_ID}:view:clips`);
    assert.strictEqual(concurrentView.durationMs, 5000);
    assert.strictEqual(concurrentView.completionRate, 1);
    assert.strictEqual([...viewStore.keys()].filter((key) => key.includes(CONCURRENT_POST_ID)).length, 1);
    assert.strictEqual(duplicateKeyRetries, 1);
    assert(updateOneCalls.some(({ filter, options }) => (
      String(filter.post) === CONCURRENT_POST_ID && options.upsert === false
    )), 'the duplicate-key loser must retry without upsert');

    // The same update builder is safe after Mongoose casts a future analytics bulk write.
    const bulkPayloads = [
      { post: POST_ID, durationMs: 800, completionRate: 0.2 },
      { post: CONCURRENT_POST_ID, durationMs: 6400, completionRate: 0.9 }
    ];
    await PostEngagement.bulkWrite(bulkPayloads.map((entry) => {
      const payload = {
        user: USER_ID,
        post: entry.post,
        author: AUTHOR_ID,
        eventType: 'view',
        context: 'clips',
        source: 'organic',
        boostCampaign: null,
        metadata: {},
        durationMs: entry.durationMs,
        completionRate: entry.completionRate
      };
      return {
        updateOne: {
          filter: { user: USER_ID, post: entry.post, eventType: 'view', context: 'clips' },
          update: buildViewEngagementUpdate(payload),
          upsert: true
        }
      };
    }), { ordered: false });
    assert.strictEqual(bulkWriteCalls.length, 1);
    assert.strictEqual(bulkWriteCalls[0].operations.length, 2);
    bulkWriteCalls[0].operations.forEach(({ updateOne }) => {
      assert.strictEqual(Object.hasOwn(updateOne.update.$setOnInsert, 'durationMs'), false);
      assert.strictEqual(Object.hasOwn(updateOne.update.$setOnInsert, 'completionRate'), false);
      assertNoUpdatePathConflicts(updateOne.update);
    });

    assert.strictEqual(normalizeEngagementContext('profile-saved'), 'profile');
    assert.strictEqual(normalizeEngagementContext('profile-liked'), 'profile');
    assert.strictEqual(normalizeEngagementContext('unexpected-client-surface'), 'unknown');
    assert.strictEqual(normalizeEngagementDuration(-1), 0);
    assert.strictEqual(normalizeEngagementDuration(Number.POSITIVE_INFINITY), 0);
    assert.strictEqual(normalizeEngagementDuration(MAX_ENGAGEMENT_DURATION_MS + 1), MAX_ENGAGEMENT_DURATION_MS);
    assert.strictEqual(normalizeCompletionRate(-1), 0);
    assert.strictEqual(normalizeCompletionRate(5), 1);

    const interactionResponse = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    await trackInteraction({
      user: { _id: USER_ID },
      body: { postId: POST_ID, interactionType: 'view' }
    }, interactionResponse);
    assert.strictEqual(interactionResponse.statusCode, 400);
    assert.strictEqual(interactionResponse.body.message, 'Invalid interaction type');

    const controllerSource = fs.readFileSync(
      path.join(__dirname, '../controllers/postController.js'),
      'utf8'
    );
    assert(
      controllerSource.includes('BoostDeliveryAttribution.exists({'),
      'boost attribution must require a server-authored delivery proof'
    );
    assert(
      controllerSource.includes("expiresAt: { $gt: new Date() }"),
      'expired boost delivery proof must not classify engagement as boosted'
    );
    assert(
      controllerSource.includes("return proof ? { source: 'boost', campaignId } : { source: 'organic', campaignId: null }"),
      'no valid server proof must default attribution to organic'
    );
    assert.strictEqual(
      controllerSource.includes('req.body?.source'),
      false,
      'client-provided source must not control monetization attribution'
    );
  } finally {
    PostEngagement.collection.updateOne = originalUpdateOne;
    PostEngagement.collection.insertOne = originalInsertOne;
    PostEngagement.collection.bulkWrite = originalBulkWrite;
  }

  console.log('post engagement regression tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
