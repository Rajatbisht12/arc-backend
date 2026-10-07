const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const { Message } = require('../models/Message');
const Notification = require('../models/Notification');
const Broadcast = require('../models/Broadcast');
const BroadcastRecipient = require('../models/BroadcastRecipient');
const { getOfficialSquadHunt, deliverBroadcastDm, hydrateBroadcastMessageCtas } = require('./officialSquadHunt');
const { sendDirectMessage } = require('../controllers/messageController');

test('notification CTA persists separate Web and native destinations', () => {
  const notification = new Notification({
    recipient: new mongoose.Types.ObjectId(),
    type: 'system',
    message: 'Test broadcast',
    data: { cta: { text: 'Follow', url: 'https://www.squadhunt.com/zoro', deepLink: 'arc://user/zoro', type: 'profile' } }
  });
  const cta = notification.toObject().data.cta;
  assert.equal(cta.url, 'https://www.squadhunt.com/zoro');
  assert.equal(cta.deepLink, 'arc://user/zoro');
});

test('reserved case variants cannot validate as normal users', async () => {
  for (const username of ['SquadHunt', 'squadhunt', 'SQUADHUNT']) {
    const user = new User({ username, email: `${username}@example.com`, password: 'unused-secret', userType: 'player', profile: { displayName: username } });
    await assert.rejects(user.validate(), /reserved system username/);
  }
});

test('official identity refuses to adopt a pre-existing normal account', async () => {
  const original = User.find;
  User.find = () => ({ limit: async () => [{ username: 'squadhunt', isSystemAccount: false, userType: 'player' }] });
  try {
    await assert.rejects(getOfficialSquadHunt(), /manual review required/);
  } finally {
    User.find = original;
  }
});

test('official identity refuses duplicate case-equivalent owners', async () => {
  const original = User.find;
  User.find = () => ({ limit: async () => [
    { username: 'SquadHunt', isSystemAccount: true, userType: 'system' },
    { username: 'squadhunt', isSystemAccount: false, userType: 'player' }
  ] });
  try {
    await assert.rejects(getOfficialSquadHunt(), /manual review required/);
  } finally {
    User.find = original;
  }
});

test('broadcast delivery reuses the same message for the same recipient ledger', async () => {
  const originalUserFind = User.find;
  const originalMessageFind = Message.findOne;
  const originalMessageCreate = Message.create;
  const official = { _id: new mongoose.Types.ObjectId(), username: 'SquadHunt', userType: 'system', isSystemAccount: true };
  const recipientLog = { _id: new mongoose.Types.ObjectId() };
  const recipientId = new mongoose.Types.ObjectId();
  let stored = null;
  let creates = 0;
  User.find = () => ({ limit: async () => [official] });
  Message.findOne = async () => stored;
  Message.create = async (input) => {
    creates += 1;
    stored = { _id: new mongoose.Types.ObjectId(), ...input };
    return stored;
  };
  try {
    const first = await deliverBroadcastDm({ recipientLog, broadcast: { message: 'Full broadcast\n\nSecond line', cta: { text: 'Follow', url: 'https://www.squadhunt.com/zoro', deepLink: 'arc://user/zoro', type: 'profile' } }, recipientId });
    const second = await deliverBroadcastDm({ recipientLog, broadcast: { message: 'Full broadcast\n\nSecond line' }, recipientId });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(creates, 1);
    assert.equal(first.message.content.text, 'Full broadcast\n\nSecond line');
    assert.equal(first.message.broadcastCta.text, 'Follow');
    assert.equal(first.message.broadcastCta.deepLink, 'arc://user/zoro');
    assert.equal(String(second.message._id), String(first.message._id));
  } finally {
    User.find = originalUserFind;
    Message.findOne = originalMessageFind;
    Message.create = originalMessageCreate;
  }
});

test('old broadcast DM history gains its original CTA without rewriting records', async () => {
  const recipientId = new mongoose.Types.ObjectId();
  const broadcastId = new mongoose.Types.ObjectId();
  const messages = [{ _id: new mongoose.Types.ObjectId(), broadcastRecipient: recipientId, content: { text: 'Original text' } }];
  const originalRecipientsFind = BroadcastRecipient.find;
  const originalBroadcastFind = Broadcast.find;
  BroadcastRecipient.find = () => ({ select: () => ({ lean: async () => [{ _id: recipientId, broadcast: broadcastId }] }) });
  Broadcast.find = () => ({ select: () => ({ lean: async () => [{ _id: broadcastId, cta: { text: 'Follow', url: 'https://www.squadhunt.com/zoro', deepLink: 'arc://user/zoro', type: 'profile' } }] }) });
  try {
    const result = await hydrateBroadcastMessageCtas(messages);
    assert.equal(result[0].broadcastCta.text, 'Follow');
    assert.equal(result[0].broadcastCta.url, 'https://www.squadhunt.com/zoro');
    assert.equal(result[0].content.text, 'Original text');
  } finally {
    BroadcastRecipient.find = originalRecipientsFind;
    Broadcast.find = originalBroadcastFind;
  }
});

test('direct-message API refuses a system recipient before creating a message', async () => {
  const originalFindById = User.findById;
  const originalMessageCreate = Message.create;
  let created = false;
  User.findById = () => ({
    select: async () => ({
      _id: new mongoose.Types.ObjectId(),
      username: 'SquadHunt',
      userType: 'system',
      isSystemAccount: true,
      isActive: true
    })
  });
  Message.create = async () => { created = true; throw new Error('Unexpected message creation'); };
  const result = { status: 200, body: null };
  const response = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; }
  };
  try {
    await sendDirectMessage({
      body: { recipientId: String(new mongoose.Types.ObjectId()), text: 'Unauthorized reply' },
      user: { _id: new mongoose.Types.ObjectId() }
    }, response);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'SYSTEM_CONVERSATION_READ_ONLY');
    assert.equal(created, false);
  } finally {
    User.findById = originalFindById;
    Message.create = originalMessageCreate;
  }
});
