const assert = require('node:assert/strict');
const { body } = require('express-validator');
const { handleValidationErrors } = require('./validation');

const runMiddleware = async (middleware, req, res) => {
  await middleware(req, res, () => {});
};

const run = async () => {
  const secret = 'do-not-echo-this-password';
  const req = { body: { password: secret } };
  let statusCode;
  let payload;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(bodyPayload) {
      payload = bodyPayload;
      return this;
    }
  };

  await runMiddleware(
    body('password').isLength({ min: 100 }).withMessage('Password is invalid'),
    req,
    res
  );
  handleValidationErrors(req, res, () => {
    throw new Error('Invalid request should not continue');
  });

  assert.equal(statusCode, 400);
  assert.equal(payload.success, false);
  assert.deepEqual(payload.errors, [
    { field: 'password', message: 'Password is invalid' }
  ]);
  assert.equal(JSON.stringify(payload).includes(secret), false);

  console.log('Validation response security contract passed');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
