const assert = require('node:assert/strict');
const CallSession = require('../models/CallSession');
const { getActiveCallSessionForUser } = require('./callSessionService');

const originalFind = CallSession.find;
const originalFindOne = CallSession.findOne;
const queries = [];
const activeSession = { callId: 'call-active-123', status: 'accepted' };

CallSession.find = (query) => {
  queries.push(query);
  return {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    async lean() { return []; }
  };
};
CallSession.findOne = (query) => {
  queries.push(query);
  return {
    sort() { return this; },
    async lean() { return activeSession; }
  };
};

(async () => {
  const userId = '507f1f77bcf86cd799439011';
  const session = await getActiveCallSessionForUser(userId);
  assert.equal(session, activeSession);
  const filter = queries[1];
  assert.equal(filter.participantLeaseActive, true);
  assert.deepEqual(filter.source, { $ne: 'random_connect' });
  assert.deepEqual(filter.$and[0].$or, [{ caller: userId }, { callee: userId }]);
  assert.deepEqual(filter.$and[1].$or.map(({ status }) => status), ['ringing', 'accepted']);
  assert.equal(await getActiveCallSessionForUser(''), null);
  assert.equal(queries.length, 2);
  console.log('Call-session own-active recovery query tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  CallSession.find = originalFind;
  CallSession.findOne = originalFindOne;
});
