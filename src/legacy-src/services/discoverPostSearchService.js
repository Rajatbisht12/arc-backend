const Post = require('../models/Post');
const User = require('../models/User');
const { formatUserDTO } = require('../utils/dto');
const { resolveClientMediaPayload } = require('../utils/privateMediaDelivery');
const { normalizeQuerySearch, buildPrefixRegex, escapeRegex } = require('../utils/searchQuery');
const { getRelationshipContext, buildAudienceFilter } = require('./recommendationService');

const normalizeId = (value) => String(value?._id || value || '');
const MAX_CREATOR_MATCHES = 250;

const buildDiscoverSearchFilter = ({ audienceFilter, search, matchingAuthorIds, mode }) => {
  const captionPattern = escapeRegex(search);
  const contentMatch = [
    { 'content.text': { $regex: captionPattern, $options: 'i' } },
    { tags: { $regex: captionPattern, $options: 'i' } }
  ];
  if (matchingAuthorIds.length) contentMatch.push({ author: { $in: matchingAuthorIds } });
  return {
    ...audienceFilter,
    ...(mode === 'feed'
      ? { 'content.media': { $not: { $elemMatch: { type: 'video' } } } }
      : {}),
    $and: [...(audienceFilter.$and || []), { $or: contentMatch }]
  };
};

const toDiscoverSearchTile = (post, isGuest) => ({
  _id: normalizeId(post),
  author: post.author ? formatUserDTO(post.author, isGuest) : null,
  content: post.content,
  postType: post.postType,
  createdAt: post.createdAt,
  viewCount: Number(post.views) || 0
});

// Search only the first requested page. The regular Feed/Clips recommendation
// path deliberately does much more work and must not be used as a search API.
const getDiscoverSearchPosts = async ({ user, query = {}, mode = 'feed' }) => {
  const search = normalizeQuerySearch(query.search);
  const limit = Math.min(30, Math.max(1, Number.parseInt(query.limit, 10) || 15));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const relationship = await getRelationshipContext(user);
  const audienceFilter = buildAudienceFilter({ user, mode, relationship, query });

  // A one-letter prefix can match most accounts. Never transfer an unbounded
  // author ID list into a Post $in filter. Broad creator names are searchable
  // in the Users tab; narrower prefixes retain creator matching here.
  let matchingAuthors = [];
  if (search.length > 1) {
    const authorPattern = buildPrefixRegex(search);
    const candidates = await User.find({
      isActive: true,
      isSuperUser: { $ne: true },
      $or: [
        { username: { $regex: authorPattern, $options: 'i' } },
        { 'profile.displayName': { $regex: authorPattern, $options: 'i' } }
      ]
    }).select('_id').limit(MAX_CREATOR_MATCHES + 1).lean();
    // Dropping creator matches when over budget is preferable to silently
    // returning only the first arbitrary subset of matching creators.
    if (candidates.length <= MAX_CREATOR_MATCHES) matchingAuthors = candidates;
  }

  const filter = buildDiscoverSearchFilter({
    audienceFilter,
    search,
    matchingAuthorIds: matchingAuthors.map((author) => author._id),
    mode
  });

  const found = await Post.find(filter)
    .select('_id author content.text content.media.type content.media.url content.media.publicId content.media.coverUrl content.media.coverPublicId content.media.thumbnailUrl content.media.posterUrl content.media.width content.media.height content.media.aspectRatio postType createdAt views')
    .populate('author', 'username profile.displayName profile.avatar profilePicture avatar userType privacySettings isActive')
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .lean()
    .exec();
  const hasMore = found.length > limit;
  const pagePosts = hasMore ? found.slice(0, limit) : found;
  // Search screens render preview tiles and navigate by ID. Do not populate
  // comment/like arrays or the full Post; the canonical detail endpoint loads
  // interaction state only when the user opens a result.
  const posts = pagePosts.map((post) => toDiscoverSearchTile(post, !user || user.userType === 'guest'));
  const delivered = await resolveClientMediaPayload({ posts });
  return {
    posts: delivered.posts,
    pagination: {
      current: page,
      count: pagePosts.length,
      hasMore,
      nextCursor: null,
      cursor: null
    },
    recommendation: { algorithm: 'discover-search', mode, context: 'search' }
  };
};

module.exports = { getDiscoverSearchPosts, buildDiscoverSearchFilter, toDiscoverSearchTile };
