const assert = require('node:assert/strict');
const test = require('node:test');

const User = require('../models/User');
const { getUserAvailability } = require('./userController');

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

test('profile availability returns only an existence result for an active username', async () => {
  const originalExists = User.exists;
  let receivedQuery;
  User.exists = async (query) => {
    receivedQuery = query;
    return { _id: '507f1f77bcf86cd799439011' };
  };

  try {
    const response = responseRecorder();
    await getUserAvailability({ params: { identifier: 'zoro' } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { success: true, data: { exists: true } });
    assert.deepEqual(receivedQuery, { username: 'zoro', isActive: true });
    assert.equal(JSON.stringify(response.body).includes('profile'), false);
  } finally {
    User.exists = originalExists;
  }
});

test('profile availability returns not found for an inactive or missing username', async () => {
  const originalExists = User.exists;
  User.exists = async () => null;

  try {
    const response = responseRecorder();
    await getUserAvailability({ params: { identifier: 'missing_user' } }, response);

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {
      success: false,
      code: 'PROFILE_NOT_FOUND',
      message: 'Profile not found'
    });
  } finally {
    User.exists = originalExists;
  }
});
