const TeamRecruitment = require('../models/TeamRecruitment');
const PlayerProfile = require('../models/PlayerProfile');
const Tournament = require('../models/Tournament');
const Scrim = require('../models/Scrim');
const log = require('../utils/logger');
const {
  publicShareCode, publicSocialImageUrl, publicAvatarUrl,
  isLiveRecruitmentSeoEligible, isPublicCompetitionSeoEligible
} = require('../utils/publicSocialSeoPolicy');

const ownerFields = 'username userType isActive moderationStatus deletedAt isSystemAccount isSuperUser needsProfileCompletion adminControls.loginDisabled privacySettings.profileVisibility profile.displayName profile.avatar profile.banner';
const noStore = res => res.setHeader('Cache-Control', 'private, no-store, max-age=0');
const missing = res => res.status(404).json({ success: false, message: 'Public page not found' });
const failed = (res, error) => {
  log.error('Public social SEO lookup failed', { error: String(error) });
  return res.status(500).json({ success: false, message: 'Public page unavailable' });
};

const getPublicRecruitmentSeo = async (req, res) => {
  noStore(res);
  const code = publicShareCode(req.params.code);
  if (!code) return missing(res);
  try {
    const listing = await TeamRecruitment.findOne({ recruitmentCode: code, isActive: true, status: 'active' })
      .select('recruitmentCode team recruitmentType game role staffRole requirements.additionalRequirements requirements.requiredSkills status isActive expiresAt')
      .populate('team', ownerFields).lean();
    if (!isLiveRecruitmentSeoEligible(listing, listing?.team) || listing.team.userType !== 'team') return missing(res);
    return res.status(200).json({ success: true, data: { recruitment: {
      code: listing.recruitmentCode,
      role: listing.role || listing.staffRole || '',
      game: listing.game || '',
      description: listing.requirements?.additionalRequirements || listing.requirements?.requiredSkills || '',
      team: {
        username: listing.team.username,
        displayName: listing.team.profile?.displayName || '',
        image: publicSocialImageUrl(listing.team.profile?.banner) || publicAvatarUrl(listing.team.profile?.avatar)
      }
    } } });
  } catch (error) { return failed(res, error); }
};

const getPublicPlayerProfileSeo = async (req, res) => {
  noStore(res);
  const code = publicShareCode(req.params.code);
  if (!code) return missing(res);
  try {
    const listing = await PlayerProfile.findOne({ profileCode: code, isActive: true, status: 'active' })
      .select('profileCode player profileType game role staffRole playerInfo.additionalInfo professionalInfo.skillsAndExpertise status isActive expiresAt')
      .populate('player', ownerFields).lean();
    if (!isLiveRecruitmentSeoEligible(listing, listing?.player) || listing.player.userType !== 'player') return missing(res);
    return res.status(200).json({ success: true, data: { profile: {
      code: listing.profileCode,
      role: listing.role || listing.staffRole || '',
      game: listing.game || '',
      description: listing.playerInfo?.additionalInfo || listing.professionalInfo?.skillsAndExpertise || '',
      player: {
        username: listing.player.username,
        displayName: listing.player.profile?.displayName || '',
        image: publicAvatarUrl(listing.player.profile?.avatar)
      }
    } } });
  } catch (error) { return failed(res, error); }
};

const getPublicTournamentSeo = async (req, res) => {
  noStore(res);
  const code = publicShareCode(req.params.code);
  if (!code) return missing(res);
  try {
    const tournament = await Tournament.findOne({ tournamentCode: code, status: { $ne: 'Cancelled' } })
      .select('tournamentCode host name description banner status')
      .populate('host', ownerFields).lean();
    if (!isPublicCompetitionSeoEligible(tournament, tournament?.host,
      ['Upcoming', 'Registration Open', 'Ongoing', 'Completed'])) return missing(res);
    return res.status(200).json({ success: true, data: { tournament: {
      code: tournament.tournamentCode,
      name: tournament.name || '',
      description: tournament.description || '',
      image: publicSocialImageUrl(tournament.banner)
    } } });
  } catch (error) { return failed(res, error); }
};

const getPublicScrimSeo = async (req, res) => {
  noStore(res);
  const code = publicShareCode(req.params.code);
  if (!code) return missing(res);
  try {
    const scrim = await Scrim.findOne({ scrimCode: code, status: { $ne: 'Cancelled' } })
      .select('scrimCode host name description status')
      .populate('host', ownerFields).lean();
    if (!isPublicCompetitionSeoEligible(scrim, scrim?.host,
      ['Open', 'Full', 'In Progress', 'Completed'])) return missing(res);
    return res.status(200).json({ success: true, data: { scrim: {
      code: scrim.scrimCode,
      name: scrim.name || '',
      description: scrim.description || '',
      image: publicAvatarUrl(scrim.host.profile?.avatar)
    } } });
  } catch (error) { return failed(res, error); }
};

module.exports = {
  getPublicRecruitmentSeo, getPublicPlayerProfileSeo,
  getPublicTournamentSeo, getPublicScrimSeo
};
