const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  findGamingStatIndexes,
  normalizeGamingStatPayload,
  resolveGamingStatsUserId
} = require('./gamingStatsPolicy');

test('Gaming Stats resolves the canonical lean-authenticated user _id', () => {
  assert.equal(resolveGamingStatsUserId({ _id: 'canonical-user-id' }), 'canonical-user-id');
  assert.equal(resolveGamingStatsUserId({ id: 'legacy-user-id' }), 'legacy-user-id');
  assert.equal(resolveGamingStatsUserId({}), null);
});

test('all Gaming Stats handlers use canonical authenticated identity', () => {
  const controller = readFileSync(path.join(__dirname, '../controllers/userController.js'), 'utf8');
  const gamingBlock = controller.slice(
    controller.indexOf('// Gaming Stats CRUD operations'),
    controller.indexOf('// Create team')
  );
  assert.doesNotMatch(gamingBlock, /req\.user\.id/);
  assert.equal((gamingBlock.match(/resolveGamingStatsUserId\(req\.user\)/g) || []).length, 6);
});

test('BGMI, Free Fire Max, Valorant, and COD Mobile payloads retain independent game contracts', () => {
  const payloads = [
    { game: 'BGMI', characterId: '512345678', inGameName: 'Alpha', idLevel: '65', role: 'IGL', fdRatio: '4.2', currentTier: 'Ace' },
    { game: 'Free Fire Max', inGameName: 'Bravo', uid: 'ff-1', level: '70', rank: 'Heroic', role: 'Rusher', kd: '3.5', matchesPlayed: '200' },
    { game: 'Valorant', inGameName: 'Charlie', tag: '#1234', rank: 'Gold 2', role: 'Controller', rr: '52' },
    { game: 'Call of Duty Mobile', inGameName: 'Delta', uid: 'cod-1', level: '100', rank: 'Legendary', role: 'Assault', kd: '2.1', wins: '300' }
  ];

  const normalized = payloads.map((payload) => normalizeGamingStatPayload(payload));
  normalized.forEach((result) => assert.equal(result.error, undefined));
  assert.deepEqual(normalized.map((result) => result.value.game), [
    'BGMI', 'Free Fire Max', 'Valorant', 'Call of Duty Mobile'
  ]);
  assert.equal(normalized[0].value.idLevel, 65);
  assert.equal(normalized[1].value.matchesPlayed, 200);
  assert.equal(normalized[2].value.rr, 52);
  assert.equal(normalized[3].value.wins, 300);
});

test('Gaming Stats returns field-specific validation errors', () => {
  const missing = normalizeGamingStatPayload({ game: 'Valorant', inGameName: 'Alpha' });
  assert.equal(missing.error.field, 'tag');

  const invalidNumber = normalizeGamingStatPayload({
    game: 'BGMI', characterId: '1', inGameName: 'Alpha', idLevel: 'not-a-number',
    role: 'IGL', fdRatio: 2, currentTier: 'Ace'
  });
  assert.equal(invalidNumber.error.field, 'idLevel');
});

test('game lookup identifies only same-game duplicates', () => {
  const stats = [{ game: 'BGMI' }, { game: 'Valorant' }, { game: 'BGMI' }];
  assert.deepEqual(findGamingStatIndexes(stats, 'BGMI'), [0, 2]);
  assert.deepEqual(findGamingStatIndexes(stats, 'Valorant'), [1]);
  assert.deepEqual(findGamingStatIndexes(stats, 'Free Fire Max'), []);
});
