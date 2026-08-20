const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Message } = require('../models/Message');

const controllerSource = readFileSync(path.join(__dirname, 'messageController.js'), 'utf8');

test('invite acknowledgement schema is explicit, non-actionable presentation metadata', () => {
  assert.ok(Message.schema.path('inviteResponse.invitationType'));
  assert.ok(Message.schema.path('inviteResponse.invitationMessageId'));
  assert.ok(Message.schema.path('inviteResponse.status'));
  assert.deepEqual(
    Message.schema.path('inviteResponse.status').options.enum,
    ['accepted', 'declined'],
  );
  assert.deepEqual(
    Message.schema.path('inviteResponse.invitationType').options.enum,
    ['roster', 'staff'],
  );
  assert.equal(Message.schema.path('inviteData.type').options.enum.includes('invite_response'), false);
});

test('invite response keeps the existing endpoint workflow and adds durable display metadata', () => {
  assert.match(controllerSource, /respondToInvitation\(\{/);
  assert.match(controllerSource, /inviteResponse:\s*\{/);
  assert.match(controllerSource, /invitationMessageId: message\._id/);
  assert.match(controllerSource, /status: outcome\.status/);
  assert.match(controllerSource, /responseMessage: responseMsg/);
});

test('invite response emits the acknowledgement and original-card status over existing user rooms', () => {
  assert.match(controllerSource, /emit\('newMessage', \{/);
  assert.match(controllerSource, /emit\('invite_status_updated', \{/);
  assert.match(controllerSource, /chatId: `direct_\$\{outcome\.invite\.team\}`/);
  assert.match(controllerSource, /chatId: `direct_\$\{userId\}`/);
});
