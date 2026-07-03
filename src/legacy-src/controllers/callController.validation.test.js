const assert = require('assert');
const callController = require('./callController');

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

const run = async () => {
  for (const chatRoomId of [undefined, '', 'not-an-object-id', { $ne: null }]) {
    const res = responseRecorder();
    await callController.generateGroupCallToken({
      user: { _id: '507f1f77bcf86cd799439011' },
      body: { chatRoomId }
    }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, 'Valid chatRoomId is required');
  }

  const callerId = '507f1f77bcf86cd799439011';
  for (const targetUserId of [[callerId], { $ne: null }]) {
    const res = responseRecorder();
    await callController.initiateCall({
      user: { _id: callerId },
      body: { targetUserId, callType: 'voice' }
    }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, 'Valid targetUserId is required');
  }

  console.log('Call controller identifier validation contracts passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
