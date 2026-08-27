// Authoritative, real-DB proof that a FREE (free-to-free) Random Connect session
// is terminated by the BACKEND at the duration limit — independent of any client
// countdown. This is the Phase-21 "client bypass" guarantee: even if the client
// timer is removed/frozen, the server sweep (syncExpiredSessions, run every 3s by
// the matchmaking tick) ends the session and emits `random-session-ended` to both
// participants. Premium/unlimited sessions must never be swept.
const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const RandomConnection = require('../models/RandomConnection');
const { markSessionReady, syncExpiredSessions } = require('./randomConnectController');

let mongod;
test.before(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); });
test.after(async () => { await mongoose.disconnect(); await mongod.stop(); });
test.beforeEach(async () => { await RandomConnection.deleteMany({}); });

const oid = () => new mongoose.Types.ObjectId();

// Mock socket.io server that records every emit (room + user targets).
const makeIo = () => {
  const emissions = [];
  return {
    emissions,
    to: (target) => ({ emit: (event, data) => emissions.push({ target, event, data }) })
  };
};

const makeConnection = async ({ durationLimitSeconds }) => {
  const u1 = oid();
  const u2 = oid();
  const conn = await RandomConnection.create({
    roomId: `room-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    status: 'active',
    durationLimitSeconds,
    startTime: new Date(),
    createdBy: u1,
    participants: [
      { userId: u1, username: 'alpha' },
      { userId: u2, username: 'bravo' }
    ]
  });
  return { conn, u1, u2 };
};

test('FREE session: both-ready starts an authoritative expiry; the sweep ends it and notifies both', async () => {
  const io = makeIo();
  const { conn, u1, u2 } = await makeConnection({ durationLimitSeconds: 180 });

  // Both participants join/ready → server arms the authoritative timer.
  await markSessionReady(conn.roomId, u1, io);
  let mid = await RandomConnection.findOne({ roomId: conn.roomId });
  assert.equal(mid.expiresAt, undefined, 'timer not armed until BOTH are ready');

  await markSessionReady(conn.roomId, u2, io);
  const armed = await RandomConnection.findOne({ roomId: conn.roomId });
  assert.ok(armed.expiresAt, 'expiresAt is set once both are ready');
  assert.ok(armed.timerStartedAt, 'timerStartedAt is set');
  // ~180s window from server time (authoritative, not a device clock).
  const windowMs = new Date(armed.expiresAt).getTime() - new Date(armed.timerStartedAt).getTime();
  assert.ok(Math.abs(windowMs - 180000) < 2000, `expiry window ≈180s (got ${windowMs}ms)`);

  // Simulate the client timer being bypassed/frozen: the connection is still
  // "active" past its expiry. The server sweep must end it regardless.
  await RandomConnection.updateOne({ roomId: conn.roomId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await syncExpiredSessions(io);

  const ended = await RandomConnection.findOne({ roomId: conn.roomId });
  assert.equal(ended.status, 'ended', 'backend force-ends the expired FREE session');
  assert.equal(ended.endReason, 'timeout', 'end reason distinguishes the free-duration limit');

  const endedEvents = io.emissions.filter(e => e.event === 'random-session-ended');
  assert.ok(endedEvents.length > 0, 'random-session-ended emitted');
  assert.equal(endedEvents[0].data.reason, 'timeout');
  // Emitted to the room AND to each participant channel (so a client that left
  // the room still hears it on its user channel).
  const targets = new Set(io.emissions.filter(e => e.event === 'random-session-ended').map(e => e.target));
  assert.ok(targets.has(`random-room-${conn.roomId}`), 'notifies the room');
  assert.ok(targets.has(`user-${u1}`) && targets.has(`user-${u2}`), 'notifies both participants directly');
});

test('sweep is idempotent — ending an already-ended session does not re-emit or throw', async () => {
  const io = makeIo();
  const { conn, u1, u2 } = await makeConnection({ durationLimitSeconds: 180 });
  await markSessionReady(conn.roomId, u1, io);
  await markSessionReady(conn.roomId, u2, io);
  await RandomConnection.updateOne({ roomId: conn.roomId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await syncExpiredSessions(io);
  const firstEndCount = io.emissions.filter(e => e.event === 'random-session-ended').length;
  await syncExpiredSessions(io); // second sweep — session already ended
  const secondEndCount = io.emissions.filter(e => e.event === 'random-session-ended').length;
  assert.equal(firstEndCount, secondEndCount, 'no duplicate end event on repeat sweep');
});

test('PREMIUM/unlimited session: no expiry is armed and the sweep never ends it', async () => {
  const io = makeIo();
  const { conn, u1, u2 } = await makeConnection({ durationLimitSeconds: null });
  await markSessionReady(conn.roomId, u1, io);
  await markSessionReady(conn.roomId, u2, io);
  const armed = await RandomConnection.findOne({ roomId: conn.roomId });
  assert.equal(armed.expiresAt, undefined, 'no expiresAt for an unlimited session');

  await syncExpiredSessions(io);
  const still = await RandomConnection.findOne({ roomId: conn.roomId });
  assert.equal(still.status, 'active', 'premium/unlimited session is never force-ended');
  assert.equal(io.emissions.filter(e => e.event === 'random-session-ended').length, 0, 'no end event for premium');
});
