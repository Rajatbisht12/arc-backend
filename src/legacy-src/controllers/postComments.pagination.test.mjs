// REAL-DB proof that GET /:id/comments paginates top-level comments 10 at a
// time (Instagram-style drawer) — never the whole array, never the reply tree,
// no duplicates or skips across pages, accurate counts.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const User = require('../models/User');
const Post = require('../models/Post');
const { getPostComments } = require('./postController');

const makeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } });

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri());
try {
  const author = await User.create({ username: 'author1', email: 'a@a.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'A' } });
  const commenter = await User.create({ username: 'commenter1', email: 'c@c.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'C' } });

  // 30 top-level comments (chronological), each root carries 2 replies.
  const comments = [];
  const t0 = Date.now() - 30 * 60000;
  for (let i = 0; i < 30; i++) {
    const rootId = new mongoose.Types.ObjectId();
    comments.push({ _id: rootId, user: commenter._id, text: `top-${i}`, createdAt: new Date(t0 + i * 60000), parentComment: null, rootComment: null, replyCount: 2, likes: [] });
    for (let r = 0; r < 2; r++) {
      comments.push({ _id: new mongoose.Types.ObjectId(), user: commenter._id, text: `reply-${i}-${r}`, createdAt: new Date(t0 + i * 60000 + 1000 * (r + 1)), parentComment: rootId, rootComment: rootId, replyCount: 0, likes: [] });
    }
  }
  const post = await Post.create({ author: author._id, visibility: 'public', isActive: true, content: { text: 'p' }, comments });

  const call = (cursor) => {
    const res = makeRes();
    return getPostComments({ params: { id: String(post._id) }, query: { limit: 10, ...(cursor ? { cursor } : {}) }, user: author }, res).then(() => res.body.data);
  };

  const p1 = await call();
  const p2 = await call(p1.nextCursor);
  const p3 = await call(p2.nextCursor);

  // Each page has exactly 10 top-level comments.
  assert.equal(p1.comments.length, 10, 'page 1 = 10');
  assert.equal(p2.comments.length, 10, 'page 2 = 10');
  assert.equal(p3.comments.length, 10, 'page 3 = 10');

  // Counts reflect totals, NOT loaded length; replies are excluded from paging.
  assert.equal(p1.totalTopLevel, 30, 'totalTopLevel = 30');
  assert.equal(p1.totalComments, 90, 'totalComments = 30 roots + 60 replies');
  assert.equal(p1.hasMore, true);
  assert.equal(p3.hasMore, false, 'no more after 30');
  assert.equal(p3.nextCursor, null);

  // Every returned comment is top-level and carries a replyCount, no reply objects.
  const all = [...p1.comments, ...p2.comments, ...p3.comments];
  assert.ok(all.every((c) => c.parentComment === null && c.replyCount === 2), 'only top-level, replyCount preserved');
  assert.ok(all.every((c) => !c.text.startsWith('reply-')), 'no replies leaked into paging');

  // No duplicates and no skips across the 3 pages.
  const ids = all.map((c) => String(c._id));
  assert.equal(new Set(ids).size, 30, 'no duplicate comment IDs across pages');
  const texts = all.map((c) => c.text);
  // Newest first (latest → oldest): top-29 down to top-0, no skips.
  assert.deepEqual(texts, Array.from({ length: 30 }, (_, i) => `top-${29 - i}`), 'newest-first, no skips');

  // A post with 0 comments returns a clean empty page.
  const empty = await Post.create({ author: author._id, visibility: 'public', isActive: true, content: { text: 'e' }, comments: [] });
  const er = makeRes();
  await getPostComments({ params: { id: String(empty._id) }, query: { limit: 10 }, user: author }, er);
  assert.equal(er.body.data.comments.length, 0);
  assert.equal(er.body.data.hasMore, false);
  assert.equal(er.body.data.totalComments, 0);

  console.log('post comments pagination test passed ✅');
} finally {
  await mongoose.disconnect();
  await mem.stop();
}
