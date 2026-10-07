import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./notifications.routes.ts', import.meta.url), 'utf8');
const batch = source.slice(source.indexOf('router.post("/mark-read"'), source.indexOf('router.put("/:id/read"'));

test('viewed-read batch is authenticated, bounded, and validates every ID', () => {
  assert.match(batch, /router\.post\("\/mark-read", protect/);
  assert.match(batch, /suppliedIds\.length === 0 \|\| suppliedIds\.length > 100/);
  assert.match(batch, /suppliedIds\.some\(\(id: unknown\) => !isObjectId\(id\)\)/);
  assert.match(batch, /new Set\(suppliedIds as string\[\]\)/);
});

test('batch write cannot mark another recipient or message notifications read', () => {
  assert.match(batch, /Notification\.updateMany\(/);
  assert.match(batch, /recipient: userId/);
  assert.match(batch, /isRead: false/);
  assert.match(batch, /deletedAt: null/);
  assert.match(batch, /archivedAt: null/);
  assert.match(batch, /type: \{ \$nin: NOTIFICATION_LIST_EXCLUDED_TYPES \}/);
  assert.match(batch, /withClientVisibility\(/);
});

test('batch response reconciles unread count and syncs badge only after a real update', () => {
  assert.match(batch, /countVisibleUnreadNotifications\(userId, platform, appVersion\)/);
  assert.match(batch, /if \(modifiedCount > 0\) scheduleUnreadBadgeSync/);
  assert.match(batch, /updatedCount: modifiedCount, unreadCount/);
});

test('read keeps call rows until recipient-scoped screen-exit cleanup', () => {
  const clear = source.slice(source.indexOf('router.post("/clear-read-calls"'), source.indexOf('router.post("/mark-read"'));
  assert.match(batch, /\$set: \{ isRead: true, readAt \}/);
  assert.doesNotMatch(batch, /\$set: \{ isRead: true, readAt, deletedAt/);
  assert.match(clear, /router\.post\("\/clear-read-calls", protect/);
  assert.match(clear, /recipient: userId/);
  assert.match(clear, /isRead: true/);
  assert.match(clear, /temporaryCallNotificationFilter/);
  assert.match(clear, /\$set: \{ deletedAt: new Date\(\) \}/);
  assert.match(clear, /countVisibleUnreadNotifications\(userId, platform, appVersion\)/);
  assert.match(source, /const markTrackedNotificationRead = async/);
  assert.match(source, /await markTrackedNotificationRead\(owned\.notification, userId\)/);
});
