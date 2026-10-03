import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const require = createRequire(import.meta.url);
const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const { createPost, updatePost } = require('./postController');

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri());
let server;
try {
  const owner = await User.create({
    username: 'hashtagowner', email: 'hashtagowner@example.test', password: 'test-password',
    userType: 'player', isActive: true, profile: { displayName: 'Hashtag Owner' },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = owner; next(); });
  app.post('/api/posts', createPost);
  app.put('/api/posts/:id', updatePost);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, body) => {
    const response = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const six = '#one #two #three #four #five #six';
  const rejected = await request('POST', '/api/posts', { text: six });
  assert.equal(rejected.status, 400);
  assert.deepEqual({ success: rejected.body.success, message: rejected.body.message },
    { success: false, message: 'Maximum 5 hashtags allowed.' });
  assert.equal(await Post.countDocuments(), 0);

  let postId;
  for (const count of [0, 1, 4, 5]) {
    const tags = ['one', 'two', 'three', 'four', 'five'].slice(0, count);
    const allowed = await request('POST', '/api/posts', { text: `Caption ${tags.map(tag => `#${tag}`).join(' ')}` });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
    assert.deepEqual(allowed.body.data.post.tags, tags);
    if (count === 5) postId = allowed.body.data.post._id;
  }

  const explicitTagBypass = await request('POST', '/api/posts', {
    text: '#one #two #three #four #five', tags: ['extra'],
  });
  assert.equal(explicitTagBypass.status, 400);
  assert.equal(explicitTagBypass.body.message, 'Maximum 5 hashtags allowed.');

  const editRejected = await request('PUT', `/api/posts/${postId}`, { text: six });
  assert.equal(editRejected.status, 400);
  assert.equal(editRejected.body.message, 'Maximum 5 hashtags allowed.');
  assert.equal((await Post.findById(postId).lean()).content.text, 'Caption #one #two #three #four #five');

  const editAllowed = await request('PUT', `/api/posts/${postId}`, { text: '#one #two #three #four #six' });
  assert.equal(editAllowed.status, 200, JSON.stringify(editAllowed.body));
  assert.deepEqual(editAllowed.body.data.post.tags, ['one', 'two', 'three', 'four', 'six']);

  // Old clients may resend an unchanged legacy caption; it must not bypass
  // the edit limit merely because the text equals the stored value.
  await Post.updateOne({ _id: postId }, { $set: {
    'content.text': six,
    tags: ['one', 'two', 'three', 'four', 'five', 'six'],
  } });
  const unchangedLegacyEdit = await request('PUT', `/api/posts/${postId}`, { text: six });
  assert.equal(unchangedLegacyEdit.status, 400);
  assert.equal(unchangedLegacyEdit.body.message, 'Maximum 5 hashtags allowed.');
  console.log('Post create/edit HTTP hashtag limit checks passed');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mem.stop();
}
