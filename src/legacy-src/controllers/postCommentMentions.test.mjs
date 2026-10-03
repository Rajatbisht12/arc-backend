import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const User = require('../models/User');
const Post = require('../models/Post');
const emitter = require('../utils/notificationEmitter');
const recommendations = require('../services/recommendationService');
const originalCreate = emitter.createAndEmitNotification;
const originalEngagement = recommendations.recordEngagementEvent;
const notifications = [];
emitter.createAndEmitNotification = async (payload) => { notifications.push(payload); return payload; };
recommendations.recordEngagementEvent = async () => {};
const { addComment, getPostComments } = require('./postController');

const makeRes = () => ({
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const comment = async (postId, user, text, parentCommentId) => {
  const response = makeRes();
  await addComment({ params: { id: String(postId) }, user, body: { text, ...(parentCommentId ? { parentCommentId } : {}) } }, response);
  return response;
};

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri());
try {
  const makeUser = (username) => User.create({
    username, email: `${username}@example.test`, password: 'test-password', userType: 'player', isActive: true,
    profile: { displayName: username },
  });
  const [owner, author, zoro, zoya] = await Promise.all(['postowner', 'commentauthor', 'zoro', 'zoya'].map(makeUser));
  const post = await Post.create({ author: owner._id, visibility: 'public', isActive: true, content: { text: 'A clip' } });

  let response = await comment(post._id, author, 'Hey @zoro @Zoya @zoro and @doesnotexist123');
  assert.equal(response.statusCode, 201, JSON.stringify(response.body));
  const saved = await Post.findById(post._id).lean();
  assert.deepEqual(saved.comments[0].mentions.map((mention) => String(mention.user)), [String(zoro._id), String(zoya._id)]);
  assert.equal(notifications.filter((event) => event.type === 'mention').length, 2);
  assert.equal(notifications.filter((event) => event.type === 'comment').length, 1);
  assert.match(notifications.find((event) => String(event.recipient) === String(zoro._id)).data.deepLink, /\?comment=/);
  assert.ok(notifications.every((event) => String(event.recipient) !== String(author._id)));

  const list = makeRes();
  await getPostComments({ params: { id: String(post._id) }, query: {}, user: author }, list);
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.data.comments[0].mentions.length, 2, 'page retains resolved IDs for link rendering');

  const rootId = response.body.data.comment._id;
  notifications.length = 0;
  response = await comment(post._id, zoya, '@commentauthor and @zoro look', rootId);
  assert.equal(response.statusCode, 201, JSON.stringify(response.body));
  assert.equal(notifications.filter((event) => String(event.recipient) === String(author._id)).length, 1, 'reply target has one notification');
  assert.equal(notifications.filter((event) => String(event.recipient) === String(zoro._id)).length, 1, 'other mention has one notification');
  assert.equal(notifications.filter((event) => String(event.recipient) === String(zoya._id)).length, 0, 'self mention has no notification');

  notifications.length = 0;
  response = await comment(post._id, author, '@user1 @user2 @user3 @user4 @user5 @user6');
  assert.equal(response.statusCode, 400);
  assert.equal(notifications.length, 0);

  console.log('Comment mention persistence, resolution, and notification contracts passed');
} finally {
  emitter.createAndEmitNotification = originalCreate;
  recommendations.recordEngagementEvent = originalEngagement;
  await mongoose.disconnect();
  await mem.stop();
}
