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
  await Promise.all([Message.deleteMany({}), User.deleteMany({}), ChatRoom.deleteMany({}), CallSession.deleteMany({})]);
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
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const postSummary = async (user, { outcome, durationSeconds = 0, recipient, callId = CALL_ID }) => {
  const res = makeRes();
  await messageController.createCallSummary({
    user,
    body: { callId, callType: 'voice', outcome, durationSeconds, participantCount: 1, recipientId: String(recipient._id) },
  }, res);
  return res;
};

const storedOutcome = async (callId = CALL_ID) => {
  const message = await Message.findOne({ messageType: 'call', 'callSummary.callId': callId }).lean();
  return message?.callSummary;
};

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
