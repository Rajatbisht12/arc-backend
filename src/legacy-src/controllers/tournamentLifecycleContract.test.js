const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  _private: {
    withViewerTournamentContext,
    withoutViewerTournamentContext
  }
} = require('./tournamentController');
const { sanitizePublicTournament } = require('../utils/tournamentPublicDto');

const now = new Date('2026-07-09T06:30:00.000Z');
const base = {
  _id: '507f1f77bcf86cd799439010',
  host: '507f1f77bcf86cd799439011',
  status: 'Upcoming',
  format: 'Solo',
  totalSlots: 4,
  participants: [],
  teams: [],
  groups: [],
  matches: [],
  registrationStartDate: new Date('2026-07-09T06:00:00.000Z'),
  registrationEndDate: new Date('2026-07-09T06:34:00.000Z'),
  tournamentStartDate: new Date('2026-07-09T06:35:00.000Z'),
  tournamentEndDate: new Date('2026-07-09T08:35:00.000Z')
};

const context = (source, userId = '507f1f77bcf86cd799439012', userType = 'player') => (
  withViewerTournamentContext({ ...source }, source, userId, [], userType, now)
);

const soloPlayer = context(base);
assert.strictEqual(soloPlayer.effectivePhase, 'Registration Open');
assert.strictEqual(soloPlayer.registrationOpen, true);
assert.strictEqual(soloPlayer.viewerCanJoin, true);
assert.strictEqual(soloPlayer.viewerJoinAction, 'join');
assert.strictEqual(soloPlayer.viewerJoinReason, null);
assert.strictEqual(soloPlayer.nextTransitionAt, '2026-07-09T06:34:00.000Z');
assert.deepStrictEqual(soloPlayer.capacity, { used: 0, total: 4, remaining: 4, isFull: false });
assert.strictEqual(soloPlayer.currentParticipants, 0);
assert.strictEqual(soloPlayer.maxParticipants, 4);

const host = context(base, String(base.host));
assert.strictEqual(host.viewerCanJoin, false);
assert.strictEqual(host.viewerJoinReason, 'HOST_CANNOT_JOIN');

const participantId = '507f1f77bcf86cd799439012';
const participant = context({ ...base, participants: [participantId] }, participantId);
assert.strictEqual(participant.viewerParticipation, true);
assert.strictEqual(participant.viewerCanJoin, false);
assert.strictEqual(participant.viewerJoinReason, 'ALREADY_REGISTERED');
assert.strictEqual(participant.viewerCanWithdraw, true);

const full = context({
  ...base,
  totalSlots: 2,
  participants: ['507f1f77bcf86cd799439020', '507f1f77bcf86cd799439021']
});
assert.strictEqual(full.viewerCanJoin, false);
assert.strictEqual(full.viewerJoinReason, 'TOURNAMENT_FULL');
assert.strictEqual(full.capacity.isFull, true);
assert.strictEqual(full.currentParticipants, 2);
assert.strictEqual(full.maxParticipants, 2);

const soloTeam = context(base, '507f1f77bcf86cd799439012', 'team');
assert.strictEqual(soloTeam.viewerJoinReason, 'SOLO_REQUIRES_PLAYER_ACCOUNT');

const duoPlayer = context({ ...base, format: 'Duo' });
assert.strictEqual(duoPlayer.viewerCanJoin, true);
assert.strictEqual(duoPlayer.viewerJoinAction, 'join-duo');

const squadPlayer = context({ ...base, format: 'Squad' });
assert.strictEqual(squadPlayer.viewerCanJoin, false);
assert.strictEqual(squadPlayer.viewerJoinReason, 'TEAM_ACCOUNT_REQUIRED');
const squadTeam = context({ ...base, format: 'Squad' }, '507f1f77bcf86cd799439012', 'team');
assert.strictEqual(squadTeam.viewerCanJoin, true);
assert.strictEqual(squadTeam.viewerJoinAction, 'join');
const squadWithLegacyParticipant = context({
  ...base,
  format: 'Squad',
  totalSlots: 1,
  participants: ['507f1f77bcf86cd799439099']
}, '507f1f77bcf86cd799439012', 'team');
assert.strictEqual(squadWithLegacyParticipant.capacity.used, 0);
assert.strictEqual(squadWithLegacyParticipant.viewerCanJoin, true);

const registeredTeamId = '507f1f77bcf86cd799439030';
const registeredSquad = {
  ...base,
  format: 'Squad',
  teams: [{ _id: registeredTeamId }],
  broadcastChannels: [{ name: 'Tournament Announcements', type: 'Text Messages', round: 1 }]
};
const teamMember = withViewerTournamentContext(
  { ...registeredSquad },
  registeredSquad,
  participantId,
  [registeredTeamId],
  'player',
  now
);
assert.strictEqual(teamMember.viewerParticipation, true);
assert.strictEqual(teamMember.viewerRole, 'team-member');
assert.strictEqual(teamMember.viewerRegisteredTeamId, registeredTeamId);
assert.strictEqual(teamMember.viewerCanWithdraw, false);
assert.strictEqual(teamMember.broadcastChannels.length, 1, 'normal team members remain participant readers');

const registeredTeamAccount = withViewerTournamentContext(
  { ...registeredSquad },
  registeredSquad,
  registeredTeamId,
  [],
  'team',
  now
);
assert.strictEqual(registeredTeamAccount.viewerParticipation, true);
assert.strictEqual(registeredTeamAccount.viewerCanWithdraw, true);

const registeredDuo = { ...base, format: 'Duo', teams: [{ _id: registeredTeamId }] };
const duoMember = withViewerTournamentContext(
  { ...registeredDuo },
  registeredDuo,
  participantId,
  [registeredTeamId],
  'player',
  now,
  [registeredTeamId]
);
assert.strictEqual(duoMember.viewerParticipation, true);
assert.strictEqual(duoMember.viewerCanWithdraw, true);

const guest = withViewerTournamentContext({ ...base }, base, null, [], null, now);
assert.strictEqual(guest.viewerCanJoin, false);
assert.strictEqual(guest.viewerJoinReason, 'AUTHENTICATION_REQUIRED');

const rawResultVisibility = {
  ...base,
  groupResults: [
    { round: 1, groupName: 'Published', isSubmitted: true, teams: [] },
    { round: 2, groupName: 'Draft', isSubmitted: false, teams: [{ rank: 0 }] },
    {
      round: 1,
      groupName: 'Legacy Timestamp',
      isSubmitted: false,
      submittedAt: new Date('2026-07-09T08:00:00.000Z'),
      teams: [{ rank: 0 }]
    },
    { round: 1, groupName: 'Legacy Ranked', isSubmitted: false, teams: [{ rank: 1 }] }
  ]
};
const safeResultVisibility = sanitizePublicTournament(rawResultVisibility);
const participantResultVisibility = withViewerTournamentContext(
  safeResultVisibility,
  { ...rawResultVisibility, participants: [participantId] },
  participantId,
  [],
  'player',
  now
);
assert.deepStrictEqual(
  participantResultVisibility.groupResults.map((result) => result.groupName),
  ['Published', 'Legacy Timestamp', 'Legacy Ranked']
);
const hostResultVisibility = withViewerTournamentContext(
  safeResultVisibility,
  rawResultVisibility,
  String(base.host),
  [],
  'player',
  now
);
assert.deepStrictEqual(
  hostResultVisibility.groupResults.map((result) => result.groupName),
  ['Published', 'Draft', 'Legacy Timestamp', 'Legacy Ranked']
);

const broadcast = withoutViewerTournamentContext({ ...base }, base, now);
assert.strictEqual(broadcast.effectivePhase, 'Registration Open');
assert.strictEqual(Object.hasOwn(broadcast, 'viewerCanJoin'), false);
assert.strictEqual(Object.hasOwn(broadcast, 'viewerJoinReason'), false);
assert.strictEqual(Object.hasOwn(broadcast, 'viewerParticipation'), false);

const closedNow = new Date('2026-07-09T06:34:30.000Z');
const closed = withViewerTournamentContext(
  { ...base },
  { ...base, participants: [participantId] },
  participantId,
  [],
  'player',
  closedNow
);
assert.strictEqual(closed.effectivePhase, 'Registration Closed');
assert.strictEqual(closed.viewerCanWithdraw, false);

// Guard against later code paths reintroducing environment-dependent parsing
// or raw-status-only registration checks.
const source = fs.readFileSync(path.join(__dirname, 'tournamentController.js'), 'utf8');
const userSource = fs.readFileSync(path.join(__dirname, 'userController.js'), 'utf8');
assert(source.includes('parseTournamentDateTime(regStartInput, canonicalTimezone)'));
assert(source.includes('parseTournamentDateTime(\n          updateData.registrationStartDate'));
assert(source.includes('isTournamentRegistrationOpen(tournament, registrationNow)'));
assert(source.includes('const windowQuery = registrationWindowQuery(now)'));
assert(source.includes('ongoingWindowQuery(now)'));
assert(source.includes('completedWindowQuery(now)'));
assert(source.includes("new Set(['upcoming', 'recent', 'completed', 'hosted', 'participating', 'all'])"));
assert(source.includes("if (filter === 'upcoming')"));
assert(source.includes('Object.assign(queryFilter, upcomingWindowQuery(now))'));
assert(source.includes('viewerCanJoin'));
assert(userSource.includes('isTournamentRegistrationOpen(duoTournament, now)'));
assert(userSource.includes('const registrationQuery = registrationWindowQuery(now)'));

console.log('Tournament lifecycle and viewer eligibility contract tests passed');
