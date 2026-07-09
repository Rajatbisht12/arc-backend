const User = require('../models/User');
const Tournament = require('../models/Tournament');
const { buildTournamentEntrantRemovalUpdate } = require('../utils/tournamentCompetitionState');

const generatedDuoTeamQuery = (teamIds) => ({
  _id: { $in: teamIds },
  userType: 'team',
  'teamInfo.isGeneratedDuo': true
});

const cleanupGeneratedDuoTeams = async (teamIds = []) => {
  const ids = Array.from(new Set(teamIds.map(String).filter(Boolean)));
  if (ids.length === 0) return { generatedTeamIds: [] };
  const teams = await User.find(generatedDuoTeamQuery(ids))
    .select('_id teamInfo.members.user')
    .lean();
  if (teams.length === 0) return { generatedTeamIds: [] };

  const now = new Date();
  await User.updateMany(
    { _id: { $in: teams.map((team) => team._id) } },
    { $set: { isActive: false, deletedAt: now } }
  );
  await User.updateMany(
    { 'playerInfo.joinedTeams.team': { $in: teams.map((team) => team._id) } },
    { $pull: { 'playerInfo.joinedTeams': { team: { $in: teams.map((team) => team._id) } } } }
  );
  for (const team of teams) {
    const memberIds = (team.teamInfo?.members || []).map((member) => member.user);
    // Scope reservation cleanup to tournaments actually containing this
    // generated entity; normal teams and unrelated Duo reservations are never
    // touched.
    await Tournament.updateMany(
      { teams: team._id },
      buildTournamentEntrantRemovalUpdate(team._id, memberIds)
    );
  }
  return { generatedTeamIds: teams.map((team) => String(team._id)) };
};

module.exports = { generatedDuoTeamQuery, cleanupGeneratedDuoTeams };
