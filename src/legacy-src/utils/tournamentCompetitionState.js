const buildTournamentEntrantRemovalUpdate = (entrantId, duoMemberIds = []) => {
  const pull = {
    participants: entrantId,
    teams: entrantId,
    'groups.$[].participants': entrantId,
    matches: { $or: [{ team1: entrantId }, { team2: entrantId }] },
    'groupResults.$[].teams': { teamId: entrantId },
    'qualifications.$[].qualifiedTeams': entrantId,
    winners: { team: entrantId },
    'finalResult.standings': { teamId: entrantId },
    'finalResult.specialPrizeWinners': { winnerId: entrantId }
  };
  if (duoMemberIds.length > 0) {
    pull.duoRegistrationMembers = { $in: duoMemberIds };
  }
  return { $pull: pull };
};

module.exports = { buildTournamentEntrantRemovalUpdate };
