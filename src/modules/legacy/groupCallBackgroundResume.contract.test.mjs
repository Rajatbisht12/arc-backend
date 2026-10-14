import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const socket = await readFile(new URL('./legacy.socket.ts', import.meta.url), 'utf8');

test('transport disconnect does not immediately remove a group participant', () => {
  const disconnect = socket.slice(socket.indexOf('socket.on("disconnect", () => {'));
  assert.match(disconnect, /socket\.data\?\.groupCallChats\?\.\[callId\]/);
  assert.match(disconnect, /pendingGroupDisconnects\.set\(groupDisconnectKey\(callId, userIdStr\), timer\)/);
  assert.match(disconnect, /setTimeout\(\(\) => \{[\s\S]*?fetchSockets\(\)/);
  assert.match(disconnect, /if \(!stillInCall && activeCalls\.get\(callId\) === session/);
});

test('authenticated rejoin cancels the pending removal and reuses the participant slot', () => {
  const join = socket.slice(socket.indexOf('socket.on("group-call-join"'), socket.indexOf('socket.on("group-call-signal"'));
  assert.match(join, /isAuthorizedLegacyChatMember\(session\.chatRoomId, userIdStr\)/);
  assert.match(join, /const resumed = cancelGroupDisconnect\(data\.callId, userIdStr\)/);
  assert.match(join, /const wasParticipant = session\.participants\.has\(userIdStr\)/);
  assert.match(join, /session\.participants\.add\(userIdStr\)/);
  assert.match(join, /session\.joinedUserIds\.add\(userIdStr\)/);
  assert.match(join, /if \(!wasParticipant \|\| resumed\)/);
});

test('explicit leave remains immediate and finalization cancels stale timers', () => {
  assert.match(socket, /socket\.on\("group-call-leave", \(data:[\s\S]*?handleGroupCallLeave\(io, data\.callId, userIdStr, socket\)/);
  const finalize = socket.slice(socket.indexOf('const finalizeGroupCall'), socket.indexOf('export const registerLegacySocketHandlers'));
  assert.match(finalize, /cancelGroupDisconnect\(callId, participantId\)/);
});
