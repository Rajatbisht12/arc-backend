const assert = require('node:assert/strict');
const test = require('node:test');
const Post = require('../models/Post');
const { updatePost } = require('./postController');

test('a persisted canary post rejects a public or followers-only edit before saving', async () => {
  const originalFindById = Post.findById;
  const owner = '507f1f77bcf86cd799439011';
  let saves = 0;
  Post.findById = async () => ({
    author: { toString: () => owner },
    postVideoCanaryRestricted: true,
    visibility: 'private',
    content: { text: 'Synthetic test video' },
    save: async () => { saves += 1; }
  });
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    for (const visibility of ['public', 'followers']) {
      const res = response();
      await updatePost({ params: { id: '507f1f77bcf86cd799439012' }, user: { _id: owner }, body: { visibility } }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, 'CANARY_POST_PRIVATE');
    }
    assert.equal(saves, 0);
  } finally {
    Post.findById = originalFindById;
  }
});

test('the owner-only marker is an internal persisted Post field', () => {
  const path = Post.schema.path('postVideoCanaryRestricted');
  assert.ok(path);
  assert.equal(path.options.default, undefined);
  assert.equal(path.options.immutable, true);
});
