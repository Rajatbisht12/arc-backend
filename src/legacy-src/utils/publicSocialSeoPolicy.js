const { isPublicProfileSeoEligible, publicAvatarUrl } = require('./publicProfileSeoPolicy');
const { rewritePublicMediaUrl } = require('./mediaDelivery');

const publicShareCode = value => {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{3,80}$/.test(code) ? code : '';
};

const publicSocialImageUrl = value => {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(rewritePublicMediaUrl(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    if (url.hostname !== 'media.squadhunt.com') return '';
    if (!/^\/gaming-social\/(?:avatars|banners|group-avatars|tournaments)\//.test(url.pathname)) return '';
    if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname)) return '';
    return url.toString();
  } catch { return ''; }
};

const isLiveRecruitmentSeoEligible = (listing, owner, now = new Date()) => Boolean(
  listing
  && listing.isActive === true
  && listing.status === 'active'
  && (!listing.expiresAt || new Date(listing.expiresAt) > now)
  && isPublicProfileSeoEligible(owner)
);

const isPublicCompetitionSeoEligible = (competition, owner, allowedStatuses) => Boolean(
  competition
  && allowedStatuses.includes(competition.status)
  && isPublicProfileSeoEligible(owner)
);

module.exports = {
  publicShareCode, publicSocialImageUrl, publicAvatarUrl,
  isLiveRecruitmentSeoEligible, isPublicCompetitionSeoEligible
};
