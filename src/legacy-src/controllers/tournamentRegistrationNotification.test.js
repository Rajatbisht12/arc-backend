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
      findRelevantTeams: async () => [],
      enqueue: async (...args) => calls.push(args)
    }
  );

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0][0].length, 500);
  assert.strictEqual(calls[1][0].length, 1);
  assert.strictEqual(calls[0][1], 'Registration Opened');
  assert.strictEqual(calls[0][3], 'tournament');
  assert.strictEqual(calls[0][4].customData.action, 'registration_opened');
  assert.strictEqual(calls[0][4].customData.pushOptions.priority, 'normal');
  assert.strictEqual(calls[0][5], calls[1][5]);
  assert.strictEqual(
    calls[0][5],
    'tournament-registration-open:507f1f77bcf86cd799439010:2026-07-09T08:00:00.000Z'
  );

  const prioritizedCalls = [];
  async function* mixedActiveUsers() {
    yield { _id: 'premium-relevant-team' };
    yield { _id: 'standard-user' };
  }
  await enqueueRegistrationOpenedNotifications(
    {
      _id: '507f1f77bcf86cd799439012',
      name: 'Squad Contract Cup',
      game: 'BGMI',
      format: 'Squad',
      registrationStartDate: new Date('2026-07-10T08:00:00.000Z')
    },
    {
      findActiveUsers: mixedActiveUsers,
      findRelevantTeams: async () => [
        { _id: 'premium-relevant-team' },
        { _id: 'free-relevant-team' }
      ],
      resolveTeamEntitlement: async ({ userId }) => ({
        prioritySquadTournamentNotifications: userId === 'premium-relevant-team'
      }),
      enqueue: async (...args) => prioritizedCalls.push(args)
    }
  );

  assert.strictEqual(prioritizedCalls.length, 2);
  assert.deepStrictEqual(prioritizedCalls[0][0], ['premium-relevant-team']);
  assert.strictEqual(prioritizedCalls[0][4].customData.priorityTier, 'team_premium');
  assert.strictEqual(prioritizedCalls[0][4].customData.pushOptions.priority, 'high');
  assert.match(prioritizedCalls[0][5], /team-premium-priority$/);
  assert.deepStrictEqual(prioritizedCalls[1][0], ['standard-user']);
  assert.strictEqual(prioritizedCalls[1][4].customData.pushOptions.priority, 'normal');
  assert.equal(
    prioritizedCalls.flatMap((call) => call[0]).filter((id) => id === 'premium-relevant-team').length,
    1,
    'priority recipient must not receive the normal duplicate'
  );

  const nonSquadCalls = [];
  let nonSquadLookupCount = 0;
  async function* soloActiveUsers() { yield { _id: 'premium-relevant-team' }; }
  await enqueueRegistrationOpenedNotifications(
    {
      _id: '507f1f77bcf86cd799439013',
      name: 'Solo Contract Cup',
      game: 'BGMI',
      format: 'Solo',
      registrationStartDate: new Date('2026-07-11T08:00:00.000Z')
    },
    {
      findActiveUsers: soloActiveUsers,
      findRelevantTeams: async () => { nonSquadLookupCount += 1; return []; },
      enqueue: async (...args) => nonSquadCalls.push(args)
    }
  );
  assert.strictEqual(nonSquadLookupCount, 0, 'non-Squad tournaments must not use the priority matcher');
  assert.strictEqual(nonSquadCalls[0][4].customData.pushOptions.priority, 'normal');

  console.log('Tournament registration notification priority and parity tests passed');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
