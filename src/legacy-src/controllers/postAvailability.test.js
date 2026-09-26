const assert = require('node:assert/strict');
const test = require('node:test');

const Post = require('../models/Post');
const { getPostAvailability } = require('./postController');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

test('post availability returns only an existence result for an active post', async () => {
  const originalExists = Post.exists;
  let receivedQuery;
  Post.exists = async (query) => {
    receivedQuery = query;
    return { _id: '507f1f77bcf86cd799439011' };
  };

  try {
    const response = responseRecorder();
    await getPostAvailability(
      { params: { id: '507f1f77bcf86cd799439011' } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { success: true, data: { exists: true } });
    assert.deepEqual(receivedQuery, {
      _id: '507f1f77bcf86cd799439011',
      isActive: { $ne: false },
      hiddenByAdmin: { $ne: true }
    });
    assert.equal(JSON.stringify(response.body).includes('content'), false);
    assert.equal(JSON.stringify(response.body).includes('author'), false);
  } finally {
    Post.exists = originalExists;
  }
});

test('post availability returns a real not-found result for missing content', async () => {
  const originalExists = Post.exists;
  Post.exists = async () => null;

  try {
    const response = responseRecorder();
    await getPostAvailability(
      { params: { id: '507f1f77bcf86cd799439011' } },
      response
    );

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {
      success: false,
      code: 'POST_NOT_FOUND',
      message: 'Post not found'
    });
  } finally {
    Post.exists = originalExists;
  }
});
