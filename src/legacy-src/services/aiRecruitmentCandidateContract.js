const buildSmartSearchCandidate = ({
  candidate,
  analysis,
  profile,
  profileType,
  searchType
}) => {
  const sourcePlayer = profile?.player || {};
  const sourcePlayerProfile = sourcePlayer.profile || {};

  return {
    ...candidate,
    ...analysis,
    profile: {
      _id: candidate.profileId,
      profileType,
      game: candidate.game,
      role: searchType === 'players' ? candidate.role : undefined,
      staffRole: searchType === 'staff' ? candidate.role : undefined,
      rank: candidate.rank,
      experience: candidate.experience,
      tournamentExperience: candidate.tournamentExperience,
      kdRatio: candidate.kdRatio,
      winRate: candidate.winRate,
      inGameName: candidate.inGameName,
      profileCode: profile?.profileCode || candidate.profileCode
    },
    player: {
      ...sourcePlayer,
      _id: sourcePlayer._id || candidate.playerId,
      username: sourcePlayer.username || candidate.playerName,
      profile: {
        ...sourcePlayerProfile,
        displayName: sourcePlayerProfile.displayName || candidate.playerName
      }
    },
    expectations: {
      expectedSalary: candidate.expectedSalary,
      preferredLocation: candidate.preferredLocation
    }
  };
};

module.exports = { buildSmartSearchCandidate };
