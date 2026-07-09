const Tournament = require('../models/Tournament');
const TournamentHostActiveLock = require('../models/TournamentHostActiveLock');
const User = require('../models/User');
const PaymentTransaction = require('../models/PaymentTransaction');
const { deleteFile } = require('../utils/cloudinary');
const log = require('../utils/logger');
const { cleanupGeneratedDuoTeams } = require('./generatedDuoTeamService');

/**
 * Atomically claim deletion of a tournament, then perform idempotent reference
 * cleanup shared by host and admin entry points. Cleanup failures are reported
 * and logged without turning an already-committed deletion into a misleading
 * HTTP failure that a caller might retry.
 */
const deleteTournamentAndCleanup = async ({ tournamentId, expectedHostId = null }) => {
  const filter = { _id: tournamentId };
  if (expectedHostId) filter.host = expectedHostId;

  const candidate = await Tournament.findOne(filter).select('+bannerPublicId +entryFee');
  if (!candidate) return null;
  const unresolvedPayment = await PaymentTransaction.exists({
    type: 'tournament',
    referenceId: candidate._id,
    status: { $in: ['pending', 'completed'] }
  });
  if (Number(candidate.entryFee) > 0 || unresolvedPayment) {
    return {
      blocked: true,
      tournament: candidate,
      cleanupFailures: [],
      code: 'LEGACY_PAID_TOURNAMENT_REQUIRES_RECONCILIATION'
    };
  }

  const tournament = await Tournament.findOneAndDelete({
    ...filter,
    _id: candidate._id
  }).select('+bannerPublicId +entryFee');
  if (!tournament) return null;

  const registeredTeams = await User.find({
    _id: { $in: tournament.teams || [] },
    userType: 'team'
  }).select('teamInfo.members.user').lean();
  const notificationRecipientIds = Array.from(new Set([
    ...(tournament.participants || []).map(String),
    ...(tournament.teams || []).map(String),
    ...registeredTeams.flatMap((team) => (
      (team.teamInfo?.members || []).map((member) => String(member.user)).filter(Boolean)
    ))
  ]));

  const operations = [
    {
      name: 'active-host-lock',
      run: () => TournamentHostActiveLock.deleteMany({ tournament: tournament._id })
    },
    {
      name: 'player-history',
      run: () => User.updateMany(
        { 'playerInfo.tournamentHistory.tournamentId': tournament._id },
        { $pull: { 'playerInfo.tournamentHistory': { tournamentId: tournament._id } } }
      )
    },
    {
      name: 'generated-duo-teams',
      run: () => cleanupGeneratedDuoTeams(tournament.teams || [])
    },
    ...(tournament.bannerPublicId ? [{
      name: 'banner',
      run: () => deleteFile(tournament.bannerPublicId)
    }] : [])
  ];
  const settled = await Promise.allSettled(operations.map((operation) => operation.run()));
  const cleanupFailures = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    const failure = {
      operation: operations[index].name,
      error: String(result.reason)
    };
    log.error('Tournament deletion cleanup failed', {
      ...failure,
      tournamentId: String(tournament._id)
    });
    return [failure];
  });

  return { tournament, cleanupFailures, notificationRecipientIds, blocked: false };
};

module.exports = { deleteTournamentAndCleanup };
