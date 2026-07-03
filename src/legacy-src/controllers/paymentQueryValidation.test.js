const assert = require('node:assert/strict');
const controller = require('./paymentController');

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

const assertRejected = async (handler, query, expectedMessage) => {
  const res = responseRecorder();
  await handler({ query, user: { _id: '507f1f77bcf86cd799439011' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, expectedMessage);
};

const run = async () => {
  await assertRejected(
    controller.getBoostCampaigns,
    { postId: { $ne: null } },
    'Invalid post identifier'
  );
  await assertRejected(
    controller.getBoostCampaigns,
    { status: { $ne: 'cancelled' } },
    'Invalid boost campaign status'
  );
  await assertRejected(
    controller.getPaymentHistory,
    { cursor: 'not-a-date' },
    'Invalid payment history cursor'
  );

  console.log('Payment list query-shape and cursor validation contracts passed');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
