// Contract: group calls have a deterministic, SERVER-decided outcome and a
// terminal event that actually reaches everyone who was ringing.
//
// Two reported bugs:
//  1. Group history "mostly showed only Answered" — nothing on the server wrote
//     the record; it depended on whichever client happened to report, and a
//     caller on Mobile posted nothing at all, so the missed case never appeared.
//  2. Recipients kept seeing the incoming-call UI after the caller hung up.
//     `group-call-ended` was broadcast ONLY to `chat-<roomId>`, but members are
//     rung on `user-<id>` and only join the chat room while that conversation is
//     open — so most ringing clients never received the terminal event.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const socket = await readFile(new URL('./legacy.socket.ts', import.meta.url), 'utf8');

test('the terminal event reaches every rung member, not just the open chat', () => {
  const finalize = socket.slice(
    socket.indexOf('const finalizeGroupCall'),
    socket.indexOf('const handleGroupCallLeave'),
  );
  assert.match(finalize, /io\.to\(`chat-\$\{session\.chatRoomId\}`\)\.emit\("group-call-ended", payload\)/);
  // The fix: personal rooms, which also covers a user's other tabs/devices.
  assert.match(finalize, /session\.memberIds\.forEach\(\(id\) => io\.to\(`user-\$\{id\}`\)\.emit\("group-call-ended", payload\)\)/);
});

test('the members who were rung are remembered for that broadcast', () => {
  assert.match(socket, /ringingSession\.memberIds = roomInfo\.memberIds;/);
  assert.match(socket, /memberIds: string\[\];/);
});

test('ONE joiner makes the call answered, and it stays answered', () => {
  assert.match(socket, /if \(userIdStr !== session\.initiatorId && !session\.answered\) \{\s*session\.answered = true;/);
  // Outcome is derived from that latch — never from duration or a client report.
  assert.match(socket, /const outcome: "answered" \| "missed" = session\.answered \? "answered" : "missed";/);
});

test('a non-initiator leaving does NOT end the call for everyone', () => {
  const leave = socket.slice(socket.indexOf('const handleGroupCallLeave'), socket.indexOf('export const registerLegacySocketHandlers'));
  // Only the initiator hanging up, or the room emptying, finalizes.
  assert.match(leave, /if \(userId === session\.initiatorId \|\| session\.participants\.size === 0\) \{\s*finalizeGroupCall\(io, callId\);/);
  // The old unconditional "participants.size === 0 -> chat-room emit" is gone.
  assert.doesNotMatch(leave, /io\.to\(`chat-\$\{session\.chatRoomId\}`\)\.emit\("group-call-ended"/);
});

test('finalization is idempotent by callId', () => {
  const finalize = socket.slice(socket.indexOf('const finalizeGroupCall'), socket.indexOf('const handleGroupCallLeave'));
  assert.match(finalize, /if \(!session \|\| session\.finalized\) return;/);
  assert.match(finalize, /session\.finalized = true;/);
  assert.match(finalize, /activeCalls\.delete\(callId\);/);
  // ...and the message write is guarded too, for a cross-process race.
  const writer = socket.slice(socket.indexOf('const writeGroupCallSummary'), socket.indexOf('const finalizeGroupCall'));
  assert.match(writer, /const existing = await Message\.findOne\(\{ messageType: "call", "callSummary\.callId": session\.callId \}\)/);
  assert.match(writer, /if \(existing\) return;/);
  assert.match(writer, /error\?\.code !== 11000/);
});

test('exactly one shared group message, in the group thread', () => {
  const writer = socket.slice(socket.indexOf('const writeGroupCallSummary'), socket.indexOf('const finalizeGroupCall'));
  assert.match(writer, /chatRoom: session\.chatRoomId/);
  assert.match(writer, /messageType: "call"/);
  // Never "declined": one member declining is not a group outcome.
  assert.doesNotMatch(writer, /"declined"/);
  // Delivered live to the thread the same way the DM path does it.
  assert.match(writer, /emit\("newMessage", \{\s*chatId: session\.chatRoomId/);
});

test('duration is only recorded for an answered call, measured from the join', () => {
  assert.match(socket, /session\.answeredAt = new Date\(\);/);
  assert.match(socket, /session\.answered && session\.answeredAt\s*\?\s*Math\.floor\(\(Date\.now\(\) - session\.answeredAt\.getTime\(\)\) \/ 1000\)/);
  assert.match(socket, /durationSeconds: outcome === "answered" \? Math\.max\(0, Math\.min\(86400, durationSeconds\)\) : 0/);
});

test('call type is preserved for the history icon', () => {
  assert.match(socket, /callType: session\.callType/);
  assert.match(socket, /session\.callType === "video" \? "Video" : "Voice"/);
});

test('an abandoned call finalizes on a server timeout', () => {
  // Caller loses the network instead of hanging up: nothing client-side would
  // ever stop the ringing.
  assert.match(socket, /const GROUP_CALL_RING_TIMEOUT_MS = 30_000;/);
  assert.match(socket, /ringingSession\.ringTimer = setTimeout\(/);
  assert.match(socket, /if \(pending && !pending\.answered\) finalizeGroupCall\(io, callId\);/);
  // ...and answering disarms it.
  assert.match(socket, /session\.answered = true;[\s\S]{0,200}?clearTimeout\(session\.ringTimer\)/);
});

// ── Participant count ────────────────────────────────────────────────────────
// Reported: a 3-member group showed "Missed call · 3 participants". The count
// was written from `session.memberIds` — the group's MEMBER LIST — so it
// reported group size, not who actually joined, and it printed even when nobody
// joined at all.

test('participants are the users who actually JOINED, never the member list', () => {
  assert.match(socket, /joinedUserIds: Set<string>;/);
  // Seeded with the initiator (they are in the call from the moment it starts).
  assert.match(socket, /joinedUserIds: new Set\(\[userIdStr\]\)/);
  // Every joiner is recorded...
  assert.match(socket, /session\.joinedUserIds\.add\(userIdStr\);/);
  // ...and the written count comes from that set, not memberIds.
  assert.match(socket, /participantCount: outcome === "answered" \? session\.joinedUserIds\.size : 0/);
  assert.doesNotMatch(socket, /participantCount: Math\.max\(1, session\.memberIds\.length/);
});

test('a rejoin cannot double-count the same user', () => {
  // A Set is the whole mechanism: add() of an existing id is a no-op.
  const decl = socket.slice(socket.indexOf('joinedUserIds: Set<string>'), socket.indexOf('answered: boolean;'));
  assert.match(decl, /Set<string>/);
  assert.match(socket, /session\.joinedUserIds\.add\(/);
});

test('a missed call records ZERO participants, so nothing is rendered', () => {
  assert.match(socket, /outcome === "answered" \? session\.joinedUserIds\.size : 0/);
});

test('users who were only rung are tracked separately from participants', () => {
  // memberIds still exists — it is the ring/terminal-event list — but it must
  // never be the participant count.
  assert.match(socket, /session\.memberIds\.forEach\(\(id\) => io\.to\(`user-\$\{id\}`\)/);
  assert.match(socket, /ringingSession\.memberIds = roomInfo\.memberIds;/);
});
