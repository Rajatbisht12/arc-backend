// REAL-DB regression test for the save/bookmark pipeline. This exercises the
// actual toggleSave + getSavedPosts controllers against an in-memory MongoDB.
//
// Why this exists: the mocked unit test hardcoded updateOne().modifiedCount and
// so could not see that the User schema's `timestamps:true` inflates
// modifiedCount on every write. The old toggleSave gated save-vs-unsave on that
// count, so the $push never ran and NOTHING ever persisted. A real DB catches
// it; a mock cannot. Do not replace this with a mock.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const User = require('../models/User');
const Post = require('../models/Post');
const { toggleSave, getSavedPosts } = require('./postController');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    set() { return this; },
  };
}

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri());

try {
  const viewer = await User.create({
    username: 'zoro', email: 'z@z.com', password: 'x'.repeat(8),
    userType: 'player', isActive: true, profile: { displayName: 'Zoro' },
  });
  const post = await Post.create({
    author: viewer._id, visibility: 'public', isActive: true, content: { text: 'catieee' },
  });

  const req = () => ({
    params: { id: post._id.toString() },
    body: { context: 'post-card' },
    query: {}, headers: {},
    user: viewer,
  });

  // 1. Save — must persist and report isSaved:true.
  let res = makeRes();
  await toggleSave(req(), res);
  assert.equal(res.statusCode, 200, 'save status');
  assert.equal(res.body?.data?.isSaved, true, 'save must report isSaved:true');
  assert.equal(res.body?.data?.savedCount, 1, 'savedCount after save');

  let dbUser = await User.findById(viewer._id).select('savedPosts').lean();
  assert.equal(dbUser.savedPosts.length, 1, 'save must PERSIST to the DB');

  // 2. Saved list returns it.
  res = makeRes();
  await getSavedPosts(req(), res);
  assert.equal(res.body?.data?.posts?.length, 1, 'saved list must contain the post');
  assert.equal(res.body.data.posts[0]._id.toString(), post._id.toString());

  // 3. Unsave — removes it.
  res = makeRes();
  await toggleSave(req(), res);
  assert.equal(res.body?.data?.isSaved, false, 'second toggle unsaves');
  dbUser = await User.findById(viewer._id).select('savedPosts').lean();
  assert.equal(dbUser.savedPosts.length, 0, 'unsave must remove the record');

  // 4. Re-save — persists again (proves it was never a one-shot).
  res = makeRes();
  await toggleSave(req(), res);
  assert.equal(res.body?.data?.isSaved, true, 'third toggle re-saves');
  dbUser = await User.findById(viewer._id).select('savedPosts').lean();
  assert.equal(dbUser.savedPosts.length, 1, 're-save must persist');

  console.log('saved-posts real-DB persistence test passed ✅');
} finally {
  await mongoose.disconnect();
  await mem.stop();
}
