const User = require('../models/User');
const { usernameOwnerFilter } = require('../services/usernameLookupService');
const { publicProfileSeoFilter, isPublicProfileSeoEligible, publicAvatarUrl } = require('../utils/publicProfileSeoPolicy');
const { PAGE_SIZE, candidateCount, afterFilter, startCursorForPage, rememberNextPage } = require('../utils/publicSitemapPagination');
const log = require('../utils/logger');

const fields = 'username userType isActive moderationStatus deletedAt isSystemAccount isSuperUser needsProfileCompletion adminControls.loginDisabled privacySettings.profileVisibility profile.displayName profile.avatar profile.bio';

const noStore = res => res.setHeader('Cache-Control', 'private, no-store, max-age=0');

const getPublicProfileSeo = async (req, res) => {
  noStore(res);
  try {
    const username = req.params.username;
    const user = await User.findOne(await usernameOwnerFilter(username, publicProfileSeoFilter))
      .select(fields).lean();
    if (!isPublicProfileSeoEligible(user)) {
      return res.status(404).json({ success: false, message: 'Public profile not found' });
    }
    return res.status(200).json({
      success: true,
      data: {
        user: {
          username: user.username,
          userType: user.userType,
          profile: {
            displayName: user.profile?.displayName || '',
            avatar: publicAvatarUrl(user.profile?.avatar),
            bio: user.profile?.bio || ''
          }
        }
      }
    });
  } catch (error) {
    log.error('Public profile SEO lookup failed', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Public profile unavailable' });
  }
};

const getPublicProfileSitemap = async (req, res) => {
  noStore(res);
  const page = Number(req.query.page);
  if (!Number.isSafeInteger(page) || page < 1) {
    return res.status(400).json({ success: false, message: 'Invalid sitemap page' });
  }
  try {
    const count = await candidateCount(User, publicProfileSeoFilter, 'profiles');
    if (page > Math.ceil(count / PAGE_SIZE)) return res.status(404).json({ success: false, message: 'Sitemap page not found' });
    const cursor = await startCursorForPage(User, publicProfileSeoFilter, 'profiles', page);
    if (cursor === null) return res.status(503).json({ success: false, message: 'Sitemap page temporarily unavailable' });
    const users = await User.find(afterFilter(publicProfileSeoFilter, cursor))
      .sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .select(fields).lean();
    await rememberNextPage('profiles', page, users);
    return res.status(200).json({
      success: true,
      data: {
        usernames: users.filter(isPublicProfileSeoEligible).map(user => user.username),
        page
      }
    });
  } catch (error) {
    log.error('Public profile sitemap lookup failed', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Public profile sitemap unavailable' });
  }
};

const getPublicProfileSitemapCount = async (_req, res) => {
  noStore(res);
  try {
    const count = await candidateCount(User, publicProfileSeoFilter, 'profiles');
    return res.status(200).json({ success: true, data: { pages: Math.ceil(count / PAGE_SIZE) } });
  } catch (error) {
    log.error('Public profile sitemap count failed', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Public profile sitemap unavailable' });
  }
};

module.exports = { getPublicProfileSeo, getPublicProfileSitemap, getPublicProfileSitemapCount, PAGE_SIZE };
