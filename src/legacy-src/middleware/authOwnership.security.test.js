const assert = require('node:assert/strict');
const { checkOwnership } = require('./auth');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
});

const run = async () => {
  let lookupCount = 0;
  const invalidIdModel = {
    async findById() {
      lookupCount += 1;
      return null;
    }
  };
  const invalidResponse = responseRecorder();
  await checkOwnership(invalidIdModel)(
    { params: { id: 'not-an-object-id' }, user: { _id: '507f1f77bcf86cd799439011' } },
    invalidResponse,
    () => { throw new Error('Malformed IDs must not continue'); }
  );
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(invalidResponse.body.code, 'INVALID_IDENTIFIER');
  assert.equal(lookupCount, 0, 'Malformed IDs must be rejected before querying MongoDB');

  const internalResponse = responseRecorder();
  const internalMessage = 'mongodb://internal-host/private-database';
  await checkOwnership({
    async findById() {
      throw new Error(internalMessage);
    }
  })(
    { params: { id: '507f1f77bcf86cd799439011' }, user: { _id: '507f1f77bcf86cd799439011' } },
    internalResponse,
    () => { throw new Error('Failed lookup must not continue'); }
  );
  assert.equal(internalResponse.statusCode, 500);
  assert.equal(JSON.stringify(internalResponse.body).includes(internalMessage), false);
  assert.deepEqual(internalResponse.body, {
    success: false,
    message: 'Error checking resource ownership.'
  });

  console.log('Ownership middleware validation and error-redaction contracts passed');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
