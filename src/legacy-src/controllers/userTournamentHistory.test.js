const assert = require('assert');
const mongoose = require('mongoose');

const User = require('../models/User');
const Tournament = require('../models/Tournament');
const userController = require('./userController');

const queryResult = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  lean() { return Promise.resolve(value); },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

(async () => {
  const originals = {
    userFindOne: User.findOne,
    userFind: User.find,
    tournamentFind: Tournament.find
  };

  const targetId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const activeHostId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
  const inactiveTeamId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');
  const validTournamentId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439021');
  const orphanTournamentId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');
  const inactiveTeamTournamentId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439023');
  const now = Date.now();

  const validTournament = {
    _id: validTournamentId,
    name: 'Completed Cup',
    game: 'BGMI',
    format: 'Solo',
    status: 'Ongoing',
    host: { _id: activeHostId, username: 'active_host' },
    registrationStartDate: new Date(now - 50_000),
    registrationEndDate: new Date(now - 40_000),
    tournamentStartDate: new Date(now - 30_000),
    tournamentEndDate: new Date(now - 20_000),
    groupResults: []
  };
  const orphanTournament = {
    ...validTournament,
    _id: orphanTournamentId,
    name: 'Orphan Cup',
    host: null
  };
  const inactiveTeamTournament = {
    ...validTournament,
    _id: inactiveTeamTournamentId,
    name: 'Inactive Team Cup'
  };

  const targetUser = {
    _id: targetId,
    username: 'history_player',
    userType: 'player',
    isActive: true,
    blockedUsers: [],
    privacySettings: { profileVisibility: 'public' },
    playerInfo: {
      tournamentHistory: [
        {
          tournamentId: validTournamentId,
          teamId: targetId,
          game: 'BGMI',
          status: 'Ongoing',
          tournamentStartDate: validTournament.tournamentStartDate
        },
        {
          tournamentId: orphanTournamentId,
          teamId: targetId,
          game: 'BGMI',
          status: 'Completed',
          tournamentStartDate: validTournament.tournamentStartDate
        },
        {
          tournamentId: inactiveTeamTournamentId,
          teamId: inactiveTeamId,
          game: 'BGMI',
          status: 'Completed',
          tournamentStartDate: validTournament.tournamentStartDate
        }
      ]
    }
  };

  let mode = 'live';
  User.findOne = () => queryResult(targetUser);
  User.find = () => queryResult([{ _id: targetId }]);
  Tournament.find = () => queryResult(
    mode === 'live'
      ? [validTournament, orphanTournament]
      : [validTournament, orphanTournament, inactiveTeamTournament]
  );

  try {
    const liveResponse = responseRecorder();
    await userController.getLiveTournamentHistory({
      params: { identifier: String(targetId) },
      query: { page: '1', limit: '1' },
      user: { _id: targetId, userType: 'player' }
    }, liveResponse);
    assert.strictEqual(liveResponse.statusCode, 200);
    assert.strictEqual(liveResponse.body.data.tournaments.length, 1);
    assert.strictEqual(liveResponse.body.data.tournaments[0].status, 'Completed');
    assert.strictEqual(liveResponse.body.data.pagination.total, 1);
    assert.strictEqual(liveResponse.body.data.pagination.limit, 1);

    mode = 'player';
    const playerResponse = responseRecorder();
    await userController.getUserTournamentHistory({
      params: { username: targetUser.username },
      query: { page: 'not-a-number', limit: '999', status: 'Completed' },
      user: { _id: targetId, userType: 'player' }
    }, playerResponse);
    assert.strictEqual(playerResponse.statusCode, 200);
    assert.strictEqual(playerResponse.body.data.tournamentHistory.length, 1);
    assert.strictEqual(playerResponse.body.data.tournamentHistory[0].status, 'Completed');
    assert.strictEqual(playerResponse.body.data.pagination.total, 1);
    assert.strictEqual(playerResponse.body.data.pagination.page, 1);
    assert.strictEqual(playerResponse.body.data.pagination.limit, 50);

    const invalidFilterResponse = responseRecorder();
    await userController.getUserTournamentHistory({
      params: { username: targetUser.username },
      query: { status: 'destroyed' },
      user: { _id: targetId, userType: 'player' }
    }, invalidFilterResponse);
    assert.strictEqual(invalidFilterResponse.statusCode, 400);
    assert.strictEqual(invalidFilterResponse.body.code, 'INVALID_TOURNAMENT_HISTORY_FILTER');

    const invalidIdentifierResponse = responseRecorder();
    await userController.getLiveTournamentHistory({
      params: { identifier: '$bad identifier' },
      query: {},
      user: { _id: targetId, userType: 'player' }
    }, invalidIdentifierResponse);
    assert.strictEqual(invalidIdentifierResponse.statusCode, 400);
    assert.strictEqual(invalidIdentifierResponse.body.code, 'INVALID_USER_IDENTIFIER');
  } finally {
    User.findOne = originals.userFindOne;
    User.find = originals.userFind;
    Tournament.find = originals.tournamentFind;
  }

  console.log('User tournament history controller tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
