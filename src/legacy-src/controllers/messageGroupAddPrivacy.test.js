const assert = require('assert');
const { Message, ChatRoom } = require('../models/Message');
const User = require('../models/User');
const Follow = require('../models/Follow');
const { addMemberToChatRoom } = require('./messageController');

const actorId = '507f1f77bcf86cd799439001';
const targetId = '507f1f77bcf86cd799439002';
const roomId = '507f1f77bcf86cd799439003';

const originals = {
  chatRoomFindById: ChatRoom.findById,
  userFindById: User.findById,
  followFind: Follow.find,
  messageSave: Message.prototype.save,
  messagePopulate: Message.prototype.populate
};

const responseRecorder = () => {
  const result = { statusCode: 200, body: undefined };
  return {
    result,
    response: {
      status(code) {
        result.statusCode = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      }
    }
  };
};

const fakeRoom = () => ({
  _id: roomId,
  name: 'Existing group',
  description: '',
  avatar: '',
  creator: actorId,
  members: [],
  memberPermissions: { addMembers: true },
  populate: async () => {}
});

const runDeniedCase = async ({ setting, followedActorIds = [] }) => {
  let selectedFields = '';
  let roomSaved = false;
  const room = fakeRoom();
  room.save = async () => { roomSaved = true; };

  ChatRoom.findById = async () => room;
  User.findById = () => ({
    select: async (fields) => {
      selectedFields = fields;
      return {
        _id: targetId,
        username: 'privacy_target',
        isActive: true,
        blockedUsers: [],
        privacySettings: { whoCanAddToGroup: setting },
        profile: { displayName: 'Privacy Target' }
      };
    }
  });
  Follow.find = () => ({ distinct: async () => followedActorIds });

  const { result, response } = responseRecorder();
  await addMemberToChatRoom({
    params: { chatRoomId: roomId },
    body: { memberId: targetId },
    user: { _id: actorId, blockedUsers: [] }
  }, response);

  assert.strictEqual(selectedFields, 'privacySettings username isActive profile blockedUsers');
  assert.strictEqual(result.statusCode, 403);
  assert.strictEqual(result.body.success, false);
  assert.strictEqual(result.body.reason, 'privacy_blocked');
  assert.strictEqual(roomSaved, false, 'a privacy-denied target must never be inserted');
  assert.strictEqual(room.members.length, 0);
  return result.body;
};

const runAllowedCase = async ({ setting, followedActorIds = [] }) => {
  let roomSaved = false;
  const room = fakeRoom();
  room.save = async () => { roomSaved = true; };
  ChatRoom.findById = async () => room;
  User.findById = () => ({
    select: async () => ({
      _id: targetId,
      username: 'privacy_target',
      isActive: true,
      blockedUsers: [],
      privacySettings: { whoCanAddToGroup: setting },
      profile: { displayName: 'Privacy Target' }
    })
  });
  Follow.find = () => ({ distinct: async () => followedActorIds });
  Message.prototype.save = async function save() { return this; };
  Message.prototype.populate = async function populate() { return this; };

  const { result, response } = responseRecorder();
  await addMemberToChatRoom({
    params: { chatRoomId: roomId },
    body: { memberId: targetId },
    user: { _id: actorId, blockedUsers: [] }
  }, response);

  assert.strictEqual(result.statusCode, 200);
  assert.strictEqual(result.body.success, true);
  assert.strictEqual(roomSaved, true);
  assert.strictEqual(room.members.length, 1);
};

(async () => {
  try {
    const nobody = await runDeniedCase({ setting: 'nobody' });
    assert.strictEqual(nobody.code, 'GROUP_ADD_PRIVACY_NOBODY');

    const following = await runDeniedCase({ setting: 'people_you_follow' });
    assert.strictEqual(following.code, 'GROUP_ADD_PRIVACY_FOLLOW_REQUIRED');

    await runAllowedCase({ setting: 'anyone' });
    await runAllowedCase({ setting: 'people_you_follow', followedActorIds: [targetId] });

    console.log('existing-group add-member privacy tests passed');
  } finally {
    ChatRoom.findById = originals.chatRoomFindById;
    User.findById = originals.userFindById;
    Follow.find = originals.followFind;
    Message.prototype.save = originals.messageSave;
    Message.prototype.populate = originals.messagePopulate;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
