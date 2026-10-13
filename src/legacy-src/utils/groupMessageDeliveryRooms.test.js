const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { groupMessageDeliveryRooms } = require('./groupMessageDeliveryRooms');

assert.deepEqual(groupMessageDeliveryRooms([
  { user: 'sender' },
  { user: { toString: () => 'recipient' } },
  { user: 'recipient' },
  { user: null }
]), ['user-sender', 'user-recipient']);
assert.deepEqual(groupMessageDeliveryRooms([]), []);

const source = fs.readFileSync(path.join(__dirname, '../controllers/messageController.js'), 'utf8');
const groupSend = source.slice(source.indexOf('const sendGroupMessage ='), source.indexOf('// Get group messages'));
assert(groupSend.includes('await emitNewMessage(groupMessageDeliveryRooms(chatRoom.members), {'),
  'durable group sends must emit to all current member user rooms');
assert(!groupSend.includes('await emitNewMessage(`chat-${chatRoomId}`'),
  'a stale chat-room subscription must not deliver a message to a removed member');

console.log('Group message delivery room tests passed');
