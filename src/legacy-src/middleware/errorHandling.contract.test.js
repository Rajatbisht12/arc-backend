const assert = require('assert');
const errorHandler = require('./errorHandler');
const safeAsyncHandler = require('../utils/safeAsyncHandler');

const invokeErrorHandler = (error, nodeEnv = 'production') => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  const result = { statusCode: 0, body: null };
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
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    errorHandler(error, {}, response, () => {});
  } finally {
    console.error = originalConsoleError;
    process.env.NODE_ENV = previousNodeEnv;
  }
  return result;
};

const run = async () => {
  const malformedJson = Object.assign(new SyntaxError('Unexpected token with private payload'), {
    status: 400,
    type: 'entity.parse.failed'
  });
  assert.deepStrictEqual(invokeErrorHandler(malformedJson), {
    statusCode: 400,
    body: {
      success: false,
      message: 'Request body contains invalid JSON',
      code: 'INVALID_JSON'
    }
  });

  const castError = Object.assign(new Error('Cast to ObjectId failed for value private-id'), {
    name: 'CastError',
    path: '_id'
  });
  assert.deepStrictEqual(invokeErrorHandler(castError), {
    statusCode: 400,
    body: {
      success: false,
      message: 'Invalid resource identifier',
      code: 'INVALID_IDENTIFIER'
    }
  });

  const duplicateError = Object.assign(new Error('E11000 duplicate key collection: secret'), {
    code: 11000
  });
  assert.deepStrictEqual(invokeErrorHandler(duplicateError), {
    statusCode: 409,
    body: {
      success: false,
      message: 'A resource with that value already exists',
      code: 'RESOURCE_CONFLICT'
    }
  });

  const forbidden = Object.assign(new Error('Origin not allowed by CORS'), {
    statusCode: 403,
    code: 'CORS_ORIGIN_DENIED'
  });
  assert.deepStrictEqual(invokeErrorHandler(forbidden), {
    statusCode: 403,
    body: {
      success: false,
      message: 'Origin not allowed by CORS',
      code: 'CORS_ORIGIN_DENIED'
    }
  });

  const internal = invokeErrorHandler(new Error('mongodb://user:password@private-host/database'));
  assert.strictEqual(internal.statusCode, 500);
  assert.strictEqual(internal.body.message, 'Internal server error');
  assert.ok(!JSON.stringify(internal.body).includes('private-host'));

  const original = new Error('recoverable failure');
  let forwarded = null;
  const wrapped = safeAsyncHandler(async () => {
    throw original;
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await wrapped({}, { headersSent: false }, (error) => {
      forwarded = error;
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.strictEqual(forwarded, original, 'safeAsyncHandler must preserve errors for central classification');

  console.log('Central API error handling contracts passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
