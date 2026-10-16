#!/usr/bin/env node

// The default mode audits historical signals and indexes without writing.
// Use --apply only against the intended deployment database after reviewing
// the audit. This script never connects when imported by a test.
const fs = require('node:fs');
const mongoose = require('mongoose');

const QUALIFIED_VIEW_TYPES = ['view', 'watch', 'dwell'];
const EXPLICIT_INTERACTION_TYPES = ['like', 'comment', 'share', 'save', 'unlike', 'unsave'];
const MIN_EXPOSURE_MS = 1000;
const DEFAULT_BATCH_SIZE = 250;

function objectId(value) {
  const candidate = value?._id || value;
  if (!candidate || !mongoose.Types.ObjectId.isValid(String(candidate))) return null;
  return new mongoose.Types.ObjectId(String(candidate));
}

function actualDate(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}

function contentType(post) {
  return post?.content?.media?.some((media) => media?.type === 'video') ? 'video' : 'post';
}

function buildExposureOperation(record) {
  const user = objectId(record.user);
  const post = objectId(record.post);
  if (!user || !post) return null;
  const firstViewedAt = actualDate(record.firstViewedAt);
  const lastViewedAt = actualDate(record.lastViewedAt) || firstViewedAt;
  const firstInteractedAt = actualDate(record.firstInteractedAt);
  const lastInteractedAt = actualDate(record.lastInteractedAt) || firstInteractedAt;
  const interacted = record.interacted === true;
  // A reference with no timestamp proves an explicit action, but a malformed
  // view timestamp cannot establish a meaningful exposure date.
  if (!interacted && !firstViewedAt && !lastViewedAt) return null;
  const minimum = {};
  const maximum = { interacted };
  if (firstViewedAt) minimum.firstViewedAt = firstViewedAt;
  if (lastViewedAt) maximum.lastViewedAt = lastViewedAt;
  if (interacted && firstInteractedAt) minimum.firstInteractedAt = firstInteractedAt;
  if (interacted && lastInteractedAt) maximum.lastInteractedAt = lastInteractedAt;
  return {
    updateOne: {
      filter: { _id: `${user}:${post}` },
      update: {
        $setOnInsert: { user, post, contentType: record.contentType === 'video' ? 'video' : 'post' },
        ...(Object.keys(minimum).length ? { $min: minimum } : {}),
        $max: maximum
      },
      upsert: true
    }
  };
}

function mergeExposureOperations(operations) {
  const byId = new Map();
  for (const operation of operations) {
    const id = operation.updateOne.filter._id;
    const current = byId.get(id);
    if (!current) {
      byId.set(id, operation);
      continue;
    }
    for (const [operator, compare] of [['$min', (a, b) => a < b], ['$max', (a, b) => a > b]]) {
      for (const [field, value] of Object.entries(operation.updateOne.update[operator] || {})) {
        const target = current.updateOne.update[operator] ||= {};
        if (!(field in target) || compare(value, target[field])) target[field] = value;
      }
    }
    if (operation.updateOne.update.$setOnInsert.contentType === 'video') {
      current.updateOne.update.$setOnInsert.contentType = 'video';
    }
  }
  return [...byId.values()];
}

async function writeExposureBatch(collection, operations) {
  if (!operations.length) return;
  try {
    await collection.bulkWrite(operations, { ordered: false });
  } catch (error) {
    const failures = error.writeErrors || error.result?.getWriteErrors?.() || [];
    // A live first-view request may win an upsert between the audit and write.
    // Retry only those duplicate races; mixed failures must remain visible.
    if (!failures.length || failures.some((failure) => failure.code !== 11000)) throw error;
    const retries = failures.map((failure) => ({
      updateOne: { ...operations[failure.index].updateOne, upsert: false }
    }));
    await collection.bulkWrite(retries, { ordered: false });
  }
}

function expectedIndexes(Model) {
  return [
    [{ _id: 1 }, { unique: true, name: '_id_' }],
    ...Model.schema.indexes().filter(([, options]) => Model.modelName !== 'Post' || ['discovery_updates', 'discovery_video_updates'].includes(options.name))
  ];
}

async function auditIndexes(Model, apply) {
  const exists = await Model.db.db.listCollections({ name: Model.collection.name }, { nameOnly: true }).hasNext();
  if (!exists && apply) await Model.createCollection();
  let indexes = exists || apply ? await Model.collection.indexes() : [];
  for (const [key, options] of expectedIndexes(Model)) {
    const existing = indexes.find((index) => JSON.stringify(index.key) === JSON.stringify(key));
    if (!existing && apply && options.name !== '_id_') {
      const { background, ...safeOptions } = options;
      await Model.collection.createIndex(key, { ...safeOptions, background: true });
    }
  }
  if (apply) indexes = await Model.collection.indexes();
  const missing = expectedIndexes(Model).filter(([key, options]) => !indexes.some((index) => (
    JSON.stringify(index.key) === JSON.stringify(key)
    && (options.name === '_id_' || Boolean(index.unique) === Boolean(options.unique))
    && (options.expireAfterSeconds == null || Number(index.expireAfterSeconds) === options.expireAfterSeconds)
    && (!options.partialFilterExpression || JSON.stringify(index.partialFilterExpression) === JSON.stringify(options.partialFilterExpression))
  ))).map(([key, options]) => ({ key, unique: Boolean(options.unique), ...(options.expireAfterSeconds == null ? {} : { expireAfterSeconds: options.expireAfterSeconds }) }));
  return { collection: Model.collection.name, exists: exists || apply, compliant: missing.length === 0, missing };
}

async function migrate({ models, apply = false, verify = false, batchSize = DEFAULT_BATCH_SIZE }) {
  const { ContentExposure, RecommendationDelivery, RecommendationState, PostEngagement, Post, User } = models;
  const indexes = [];
  for (const Model of [ContentExposure, RecommendationDelivery, RecommendationState, Post]) indexes.push(await auditIndexes(Model, apply));
  const stats = {
    mode: apply ? 'apply' : verify ? 'verify' : 'audit-only',
    indexes,
    sourceRecords: {},
    validOperations: 0,
    skippedInvalidOrUndated: 0,
    skippedMissingContent: 0,
    skippedDeletedOrInactiveUser: 0,
    batches: 0,
    writes: 0
  };
  if (verify) return stats;
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const postIds = [...new Map(batch.map((row) => [String(row.post), objectId(row.post)])).values()].filter(Boolean);
    const userIds = [...new Map(batch.map((row) => [String(row.user), objectId(row.user)])).values()].filter(Boolean);
    const [posts, users] = await Promise.all([
      Post.find({ _id: { $in: postIds } }).select('_id content.media.type').lean(),
      User.find({ _id: { $in: userIds }, isActive: true, deletedAt: null }).select('_id').lean()
    ]);
    const postsById = new Map(posts.map((post) => [String(post._id), post]));
    const validUsers = new Set(users.map((user) => String(user._id)));
    const operations = [];
    for (const row of batch) {
      const post = postsById.get(String(row.post));
      if (!post) { stats.skippedMissingContent++; continue; }
      if (!validUsers.has(String(row.user))) { stats.skippedDeletedOrInactiveUser++; continue; }
      const operation = buildExposureOperation({ ...row, contentType: contentType(post) });
      if (!operation) { stats.skippedInvalidOrUndated++; continue; }
      stats.validOperations++;
      operations.push(operation);
    }
    const merged = mergeExposureOperations(operations);
    if (apply) {
      await writeExposureBatch(ContentExposure.collection, merged);
      stats.writes += merged.length;
    }
    stats.batches++;
  };
  const enqueue = async (source, record) => {
    stats.sourceRecords[source] = (stats.sourceRecords[source] || 0) + 1;
    if (!objectId(record.user) || !objectId(record.post)) { stats.skippedInvalidOrUndated++; return; }
    pending.push(record);
    if (pending.length >= batchSize) await flush();
  };

  // A GET of post detail historically emitted a zero-duration view. Neither
  // those events nor server-side delivery impressions prove actual exposure.
  const eventCursor = PostEngagement.find({
    $or: [
      { eventType: { $in: QUALIFIED_VIEW_TYPES }, durationMs: { $gte: MIN_EXPOSURE_MS } },
      { eventType: { $in: EXPLICIT_INTERACTION_TYPES } }
    ]
  }).select('user post eventType durationMs createdAt updatedAt').lean().cursor({ batchSize });
  for await (const event of eventCursor) {
    const interacted = EXPLICIT_INTERACTION_TYPES.includes(event.eventType);
    const first = actualDate(event.createdAt);
    const last = actualDate(event.updatedAt) || first;
    await enqueue('engagementEvents', {
      user: event.user, post: event.post, interacted,
      firstViewedAt: first, lastViewedAt: last,
      ...(interacted ? { firstInteractedAt: first, lastInteractedAt: last } : {})
    });
  }
  // Legacy viewedBy is deliberately excluded too: older direct GET requests
  // and instant clip activation populated it before meaningful playback.
  const postCursor = Post.find({
    $or: ['likes', 'comments', 'shares'].map((field) => ({ [`${field}.0`]: { $exists: true } }))
  }).select('_id likes.user likes.likedAt comments.user comments.createdAt shares.user shares.sharedAt').lean().cursor({ batchSize });
  for await (const post of postCursor) {
    for (const [field, dateField] of [['likes', 'likedAt'], ['comments', 'createdAt'], ['shares', 'sharedAt']]) {
      for (const action of post[field] || []) {
        await enqueue(`legacy${field[0].toUpperCase()}${field.slice(1)}`, {
          user: action.user, post: post._id, interacted: true,
          firstViewedAt: action[dateField], lastViewedAt: action[dateField],
          firstInteractedAt: action[dateField], lastInteractedAt: action[dateField]
        });
      }
    }
  }
  const savedCursor = User.find({ isActive: true, deletedAt: null, 'savedPosts.0': { $exists: true } })
    .select('_id savedPosts.post savedPosts.savedAt').lean().cursor({ batchSize });
  for await (const user of savedCursor) {
    for (const saved of user.savedPosts || []) {
      await enqueue('legacySavedPosts', {
        user: user._id, post: saved.post, interacted: true,
        firstViewedAt: saved.savedAt, lastViewedAt: saved.savedAt,
        firstInteractedAt: saved.savedAt, lastInteractedAt: saved.savedAt
      });
    }
  }
  await flush();
  return stats;
}

async function main() {
  require('dotenv').config();
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply', '--verify'].includes(arg))) throw new Error('Supported options: --apply or --verify (default: read-only audit)');
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  if (apply && verify) throw new Error('Use either --apply or --verify, not both');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  const models = Object.fromEntries(['ContentExposure', 'RecommendationDelivery', 'RecommendationState', 'PostEngagement', 'Post', 'User'].map((name) => [name, require(`../src/legacy-src/models/${name}`)]));
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false, autoCreate: false, readPreference: 'primary',
    retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
    serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? {
      tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE) ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {})
    } : {})
  });
  const result = await migrate({ models, apply, verify });
  console.log(JSON.stringify(result, null, 2));
  if (!apply) console.log('No collections, indexes, or exposure records were changed.');
  if ((verify || apply) && result.indexes.some((index) => !index.compliant)) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    // Database errors may include document values. Print no exposure identities
    // or connection strings in operator-facing migration logs.
    console.error(`Discovery exposure migration failed (${error.code || error.name || 'unknown'}). Review the database operation and deployment configuration.`);
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect().catch(() => undefined));
}

module.exports = { actualDate, buildExposureOperation, mergeExposureOperations, writeExposureBatch, auditIndexes, migrate, MIN_EXPOSURE_MS };
