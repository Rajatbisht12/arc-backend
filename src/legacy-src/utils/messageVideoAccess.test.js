const test = require('node:test');
const assert = require('node:assert/strict');
const { canReadMessageVideo } = require('./messageVideoAccess');

const ids = {
  sender: '000000000000000000000001',
  recipient: '000000000000000000000002',
  outsider: '000000000000000000000003',
  room: '000000000000000000000004'
};
const now = new Date('2026-10-09T00:00:00Z');

test('direct video URL is limited to sender and recipient and respects deletion', () => {
  const message = { messageType: 'direct', sender: ids.sender, recipient: ids.recipient };
  assert.equal(canReadMessageVideo(message, ids.sender), true);
  assert.equal(canReadMessageVideo(message, ids.recipient), true);
  assert.equal(canReadMessageVideo(message, ids.outsider), false);
  assert.equal(canReadMessageVideo({ ...message, deletedForUsers: [{ user: ids.recipient }] }, ids.recipient), false);
  assert.equal(canReadMessageVideo({ ...message, deletedForEveryone: true }, ids.sender), false);
});

test('group video URL respects room and membership epoch', () => {
  const message = { messageType: 'group', chatRoom: ids.room, createdAt: now };
  const room = {
    _id: ids.room,
    isActive: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    members: [{ user: ids.recipient, joinedAt: new Date('2026-10-08T00:00:00Z') }],
    removedMembers: []
  };
  assert.equal(canReadMessageVideo(message, ids.recipient, room), true);
  assert.equal(canReadMessageVideo(message, ids.outsider, room), false);
  assert.equal(canReadMessageVideo({ ...message, createdAt: new Date('2026-10-07T00:00:00Z') }, ids.recipient, room), false);
  assert.equal(canReadMessageVideo(message, ids.recipient, { ...room, isActive: false }), false);
});
