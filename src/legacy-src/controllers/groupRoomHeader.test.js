const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Message, ChatRoom } = require('../models/Message');
const { getGroupMessages } = require('./messageController');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('authorized group history includes the current room name and avatar', async (t) => {
  const originalFindById = ChatRoom.findById;
  const originalFind = Message.find;
  const originalCountDocuments = Message.countDocuments;
  t.after(() => {
    ChatRoom.findById = originalFindById;
    Message.find = originalFind;
    Message.countDocuments = originalCountDocuments;
  });

  ChatRoom.findById = async () => ({
    _id: 'room-1',
    isActive: true,
    name: 'Tetstifn',
    avatar: 'https://media.squadhunt.com/group.webp',
    members: [{ user: 'viewer-1' }, { user: 'other-1' }],
    removedMembers: [],
  });
  const query = {
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    async lean() { return []; },
  };
  Message.find = () => query;
  Message.countDocuments = async () => 0;

  const response = createResponse();
  await getGroupMessages(
    { params: { chatRoomId: 'room-1' }, query: { limit: '1' }, user: { _id: 'viewer-1' } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.room, {
    _id: 'room-1',
    name: 'Tetstifn',
    avatar: 'https://media.squadhunt.com/group.webp',
    memberCount: 2,
  });
});

test('non-members cannot fetch group header metadata through history', async (t) => {
  const originalFindById = ChatRoom.findById;
  t.after(() => { ChatRoom.findById = originalFindById; });
  ChatRoom.findById = async () => ({
    _id: 'room-1',
    isActive: true,
    name: 'Private group',
    avatar: 'https://media.squadhunt.com/private.webp',
    members: [{ user: 'other-1' }],
    removedMembers: [],
  });

  const response = createResponse();
  await getGroupMessages(
    { params: { chatRoomId: 'room-1' }, query: {}, user: { _id: 'stranger-1' } },
    response,
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.room, undefined);
});
