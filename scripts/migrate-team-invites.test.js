const assert = require('node:assert/strict');
const { planModelMigration } = require('./migrate-team-invites');

const TEAM_ID = '507f1f77bcf86cd799439011';
const PLAYER_ID = '507f1f77bcf86cd799439012';

async function run() {
  const pending = [
    {
      _id: '507f1f77bcf86cd799439021', team: TEAM_ID, player: PLAYER_ID, game: 'BGMI',
      status: 'pending', createdAt: new Date('2026-07-08T08:00:00.000Z'), expiresAt: new Date('2026-07-15T08:00:00.000Z')
    },
    {
      _id: '507f1f77bcf86cd799439022', team: TEAM_ID, player: PLAYER_ID, game: 'BGMI',
      status: 'pending', createdAt: new Date('2026-07-08T09:00:00.000Z'), expiresAt: new Date('2026-07-15T09:00:00.000Z')
    },
    {
      _id: '507f1f77bcf86cd799439023', team: TEAM_ID, player: '507f1f77bcf86cd799439088', game: 'BGMI',
      status: 'pending', createdAt: new Date('2026-07-01T08:00:00.000Z'), expiresAt: new Date('2026-07-08T08:00:00.000Z')
    }
  ];
  const terminal = [{
    _id: '507f1f77bcf86cd799439024', status: 'accepted', pendingKey: 'stale-key'
  }];
  const Model = {
    modelName: 'FakeRosterInvite',
    find(filter) {
      const value = filter.status === 'pending' ? pending : terminal;
      return {
        select() { return this; },
        sort() { return this; },
        async lean() { return value; }
      };
    }
  };
  const plan = await planModelMigration('roster', Model, new Date('2026-07-09T10:00:00.000Z'));
  assert.equal(plan.expired.length, 1);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.activeBackfills.length, 1);
  assert.equal(plan.terminalWithKeys.length, 1);
  console.log('Team invitation migration tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
