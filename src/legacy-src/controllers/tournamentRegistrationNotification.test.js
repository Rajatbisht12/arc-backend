const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  _private: { enqueueRegistrationOpenedNotifications }
} = require('./tournamentController');

const source = fs.readFileSync(path.join(__dirname, 'tournamentController.js'), 'utf8');
const functionSource = (name, nextName) => {
  const start = source.indexOf(`const ${name} = async`);
  const end = source.indexOf(`const ${nextName} = async`, start + 1);
  assert(start >= 0, `Missing ${name}`);
  assert(end > start, `Missing boundary after ${name}`);
  return source.slice(start, end);
};

const updateSource = functionSource('updateTournament', 'joinTournament');
const openSource = functionSource('openRegistration', 'startTournament');

// Both Web-accepted commands must use the same durable post-commit producer.
assert(updateSource.includes('await enqueueRegistrationOpenedNotifications(updatedTournament)'));
assert(openSource.includes('await enqueueRegistrationOpenedNotifications(openedTournament)'));
// Retrying after a committed state change must recover the queue submission.
assert(openSource.includes('await enqueueRegistrationOpenedNotifications(tournament)'));

const main = async () => {
  const users = Array.from({ length: 501 }, (_, index) => ({ _id: `user-${index + 1}` }));
  const calls = [];
  async function* activeUsers() {
    for (const user of users) yield user;
  }

  await enqueueRegistrationOpenedNotifications(
    {
      _id: '507f1f77bcf86cd799439010',
      name: 'Contract Cup',
      registrationStartDate: new Date('2026-07-09T08:00:00.000Z')
    },
    {
      findActiveUsers: activeUsers,
      enqueue: async (...args) => calls.push(args)
    }
  );

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0][0].length, 500);
  assert.strictEqual(calls[1][0].length, 1);
  assert.strictEqual(calls[0][1], 'Registration Opened');
  assert.strictEqual(calls[0][3], 'tournament');
  assert.strictEqual(calls[0][4].customData.action, 'registration_opened');
  assert.strictEqual(calls[0][5], calls[1][5]);
  assert.strictEqual(
    calls[0][5],
    'tournament-registration-open:507f1f77bcf86cd799439010:2026-07-09T08:00:00.000Z'
  );

  console.log('Tournament registration notification parity tests passed');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
