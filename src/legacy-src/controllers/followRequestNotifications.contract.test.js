const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const controller = fs.readFileSync(path.join(__dirname, 'userController.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../routes/users.js'), 'utf8');
const notificationModel = fs.readFileSync(path.join(__dirname, '../models/Notification.js'), 'utf8');

test('existing follow-request endpoints remain the only read and resolution contract', () => {
  assert.match(routes, /router\.get\('\/follow-requests\/incoming', protect, getFollowRequests\)/);
  assert.match(routes, /router\.post\('\/follow-requests\/:requestId\/accept', protect, acceptFollowRequest\)/);
  assert.match(routes, /router\.post\('\/follow-requests\/:requestId\/reject', protect, rejectFollowRequest\)/);
  assert.match(controller, /const filter = \{ target: req\.user\._id, status: 'pending' \}/);
});

test('follow notifications link to the canonical request and become non-actionable after resolution', () => {
  assert.match(controller, /eventType: 'follow_request'/);
  assert.match(controller, /followRequestId: String\(request\._id\)/);
  assert.match(controller, /'data\.customData\.followRequestId': followRequestId/);
  assert.match(controller, /'data\.customData\.followRequestStatus': status/);
  assert.match(controller, /isRead: true/);
  assert.match(notificationModel, /recipient: 1, 'data\.customData\.followRequestId': 1/);
});

test('accept, reject, account deletion, and requester withdrawal publish user-scoped reconciliation', () => {
  assert.match(controller, /io\.to\(`user-\$\{request\.target\}`\)\.emit\('follow-request-updated'/);
  assert.match(controller, /publishFollowRequestUpdate\(\{ req, request, status \}\)/);
  assert.match(controller, /publishFollowRequestUpdate\(\{ req, request, status: 'cancelled' \}\)/);
  assert.match(controller, /cancelledRequests\.map\(\(request\) =>/);
  assert.match(controller, /requesterStillActive/);
});
