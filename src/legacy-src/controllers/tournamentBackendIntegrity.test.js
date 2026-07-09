const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const {
  sanitizePublicTournament,
  sanitizeTournamentGroupResults
} = require('../utils/tournamentPublicDto');
const {
  registeredCountForFormat,
  getTournamentCapacity,
  mongoCapacityUsedExpression
} = require('../utils/tournamentCapacity');
const { buildTournamentEntrantRemovalUpdate } = require('../utils/tournamentCompetitionState');
const {
  _private: {
    normalizeTournamentMessageType,
    notificationRecipientId,
    parseEmbeddedArrayIndex,
    parseStrictInteger,
    alphabeticGroupLabel,
    normalizeRoundGroupsInput,
    normalizeCompetitionList,
    tournamentResultTeamDto,
    competitionMutationBlocked,
    tournamentRevisionFilter,
    isTerminalTournament,
    isTournamentBeforeStart
  }
} = require('./tournamentController');

assert.strictEqual(registeredCountForFormat({ format: 'Solo', participants: [1, 2], teams: [3] }), 3);
assert.strictEqual(registeredCountForFormat({ format: 'Squad', participants: [1, 2], teams: [3] }), 1);
const hydratedTournament = {
  format: 'Solo',
  participants: [{ _id: 'active-player' }],
  teams: [],
  populated(pathName) {
    return pathName === 'participants' ? ['active-player', 'orphan-player'] : ['inactive-team'];
  }
};
assert.strictEqual(registeredCountForFormat(hydratedTournament), 3);
assert.deepStrictEqual(
  getTournamentCapacity({ format: 'Duo', teams: [1], totalSlots: 4 }),
  { used: 1, total: 4, remaining: 3, isFull: false }
);
assert.deepStrictEqual(mongoCapacityUsedExpression('Duo'), { $size: { $ifNull: ['$teams', []] } });

const removal = buildTournamentEntrantRemovalUpdate('entrant', ['member-a', 'member-b']);
assert.strictEqual(removal.$pull.participants, 'entrant');
assert.strictEqual(removal.$pull.teams, 'entrant');
assert.strictEqual(removal.$pull['groups.$[].participants'], 'entrant');
assert.deepStrictEqual(removal.$pull.duoRegistrationMembers, { $in: ['member-a', 'member-b'] });
assert.deepStrictEqual(removal.$pull.matches.$or, [{ team1: 'entrant' }, { team2: 'entrant' }]);

assert.strictEqual(normalizeTournamentMessageType('announcement'), 'announcement');
assert.strictEqual(normalizeTournamentMessageType('invalid'), null);
assert.strictEqual(notificationRecipientId({ teamId: 'team-id' }), 'team-id');
assert.strictEqual(notificationRecipientId({ user: { _id: 'member-id' } }), 'member-id');
assert.strictEqual(notificationRecipientId({ invalid: true }), '');
assert.strictEqual(parseEmbeddedArrayIndex('0', 1), 0);
assert.strictEqual(parseEmbeddedArrayIndex('-1', 2), null);
assert.strictEqual(parseEmbeddedArrayIndex('not-a-number', 2), null);
assert.strictEqual(parseEmbeddedArrayIndex('2', 2), null);
assert.strictEqual(parseStrictInteger('4'), 4);
assert.strictEqual(parseStrictInteger('4players'), null);
assert.strictEqual(parseStrictInteger('4.9'), null);
assert.strictEqual(parseStrictInteger(4.9), null);
assert.strictEqual(alphabeticGroupLabel(0), 'A');
assert.strictEqual(alphabeticGroupLabel(25), 'Z');
assert.strictEqual(alphabeticGroupLabel(26), 'AA');
assert.strictEqual(alphabeticGroupLabel(63), 'BL');
const participantA = '507f1f77bcf86cd799439011';
const participantB = '507f1f77bcf86cd799439012';
assert.deepStrictEqual(
  normalizeRoundGroupsInput([{
    name: 'Group A',
    participants: [{ teamId: participantA, teamName: 'Alpha' }, participantB]
  }]),
  {
    groups: [{
      name: 'Group A',
      participants: [
        { teamId: participantA, teamName: 'Alpha', teamLogo: null },
        { teamId: participantB, teamName: '', teamLogo: null }
      ]
    }]
  }
);
assert(normalizeRoundGroupsInput([null]).error);
assert(normalizeRoundGroupsInput([{ name: 'Group A', participants: [null] }]).error);
assert(normalizeRoundGroupsInput([
  { name: 'Group A', participants: [participantA] },
  { name: 'group a', participants: [participantB] }
]).error);
assert.deepStrictEqual(
  normalizeCompetitionList([{ teamId: participantA, teamName: 'Alpha' }]),
  [{ teamId: participantA, teamName: 'Alpha', teamLogo: null }]
);
assert.strictEqual(normalizeCompetitionList([{ teamId: 'invalid' }]), null);
assert.deepStrictEqual(
  tournamentResultTeamDto({
    teamId: {
      _id: participantA,
      username: 'alpha-team',
      profile: { displayName: 'Alpha Team', avatar: 'alpha.png' }
    },
    wins: 2,
    totalPoints: 42,
    qualified: true
  }),
  {
    teamId: participantA,
    teamName: 'Alpha Team',
    teamLogo: 'alpha.png',
    wins: 2,
    finishPoints: 0,
    positionPoints: 0,
    totalPoints: 42,
    rank: 0,
    qualified: true
  }
);
assert.deepStrictEqual(tournamentRevisionFilter({ updatedAt: 'revision' }), { updatedAt: 'revision' });
assert.deepStrictEqual(tournamentRevisionFilter({}), {});
assert.strictEqual(competitionMutationBlocked({ status: 'Cancelled' }), true);
assert.strictEqual(competitionMutationBlocked({
  status: 'Ongoing',
  tournamentEndDate: '2099-01-01T00:00:00.000Z',
  finalResult: { generatedAt: new Date() }
}), true);
const staleTerminalTournament = {
  status: 'Upcoming',
  registrationStartDate: '2026-07-09T04:00:00.000Z',
  registrationEndDate: '2026-07-09T05:00:00.000Z',
  tournamentStartDate: '2026-07-09T05:30:00.000Z',
  tournamentEndDate: '2026-07-09T06:00:00.000Z'
};
assert.strictEqual(isTerminalTournament(staleTerminalTournament, new Date('2026-07-09T07:00:00.000Z')), true);
assert.strictEqual(isTournamentBeforeStart(staleTerminalTournament, new Date('2026-07-09T07:00:00.000Z')), false);

const safe = sanitizePublicTournament({
  _id: 'tournament',
  entryFee: 500,
  duoRegistrationMembers: ['private'],
  bannerPublicId: 'private',
  participants: [],
  teams: []
});
assert.strictEqual(Object.hasOwn(safe, 'entryFee'), false);
assert.strictEqual(Object.hasOwn(safe, 'duoRegistrationMembers'), false);
assert.strictEqual(Object.hasOwn(safe, 'bannerPublicId'), false);

const publicResults = sanitizePublicTournament({
  participants: [],
  teams: [],
  groupResults: [
    {
      round: 1,
      groupName: 'Published Group',
      isSubmitted: true,
      teams: [{ teamId: participantA, teamName: 'Published Team', rank: 1 }]
    },
    {
      round: 2,
      groupName: 'Draft Group',
      isSubmitted: false,
      teams: [{ teamId: participantB, teamName: 'Draft Team', rank: 0 }]
    },
    {
      round: 1,
      groupName: 'Legacy Timestamp Group',
      isSubmitted: false,
      submittedAt: new Date('2026-07-09T08:00:00.000Z'),
      teams: [{ teamId: participantA, teamName: 'Timestamp Team', rank: 0 }]
    },
    {
      round: 1,
      groupName: 'Legacy Ranked Group',
      isSubmitted: false,
      teams: [{ teamId: participantB, teamName: 'Ranked Team', rank: 2 }]
    }
  ]
});
assert.deepStrictEqual(
  publicResults.groupResults.map((result) => result.groupName),
  ['Published Group', 'Legacy Timestamp Group', 'Legacy Ranked Group']
);
assert.strictEqual(publicResults.groupResults.every((result) => result.isSubmitted === true), true);
assert.strictEqual(JSON.stringify(publicResults).includes('Draft Team'), false);
const hostResults = sanitizeTournamentGroupResults([
  {
    groupName: 'Legacy Timestamp Group',
    isSubmitted: false,
    submittedAt: new Date('2026-07-09T08:00:00.000Z'),
    teams: [{ rank: 0 }]
  },
  { groupName: 'Legacy Ranked Group', isSubmitted: false, teams: [{ rank: 2 }] },
  { groupName: 'Initialized Draft', isSubmitted: false, teams: [{ rank: 0 }] }
], { includeDrafts: true });
assert.strictEqual(hostResults.find((result) => result.groupName === 'Legacy Timestamp Group').isSubmitted, true);
assert.strictEqual(hostResults.find((result) => result.groupName === 'Legacy Ranked Group').isSubmitted, true);
assert.strictEqual(hostResults.find((result) => result.groupName === 'Initialized Draft').isSubmitted, false);

const publishedFinalists = sanitizePublicTournament({
  participants: [],
  teams: [],
  finalResult: {
    generatedAt: new Date('2026-07-09T08:00:00.000Z'),
    standings: [
      { rank: 2, teamId: 'team-2', teamName: 'Runner Up', teamLogo: 'runner.png' },
      { rank: 1, teamId: 'team-1', teamName: 'Champion', teamLogo: 'champion.png' },
      { rank: 3, teamId: 'team-3', teamName: 'Third Place', teamLogo: 'third.png' }
    ]
  }
});
assert.strictEqual(publishedFinalists.winner.profile.displayName, 'Champion');
assert.strictEqual(publishedFinalists.runnerUp.profile.displayName, 'Runner Up');
assert.strictEqual(publishedFinalists.thirdPlace.profile.displayName, 'Third Place');
assert.strictEqual(publishedFinalists.winner.profile.avatar, 'champion.png');

assert.strictEqual(Tournament.schema.path('entryFee').options.select, false);
assert.strictEqual(Tournament.schema.path('prizePool').options.max, Number.MAX_SAFE_INTEGER);
assert.strictEqual(
  Tournament.schema.path('finalResult.standings.prizeAmount').options.max,
  Number.MAX_SAFE_INTEGER
);
assert.strictEqual(User.schema.path('teamInfo.isGeneratedDuo').options.select, false);
assert.strictEqual(User.schema.path('teamInfo.generatedForTournament').options.select, false);

const controllerSource = fs.readFileSync(path.join(__dirname, 'tournamentController.js'), 'utf8');
const userSource = fs.readFileSync(path.join(__dirname, 'userController.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, 'adminController.js'), 'utf8');
const accountCleanupSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'accountCompetitionCleanupService.js'),
  'utf8'
);
const generatedDuoCleanupSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'generatedDuoTeamService.js'),
  'utf8'
);
const migrationSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'scripts', 'migrate-tournament-indexes.js'),
  'utf8'
);

assert(controllerSource.includes('const publicQueryFilter = await constrainToActiveTournamentHosts(queryFilter)'));
assert.strictEqual(controllerSource.includes('decodeURIComponent(tournamentName)'), false);
assert(controllerSource.includes("match: { isActive: true, userType: 'team' }"));
assert(controllerSource.includes("code: 'LEGACY_PAID_TOURNAMENT_REQUIRES_RECONCILIATION'"));
assert(controllerSource.includes("code: 'TOURNAMENT_FINAL_RESULT_CONFLICT'"));
assert(controllerSource.includes('buildTournamentEntrantRemovalUpdate(userId, teamMemberIds)'));
assert(controllerSource.includes("code: 'TOURNAMENT_WITHDRAWAL_CONFLICT'"));
assert(controllerSource.includes("code: 'TOURNAMENT_PARTICIPANT_REMOVE_CONFLICT'"));
assert(controllerSource.includes("code: 'TOURNAMENT_VALIDATION_FAILED'"));
assert(controllerSource.includes("code: 'TOURNAMENT_UPDATE_CONFLICT'"));
assert(controllerSource.includes("Number(String(prizePool).trim())"));
assert(controllerSource.includes('new Date(nextRegEnd.getTime() - 60_000)'));
assert(adminSource.includes("status === 'Upcoming'"));
assert(adminSource.includes('upcomingWindowQuery(now)'));
assert(adminSource.includes("message: 'Invalid tournament status filter'"));
assert(adminSource.includes('mongoose.Types.ObjectId.isValid(tournamentId)'));
assert(userSource.includes('await User.bulkWrite(allMembers.map'));
assert(userSource.includes('Duo team membership reconciliation failed'));
assert(userSource.includes("$pull: { 'playerInfo.joinedTeams': { team: createdDuoTeamId } }"));
assert(accountCleanupSource.includes('cancel_hosted_tournaments'));
assert(accountCleanupSource.includes("{ tournamentEndDate: { $gte: now } }"));
assert(accountCleanupSource.includes("'teamInfo.rosters.$[].players': { user: userId }"));
assert(accountCleanupSource.includes('includeReservationOnly: userType !== \'team\''));
assert(accountCleanupSource.includes('{ $or: referenceConditions }'));
assert(accountCleanupSource.includes('remove_joined_team_references'));
assert(generatedDuoCleanupSource.includes("'teamInfo.isGeneratedDuo': true"));
assert.strictEqual(generatedDuoCleanupSource.includes('username: /^duo_/'), false);
assert.strictEqual(generatedDuoCleanupSource.includes('email: /@team\\.com$/i'), false);
assert(generatedDuoCleanupSource.includes("{ teams: team._id }"));
assert(generatedDuoCleanupSource.includes("$pull: { 'playerInfo.joinedTeams'"));
assert(migrationSource.includes('auditTournamentReferences'));
assert(migrationSource.includes('auditLegacyTournamentPayments'));
assert(migrationSource.includes('migrateGeneratedDuoMarkers'));
assert(migrationSource.includes('invalidOrWrongTypeEmbeddedEntrantReferenceCount'));
assert(migrationSource.includes('embeddedEntrantOutsideRegistrationCount'));

const controllerFunctionSource = (name, nextName) => {
  const start = controllerSource.indexOf(`const ${name} = async`);
  const end = nextName ? controllerSource.indexOf(`const ${nextName} = async`, start + 1) : controllerSource.length;
  assert(start >= 0, `Missing ${name} controller`);
  assert(end > start, `Missing boundary after ${name} controller`);
  return controllerSource.slice(start, end);
};
const cancelSource = controllerFunctionSource('cancelTournament', 'scheduleMatches');
assert(cancelSource.includes('Tournament.findOneAndUpdate'));
assert(cancelSource.indexOf("$set: { status: 'Cancelled' }") < cancelSource.indexOf('notifyTournamentRecipients'));
assert(cancelSource.includes("propagateStatusChange(cancelledTournament._id, 'Cancelled')"));
const openSource = controllerFunctionSource('openRegistration', 'startTournament');
assert(openSource.includes('Tournament.findOneAndUpdate'));
assert(openSource.includes("propagateStatusChange(openedTournament._id, 'Registration Open')"));
const startSource = controllerFunctionSource('startTournament', 'updatePrizeDistribution');
assert(startSource.includes("propagateStatusChange(startedTournament._id, 'Ongoing')"));
const scheduleSource = controllerFunctionSource('scheduleMatches', 'createMatchSchedule');
assert(scheduleSource.includes("code: 'TOURNAMENT_SCHEDULE_CONFLICT'"));
assert(scheduleSource.includes('...tournamentRevisionFilter(tournament)'));
const updateScheduleSource = controllerFunctionSource('updateMatchSchedule', 'getTournamentSchedule');
assert(updateScheduleSource.includes('matchDuration !== undefined'));
assert(updateScheduleSource.includes('!Number.isInteger(parsedDuration)'));
const updateResultSource = controllerFunctionSource('updateMatchResult', 'startMatch');
assert(updateResultSource.includes("'finalResult.generatedAt': null"));
assert(updateResultSource.includes("code: 'TOURNAMENT_RESULT_CONFLICT'"));
const submitResultsSource = controllerFunctionSource('submitGroupResults', 'getRoundResults');
assert(submitResultsSource.includes('teams.some((team) => !isPlainObject(team) || !isCompetitionId(team.teamId))'));
assert(submitResultsSource.includes('Tournament.findOneAndUpdate'));
const broadcastSource = controllerFunctionSource('broadcastSchedule', 'qualifyTeams');
assert(broadcastSource.indexOf('await tournament.save()') < broadcastSource.indexOf('for (const notification of pendingScheduleNotifications)'));
const createNextRoundSource = controllerFunctionSource('createNextRoundGroups', 'getQualificationStatus');
assert(createNextRoundSource.includes("code: 'TOURNAMENT_ROUND_CONFLICT'"));
const createRoundSource = controllerFunctionSource('createRound2', 'autoAssignRound2');
assert(createRoundSource.includes('normalizeRoundGroupsInput(groups)'));
assert(createRoundSource.includes('Tournament.findOneAndUpdate'));
const autoAssignSource = controllerFunctionSource('autoAssignRound2', 'openRegistration');
assert(autoAssignSource.includes('normalizeRoundGroupsInput(groups)'));
assert(autoAssignSource.includes('tournamentMessages: tournament.tournamentMessages'));
assert(autoAssignSource.includes('broadcastChannels: tournament.broadcastChannels'));
assert.strictEqual(autoAssignSource.includes('tournament.broadcasts'), false);
const participantSource = controllerFunctionSource('getTournamentParticipants', 'removeParticipant');
assert(participantSource.includes("activeCompetitionUserPopulate('participants')"));
assert(participantSource.includes("activeCompetitionUserPopulate('groups.participants')"));
const roundSettingsSource = controllerFunctionSource('updateRoundSettings', 'recreateGroups');
assert(roundSettingsSource.includes('const minimumTeamsPerGroup = roundNumber === 1 ? 2 : 1'));
assert(roundSettingsSource.includes('const minimumTotalSlots = roundNumber === 1 ? 4 : 1'));
const recreateGroupsSource = controllerFunctionSource('recreateGroups', 'submitGroupResults');
assert(recreateGroupsSource.includes('parsedTeamsPerGroup < 2'));
assert(recreateGroupsSource.includes('parsedTotalSlots < 4'));

console.log('Tournament backend integrity contract tests passed');
