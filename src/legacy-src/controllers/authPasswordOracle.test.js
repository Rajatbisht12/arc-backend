const assert = require('assert');
const axios = require('axios');
const User = require('../models/User');
const { checkPasswordSame, googleTokenLogin } = require('./authController');

const run = async () => {
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  const authenticatedUserId = '507f1f77bcf86cd799439011';
  let queriedUserId = '';

  User.findOne = () => {
    throw new Error('checkPasswordSame must not select an account by caller-supplied email');
  };
  User.findById = (userId) => ({
    select: async () => {
      queriedUserId = String(userId);
      return {
        password: 'stored-hash',
        comparePassword: async (candidate) => candidate === 'correct-password'
      };
    }
  });

  const result = { statusCode: 200, body: null };
  const response = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };

  try {
    await checkPasswordSame({
      user: { _id: authenticatedUserId },
      body: { email: 'victim@example.com', password: 'correct-password' }
    }, response);
  } finally {
    User.findById = originalFindById;
    User.findOne = originalFindOne;
  }

  assert.strictEqual(queriedUserId, authenticatedUserId);
  assert.strictEqual(result.statusCode, 200);
  assert.deepStrictEqual(result.body, { success: true, isSame: true });

  const originalAxiosGet = axios.get;
  try {
    axios.get = async () => {
      const error = new Error('provider rejected token');
      error.isAxiosError = true;
      error.response = { status: 401 };
      throw error;
    };
    result.statusCode = 200;
    result.body = null;
    await googleTokenLogin({ body: { access_token: 'invalid-token' } }, response);
    assert.strictEqual(result.statusCode, 401);

    axios.get = async () => {
      const error = new Error('provider network timeout');
      error.isAxiosError = true;
      throw error;
    };
    result.statusCode = 200;
    result.body = null;
    await googleTokenLogin({ body: { access_token: 'valid-shape-token' } }, response);
    assert.strictEqual(result.statusCode, 502);
  } finally {
    axios.get = originalAxiosGet;
  }
  console.log('Authenticated self-only password comparison contract passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
