const assert = require('node:assert/strict');
const test = require('node:test');
const { Message } = require('./Message');

test('client message IDs are optional and unique per sender when present', () => {
  assert.equal(Message.schema.path('clientMessageId').options.required, undefined);
  const index = Message.schema.indexes().find(([, options]) => options.name === 'message_client_idempotency');
  assert.ok(index, 'the idempotency index must be declared');
  assert.deepEqual(index[0], { sender: 1, clientMessageId: 1 });
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { clientMessageId: { $type: 'string' } });
});
