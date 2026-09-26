const assert = require('node:assert/strict');
const { emitTerminalCallSession } = require('./callSessionService');

const previousIo = global._arcSocketIO;
const emissions = [];
global._arcSocketIO = {
  to(room) {
    return {
      emit(event, payload) {
        emissions.push({ room, event, payload });
      }
    };
  }
};

try {
  const session = {
    _id: '507f1f77bcf86cd799439099',
    callId: 'call-terminal-123',
    nativeCallId: 'native-terminal-123',
    caller: '507f1f77bcf86cd799439011',
    callee: '507f191e810c19729de860ea',
    callType: 'video',
    source: 'socket',
    status: 'missed',
    endReason: 'timeout'
  };

  emitTerminalCallSession(session, 'timeout');

  for (const participantId of [session.caller, session.callee]) {
    const roomEvents = emissions.filter(({ room }) => room === `user-${participantId}`);
    assert.deepEqual(roomEvents.map(({ event }) => event), ['call-end', 'call-session-updated']);
    assert.deepEqual(roomEvents[0].payload, {
      callId: session.callId,
      nativeCallId: session.nativeCallId,
      fromUserId: 'server',
      reason: 'timeout'
    });
    assert.equal(roomEvents[1].payload.status, 'missed');
    assert.equal(roomEvents[1].payload.callId, session.callId);
  }

  emissions.length = 0;
  emitTerminalCallSession({ ...session, status: 'ended', endReason: 'max_duration' });
  assert.equal(emissions.filter(({ event }) => event === 'call-end').length, 2);
  assert(emissions
    .filter(({ event }) => event === 'call-end')
    .every(({ payload }) => payload.reason === 'max_duration'));

  emissions.length = 0;
  emitTerminalCallSession({
    ...session,
    source: 'random_connect',
    randomRoomId: 'owned-random-room',
    status: 'ended',
    endReason: 'user_left'
  });
  assert.deepEqual(
    [...new Set(emissions.map(({ room }) => room))],
    ['random-room-owned-random-room'],
    'Random Connect terminal state must not fan out to account-wide user rooms'
  );
  assert.deepEqual(emissions.map(({ event }) => event), ['call-end', 'call-session-updated']);

  console.log('Call-session realtime terminal event tests passed');
} finally {
  if (previousIo === undefined) delete global._arcSocketIO;
  else global._arcSocketIO = previousIo;
}
