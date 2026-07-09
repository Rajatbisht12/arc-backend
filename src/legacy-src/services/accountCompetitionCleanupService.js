const User = require('../models/User');
const Tournament = require('../models/Tournament');
const TournamentHostActiveLock = require('../models/TournamentHostActiveLock');
const RosterInvite = require('../models/RosterInvite');
const StaffInvite = require('../models/StaffInvite');
const LeaveRequest = require('../models/LeaveRequest');
const log = require('../utils/logger');
const { buildTournamentEntrantRemovalUpdate } = require('../utils/tournamentCompetitionState');

const cleanupAccountCompetitionReferences = async ({ userId, userType }) => {
  const generatedDuoTeams = userType === 'team'
    ? []
    : await User.find({
        userType: 'team',
        'teamInfo.isGeneratedDuo': true,
        'teamInfo.members.user': userId
      })
      .select('_id teamInfo.members.user')
      .lean();
  const removedTeamIds = [
    ...(userType === 'team' ? [userId] : []),
    ...generatedDuoTeams.map((team) => team._id)
  ];
  const entrantRemovals = [
    { entrantId: userId, members: userType === 'team' ? [] : [userId], includeReservationOnly: userType !== 'team' },
    ...generatedDuoTeams.map((team) => ({
      entrantId: team._id,
      members: (team.teamInfo?.members || []).map((member) => member.user),
      includeReservationOnly: false
    }))
  ];

  const failures = [];
  const run = async (step, operation) => {
    try {
      await operation();
    } catch (error) {
      failures.push({ step, error: String(error) });
      log.error('Account competition cleanup step failed', {
        userId: String(userId),
        step,
        error: String(error)
      });
    }
  };
  const now = new Date();

  await run('cancel_hosted_tournaments', () => Tournament.updateMany(
    {
      host: userId,
      status: { $in: ['Upcoming', 'Registration Open', 'Ongoing'] },
      $or: [
        { tournamentEndDate: { $gte: now } },
        { tournamentEndDate: null, endDate: { $gte: now } },
        { tournamentEndDate: null, endDate: null }
      ]
    },
    { $set: { status: 'Cancelled' } }
  ));
  await run('release_host_locks', () => TournamentHostActiveLock.deleteMany({ host: userId }));

  for (const removal of entrantRemovals) {
    const referenceConditions = [
      { participants: removal.entrantId },
      { teams: removal.entrantId },
      { 'groups.participants': removal.entrantId },
      { 'matches.team1': removal.entrantId },
      { 'matches.team2': removal.entrantId },
      { 'groupResults.teams.teamId': removal.entrantId },
      { 'qualifications.qualifiedTeams': removal.entrantId },
      { 'finalResult.standings.teamId': removal.entrantId }
    ];
    if (removal.includeReservationOnly && removal.members.length > 0) {
      referenceConditions.push({ duoRegistrationMembers: { $in: removal.members } });
    }
    await run(`remove_tournament_entrant:${String(removal.entrantId)}`, () => Tournament.updateMany(
      { $or: referenceConditions },
      buildTournamentEntrantRemovalUpdate(removal.entrantId, removal.members)
    ));
  }

  if (generatedDuoTeams.length > 0) {
    await run('deactivate_generated_duo_teams', () => User.updateMany(
      { _id: { $in: generatedDuoTeams.map((team) => team._id) } },
      { $set: { isActive: false, deletedAt: now } }
    ));
  }
  await run('remove_user_from_team_membership', () => User.updateMany(
    { userType: 'team' },
    {
      $pull: {
        'teamInfo.members': { user: userId },
        'teamInfo.rosters.$[].players': { user: userId },
        'teamInfo.staff': { user: userId }
      }
    }
  ));
  if (removedTeamIds.length > 0) {
    await run('remove_joined_team_references', () => User.updateMany(
      { 'playerInfo.joinedTeams.team': { $in: removedTeamIds } },
      { $pull: { 'playerInfo.joinedTeams': { team: { $in: removedTeamIds } } } }
    ));
  }

  const affectedInviteQuery = {
    status: 'pending',
    $or: [
      { player: userId },
      ...(removedTeamIds.length > 0 ? [{ team: { $in: removedTeamIds } }] : [])
    ]
  };
  const inviteCancellation = {
    $set: { status: 'cancelled', respondedAt: now },
    $unset: { pendingKey: 1 }
  };
  await run('cancel_roster_invites', () => RosterInvite.updateMany(affectedInviteQuery, inviteCancellation));
  await run('cancel_staff_invites', () => StaffInvite.updateMany(affectedInviteQuery, inviteCancellation));
  await run('close_leave_requests', () => LeaveRequest.updateMany(
    {
      status: 'pending',
      $or: [
        { player: userId },
        ...(removedTeamIds.length > 0 ? [{ team: { $in: removedTeamIds } }] : [])
      ]
    },
    {
      $set: {
        status: 'rejected',
        reviewedAt: now,
        reviewNotes: 'Closed because the related account was deleted.'
      }
    }
  ));

  return {
    cleanupPending: failures.length > 0,
    failures,
    removedTeamIds: removedTeamIds.map(String)
  };
};

module.exports = { cleanupAccountCompetitionReferences };
