const { normalizePrivacySettings } = require('./privacyPolicy');
const { rewritePublicMediaUrl } = require('./mediaDelivery');

// Search discovery is opt-in at the canonical setting. A legacy default or an
// anonymously readable summary is not evidence of an explicit public choice.
const publicProfileSeoFilter = Object.freeze({
  username: /^[A-Za-z0-9_]{3,20}$/,
  isActive: true,
  moderationStatus: 'active',
  deletedAt: null,
  userType: { $in: ['player', 'creator', 'team'] },
  isSystemAccount: { $ne: true },
  isSuperUser: { $ne: true },
  needsProfileCompletion: { $ne: true },
  'adminControls.loginDisabled': { $ne: true },
  'privacySettings.profileVisibility': 'public'
});

const isPublicProfileSeoEligible = user => Boolean(
  user
  && user.isActive === true
  && user.moderationStatus === 'active'
  && !user.deletedAt
  && ['player', 'creator', 'team'].includes(user.userType)
  && user.isSystemAccount !== true
  && user.isSuperUser !== true
  && user.needsProfileCompletion !== true
  && user.adminControls?.loginDisabled !== true
  && user.privacySettings?.profileVisibility === 'public'
  && normalizePrivacySettings(user.privacySettings).profileVisibility === 'public'
  && /^[A-Za-z0-9_]{3,20}$/.test(user.username || '')
);

const publicAvatarUrl = value => {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(rewritePublicMediaUrl(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    if (url.hostname === 'media.squadhunt.com' && url.pathname.startsWith('/gaming-social/avatars/')) return url.toString();
    if (url.hostname === 'api.squadhunt.in' && url.pathname.startsWith('/uploads/avatars/')) return url.toString();
  } catch {
    return '';
  }
  return '';
};

module.exports = { publicProfileSeoFilter, isPublicProfileSeoEligible, publicAvatarUrl };
