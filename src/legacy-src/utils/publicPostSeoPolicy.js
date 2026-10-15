const { isPublicProfileSeoEligible } = require('./publicProfileSeoPolicy');
const { normalizePrivacySettings } = require('./privacyPolicy');
const { rewritePublicMediaUrl } = require('./mediaDelivery');

// Only an explicit post-level public choice qualifies. The product's older
// anonymous-read compatibility rules are deliberately broader than indexing.
const publicPostSeoFilter = Object.freeze({
  visibility: 'public',
  isActive: true,
  hiddenByAdmin: false
});

const isPublicPostSeoEligible = post => Boolean(
  post
  && post.visibility === 'public'
  && post.isActive === true
  && post.hiddenByAdmin === false
  && post.author
  && isPublicProfileSeoEligible(post.author)
  && normalizePrivacySettings(post.author.privacySettings).showPostsToFollowers === true
);

const publicPostPreviewUrl = value => {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(rewritePublicMediaUrl(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    if (url.hostname !== 'media.squadhunt.com') return '';
    if (!/^\/gaming-social\/(?:posts|post-covers)\//.test(url.pathname)) return '';
    if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname)) return '';
    return url.toString();
  } catch {
    return '';
  }
};

const postPreview = post => {
  for (const item of post?.content?.media || []) {
    const url = publicPostPreviewUrl(item?.type === 'image' ? item.url : item?.type === 'video' ? item.coverUrl : '');
    if (!url) continue;
    const width = Number(item.width);
    const height = Number(item.height);
    return {
      url,
      ...(item.type === 'image' && Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
        ? { width, height } : {})
    };
  }
  return null;
};

module.exports = { publicPostSeoFilter, isPublicPostSeoEligible, publicPostPreviewUrl, postPreview };
