const Post = require('../models/Post');
const { publicPostSeoFilter, isPublicPostSeoEligible, postPreview } = require('../utils/publicPostSeoPolicy');
const { PAGE_SIZE, candidateCount, afterFilter, startCursorForPage, rememberNextPage } = require('../utils/publicSitemapPagination');
const log = require('../utils/logger');

const postFields = 'author visibility isActive hiddenByAdmin content.text content.media.type content.media.url content.media.coverUrl content.media.width content.media.height createdAt editedAt';
const authorFields = 'username userType isActive moderationStatus deletedAt isSystemAccount isSuperUser needsProfileCompletion adminControls.loginDisabled privacySettings.profileVisibility privacySettings.showPostsToFollowers profile.displayName';
const noStore = res => res.setHeader('Cache-Control', 'private, no-store, max-age=0');
const unavailable = res => res.status(404).json({ success: false, message: 'Public post not found' });

const getPublicPostSeo = async (req, res) => {
  noStore(res);
  try {
    const post = await Post.findOne({ _id: req.params.id, ...publicPostSeoFilter })
      .select(postFields).populate('author', authorFields).lean();
    if (!isPublicPostSeoEligible(post)) return unavailable(res);
    const author = post.author;
    return res.status(200).json({ success: true, data: { post: {
      id: String(post._id),
      caption: post.content?.text || '',
      preview: postPreview(post),
      createdAt: post.createdAt || null,
      editedAt: post.editedAt || null,
      author: { username: author.username, displayName: author.profile?.displayName || '' }
    } } });
  } catch (error) {
    log.error('Public post SEO lookup failed', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Public post unavailable' });
  }
};

const getPublicClipSeo = async (req, res) => {
  noStore(res);
  try {
    const post = await Post.findOne({
      _id: req.params.id, ...publicPostSeoFilter, 'content.media.type': 'video'
    }).select(postFields).populate('author', authorFields).lean();
    if (!isPublicPostSeoEligible(post) || !post.content?.media?.some(item => item.type === 'video')) return unavailable(res);
    return res.status(200).json({ success: true, data: { clip: {
      id: String(post._id),
      caption: post.content?.text || '',
      preview: postPreview(post),
      createdAt: post.createdAt || null,
      author: { username: post.author.username, displayName: post.author.profile?.displayName || '' }
    } } });
  } catch (error) {
    log.error('Public clip SEO lookup failed', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Public clip unavailable' });
  }
};

const getPublicPostSitemapCount = async (_req, res) => {
  noStore(res);
  try {
    const count = await candidateCount(Post, publicPostSeoFilter, 'posts');
    return res.status(200).json({ success: true, data: { pages: Math.ceil(count / PAGE_SIZE) } });
  } catch (error) {
    log.error('Public post sitemap count failed', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Public post sitemap unavailable' });
  }
};

const getPublicPostSitemap = async (req, res) => {
  noStore(res);
  const page = Number(req.query.page);
  if (!Number.isSafeInteger(page) || page < 1) {
    return res.status(400).json({ success: false, message: 'Invalid sitemap page' });
  }
  try {
    const count = await candidateCount(Post, publicPostSeoFilter, 'posts');
    if (page > Math.ceil(count / PAGE_SIZE)) return res.status(404).json({ success: false, message: 'Sitemap page not found' });
    const cursor = await startCursorForPage(Post, publicPostSeoFilter, 'posts', page);
    if (cursor === null) return res.status(503).json({ success: false, message: 'Sitemap page temporarily unavailable' });
    // Indexed keyset reads; author eligibility is rechecked before any ID leaves the server.
    const posts = await Post.find(afterFilter(publicPostSeoFilter, cursor)).sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .select('author visibility isActive hiddenByAdmin editedAt').populate('author', authorFields).lean();
    await rememberNextPage('posts', page, posts);
    return res.status(200).json({ success: true, data: {
      page,
      posts: posts.filter(isPublicPostSeoEligible).map(post => ({
        id: String(post._id),
        ...(post.editedAt ? { lastmod: post.editedAt } : {})
      }))
    } });
  } catch (error) {
    log.error('Public post sitemap lookup failed', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Public post sitemap unavailable' });
  }
};

module.exports = { getPublicPostSeo, getPublicClipSeo, getPublicPostSitemapCount, getPublicPostSitemap, PAGE_SIZE };
