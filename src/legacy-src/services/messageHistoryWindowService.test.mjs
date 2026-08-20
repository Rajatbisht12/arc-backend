import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveMessageHistoryWindow } = require('./messageHistoryWindowService.js');

const makeRepository = ({ size, firstUnreadIndex = null }) => {
  const records = Array.from({ length: size }, (_, index) => ({
    _id: `message-${index + 1}`,
    createdAt: new Date(1_700_000_000_000 + index),
  }));
  const indexOf = (record) => records.findIndex((item) => item._id === record?._id);
  return {
    findAnchor: async (id) => records.find((record) => record._id === id) || null,
    findFirstUnread: async () => firstUnreadIndex == null ? null : records[firstUnreadIndex],
    findLatest: async () => records.at(-1) || null,
    countUnread: async () => firstUnreadIndex == null ? 0 : records.length - firstUnreadIndex,
    pageBefore: async (anchor, limit) => records.slice(0, indexOf(anchor)).reverse().slice(0, limit),
    pageAfter: async (anchor, limit) => records.slice(indexOf(anchor) + 1, indexOf(anchor) + 1 + limit),
    pageFrom: async (anchor, limit) => records.slice(indexOf(anchor), indexOf(anchor) + limit),
    latestPage: async (limit) => records.slice(-limit).reverse(),
    hasBefore: async (anchor) => indexOf(anchor) > 0,
    hasAfter: async (anchor) => indexOf(anchor) < records.length - 1,
  };
};

for (const conversationType of ['DM', 'Group']) {
  test(`${conversationType}: zero unread opens a bounded window at latest`, async () => {
    const result = await resolveMessageHistoryWindow({
      repository: makeRepository({ size: 90 }),
      limit: 30,
    });
    assert.equal(result.messageIds.length, 30);
    assert.equal(result.initialPosition.mode, 'latest');
    assert.equal(result.initialPosition.targetMessageId, 'message-90');
    assert.equal(result.pagination.hasOlder, true);
    assert.equal(result.pagination.hasNewer, false);
  });

  test(`${conversationType}: one unread opens at that unread message`, async () => {
    const result = await resolveMessageHistoryWindow({
      repository: makeRepository({ size: 50, firstUnreadIndex: 49 }),
      limit: 30,
    });
    assert.equal(result.initialPosition.firstUnreadMessageId, 'message-50');
    assert.equal(result.messageIds.at(-1), 'message-50');
    assert.equal(result.initialPosition.unreadCount, 1);
  });

  test(`${conversationType}: unread history larger than a page starts at first unread`, async () => {
    const result = await resolveMessageHistoryWindow({
      repository: makeRepository({ size: 5_000, firstUnreadIndex: 4_880 }),
      limit: 30,
    });
    assert.equal(result.messageIds.length, 30);
    assert.equal(result.messageIds[1], 'message-4881');
    assert.equal(result.initialPosition.targetMessageId, 'message-4881');
    assert.equal(result.initialPosition.unreadCount, 120);
    assert.equal(result.pagination.hasNewer, true);
  });
}

test('newer cursor paging reaches the latest message without duplicates', async () => {
  const repository = makeRepository({ size: 100, firstUnreadIndex: 60 });
  const initial = await resolveMessageHistoryWindow({ repository, limit: 20 });
  const newer = await resolveMessageHistoryWindow({
    repository,
    limit: 20,
    after: initial.pagination.newestCursor,
  });
  assert.equal(new Set([...initial.messageIds, ...newer.messageIds]).size, 40);
  assert.equal(newer.pagination.direction, 'newer');
});
