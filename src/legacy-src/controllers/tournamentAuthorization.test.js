const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Tournament = require('../models/Tournament');
const User = require('../models/User');
const tournamentController = require('./tournamentController');

const makeQuery = (value) => ({
  select() { return this; },
  populate() { return this; },
  lean() { return Promise.resolve(value); },
  then(resolve) { return Promise.resolve(resolve(value)); }
});

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

(async () => {
  const originalFindById = Tournament.findById;
  const originalFindOneAndUpdate = Tournament.findOneAndUpdate;
  const originalUserFind = User.find;
  const originalUserFindOne = User.findOne;
  const originalUserFindById = User.findById;
  const originalUserUpdateMany = User.updateMany;
  let saveCount = 0;
  let startUpdateCount = 0;
  let lookedUpId = '';
  let tournament = {
    _id: '507f1f77bcf86cd799439010',
    host: '507f1f77bcf86cd799439011',
    name: 'Authorization tournament',
    status: 'Registration Open',
    participants: ['507f1f77bcf86cd799439012'],
    teams: [],
    groups: [],
    groupResults: [],
    broadcasts: [],
    matches: [],
    save: async () => { saveCount += 1; }
  };
  Tournament.findById = (id) => {
    lookedUpId = String(id);
    return makeQuery(tournament);
  };
  User.find = () => ({
    select() { return this; },
    lean: async () => []
  });
  User.updateMany = async () => ({ acknowledged: true, modifiedCount: 0 });

  try {
    const outsider = { _id: '507f1f77bcf86cd799439099' };

    const assignResponse = responseRecorder();
    await tournamentController.assignParticipantToGroup({
      params: { id: String(tournament._id) },
      body: { participantId: tournament.participants[0], groupId: '', round: 1 },
      user: outsider
    }, assignResponse);
    assert.strictEqual(assignResponse.statusCode, 403);

    const createRoundResponse = responseRecorder();
    await tournamentController.createRound2({
      params: { id: String(tournament._id) },
      body: { groups: [{ name: 'Group A', participants: [] }], round: 2 },
      user: outsider
    }, createRoundResponse);
    assert.strictEqual(createRoundResponse.statusCode, 403);
    assert.strictEqual(lookedUpId, String(tournament._id), 'create-round-2 must consume the route :id parameter');

    const autoRoundResponse = responseRecorder();
    await tournamentController.autoAssignRound2({
      params: { id: String(tournament._id) },
      body: { groups: [{ name: 'Group A', participants: [] }], round: 2, qualifiedTeams: [] },
      user: outsider
    }, autoRoundResponse);
    assert.strictEqual(autoRoundResponse.statusCode, 403);
    assert.strictEqual(saveCount, 0, 'unauthorized tournament commands must not persist');

    const host = { _id: tournament.host };
    const hostRoundResponse = responseRecorder();
    await tournamentController.createRound2({
      params: { id: String(tournament._id) },
      body: { groups: [{ name: 'Group A', participants: [] }], round: 2 },
      user: host
    }, hostRoundResponse);
    assert.strictEqual(hostRoundResponse.statusCode, 409);
    assert.strictEqual(hostRoundResponse.body.success, false);
    assert.strictEqual(saveCount, 0, 'hosts cannot bypass submitted qualification state');

    const socketEvents = [];
    const io = {
      emit(event, payload) { socketEvents.push({ room: null, event, payload }); },
      to(room) {
        return { emit: (event, payload) => socketEvents.push({ room, event, payload }) };
      }
    };
    tournament = {
      ...tournament,
      status: 'Registration Open',
      groups: [],
      participants: [],
      teams: [],
      save: async () => { saveCount += 1; }
    };
    Tournament.findOneAndUpdate = async (filter, update) => {
      assert.strictEqual(String(filter.host), String(host._id));
      assert.strictEqual(filter.status, tournament.status);
      assert.strictEqual(update?.$set?.status, 'Ongoing');
      startUpdateCount += 1;
      tournament = { ...tournament, status: 'Ongoing' };
      return tournament;
    };
    const startResponse = responseRecorder();
    await tournamentController.startTournament({
      params: { id: String(tournament._id) },
      user: host,
      app: { get: (key) => key === 'io' ? io : null }
    }, startResponse);
    assert.strictEqual(startResponse.statusCode, 200);
    assert.strictEqual(tournament.status, 'Ongoing');
    assert.strictEqual(startUpdateCount, 1, 'start must atomically persist the lifecycle transition');
    assert(socketEvents.some((entry) => entry.event === 'broadcast_message'));
    assert(socketEvents.some((entry) => entry.event === 'tournament_updated'));

    // Crossing the scheduled start boundary derives Ongoing before the raw
    // status changes. The Start command must still persist and notify once.
    const scheduledNow = Date.now();
    tournament = {
      ...tournament,
      status: 'Registration Open',
      registrationStartDate: new Date(scheduledNow - 60 * 60 * 1000),
      registrationEndDate: new Date(scheduledNow - 5 * 60 * 1000),
      tournamentStartDate: new Date(scheduledNow - 60 * 1000),
      tournamentEndDate: new Date(scheduledNow + 60 * 60 * 1000)
    };
    const scheduledStartResponse = responseRecorder();
    await tournamentController.startTournament({
      params: { id: String(tournament._id) },
      user: host,
      app: { get: (key) => key === 'io' ? io : null }
    }, scheduledStartResponse);
    assert.strictEqual(scheduledStartResponse.statusCode, 200);
    assert.strictEqual(tournament.status, 'Ongoing');
    assert.strictEqual(startUpdateCount, 2, 'scheduled start boundary must not skip persistence');

    const saveCountAfterStart = saveCount;
    tournament = {
      ...tournament,
      status: 'Ongoing',
      registrationStartDate: new Date('2020-01-01T00:00:00.000Z'),
      registrationEndDate: new Date('2020-01-01T01:00:00.000Z'),
      tournamentStartDate: new Date('2020-01-01T02:00:00.000Z'),
      tournamentEndDate: new Date('2020-01-01T03:00:00.000Z')
    };
    const staleOngoingResponse = responseRecorder();
    await tournamentController.startTournament({
      params: { id: String(tournament._id) },
      user: host,
      app: { get: (key) => key === 'io' ? io : null }
    }, staleOngoingResponse);
    assert.strictEqual(staleOngoingResponse.statusCode, 409);
    assert.strictEqual(staleOngoingResponse.body.code, 'TOURNAMENT_CANNOT_START');
    assert.strictEqual(saveCount, saveCountAfterStart, 'completed schedules cannot be restarted from stale raw state');
    assert.strictEqual(startUpdateCount, 2, 'completed schedules cannot claim another start transition');

    // A date-expired registration window can still carry the historical raw
    // `Registration Open` status. The Web shows Open Registration from the
    // effective phase, so the command must reopen the dates instead of taking
    // the idempotent already-open branch based on the raw status alone.
    const reopenNow = Date.now();
    let reopenUpdateCount = 0;
    tournament = {
      ...tournament,
      status: 'Registration Open',
      registrationStartDate: new Date(reopenNow - 600_000),
      registrationEndDate: new Date(reopenNow - 300_000),
      registrationDeadline: new Date(reopenNow - 300_000),
      tournamentStartDate: new Date(reopenNow + 3_600_000),
      tournamentEndDate: new Date(reopenNow + 7_200_000),
      participants: [],
      teams: [],
      updatedAt: new Date(reopenNow - 60_000)
    };
    const previousUserFind = User.find;
    User.find = () => ({
      lean() { return this; },
      cursor() {
        return (async function* emptyCursor() {})();
      }
    });
    Tournament.findOneAndUpdate = async (filter, update) => {
      assert.strictEqual(filter.status, 'Registration Open');
      assert.strictEqual(update.$set.status, 'Registration Open');
      assert(update.$set.registrationStartDate > tournament.registrationEndDate);
      reopenUpdateCount += 1;
      tournament = { ...tournament, ...update.$set, updatedAt: new Date() };
      return tournament;
    };
    const reopenResponse = responseRecorder();
    await tournamentController.openRegistration({
      params: { id: String(tournament._id) },
      user: host
    }, reopenResponse);
    assert.strictEqual(reopenResponse.statusCode, 200);
    assert.strictEqual(reopenUpdateCount, 1, 'expired raw-open registration must claim a new window');

    const retryReopenResponse = responseRecorder();
    await tournamentController.openRegistration({
      params: { id: String(tournament._id) },
      user: host
    }, retryReopenResponse);
    assert.strictEqual(retryReopenResponse.statusCode, 200);
    assert.strictEqual(reopenUpdateCount, 1, 'retry of the same open window must be idempotent');
    User.find = previousUserFind;

    const teamId = '507f1f77bcf86cd799439055';
    tournament = {
      ...tournament,
      groupResults: [{
        round: 1,
        groupId: 'Group A',
        groupName: 'Group A',
        submittedAt: new Date('2026-07-03T00:00:00.000Z'),
        teams: [{
          _doc: { secretOwnerDocument: 'must-not-leak' },
          toObject: () => ({
            teamId,
            teamName: 'Safe Team',
            wins: 1,
            finishPoints: 10,
            positionPoints: 5,
            totalPoints: 15,
            rank: 1,
            qualified: true
          })
        }]
      }]
    };
    const resultsResponse = responseRecorder();
    await tournamentController.getRoundResults({
      params: { id: String(tournament._id), round: '1' },
      user: { _id: tournament.participants?.[0] || host._id }
    }, resultsResponse);
    assert.strictEqual(resultsResponse.statusCode, 200);
    assert.strictEqual(resultsResponse.body.data.overallStandings[0].teamId, teamId);
    assert.strictEqual(resultsResponse.body.data.overallStandings[0].totalPoints, 15);
    assert.strictEqual(resultsResponse.body.data.overallStandings[0].qualified, true);
    assert(!JSON.stringify(resultsResponse.body).includes('secretOwnerDocument'));

    const resultsParticipantId = '507f1f77bcf86cd799439056';
    tournament = {
      ...tournament,
      participants: [resultsParticipantId],
      groupResults: [
        {
          round: 1,
          groupId: 'published',
          groupName: 'Published',
          isSubmitted: true,
          teams: [{
            teamId,
            teamName: 'Published Team',
            rank: 1,
            totalPoints: 20,
            qualified: true
          }]
        },
        {
          round: 1,
          groupId: 'draft',
          groupName: 'Draft',
          isSubmitted: false,
          teams: [{
            teamId: '507f1f77bcf86cd799439057',
            teamName: 'Draft Team',
            rank: 0,
            totalPoints: 0,
            qualified: false
          }]
        },
        {
          round: 1,
          groupId: 'legacy-timestamp',
          groupName: 'Legacy Timestamp',
          isSubmitted: false,
          submittedAt: new Date('2026-07-03T01:00:00.000Z'),
          teams: [{
            teamId: '507f1f77bcf86cd799439058',
            teamName: 'Legacy Timestamp Team',
            rank: 0,
            totalPoints: 5,
            qualified: false
          }]
        },
        {
          round: 1,
          groupId: 'legacy-ranked',
          groupName: 'Legacy Ranked',
          isSubmitted: false,
          teams: [{
            teamId: '507f1f77bcf86cd799439059',
            teamName: 'Legacy Ranked Team',
            rank: 2,
            totalPoints: 10,
            qualified: false
          }]
        }
      ]
    };
    const participantResultsResponse = responseRecorder();
    await tournamentController.getRoundResults({
      params: { id: String(tournament._id), round: '1' },
      user: { _id: resultsParticipantId }
    }, participantResultsResponse);
    assert.strictEqual(participantResultsResponse.statusCode, 200);
    assert.deepStrictEqual(
      participantResultsResponse.body.data.roundResults.map((result) => result.groupName),
      ['Published', 'Legacy Timestamp', 'Legacy Ranked']
    );
    assert.strictEqual(participantResultsResponse.body.data.overallStandings.length, 3);
    assert.strictEqual(
      participantResultsResponse.body.data.roundResults.every((result) => result.isSubmitted === true),
      true
    );

    const strangerResultsResponse = responseRecorder();
    await tournamentController.getRoundResults({
      params: { id: String(tournament._id), round: '1' },
      user: { _id: outsider._id }
    }, strangerResultsResponse);
    assert.deepStrictEqual(
      strangerResultsResponse.body.data.roundResults.map((result) => result.groupName),
      ['Published', 'Legacy Timestamp', 'Legacy Ranked']
    );

    const hostResultsResponse = responseRecorder();
    await tournamentController.getRoundResults({
      params: { id: String(tournament._id), round: '1' },
      user: host
    }, hostResultsResponse);
    assert.deepStrictEqual(
      hostResultsResponse.body.data.roundResults.map((result) => result.groupName),
      ['Published', 'Draft', 'Legacy Timestamp', 'Legacy Ranked']
    );

    const normalTeamId = '507f1f77bcf86cd799439060';
    const generatedDuoTeamId = '507f1f77bcf86cd799439061';
    const normalMemberId = '507f1f77bcf86cd799439062';
    const duoMemberId = '507f1f77bcf86cd799439063';
    const registrationNow = Date.now();
    let withdrawalUpdateCount = 0;
    let generatedDuoLookup = null;
    const registeredTournament = (registeredTeamId) => ({
      _id: '507f1f77bcf86cd799439064',
      host: registeredTeamId,
      name: 'Withdrawal authorization tournament',
      status: 'Registration Open',
      format: registeredTeamId === generatedDuoTeamId ? 'Duo' : 'Squad',
      participants: [],
      teams: [registeredTeamId],
      groups: [],
      matches: [],
      registrationStartDate: new Date(registrationNow - 60_000),
      registrationEndDate: new Date(registrationNow + 300_000),
      tournamentStartDate: new Date(registrationNow + 600_000),
      tournamentEndDate: new Date(registrationNow + 3_600_000),
      updatedAt: new Date(registrationNow)
    });
    const normalTeam = {
      _id: normalTeamId,
      userType: 'team',
      username: 'normal_squad',
      email: 'normal@example.com',
      profile: { displayName: 'Normal Squad' },
      teamInfo: { members: [{ user: normalMemberId }] }
    };
    const generatedDuoTeam = {
      _id: generatedDuoTeamId,
      userType: 'team',
      username: 'duo_generated',
      email: 'duo-generated@team.com',
      profile: { displayName: 'Generated Duo' },
      teamInfo: { isGeneratedDuo: true, members: [{ user: duoMemberId }] }
    };
    User.findById = () => makeQuery(normalTeam);
    User.updateMany = async () => ({ acknowledged: true, modifiedCount: 0 });
    Tournament.findOneAndUpdate = async () => {
      withdrawalUpdateCount += 1;
      return { ...tournament, teams: [] };
    };

    tournament = registeredTournament(normalTeamId);
    let withdrawalResponse = responseRecorder();
    await tournamentController.leaveTournament({
      params: { id: String(tournament._id) },
      body: {},
      user: { ...normalTeam, _id: normalTeamId }
    }, withdrawalResponse);
    assert.strictEqual(
      withdrawalResponse.statusCode,
      200,
      `normal team account uses canonical /leave: ${JSON.stringify(withdrawalResponse.body)}`
    );
    assert.strictEqual(withdrawalUpdateCount, 1);

    withdrawalResponse = responseRecorder();
    await tournamentController.leaveTournament({
      params: { id: String(tournament._id) },
      body: {},
      user: { _id: normalMemberId, username: 'normal-member' }
    }, withdrawalResponse);
    assert.strictEqual(withdrawalResponse.statusCode, 400, 'normal team member cannot use canonical /leave');
    assert.strictEqual(withdrawalUpdateCount, 1, 'unauthorized member must not mutate registration');

    User.findOne = (query) => {
      generatedDuoLookup = query;
      return makeQuery(null);
    };
    withdrawalResponse = responseRecorder();
    await tournamentController.leaveTournamentAsTeam({
      params: { id: String(tournament._id) },
      body: { teamId: normalTeamId },
      user: { _id: normalMemberId }
    }, withdrawalResponse);
    assert.strictEqual(withdrawalResponse.statusCode, 403, 'normal team members cannot use /leave-team');
    assert.strictEqual(withdrawalResponse.body.code, 'GENERATED_DUO_WITHDRAWAL_ONLY');
    assert.strictEqual(withdrawalUpdateCount, 1, 'forbidden /leave-team must not mutate registration');
    assert.strictEqual(
      generatedDuoLookup['teamInfo.isGeneratedDuo'],
      true,
      'withdrawal lookup must require the explicit generated Duo ownership marker'
    );
    assert.strictEqual(generatedDuoLookup.userType, 'team');
    assert.deepStrictEqual(generatedDuoLookup._id.$in, [normalTeamId]);
    assert.strictEqual(Object.hasOwn(generatedDuoLookup, 'username'), false);
    assert.strictEqual(Object.hasOwn(generatedDuoLookup, 'email'), false);

    tournament = registeredTournament(generatedDuoTeamId);
    User.findOne = (query) => {
      generatedDuoLookup = query;
      return makeQuery(generatedDuoTeam);
    };
    withdrawalResponse = responseRecorder();
    await tournamentController.leaveTournamentAsTeam({
      params: { id: String(tournament._id) },
      body: { teamId: generatedDuoTeamId },
      user: { _id: duoMemberId }
    }, withdrawalResponse);
    assert.strictEqual(withdrawalResponse.statusCode, 200, 'generated Duo members retain withdrawal');

    withdrawalResponse = responseRecorder();
    await tournamentController.leaveTournamentAsTeam({
      params: { id: String(tournament._id) },
      body: { teamId: generatedDuoTeamId },
      user: { _id: generatedDuoTeamId }
    }, withdrawalResponse);
    assert.strictEqual(withdrawalResponse.statusCode, 200, 'generated Duo account retains withdrawal');
    assert.strictEqual(withdrawalUpdateCount, 3);
  } finally {
    Tournament.findById = originalFindById;
    Tournament.findOneAndUpdate = originalFindOneAndUpdate;
    User.find = originalUserFind;
    User.findOne = originalUserFindOne;
    User.findById = originalUserFindById;
    User.updateMany = originalUserUpdateMany;
  }

  const root = path.resolve(__dirname, '../..');
  const controllerSource = fs.readFileSync(path.join(root, 'legacy-src/controllers/tournamentController.js'), 'utf8');
  const userControllerSource = fs.readFileSync(path.join(root, 'legacy-src/controllers/userController.js'), 'utf8');
  const routesSource = fs.readFileSync(path.join(root, 'modules/tournaments/tournaments.routes.ts'), 'utf8');
  const legacyRoutesSource = fs.readFileSync(path.join(root, 'legacy-src/routes/tournaments.js'), 'utf8');

  assert(!controllerSource.includes("require('../server')"), 'modular controllers must use the injected Socket.IO server');
  assert(!controllerSource.includes('id.length > 20'), 'ObjectIds must never be misclassified as tournament codes');
  assert(controllerSource.includes('const isTournamentCode ='));
  assert(controllerSource.includes("$addToSet: { [registrationField]: userId }"), 'normal registration must reserve capacity atomically');
  assert(controllerSource.includes('req.body[field] !== undefined'), 'updates must use an explicit field whitelist');
  assert(!controllerSource.includes("'specialPrizes', 'rules', 'banner'"), 'body-supplied banner paths must not be accepted');
  assert(controllerSource.includes("'tournament_updated',\n      withoutViewerTournamentContext(payload, tournament, emittedAt)"));
  assert(controllerSource.includes("PUBLIC_TEAM_POPULATE"));
  assert(controllerSource.includes('multer.memoryStorage()'), 'tournament banners must not use ephemeral container storage');
  assert(controllerSource.includes("uploadImage(req.file, 'gaming-social/tournaments'"));
  assert(controllerSource.includes('validateTournamentGameConfiguration(game, mode, format)'));
  assert(controllerSource.includes('submittedRoundCoverage(tournament, currentRoundNumber)'));
  assert(controllerSource.includes('MAX_GENERATED_MATCHES_PER_ROUND'));
  assert(controllerSource.includes("message: 'Historical and future round results are read-only'"));
  assert(controllerSource.includes('expandTournamentRecipientIds'), 'team registrations must notify their active members');
  assert(controllerSource.includes("const tournamentId = req.params.id || req.params.tournamentId"));
  assert(!controllerSource.includes('memberUser.playerInfo.joinedTeams'), 'leaving a tournament must not remove team membership');
  const removeParticipantSource = controllerSource.slice(
    controllerSource.indexOf('const removeParticipant = async'),
    controllerSource.indexOf('const assignParticipantToGroup = async')
  );
  const startMatchSource = controllerSource.slice(
    controllerSource.indexOf('const startMatch = async'),
    controllerSource.indexOf('const completeMatch = async')
  );
  const joinTournamentSource = controllerSource.slice(
    controllerSource.indexOf('const joinTournament = async'),
    controllerSource.indexOf('const joinDuoTournament = async')
  );
  assert(!joinTournamentSource.includes('finalTournaments'), 'list filtering must never execute inside join');
  assert(joinTournamentSource.includes('capacityExpression'), 'join capacity must use the format-specific slot contract');
  assert(!removeParticipantSource.includes("match.status !== 'Scheduled'"), 'participant removal must not reference match state');
  assert(
    removeParticipantSource.includes('buildTournamentEntrantRemovalUpdate(participantId, memberIds)'),
    'removing a Duo team must atomically release its member reservation'
  );
  const autoAssignSource = controllerSource.slice(
    controllerSource.indexOf('const autoAssignGroups = async'),
    controllerSource.indexOf('const sendTournamentMessage = async')
  );
  assert(!autoAssignSource.includes('wasTeamEntry'), 'group assignment must not execute participant-removal cleanup');
  const autoRoundTwoSource = controllerSource.slice(
    controllerSource.indexOf('const autoAssignRound2 = async'),
    controllerSource.indexOf('// Open registration for a tournament')
  );
  assert(
    autoRoundTwoSource.includes("eventType: 'tournament_round_started'"),
    'Round 2 auto-assignment must create durable participant notifications'
  );
  assert(startMatchSource.includes("match.status !== 'Scheduled'"), 'match start must reject invalid lifecycle transitions');
  assert(userControllerSource.includes("Duo teammate must be one of your followers"));
  assert(userControllerSource.includes("format: 'Duo'"));
  assert(userControllerSource.includes('status: registrationQuery.status'));
  assert(userControllerSource.includes('registrationWindowQuery(now)'));
  assert(userControllerSource.includes("$addToSet: { teams: team._id }"));
  assert(userControllerSource.includes('duoRegistrationMembers: { $nin: reservedMemberIds }'));
  assert(userControllerSource.includes('duoRegistrationMembers: { $each: reservedMemberIds }'));
  assert(userControllerSource.includes("password: crypto.randomBytes(32).toString('hex')"));
  assert(!userControllerSource.includes("password: 'team123'"));
  assert(routesSource.includes('router.post("/:id/assign-participant", protect'));
  assert(routesSource.includes('router.post("/:id/auto-assign-round-2", protect'));
  assert(routesSource.includes('router.post("/:id/join-duo", protect'));
  assert(legacyRoutesSource.includes("router.post('/:id/assign-participant', protect"));
  assert(legacyRoutesSource.includes("router.post('/:id/auto-assign-round-2', protect"));
  assert(legacyRoutesSource.includes("router.param('id'"));
  assert(legacyRoutesSource.includes("code: 'INVALID_TOURNAMENT_ID'"));

  console.log('Tournament authorization contract tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
