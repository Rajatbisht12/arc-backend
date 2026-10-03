import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const User = require('../models/User');
const Post = require('../models/Post');
const { deleteComment } = require('./postController');

const makeRes = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});
const invoke = async ({ postId, commentId, user }) => {
  const res = makeRes();
  await deleteComment({ params: { id: String(postId), commentId: String(commentId) }, user }, res);
  return res;
};

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri());
try {
  const owner = await User.create({ username: 'commentowner', email: 'owner@example.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'Owner' } });
  const author = await User.create({ username: 'commentauthor', email: 'author@example.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'Author' } });
  const stranger = await User.create({ username: 'commentstranger', email: 'stranger@example.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'Stranger' } });
  const rootId = new mongoose.Types.ObjectId();
  const replyId = new mongoose.Types.ObjectId();
  const nestedId = new mongoose.Types.ObjectId();
  const post = await Post.create({
    author: owner._id,
    visibility: 'public',
    isActive: true,
    content: { text: 'moderated post' },
    comments: [
      { _id: rootId, user: author._id, text: 'root', parentComment: null, rootComment: null, replyCount: 2 },
      { _id: replyId, user: stranger._id, text: 'reply', parentComment: rootId, rootComment: rootId, replyCount: 0 },
      { _id: nestedId, user: author._id, text: 'nested', parentComment: replyId, rootComment: rootId, replyCount: 0 },
    ],
  });

  let response = await invoke({ postId: post._id, commentId: rootId, user: stranger });
  assert.equal(response.statusCode, 403, 'non-owner cannot delete another author comment');

  response = await invoke({ postId: post._id, commentId: replyId, user: stranger });
  assert.equal(response.statusCode, 200, 'comment author can delete own comment');
  assert.deepEqual(new Set(response.body.data.deletedCommentIds), new Set([String(replyId), String(nestedId)]));
  let refreshed = await Post.findById(post._id).lean();
  assert.equal(refreshed.comments.length, 1, 'nested descendants are deleted with their parent');
  assert.equal(refreshed.comments[0].replyCount, 0, 'root count is reconciled');

  const otherRootId = new mongoose.Types.ObjectId();
  await Post.updateOne({ _id: post._id }, { $push: { comments: { _id: otherRootId, user: author._id, text: 'owner can remove', replyCount: 0 } } });
  response = await invoke({ postId: post._id, commentId: otherRootId, user: owner });
  assert.equal(response.statusCode, 200, 'post owner can delete another author comment');
  refreshed = await Post.findById(post._id).lean();
  assert.equal(refreshed.comments.length, 1);

  console.log('Post comment moderation authorization contracts passed');
} finally {
  await mongoose.disconnect();
  await mem.stop();
}
