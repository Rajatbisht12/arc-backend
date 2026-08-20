// Contract: message-received notifications (type "message") are excluded from
// the Notifications history endpoint AND its unread count, while calls
// (type "call") and every other type are preserved. Filtering is by the
// authoritative `type` field, never by scanning message text, and the exclusion
// is applied before pagination so page counts / hasMore stay correct.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const src = await readFile(new URL('./notifications.routes.ts', import.meta.url), 'utf8');

test('there is one canonical excluded-types list containing only "message"', () => {
  assert.match(src, /const NOTIFICATION_LIST_EXCLUDED_TYPES = \["message"\] as const/);
  // Calls must not be excluded.
  assert.doesNotMatch(src, /NOTIFICATION_LIST_EXCLUDED_TYPES = \[[^\]]*"call"/);
});

test('the list query excludes message-received notifications (paginates after exclusion)', () => {
  // The base list filter carries the $nin exclusion; find(filter) + countDocuments(filter)
  // both use it, so pagination is computed over the already-filtered set.
  const listFilter = src.slice(src.indexOf('const baseFilter: Record<string, unknown> = withClientVisibility({'));
  assert.match(listFilter.slice(0, 400), /type: \{ \$nin: NOTIFICATION_LIST_EXCLUDED_TYPES \}/);
  assert.match(src, /Notification\.find\(filter\)/);
  assert.match(src, /Notification\.countDocuments\(filter\)/);
});

test('the unread count also excludes message-received notifications', () => {
  const countBlock = src.slice(src.indexOf('countVisibleUnreadNotifications ='), src.indexOf('countVisibleUnreadNotifications =') + 400);
  assert.match(countBlock, /isRead: false/);
  assert.match(countBlock, /type: \{ \$nin: NOTIFICATION_LIST_EXCLUDED_TYPES \}/);
});

test('exclusion is type-based, not text-based', () => {
  assert.doesNotMatch(src, /sent you a message|includes\(["']message["']\)|\/message\//i);
});
