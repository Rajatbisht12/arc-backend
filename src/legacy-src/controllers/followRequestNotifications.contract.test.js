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

test('follow notifications link to the canonical request and reflect its final state', () => {
  assert.match(controller, /eventType: 'follow_request'/);
  assert.match(controller, /followRequestId: String\(request\._id\)/);
  assert.match(controller, /'data\.customData\.followRequestId': followRequestId/);
  assert.match(controller, /'data\.customData\.followRequestStatus': status/);
  assert.match(controller, /'data\.customData\.eventType': 'new_follower'/);
  assert.match(controller, /message: `\$\{requester\?\.username \|\| 'Someone'\} started following you`/);
  assert.match(controller, /deletedAt: updatedAt/);
  const update = controller.slice(controller.indexOf('const publishFollowRequestUpdate'), controller.indexOf('// Follow/unfollow with explicit pending requests'));
  assert.doesNotMatch(update, /isRead:|readAt:/, 'resolution must preserve visibility-based read state');
  assert.match(notificationModel, /recipient: 1, 'data\.customData\.followRequestId': 1/);
});

test('accept, reject, account deletion, and requester withdrawal publish user-scoped reconciliation', () => {
  assert.match(controller, /io\.to\(`user-\$\{targetUserId\}`\)\.emit\('follow-request-updated'/);
  assert.match(controller, /io\.to\(`user-\$\{requesterId\}`\)\.emit\('follow-request-updated'/);
  assert.match(controller, /notification-updated/);
  assert.match(controller, /notification-deleted/);
  assert.match(controller, /publishFollowRequestUpdate\(\{ req, request, status \}\)/);
  assert.match(controller, /publishFollowRequestUpdate\(\{ req, request, status: 'cancelled' \}\)/);
  assert.match(controller, /cancelledRequests\.map\(\(request\) =>/);
  assert.match(controller, /requesterStillActive/);
});

test('acceptance commits the request and Follow edge together, while retract-only DELETE never unfollows', () => {
  assert.match(controller, /session\.withTransaction\(async \(\) => \{/);
  assert.match(controller, /FollowRequest\.findOneAndUpdate\(\{[\s\S]*?status: 'pending'[\s\S]*?\{ new: true, session \}/);
  assert.match(controller, /Follow\.updateOne\([\s\S]*?\{ upsert: true, session \}/);
  assert.match(controller, /const retractOnly = req\.query\?\.expected === 'pending'/);
  assert.match(controller, /const shouldUnfollow = !retractOnly/);
});
