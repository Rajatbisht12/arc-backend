import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const User = require('../models/User');
const Post = require('../models/Post');
const { decodeCursor, getRecommendedPosts } = require('./recommendationService');

const database = await MongoMemoryServer.create();
await mongoose.connect(database.getUri());

try {
  const viewer = await User.create({
    username: 'clipviewer', email: 'clipviewer@example.com', password: 'test-password',
    userType: 'player', isActive: true, profile: { displayName: 'Viewer' }
  });
  const authors = await Promise.all(Array.from({ length: 5 }, (_, index) => User.create({
    username: `clipauthor${index}`, email: `clipauthor${index}@example.com`, password: 'test-password',
    userType: 'player', isActive: true, profile: { displayName: `Author ${index}` }
  })));
  const now = Date.now();
  await Post.insertMany(Array.from({ length: 231 }, (_, index) => ({
    author: authors[index % authors.length]._id,
    visibility: 'public',
    isActive: true,
    content: {
      text: `Clip ${index}`,
      media: [{ type: 'video', url: `https://example.com/clip-${index}.mp4`, publicId: `test/clip-${index}` }]
    },
    createdAt: new Date(now - index * 60_000)
  })));
  const privateClip = await Post.create({
    author: authors[0]._id,
    visibility: 'private',
    isActive: true,
    content: { text: 'Private clip', media: [{ type: 'video', url: 'https://example.com/private.mp4', publicId: 'test/private' }] }
  });

  const served = new Set();
  const recent = [];
  let cursor;
  let deletedPendingId;
  let pages = 0;
  do {
    const result = await getRecommendedPosts({
      user: viewer,
      query: {
        limit: 10,
        sessionSeed: 'long-clip-session',
        ...(cursor ? { cursor } : {}),
        ...(recent.length ? { exclude: recent.slice(-100).join(',') } : {})
      },
      mode: 'clips'
    });
    pages += 1;
    assert.ok(result.posts.length <= 10, 'page size remains bounded');
    for (const post of result.posts) {
      const id = String(post._id);
      assert.ok(!served.has(id), `clip ${id} was delivered twice`);
      served.add(id);
      recent.push(id);
    }
    if (pages === 1) {
      const pendingIds = decodeCursor(result.pagination.nextCursor)?.pendingIds || [];
      assert.ok(pendingIds.length > 0, 'unserved ranked candidates remain in the cursor');
      deletedPendingId = pendingIds[0];
      await Post.deleteOne({ _id: deletedPendingId });
    }
    assert.notEqual(result.pagination.nextCursor, cursor, 'cursor must advance');
    cursor = result.pagination.nextCursor;
    assert.ok(pages < 80, 'pagination must terminate for a finite catalog');
  } while (cursor);

  assert.equal(served.size, 230, 'all eligible clips, including clips beyond page 20, are reached');
  assert.ok(!served.has(deletedPendingId), 'a deleted pending clip is not delivered');
  assert.ok(!served.has(String(privateClip._id)), 'a private clip is never delivered');
  const recentTail = new Set(recent.slice(-20));
  const repeatCycle = await getRecommendedPosts({
    user: viewer,
    query: {
      limit: 10,
      sessionSeed: 'next-clip-cycle',
      includeViewed: 'true',
      exclude: [...recentTail].join(',')
    },
    mode: 'clips'
  });
  assert.ok(repeatCycle.posts.length > 0, 'a finite catalog can start a new recommendation cycle');
  assert.ok(repeatCycle.posts.every((post) => !recentTail.has(String(post._id))), 'the repeat cycle skips the recent tail');
  console.log('Clips cursor pagination passed: 230 unique clips across', pages, 'pages');
} finally {
  await mongoose.disconnect();
  await database.stop();
}
