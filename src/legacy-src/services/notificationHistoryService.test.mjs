import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

let memoryServer;
let Notification;
let Post;
let User;
let historyService;

const oid = () => new mongoose.Types.ObjectId();
const baseNotification = ({ recipient, sender, type = 'like', postId, commentId, createdAt }) => ({
  _id: oid(),
  recipient,
  sender,
  type,
  title: type === 'like' ? 'New Like' : 'Notification',
  message: 'history event',
  data: {
    ...(postId ? { postId } : {}),
    ...(commentId ? { commentId } : {})
  },
  isRead: false,
  archivedAt: null,
  deletedAt: null,
  createdAt: createdAt || new Date(),
  updatedAt: createdAt || new Date()
});

before(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri(), { autoIndex: false, autoCreate: false });
  ({ default: Notification } = await import('../models/Notification.js'));
  ({ default: Post } = await import('../models/Post.js'));
  ({ default: User } = await import('../models/User.js'));
  ({ default: historyService } = await import('./notificationHistoryService.js'));
});

beforeEach(async () => {
  await Promise.all([
    Notification.collection.deleteMany({}),
    Post.collection.deleteMany({}),
    User.collection.deleteMany({})
  ]);
  await Notification.collection.dropIndexes().catch(() => undefined);
});

after(async () => {
  await mongoose.disconnect();
  await memoryServer.stop();
});

test('duplicate likes are repaired by actor + recipient + type + post without over-deduping', async () => {
  const recipient = oid();
  const sup = oid();
  const zoro = oid();
  const postA = oid();
  const postB = oid();
  await User.collection.insertMany([
    { _id: recipient, username: 'recipient' },
    { _id: sup, username: 'sup' },
    { _id: zoro, username: 'zoro' }
  ]);
  await Post.collection.insertMany([
    { _id: postA, author: recipient, content: { text: 'A' }, isActive: true, comments: [] },
    { _id: postB, author: recipient, content: { text: 'B' }, isActive: true, comments: [] }
  ]);
  const oldSupLike = baseNotification({ recipient, sender: sup, postId: postA, createdAt: new Date('2026-08-01T10:00:00Z') });
  const newestSupLike = baseNotification({ recipient, sender: sup, postId: postA, createdAt: new Date('2026-08-01T11:00:00Z') });
  await Notification.collection.insertMany([
    oldSupLike,
    newestSupLike,
    baseNotification({ recipient, sender: zoro, postId: postA }),
    baseNotification({ recipient, sender: sup, postId: postB })
  ]);

  const beforeRows = await Notification.find({ recipient }).lean();
  assert.equal(beforeRows.length, 4);
  const result = await historyService.repairNotificationHistory({ recipientId: recipient });
  const afterRows = await Notification.find({ recipient }).sort({ createdAt: -1 }).lean();

  assert.equal(result.duplicateLikeIds.length, 1);
  assert.equal(afterRows.length, 3);
  assert(afterRows.some((row) => String(row._id) === String(newestSupLike._id)));
  assert(!afterRows.some((row) => String(row._id) === String(oldSupLike._id)));
  assert.equal(afterRows.filter((row) => String(row.sender) === String(sup) && String(row.data.postId) === String(postA)).length, 1);
  assert.equal(afterRows.find((row) => String(row._id) === String(newestSupLike._id))
    ?.data?.customData?.notificationDedupeKey, `like:${sup}:${postA}`);
});

test('target deletion removes related history while preserving unrelated rows', async () => {
  const recipient = oid();
  const sender = oid();
  const postA = oid();
  const postB = oid();
  await User.collection.insertMany([{ _id: recipient }, { _id: sender }]);
  await Post.collection.insertMany([
    { _id: postA, author: recipient, content: { text: 'A' }, isActive: true, comments: [] },
    { _id: postB, author: recipient, content: { text: 'B' }, isActive: true, comments: [] }
  ]);
  await Notification.collection.insertMany([
    baseNotification({ recipient, sender, postId: postA }),
    baseNotification({ recipient, sender, postId: postB }),
    {
      ...baseNotification({ recipient, sender, type: 'system' }),
      data: { customData: { postId: postA } }
    },
    {
      ...baseNotification({ recipient, sender, type: 'system' }),
      data: { customData: { postId: String(postA) } }
    }
  ]);

  await Post.collection.deleteOne({ _id: postA });
  const deletion = await historyService.deleteNotificationsForTarget({ targetType: 'post', targetId: postA });
  const rows = await Notification.find({ recipient }).lean();
  assert.equal(deletion.deletedCount, 3);
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].data.postId), String(postB));
});

test('comment cleanup removes only notifications for the deleted embedded comment', async () => {
  const recipient = oid();
  const sender = oid();
  const postId = oid();
  const commentA = oid();
  const commentB = oid();
  await Notification.collection.insertMany([
    baseNotification({ recipient, sender, type: 'comment', postId, commentId: commentA }),
    baseNotification({ recipient, sender, type: 'comment', postId, commentId: commentB })
  ]);
  const deletion = await historyService.deleteNotificationsForTarget({
    targetType: 'comment',
    targetId: commentA
  });
  const rows = await Notification.find({ recipient }).lean();
  assert.equal(deletion.deletedCount, 1);
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].data.commentId), String(commentB));
});

test('defensive repair removes an orphaned post and an embedded deleted comment before pagination', async () => {
  const recipient = oid();
  const sender = oid();
  const validPost = oid();
  const missingPost = oid();
  const deletedComment = oid();
  await User.collection.insertMany([{ _id: recipient }, { _id: sender }]);
  await Post.collection.insertOne({
    _id: validPost,
    author: recipient,
    content: { text: 'valid' },
    isActive: true,
    comments: []
  });
  const valid = baseNotification({ recipient, sender, postId: validPost });
  await Notification.collection.insertMany([
    valid,
    baseNotification({ recipient, sender, postId: missingPost }),
    baseNotification({ recipient, sender, type: 'comment', postId: validPost, commentId: deletedComment })
  ]);

  const result = await historyService.repairNotificationHistory({ recipientId: recipient });
  const rows = await Notification.find({ recipient }).lean();
  assert.equal(result.orphanIds.length, 2);
  assert.deepEqual(rows.map((row) => String(row._id)), [String(valid._id)]);
});

test('temporary target lookup failure preserves notification history for retry', async () => {
  const recipient = oid();
  const sender = oid();
  const postId = oid();
  await User.collection.insertMany([{ _id: recipient }, { _id: sender }]);
  await Notification.collection.insertOne(baseNotification({ recipient, sender, postId }));
  const originalFind = Post.find;
  try {
    Post.find = () => { throw new Error('temporary database lookup failure'); };
    await assert.rejects(
      historyService.repairNotificationHistory({ recipientId: recipient }),
      /temporary database lookup failure/
    );
  } finally {
    Post.find = originalFind;
  }
  assert.equal(await Notification.countDocuments({ recipient }), 1);
});

test('database uniqueness keeps concurrent duplicate likes idempotent but allows distinct actors/posts', async () => {
  const recipient = oid();
  const sup = oid();
  const zoro = oid();
  const postA = oid();
  const postB = oid();
  await Notification.collection.createIndex(
    { recipient: 1, sender: 1, type: 1, 'data.postId': 1 },
    {
      name: 'unique_like_notification_per_actor_target',
      unique: true,
      partialFilterExpression: {
        type: 'like',
        sender: { $type: 'objectId' },
        'data.postId': { $type: 'objectId' }
      }
    }
  );
  const duplicate = () => Notification.create(baseNotification({ recipient, sender: sup, postId: postA }));
  const results = await Promise.allSettled([duplicate(), duplicate()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  await Promise.all([
    Notification.create(baseNotification({ recipient, sender: zoro, postId: postA })),
    Notification.create(baseNotification({ recipient, sender: sup, postId: postB }))
  ]);
  assert.equal(await Notification.countDocuments({ recipient }), 3);
});

test('canonical like producer reuses and restores one authoritative row on re-like and concurrent retry', async () => {
  const recipient = oid();
  const sup = oid();
  const postA = oid();
  await User.collection.insertMany([
    {
      _id: recipient,
      username: 'recipient',
      isActive: true,
      notificationSettings: { pushEnabled: false, inAppEnabled: true, likes: true }
    },
    { _id: sup, username: 'sup', isActive: true }
  ]);
  await Post.collection.insertOne({
    _id: postA,
    author: recipient,
    content: { text: 'Post A' },
    isActive: true,
    comments: []
  });
  await Notification.collection.createIndex(
    { recipient: 1, 'data.customData.notificationDedupeKey': 1 },
    {
      unique: true,
      partialFilterExpression: { 'data.customData.notificationDedupeKey': { $type: 'string' } }
    }
  );
  await Notification.collection.createIndex(
    { recipient: 1, sender: 1, type: 1, 'data.postId': 1 },
    {
      name: 'unique_like_notification_per_actor_target',
      unique: true,
      partialFilterExpression: {
        type: 'like', sender: { $type: 'objectId' }, 'data.postId': { $type: 'objectId' }
      }
    }
  );
  const { createLikeNotification } = (await import('../utils/notificationService.js')).default;

  const first = await createLikeNotification(recipient, sup, postA);
  await Notification.updateOne({ _id: first._id }, {
    $set: { isRead: true, readAt: new Date(), archivedAt: new Date(), deletedAt: new Date() }
  });
  const relike = await createLikeNotification(recipient, sup, postA);
  const restored = await Notification.findById(first._id).lean();
  assert.equal(String(relike._id), String(first._id));
  assert.equal(restored.isRead, false);
  assert.equal(restored.readAt, null);
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.deletedAt, null);
  assert.equal(await Notification.countDocuments({ recipient }), 1);

  await Notification.deleteMany({ recipient });
  const retried = await Promise.all([
    createLikeNotification(recipient, sup, postA),
    createLikeNotification(recipient, sup, postA)
  ]);
  assert.equal(await Notification.countDocuments({ recipient }), 1);
  assert.equal(String(retried[0]._id), String(retried[1]._id));
});
