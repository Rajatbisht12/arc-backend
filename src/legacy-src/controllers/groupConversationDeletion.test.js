const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Message, ChatRoom } = require('../models/Message');
const { clearGroupConversation } = require('./messageController');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('group Delete Chat persists only the caller-scoped clear markers', async (t) => {
  const originalFindOne = ChatRoom.findOne;
  const originalRoomUpdate = ChatRoom.updateOne;
  const originalMessageUpdate = Message.updateMany;
  t.after(() => {
    ChatRoom.findOne = originalFindOne;
    ChatRoom.updateOne = originalRoomUpdate;
    Message.updateMany = originalMessageUpdate;
  });

  const room = {
    _id: 'room-1',
    members: [
      { user: 'caller-1', role: 'admin' },
      { user: 'other-1', role: 'member' },
    ],
    removedMembers: [],
  };
  const messageUpdates = [];
  const roomUpdates = [];
  ChatRoom.findOne = async () => room;
  Message.updateMany = async (query, update) => {
    messageUpdates.push({ query, update });
    return { modifiedCount: 2 };
  };
  ChatRoom.updateOne = async (query, update) => {
    roomUpdates.push({ query, update });
    return { modifiedCount: 1 };
  };

  const response = createResponse();
  await clearGroupConversation(
    { params: { chatRoomId: 'room-1' }, user: { _id: 'caller-1' } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(messageUpdates.length, 1);
  assert.equal(messageUpdates[0].query['deletedForUsers.user'].$ne, 'caller-1');
  assert.equal(messageUpdates[0].update.$addToSet.deletedForUsers.user, 'caller-1');
  assert.equal(roomUpdates.length, 2);
  assert.equal(roomUpdates[0].update.$pull.deletedFor.user, 'caller-1');
  assert.equal(roomUpdates[1].update.$push.deletedFor.user, 'caller-1');
  assert.equal(room.members.length, 2, 'Delete Chat must not change membership');
});

test('group Delete Chat rejects a non-member without mutating history', async (t) => {
  const originalFindOne = ChatRoom.findOne;
  const originalRoomUpdate = ChatRoom.updateOne;
  const originalMessageUpdate = Message.updateMany;
  t.after(() => {
    ChatRoom.findOne = originalFindOne;
    ChatRoom.updateOne = originalRoomUpdate;
    Message.updateMany = originalMessageUpdate;
  });

  let mutationCount = 0;
  ChatRoom.findOne = async () => ({
    members: [{ user: 'other-1', role: 'admin' }],
    removedMembers: [],
  });
  Message.updateMany = async () => { mutationCount += 1; };
  ChatRoom.updateOne = async () => { mutationCount += 1; };

  const response = createResponse();
  await clearGroupConversation(
    { params: { chatRoomId: 'room-1' }, user: { _id: 'caller-1' } },
    response,
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'NOT_GROUP_MEMBER');
  assert.equal(mutationCount, 0);
});
