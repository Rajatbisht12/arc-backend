const assert = require('node:assert/strict');
const test = require('node:test');
const TeamRecruitment = require('../models/TeamRecruitment');
const PlayerProfile = require('../models/PlayerProfile');
const Tournament = require('../models/Tournament');
const Scrim = require('../models/Scrim');
const User = require('../models/User');
const UsernameRegistry = require('../models/UsernameRegistry');
const controller = require('./publicSocialSeoController');

const team = () => ({
  username: 'AlphaTeam', userType: 'team', isActive: true, moderationStatus: 'active',
  privacySettings: { profileVisibility: 'public' },
  profile: { displayName: 'Alpha', avatar: 'https://media.squadhunt.com/gaming-social/avatars/alpha.jpg' }
});
const response = () => ({
  headers: {}, setHeader(key, value) { this.headers[key] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; }
});
const stubFindOne = (Model, initial) => {
  const previous = Model.findOne;
  let record = initial;
  Model.findOne = () => {
    const query = { select() { return query; }, populate() { return query; }, async lean() { return record; } };
    return query;
  };
  return { update: value => { record = value; }, restore: () => { Model.findOne = previous; } };
};

test('recruitment SEO response is minimal and withdrawn when owner becomes private', async () => {
  const record = {
    recruitmentCode: 'REC-ABC', status: 'active', isActive: true, expiresAt: new Date('2030-01-01'),
    role: 'Player', game: 'BGMI', requirements: { additionalRequirements: 'Practice daily' }, team: team(),
    applicants: [{ user: 'private-id' }]
  };
  const stub = stubFindOne(TeamRecruitment, record);
  try {
    const visible = response();
    await controller.getPublicRecruitmentSeo({ params: { code: 'rec-abc' } }, visible);
    assert.equal(visible.statusCode, 200);
    assert.equal(visible.body.data.recruitment.code, 'REC-ABC');
    assert.equal(JSON.stringify(visible.body).includes('private-id'), false);
    stub.update({ ...record, team: { ...team(), privacySettings: { profileVisibility: 'private' } } });
    const hidden = response();
    await controller.getPublicRecruitmentSeo({ params: { code: 'REC-ABC' } }, hidden);
    assert.equal(hidden.statusCode, 404);
    assert.equal(hidden.headers['Cache-Control'], 'private, no-store, max-age=0');
  } finally { stub.restore(); }
});

test('player profile, tournament, and scrim SEO reject restricted owner or cancelled state', async () => {
  const cases = [
    [PlayerProfile, controller.getPublicPlayerProfileSeo, { profileCode: 'LFT-ABC', isActive: true, status: 'active', player: { ...team(), userType: 'player' } }, 'LFT-ABC'],
    [Tournament, controller.getPublicTournamentSeo, { tournamentCode: 'TRN-ABC', status: 'Upcoming', host: team() }, 'TRN-ABC'],
    [Scrim, controller.getPublicScrimSeo, { scrimCode: 'SCR-ABC', status: 'Open', host: team() }, 'SCR-ABC'],
  ];
  for (const [Model, handler, record, code] of cases) {
    const stub = stubFindOne(Model, record);
    try {
      const visible = response();
      await handler({ params: { code } }, visible);
      assert.equal(visible.statusCode, 200);
      const hiddenOwner = { ...record, [Model === PlayerProfile ? 'player' : 'host']: {
        ...team(), moderationStatus: 'suspended', userType: Model === PlayerProfile ? 'player' : 'team'
      } };
      stub.update(hiddenOwner);
      const hidden = response();
      await handler({ params: { code } }, hidden);
      assert.equal(hidden.statusCode, 404);
    } finally { stub.restore(); }
  }
});

test('legacy tournament alias resolves to the same public canonical code and rechecks host', async () => {
  const originalUserFind = User.findOne;
  const originalRegistryFind = UsernameRegistry.findOne;
  const tournament = stubFindOne(Tournament, {
    tournamentCode: 'TRN-ABC', name: 'Summer Finals', status: 'Upcoming',
    banner: 'https://media.squadhunt.com/gaming-social/tournaments/a.jpg'
  });
  let host = { ...team(), _id: '507f1f77bcf86cd799439011' };
  UsernameRegistry.findOne = () => ({ select: () => ({ lean: async () => ({ kind: 'user', ownerId: host._id }) }) });
  User.findOne = () => ({ select: () => ({ lean: async () => host }) });
  try {
    const visible = response();
    await controller.getPublicTournamentByNameSeo({ params: { name: 'Summer Finals', hostUsername: 'AlphaTeam' } }, visible);
    assert.equal(visible.statusCode, 200);
    assert.equal(visible.body.data.tournament.code, 'TRN-ABC');
    host = { ...host, privacySettings: { profileVisibility: 'private' } };
    const hidden = response();
    await controller.getPublicTournamentByNameSeo({ params: { name: 'Summer Finals', hostUsername: 'AlphaTeam' } }, hidden);
    assert.equal(hidden.statusCode, 404);
  } finally {
    User.findOne = originalUserFind;
    UsernameRegistry.findOne = originalRegistryFind;
    tournament.restore();
  }
});
