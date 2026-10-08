// A call produces ONE history item, but both participants report it and their
// reports race (a caller's ring-timeout "missed" can land after the callee has
// already answered or declined). These tests prove the stored outcome is
// resolved by priority — answered > declined > missed — so it is deterministic
// and idempotent no matter which report arrives first.
const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { Message, ChatRoom } = require('../models/Message');
const User = require('../models/User');
const UsernameRegistry = require('../models/UsernameRegistry');
const CallSession = require('../models/CallSession');
const messageController = require('./messageController');

const CALL_ID = 'call:abc12345';

let mongod;
let caller;
let callee;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
test.after(async () => { await mongoose.disconnect(); await mongod.stop(); });

test.beforeEach(async () => {
  await Promise.all([Message.deleteMany({}), User.deleteMany({}), UsernameRegistry.deleteMany({}), ChatRoom.deleteMany({}), CallSession.deleteMany({})]);
  caller = await User.create({ username: 'caller', email: 'caller@example.com', password: 'x'.repeat(12), userType: 'player', profile: { displayName: 'Caller' } });
  callee = await User.create({ username: 'callee', email: 'callee@example.com', password: 'x'.repeat(12), userType: 'player', profile: { displayName: 'Callee' } });
  // The handler authorises against the real 1:1 call session.
  await CallSession.create({
    callId: CALL_ID,
    nativeCallId: 'native-abc12345',
    caller: caller._id,
    callee: callee._id,
    callType: 'voice',
    expiresAt: new Date(Date.now() + 60_000),
  });
});

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.set = () => res;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const postSummary = async (user, { outcome, durationSeconds = 0, recipient, callId = CALL_ID, callType = 'voice' }) => {
  const res = makeRes();
  await messageController.createCallSummary({
    user,
    body: { callId, callType, outcome, durationSeconds, participantCount: 1, recipientId: String(recipient._id) },
  }, res);
  return res;
};

const storedOutcome = async (callId = CALL_ID) => {
  const message = await Message.findOne({ messageType: 'call', 'callSummary.callId': callId }).lean();
  return message?.callSummary;
};

const recentFor = async (user) => {
  const response = makeRes();
  await messageController.getRecentConversations({ user, query: {} }, response);
  assert.equal(response.statusCode, 200);
  return response.body.data;
};

test('a first-contact missed call creates one persisted recent DM for both participants', async () => {
  assert.equal((await recentFor(caller)).conversations.length, 0);
  assert.equal((await recentFor(callee)).conversations.length, 0);

  await postSummary(caller, { outcome: 'missed', recipient: callee });
  for (const [viewer, other] of [[caller, callee], [callee, caller]]) {
    const result = await recentFor(viewer);
    assert.equal(result.pagination.totalConversations, 1);
    assert.equal(result.conversations.length, 1);
    assert.equal(result.conversations[0]._id, `direct_${other._id}`);
    assert.equal(result.conversations[0].lastMessage.messageType, 'call');
    assert.equal(result.conversations[0].lastMessage.callSummary.outcome, 'missed');
    assert.equal(result.conversations[0].unreadCount, 0, 'call history is not an unread DM message');
  }
});

test('an answered call upgrades one first-contact DM, not a second conversation', async () => {
  await postSummary(caller, { outcome: 'missed', recipient: callee });
  await postSummary(callee, { outcome: 'answered', durationSeconds: 7, recipient: caller });
  await postSummary(callee, { outcome: 'answered', durationSeconds: 7, recipient: caller });
  assert.equal(await Message.countDocuments({ messageType: 'call' }), 1);
  for (const viewer of [caller, callee]) {
    const recent = await recentFor(viewer);
    assert.equal(recent.conversations.length, 1);
    assert.equal(recent.conversations[0].lastMessage.callSummary.outcome, 'answered');
  }
});

test('a newer call is the preview of an existing DM without duplicating its row', async () => {
  await Message.create({
    sender: caller._id,
    recipient: callee._id,
    messageType: 'direct',
    content: { text: 'Earlier text' },
    createdAt: new Date(Date.now() - 60_000),
  });
  await postSummary(caller, { outcome: 'answered', durationSeconds: 2, recipient: callee });
  for (const viewer of [caller, callee]) {
    const recent = await recentFor(viewer);
    assert.equal(recent.conversations.length, 1);
    assert.equal(recent.conversations[0].messageCount, 2);
    assert.equal(recent.conversations[0].lastMessage.callSummary.outcome, 'answered');
  }
});

test('first-contact video answered and missed calls are discoverable by both sides', async () => {
  await CallSession.updateOne({ callId: CALL_ID }, { $set: { callType: 'video' } });
  await postSummary(callee, { outcome: 'answered', recipient: caller, callType: 'video', durationSeconds: 3 });
  const secondCallId = 'call:video-missed-2';
  // Reuse the fixture's session after the first persisted outcome. The
  // CallSession model intentionally forbids two active participant leases.
  await CallSession.updateOne({ callId: CALL_ID }, { $set: { callId: secondCallId } });
  await postSummary(caller, { outcome: 'missed', recipient: callee, callType: 'video', callId: secondCallId });
  assert.equal(await Message.countDocuments({ messageType: 'call' }), 2);
  for (const viewer of [caller, callee]) {
    const recent = await recentFor(viewer);
    assert.equal(recent.conversations.length, 1);
    assert.equal(recent.conversations[0].messageCount, 2);
    assert.equal(recent.conversations[0].lastMessage.callSummary.callType, 'video');
    assert.equal(recent.conversations[0].lastMessage.callSummary.outcome, 'missed');
  }
});

test('group call history does not activate a direct conversation', async () => {
  await Message.create({
    sender: caller._id,
    chatRoom: new mongoose.Types.ObjectId(),
    messageType: 'call',
    content: { text: 'Group voice call ended' },
    callSummary: { callId: 'group-call-only-1', callType: 'voice', outcome: 'answered', durationSeconds: 4 },
  });
  assert.equal((await recentFor(caller)).conversations.length, 0);
  assert.equal((await recentFor(callee)).conversations.length, 0);
});

test('a persisted DM call event reaches both personal rooms with reciprocal chat IDs', async (t) => {
  const events = [];
  messageController.setIoInstance({
    to(room) {
      return { emit(event, payload) { events.push({ room, event, payload }); } };
    },
  });
  t.after(() => messageController.setIoInstance(null));
  await postSummary(callee, { outcome: 'answered', recipient: caller, durationSeconds: 2 });
  for (const viewer of [caller, callee]) {
    const recent = await recentFor(viewer);
    assert.equal(recent.conversations.length, 1);
    assert.equal(recent.conversations[0].lastMessage.callSummary.outcome, 'answered');
  }
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(item => [item.room, item.payload.chatId]), [
    [`user-${caller._id}`, `direct_${callee._id}`],
    [`user-${callee._id}`, `direct_${caller._id}`],
  ]);
  assert.ok(events.every(item => item.event === 'newMessage'));
  assert.equal(new Set(events.map(item => String(item.payload.message._id))).size, 1);

  await postSummary(caller, { outcome: 'missed', recipient: callee });
  assert.equal(events.length, 2, 'a losing or duplicate report must not emit twice');
});

test('a late "answered" upgrades an already-stored "missed"', async () => {
  await postSummary(caller, { outcome: 'missed', recipient: callee });
  assert.equal((await storedOutcome()).outcome, 'missed');

  // The callee had in fact answered; their report lands afterwards.
  await postSummary(callee, { outcome: 'answered', durationSeconds: 12, recipient: caller });

  const summary = await storedOutcome();
  assert.equal(summary.outcome, 'answered', 'a real answer must win over a ring-timeout missed');
  assert.equal(summary.durationSeconds, 12);
});

test('a late "declined" upgrades a stored "missed" (caller must not see Missed call)', async () => {
  await postSummary(caller, { outcome: 'missed', recipient: callee });
  await postSummary(callee, { outcome: 'declined', recipient: caller });
  assert.equal((await storedOutcome()).outcome, 'declined');
});

test('"missed" never downgrades an answered or declined call', async () => {
  await postSummary(callee, { outcome: 'answered', durationSeconds: 30, recipient: caller });
  await postSummary(caller, { outcome: 'missed', recipient: callee });
  const answered = await storedOutcome();
  assert.equal(answered.outcome, 'answered');
  assert.equal(answered.durationSeconds, 30, 'duration survives the losing report');

  await Message.deleteMany({});
  await postSummary(callee, { outcome: 'declined', recipient: caller });
  await postSummary(caller, { outcome: 'missed', recipient: callee });
  assert.equal((await storedOutcome()).outcome, 'declined');
});

test('"declined" never downgrades an answered call', async () => {
  await postSummary(callee, { outcome: 'answered', durationSeconds: 5, recipient: caller });
  await postSummary(callee, { outcome: 'declined', recipient: caller });
  assert.equal((await storedOutcome()).outcome, 'answered');
});

test('repeated identical reports stay idempotent and keep one history item', async () => {
  await postSummary(caller, { outcome: 'missed', recipient: callee });
  const second = await postSummary(caller, { outcome: 'missed', recipient: callee });
  assert.equal(second.body.data.deduplicated, true);
  assert.equal(await Message.countDocuments({ messageType: 'call' }), 1);
});

test('an upgrade keeps exactly one call item and clears duration for non-answered', async () => {
  await postSummary(callee, { outcome: 'missed', durationSeconds: 9, recipient: caller });
  await postSummary(callee, { outcome: 'declined', recipient: caller });
  assert.equal(await Message.countDocuments({ messageType: 'call' }), 1);
  const summary = await storedOutcome();
  assert.equal(summary.outcome, 'declined');
  assert.equal(summary.durationSeconds, 0, 'declined/missed must not carry a duration');
});

// Regression: a call summary is stored as messageType 'call', but the DM and
// group history queries filtered on 'direct'/'group'. The item therefore showed
// up live over the socket and then VANISHED as soon as the chat was reopened.
test('call summaries are returned by DM history, not just over the socket', async () => {
  await postSummary(caller, { outcome: 'missed', recipient: callee });

  // Mirror the history filter used by getDirectMessages.
  const historyFilter = {
    messageType: { $in: ['direct', 'call'] },
    deletedForEveryone: { $ne: true },
    $or: [
      { sender: caller._id, recipient: callee._id },
      { sender: callee._id, recipient: caller._id },
    ],
  };
  const history = await Message.find(historyFilter).lean();
  assert.equal(history.length, 1, 'the missed call must survive a chat reopen');
  assert.equal(history[0].callSummary.outcome, 'missed');

  // The old filter is what dropped it — proves the regression is real.
  const legacy = await Message.find({ ...historyFilter, messageType: 'direct' }).lean();
  assert.equal(legacy.length, 0);
});

// Regression: including call summaries in DM history made them permanent
// "unread" anchors — markMessagesAsRead only covers direct/group, so the
// "New messages" divider pinned itself above an old call and reading never
// cleared it. Unread must mean an unread MESSAGE.
test('a call summary never anchors the "New messages" divider', async () => {
  const {
    createMongooseMessageHistoryRepository,
    resolveMessageHistoryWindow,
  } = require('../services/messageHistoryWindowService');

  // An unread call summary from the other side, and nothing else unread.
  await postSummary(callee, { outcome: 'missed', recipient: caller });

  const baseFilter = {
    messageType: { $in: ['direct', 'call'] },
    deletedForEveryone: { $ne: true },
    $or: [
      { sender: caller._id, recipient: callee._id },
      { sender: callee._id, recipient: caller._id },
    ],
  };
  const repository = createMongooseMessageHistoryRepository({
    Message, baseFilter, viewerId: caller._id,
  });

  assert.equal(await repository.countUnread(), 0, 'a call is not an unread message');
  assert.equal(await repository.findFirstUnread(), null, 'it must not anchor the divider');

  const window = await resolveMessageHistoryWindow({ repository, limit: 20 });
  assert.notEqual(window.initialPosition.mode, 'first_unread');
  // ...but it is still part of the history the chat renders.
  assert.equal(window.messageIds.length, 1);
});
