const mongoose = require('mongoose');
const Post = require('../models/Post');
const User = require('../models/User');
const Follow = require('../models/Follow');
const PostEngagement = require('../models/PostEngagement');
const BoostDeliveryAttribution = require('../models/BoostDeliveryAttribution');
const { formatPostDTO } = require('../utils/dto');
const { normalizeTag } = require('../utils/hashtags');
const log = require('../utils/logger');
const { getBoostScore, isActiveBoost, getDeliverySource, recordBoostDelivery } = require('./boostService');

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 30;
const MAX_EXCLUDED_IDS = 120;
const CANDIDATE_MULTIPLIER = 8;
// Seen-post cooldown: recently delivered posts are strongly down-ranked and
// recover eligibility gradually — never permanently hidden.
const SEEN_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const SEEN_COOLDOWN_HOURS = 36;
const SEEN_PENALTY_BASE = 85;
const SEEN_PENALTY_HALF_LIFE_HOURS = 7;
const SEEN_FETCH_LIMIT = 400;
// Boosted delivery fairness: a campaign keeps its paid score bonus, but not
// for the same viewer back-to-back, and never more than one boosted slot in
// the first page window.
const BOOST_USER_COOLDOWN_HOURS = 6;
const BOOST_FREQUENCY_CAP = 4;
const BOOST_TOP_WINDOW = 5;
const NEW_POST_KICKER_HOURS = 6;
const MAX_SESSION_SEED_LENGTH = 64;
const MAX_ENGAGEMENT_DURATION_MS = 24 * 60 * 60 * 1000;
const ENGAGEMENT_CONTEXTS = new Set(['feed', 'clips', 'profile', 'search', 'post', 'unknown']);
const ENGAGEMENT_CONTEXT_ALIASES = new Map([
  ['team_profile', 'profile'],
  ['team-profile', 'profile'],
  ['profile-saved', 'profile'],
  ['profile_saved', 'profile'],
  ['profile-liked', 'profile'],
  ['profile_liked', 'profile'],
  ['post-card', 'feed'],
  ['post_card', 'feed'],
  ['post-detail', 'post'],
  ['post_detail', 'post'],
  ['saved', 'profile']
]);

function normalizeEngagementDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), MAX_ENGAGEMENT_DURATION_MS);
}

function normalizeCompletionRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, 1);
}

function normalizeEngagementContext(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return ENGAGEMENT_CONTEXT_ALIASES.get(normalized)
    || (ENGAGEMENT_CONTEXTS.has(normalized) ? normalized : 'unknown');
}

function buildViewEngagementUpdate(payload, updatedAt = new Date()) {
  const { durationMs, completionRate, ...insertPayload } = payload;
  return {
    $setOnInsert: insertPayload,
    $max: {
      durationMs,
      completionRate
    },
    $set: { updatedAt }
  };
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeId(id) {
  if (!id) return '';
  return (id._id || id).toString();
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

function parseExcludedIds(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id && isValidObjectId(id))
    .slice(0, MAX_EXCLUDED_IDS);
}

function encodeCursor(post) {
  if (!post?.createdAt || !post?._id) return null;
  return Buffer.from(JSON.stringify({
    createdAt: new Date(post.createdAt).toISOString(),
    id: post._id.toString()
  })).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded?.createdAt || !decoded?.id || !isValidObjectId(decoded.id)) return null;
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

function postHasVideo(post) {
  return Array.isArray(post?.content?.media)
    && post.content.media.some((media) => media?.type === 'video');
}

function getCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function stableNoise(seed, id) {
  const str = `${seed}:${id}`;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

async function getRelationshipContext(user) {
  if (!user || user.userType === 'guest') {
    const restrictedAuthors = await User.find({
      $or: [
        { isActive: { $ne: true } },
        {
          'privacySettings.showPostsToFollowers': { $exists: true, $ne: true }
        },
        {
          'privacySettings.profileVisibility': { $exists: true, $ne: 'public' }
        },
        {
          'privacySettings.profileVisibility': { $exists: false },
          'privacySettings.accountType': { $exists: true, $ne: 'public' }
        }
      ]
    }).select('_id').lean();
    return {
      currentUserId: null,
      followingIds: new Set(),
      blockedIds: new Set(),
      invisiblePrivateAuthorIds: new Set(restrictedAuthors.map((doc) => normalizeId(doc._id))),
      blockedEitherWayIds: new Set(),
      gamingPreferences: []
    };
  }

  const currentUserId = normalizeId(user._id);
  const blockedFromUser = Array.isArray(user.blockedUsers) ? user.blockedUsers.map(normalizeId) : [];

  const [followDocs, blockedByUsers] = await Promise.all([
    Follow.find({ follower: currentUserId }).select('following').lean(),
    User.find({ blockedUsers: currentUserId }).select('_id').lean()
  ]);

  // Follow is the canonical accepted-relationship store. The legacy arrays
  // are denormalized compatibility data and can be one-sided or stale after a
  // partial historical write, so they must never authorize private content.
  const followingIds = new Set(followDocs.map((doc) => normalizeId(doc.following)).filter(Boolean));
  const blockedIds = new Set(blockedFromUser.filter(Boolean));
  const blockedEitherWayIds = new Set([
    ...blockedIds,
    ...blockedByUsers.map((doc) => normalizeId(doc._id))
  ].filter(Boolean));

  const allowedFollowerIds = [currentUserId, ...followingIds];
  const privateUsers = await User.find({
    _id: { $ne: currentUserId },
    $or: [
      { isActive: { $ne: true } },
      {
        'privacySettings.showPostsToFollowers': { $exists: true, $ne: true }
      },
      {
        _id: { $nin: allowedFollowerIds },
        'privacySettings.profileVisibility': { $exists: true, $ne: 'public' }
      },
      {
        _id: { $nin: allowedFollowerIds },
        'privacySettings.profileVisibility': { $exists: false },
        'privacySettings.accountType': { $exists: true, $ne: 'public' }
      }
    ]
  }).select('_id').lean();

  return {
    currentUserId,
    followingIds,
    blockedIds,
    blockedEitherWayIds,
    invisiblePrivateAuthorIds: new Set(privateUsers.map((doc) => normalizeId(doc._id))),
    gamingPreferences: Array.isArray(user.profile?.gamingPreferences)
      ? user.profile.gamingPreferences.map((item) => String(item).toLowerCase())
      : []
  };
}

function buildAudienceFilter({ user, mode, relationship, query }) {
  const filter = {
    isActive: true,
    hiddenByAdmin: { $ne: true }
  };

  if (mode === 'clips') {
    filter['content.media'] = { $elemMatch: { type: 'video' } };
  }

  if (query.postType) filter.postType = query.postType;
  if (query.author && isValidObjectId(query.author)) filter.author = query.author;
  if (query.tags) {
    // Normalize requested tags to the same lowercase keys posts are indexed
    // under, so hashtag search is case-insensitive (#Valorant === #valorant).
    const wanted = String(query.tags).split(',').map(normalizeTag).filter(Boolean);
    if (wanted.length > 0) filter.tags = { $in: wanted };
  }

  const isGuest = !user || user.userType === 'guest';
  const requestedVisibility = ['public', 'followers', 'private'].includes(query.visibility)
    ? query.visibility
    : null;
  if (requestedVisibility === 'public' || isGuest) {
    filter.visibility = 'public';
  } else if (requestedVisibility === 'followers') {
    filter.visibility = 'followers';
    filter.$and = [{
      $or: [
        { author: relationship.currentUserId },
        { author: { $in: Array.from(relationship.followingIds) } }
      ]
    }];
  } else if (requestedVisibility === 'private') {
    // A client filter must never replace the server-derived audience scope.
    filter.visibility = 'private';
    filter.$and = [{ author: relationship.currentUserId }];
  } else {
    filter.$or = [
      { visibility: 'public' },
      { author: relationship.currentUserId },
      {
        visibility: 'followers',
        author: { $in: Array.from(relationship.followingIds) }
      }
    ];
  }

  const excludedAuthors = new Set([
    ...relationship.blockedEitherWayIds,
    ...relationship.invisiblePrivateAuthorIds
  ]);
  excludedAuthors.delete(relationship.currentUserId);
  if (excludedAuthors.size > 0) {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { author: { $nin: Array.from(excludedAuthors) } }
    ];
  }

  // Hide posts the viewer has reported from their own feeds only. This is a
  // per-viewer suppression (not a global delete) and never affects other
  // users, admins, or moderation views, which read reports separately.
  if (relationship.currentUserId) {
    filter['reports.user'] = { $ne: relationship.currentUserId };
  }

  return filter;
}

function applyCursorAndExclusions(filter, { cursor, excludedIds }) {
  const nextFilter = { ...filter };
  const and = Array.isArray(nextFilter.$and) ? [...nextFilter.$and] : [];

  if (excludedIds.length > 0) {
    and.push({ _id: { $nin: excludedIds } });
  }

  const decoded = decodeCursor(cursor);
  if (decoded) {
    const olderThanBoundary = {
      $or: [
        { createdAt: { $lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, _id: { $lt: decoded.id } }
      ]
    };
    // Ranking selects a scored subset of the candidate window, so posts newer
    // than the boundary can be left undelivered. While the client-reported
    // exclusion list still covers the delivered set, keep that newer region
    // eligible (minus exclusions) so ranked-over posts are not skipped
    // forever. Once the exclusion window saturates, fall back to strictly
    // chronological progress to guarantee termination.
    const allowNewerUnseen = excludedIds.length > 0 && excludedIds.length < Math.floor(MAX_EXCLUDED_IDS * 0.75);
    if (allowNewerUnseen) {
      and.push({
        $or: [
          olderThanBoundary,
          { createdAt: { $gt: decoded.createdAt } }
        ]
      });
    } else {
      and.push(olderThanBoundary);
    }
  }

  if (and.length > 0) nextFilter.$and = and;
  return nextFilter;
}

// The next-page boundary advances only as far as content actually delivered:
// using the oldest *selected* post keeps unselected candidates eligible for
// later pages instead of silently skipping everything the ranker passed over.
function pickNextCursorPost({ selectedPosts, candidates, incomingCursor, excludedCount }) {
  if (!candidates.length) return null;
  const lastCandidate = candidates[candidates.length - 1];
  const oldestSelected = [...selectedPosts].sort((a, b) => {
    const timeDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDelta !== 0) return timeDelta;
    return String(a._id) < String(b._id) ? -1 : 1;
  })[0];
  if (!oldestSelected) return lastCandidate;

  const decoded = decodeCursor(incomingCursor);
  if (decoded && excludedCount >= Math.floor(MAX_EXCLUDED_IDS * 0.75)) {
    const boundaryTime = new Date(oldestSelected.createdAt).getTime();
    if (boundaryTime >= decoded.createdAt.getTime()) {
      // Exclusion window is saturated and selection stayed inside the newer
      // region: advance chronologically so pagination always terminates.
      return lastCandidate;
    }
  }
  return oldestSelected;
}

function normalizeSessionSeed(raw) {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim().slice(0, MAX_SESSION_SEED_LENGTH);
  }
  // Without a client session, rotate by hour bucket so the ordering still
  // changes over time instead of staying frozen for a whole day.
  return new Date().toISOString().slice(0, 13);
}

// Posts recently delivered to this user in this surface. Impressions are
// recorded server-side at serve time; real views (client-tracked) reinforce
// the same signal.
async function getRecentlySeenMap(userId, mode) {
  if (!userId) return new Map();
  const since = new Date(Date.now() - SEEN_LOOKBACK_MS);
  const rows = await PostEngagement.find({
    user: userId,
    context: mode,
    eventType: { $in: ['impression', 'view'] },
    updatedAt: { $gte: since }
  })
    .sort({ updatedAt: -1 })
    .limit(SEEN_FETCH_LIMIT)
    .select('post updatedAt impressionCount')
    .lean()
    .catch(() => []);

  const seenMap = new Map();
  rows.forEach((row) => {
    const postId = normalizeId(row.post);
    if (!postId) return;
    const existing = seenMap.get(postId);
    const lastShownAt = new Date(row.updatedAt || Date.now()).getTime();
    const impressionCount = Math.max(1, Number(row.impressionCount) || 1);
    if (!existing) {
      seenMap.set(postId, { lastShownAt, impressionCount });
      return;
    }
    existing.lastShownAt = Math.max(existing.lastShownAt, lastShownAt);
    existing.impressionCount = Math.max(existing.impressionCount, impressionCount);
  });
  return seenMap;
}

async function getBoostDeliveryMap(userId, mode) {
  if (!userId) return new Map();
  const rows = await BoostDeliveryAttribution.find({
    user: userId,
    context: mode,
    expiresAt: { $gt: new Date() }
  })
    .select('post deliveredAt deliveryCount')
    .lean()
    .catch(() => []);

  const deliveryMap = new Map();
  rows.forEach((row) => {
    const postId = normalizeId(row.post);
    if (!postId) return;
    deliveryMap.set(postId, {
      deliveredAt: new Date(row.deliveredAt || Date.now()).getTime(),
      deliveryCount: Math.max(1, Number(row.deliveryCount) || 1)
    });
  });
  return deliveryMap;
}

function buildImpressionOps(posts, { userId, mode, sessionSeed }) {
  const now = new Date();
  return posts.map((post, index) => ({
    updateOne: {
      filter: { user: userId, post: post._id, eventType: 'impression', context: mode },
      update: {
        $setOnInsert: {
          author: post.author?._id || post.author,
          source: 'organic',
          durationMs: 0,
          completionRate: 0,
          metadata: {}
        },
        $set: {
          updatedAt: now,
          positionShown: index,
          sessionId: sessionSeed || null
        },
        $inc: { impressionCount: 1 }
      },
      upsert: true
    }
  }));
}

async function recordFeedImpressions(posts, { userId, mode, sessionSeed }) {
  if (!userId || !Array.isArray(posts) || posts.length === 0) return;
  const ops = buildImpressionOps(posts, { userId, mode, sessionSeed });
  try {
    await PostEngagement.bulkWrite(ops, { ordered: false });
  } catch (error) {
    // Duplicate-key races between concurrent first impressions are benign.
    if (error?.code !== 11000 && !/E11000/.test(String(error))) {
      log.warn('Failed to record feed impressions', { error: String(error), mode });
    }
  }
}

async function getInterestProfile(userId, relationship) {
  if (!userId) {
    return {
      tagWeights: new Map(),
      authorWeights: new Map(),
      postTypeWeights: new Map(),
      savedPostIds: new Set()
    };
  }

  const recentEvents = await PostEngagement.find({
    user: userId,
    // Server-side delivery impressions are exposure records, not intent
    // signals, and must not inflate author affinity.
    eventType: { $ne: 'impression' }
  })
    .sort({ createdAt: -1 })
    .limit(160)
    .select('post author eventType')
    .lean()
    .catch(() => []);

  const eventPostIds = recentEvents.map((event) => event.post).filter(Boolean);
  const savedUser = await User.findById(userId)
    .select('savedPosts.post')
    .lean()
    .catch(() => null);
  const savedPostIds = Array.isArray(savedUser?.savedPosts)
    ? savedUser.savedPosts.map((item) => item.post).filter(Boolean)
    : [];
  const likedPosts = await Post.find({
    $or: [
      { 'likes.user': userId },
      { 'comments.user': userId },
      { _id: { $in: [...eventPostIds, ...savedPostIds] } }
    ],
    isActive: true
  })
    .sort({ createdAt: -1 })
    .limit(120)
    .select('author tags postType')
    .lean()
    .catch(() => []);

  const tagWeights = new Map();
  const authorWeights = new Map();
  const postTypeWeights = new Map();

  relationship.gamingPreferences.forEach((pref) => {
    tagWeights.set(pref, (tagWeights.get(pref) || 0) + 6);
  });

  recentEvents.forEach((event) => {
    const weight = event.eventType === 'like' ? 5
      : event.eventType === 'comment' ? 7
        : event.eventType === 'share' || event.eventType === 'save' ? 9
          : event.eventType === 'watch' ? 4
            : 2;
    const authorId = normalizeId(event.author);
    if (authorId) authorWeights.set(authorId, (authorWeights.get(authorId) || 0) + weight);
  });

  likedPosts.forEach((post) => {
    const authorId = normalizeId(post.author);
    if (authorId) authorWeights.set(authorId, (authorWeights.get(authorId) || 0) + 4);
    if (post.postType) postTypeWeights.set(post.postType, (postTypeWeights.get(post.postType) || 0) + 2);
    (post.tags || []).forEach((tag) => {
      const key = String(tag).toLowerCase();
      tagWeights.set(key, (tagWeights.get(key) || 0) + 3);
    });
  });

  return {
    tagWeights,
    authorWeights,
    postTypeWeights,
    savedPostIds: new Set(savedPostIds.map(normalizeId).filter(Boolean))
  };
}

function getSeenPenalty(seenEntry, now) {
  if (!seenEntry?.lastShownAt) return 0;
  const hoursSinceShown = Math.max(0, (now - seenEntry.lastShownAt) / 36e5);
  if (hoursSinceShown >= SEEN_COOLDOWN_HOURS) return 0;
  // Repeat exposures decay slower so a post shown many times sinks harder,
  // but the penalty always reaches zero — content is never permanently hidden.
  const repeatFactor = Math.min(2.2, 1 + (Math.max(0, (seenEntry.impressionCount || 1) - 1) * 0.35));
  return SEEN_PENALTY_BASE * Math.exp(-hoursSinceShown / SEEN_PENALTY_HALF_LIFE_HOURS) * repeatFactor;
}

function getDampedBoostScore(post, { mode, now, boostDeliveryMap }) {
  const rawBoost = getBoostScore(post, { mode, now });
  if (rawBoost <= 0) return 0;
  const delivery = boostDeliveryMap?.get(normalizeId(post._id));
  if (!delivery) return rawBoost;
  const hoursSinceDelivery = Math.max(0, (now - delivery.deliveredAt) / 36e5);
  const frequencyCapped = delivery.deliveryCount >= BOOST_FREQUENCY_CAP;
  if (hoursSinceDelivery < BOOST_USER_COOLDOWN_HOURS || frequencyCapped) {
    // The campaign already reached this viewer recently (or hit its per-user
    // cap): the post stays eligible but competes on organic merit only.
    return 0;
  }
  return rawBoost;
}

function scorePost(post, { mode, relationship, interestProfile, seed, seenMap, boostDeliveryMap }) {
  const now = Date.now();
  const createdAt = new Date(post.createdAt).getTime();
  const hoursOld = Math.max(0, (now - createdAt) / 36e5);
  const freshness = Math.exp(-hoursOld / (mode === 'clips' ? 96 : 72));

  const likes = getCount(post.likes);
  const comments = getCount(post.comments);
  const shares = getCount(post.shares);
  const reports = getCount(post.reports);
  const views = Math.max(getCount(post.viewedBy), post.views || 0);
  // Compress engagement to a bounded log scale (~0–90). Raw counts were
  // unbounded, so one very popular post (e.g. 25k views → ~8750) dwarfed
  // freshness/seen-penalty/exploration and stayed pinned at #1 forever, freezing
  // the feed. Log keeps "more engaged ranks higher" but at a magnitude
  // comparable to the other signals, so the seen-penalty and session-seed
  // exploration can actually rotate the order.
  const engagementRaw = (likes * 3) + (comments * 7) + (shares * 9) + (views * 0.35);
  const engagement = Math.log10(1 + engagementRaw) * 22;
  const engagementRate = views > 0 ? ((likes + comments + shares) / views) : (likes + comments + shares);
  const authorId = normalizeId(post.author);
  const ownPostPenalty = relationship.currentUserId && authorId === relationship.currentUserId ? -12 : 0;
  const followingBoost = relationship.followingIds.has(authorId) ? (mode === 'clips' ? 28 : 70) : 0;
  const authorAffinity = interestProfile.authorWeights.get(authorId) || 0;
  const postTypeAffinity = interestProfile.postTypeWeights.get(post.postType) || 0;
  const tagAffinity = (post.tags || []).reduce((sum, tag) => {
    return sum + (interestProfile.tagWeights.get(String(tag).toLowerCase()) || 0);
  }, 0);
  const mediaBoost = postHasVideo(post) ? (mode === 'clips' ? 18 : 4) : 2;
  const boostScore = getDampedBoostScore(post, { mode, now, boostDeliveryMap });
  const qualityPenalty = reports * 25;
  const exploration = stableNoise(seed, post._id) * (mode === 'clips' ? 16 : 10);
  const viralVelocity = engagementRate > 0 ? Math.min(35, engagementRate * 28) : 0;
  // Temporary head start for newly created eligible posts so fresh content
  // reaches the top before engagement accumulates.
  const newPostKicker = hoursOld < NEW_POST_KICKER_HOURS
    ? (mode === 'clips' ? 20 : 26) * Math.exp(-hoursOld / 2.5)
    : 0;
  const seenPenalty = getSeenPenalty(seenMap?.get(normalizeId(post._id)), now);

  const score =
    freshness * (mode === 'clips' ? 85 : 70)
    + engagement
    + viralVelocity
    + followingBoost
    + authorAffinity
    + postTypeAffinity
    + tagAffinity
    + mediaBoost
    + boostScore
    + exploration
    + ownPostPenalty
    + newPostKicker
    - seenPenalty
    - qualityPenalty;

  return Math.round(score * 100) / 100;
}

function selectDiversePosts(scoredPosts, limit, mode) {
  const selected = [];
  const deferred = [];
  const authorCounts = new Map();
  const tagCounts = new Map();
  const maxPerAuthorFirstPass = mode === 'clips' ? 1 : 2;

  for (const item of scoredPosts) {
    const authorId = normalizeId(item.post.author);
    const topTag = Array.isArray(item.post.tags) && item.post.tags.length > 0
      ? String(item.post.tags[0]).toLowerCase()
      : item.post.postType || 'general';
    const authorCount = authorCounts.get(authorId) || 0;
    const tagCount = tagCounts.get(topTag) || 0;

    if (authorCount >= maxPerAuthorFirstPass || tagCount >= 3) {
      deferred.push(item);
      continue;
    }

    selected.push(item);
    authorCounts.set(authorId, authorCount + 1);
    tagCounts.set(topTag, tagCount + 1);
    if (selected.length >= limit) break;
  }

  for (const item of deferred) {
    if (selected.length >= limit) break;
    if (!selected.some((selectedItem) => selectedItem.post._id.toString() === item.post._id.toString())) {
      selected.push(item);
    }
  }

  return selected;
}

// Boosted posts keep paid distribution but never own a fixed slot:
// - at most one boosted post inside the first `topWindow` items;
// - a boosted post only holds position 1 when it earned it organically,
//   otherwise its slot rotates deterministically with the session seed.
function applyBoostPlacement(selected, { seed, topWindow = BOOST_TOP_WINDOW, now = Date.now() } = {}) {
  if (!Array.isArray(selected) || selected.length < 3) return selected;

  const items = [...selected];
  const window = Math.min(topWindow, items.length);
  const isBoosted = (item) => isActiveBoost(item.post, now);
  const organicExists = items.some((item) => !isBoosted(item));
  if (!organicExists) return items;

  // Keep only the strongest boosted item inside the top window; defer the
  // rest just below the window (their relative order is preserved).
  const boostedInWindow = items.slice(0, window).filter(isBoosted);
  if (boostedInWindow.length > 1) {
    const overflow = boostedInWindow.slice(1);
    overflow.reverse().forEach((item) => {
      const fromIndex = items.indexOf(item);
      items.splice(fromIndex, 1);
      items.splice(Math.min(window, items.length), 0, item);
    });
  }

  const first = items[0];
  if (first && isBoosted(first)) {
    const organicScore = first.score - getBoostScore(first.post, { now });
    const bestOrganic = items.find((item) => !isBoosted(item));
    if (bestOrganic && organicScore < bestOrganic.score) {
      // Paid weight alone put it first: rotate it into a seed-derived slot
      // inside the window so the same viewer does not always see it on top.
      const slot = 1 + Math.floor(stableNoise(`${seed}:boost-slot`, normalizeId(first.post._id)) * (window - 1));
      items.splice(0, 1);
      items.splice(Math.min(slot, items.length), 0, first);
    }
  }

  return items;
}

async function findWatchedClipIds(userId) {
  if (!userId) return new Set();
  const [viewEvents, viewedPosts] = await Promise.all([
    PostEngagement.find({ user: userId, eventType: 'view', context: 'clips' })
      .sort({ createdAt: -1 })
      .limit(1500)
      .select('post')
      .lean()
      .catch(() => []),
    Post.find({
      'viewedBy.user': userId,
      'content.media': { $elemMatch: { type: 'video' } }
    })
      .sort({ createdAt: -1 })
      .limit(1500)
      .select('_id')
      .lean()
      .catch(() => [])
  ]);
  return new Set([
    ...viewEvents.map((event) => normalizeId(event.post)),
    ...viewedPosts.map((post) => normalizeId(post._id))
  ].filter(Boolean));
}

async function fetchCandidates(filter, { limit, page, cursor }) {
  const query = Post.find(filter)
    .populate('author', 'username profile.displayName profile.avatar profilePicture avatar userType privacySettings isActive')
    .populate('likes.user', 'username profile.displayName profile.avatar profilePicture avatar')
    .populate('comments.user', 'username profile.displayName profile.avatar profilePicture avatar')
    .sort({ createdAt: -1, _id: -1 })
    .limit(Math.max(limit * CANDIDATE_MULTIPLIER, limit + 1));

  if (!cursor && page > 1) {
    query.skip((page - 1) * limit);
  }

  return query.exec();
}

async function getRecommendedPosts({ user, query = {}, mode = 'feed' }) {
  const limit = clampLimit(query.limit, mode === 'clips' ? 10 : DEFAULT_LIMIT);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const excludedIds = parseExcludedIds(query.exclude || query.excludedIds);
  const sessionSeed = normalizeSessionSeed(query.sessionSeed);
  const relationship = await getRelationshipContext(user);
  const [interestProfile, seenMap, boostDeliveryMap] = await Promise.all([
    getInterestProfile(relationship.currentUserId, relationship),
    getRecentlySeenMap(relationship.currentUserId, mode),
    getBoostDeliveryMap(relationship.currentUserId, mode)
  ]);
  const baseFilter = buildAudienceFilter({ user, mode, relationship, query });
  const watchedClipIds = mode === 'clips' && query.includeViewed !== 'true'
    ? await findWatchedClipIds(relationship.currentUserId)
    : new Set();

  const effectiveExcludedIds = [...new Set([
    ...excludedIds,
    ...(mode === 'clips' ? Array.from(watchedClipIds) : [])
  ])];

  let filter = applyCursorAndExclusions(baseFilter, {
    cursor: query.cursor,
    excludedIds: effectiveExcludedIds
  });

  let candidates = await fetchCandidates(filter, { limit, page, cursor: query.cursor });
  let exhaustedFreshClips = false;

  if (mode === 'clips' && candidates.length < limit && watchedClipIds.size > 0) {
    exhaustedFreshClips = true;
    const freshCandidates = candidates;
    const freshIds = new Set(freshCandidates.map((post) => normalizeId(post._id)));
    filter = applyCursorAndExclusions(baseFilter, {
      cursor: query.cursor,
      excludedIds: [...excludedIds, ...Array.from(freshIds)]
    });
    const fallbackCandidates = await fetchCandidates(filter, { limit, page, cursor: query.cursor });
    candidates = [...freshCandidates, ...fallbackCandidates];
  }

  // The seed is stable within a feed session (client-provided) so pagination
  // and silent revalidation stay deterministic, and rotates between sessions
  // so consecutive refreshes explore a different ordering.
  const seed = `${relationship.currentUserId || 'guest'}:${mode}:${sessionSeed}`;
  const scored = candidates
    .map((post) => ({ post, score: scorePost(post, { mode, relationship, interestProfile, seed, seenMap, boostDeliveryMap }) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.post.createdAt).getTime() - new Date(a.post.createdAt).getTime();
    });

  const selected = applyBoostPlacement(selectDiversePosts(scored, limit, mode), { seed });
  const selectedPosts = selected.map((item) => item.post);
  const attributedBoostPostIds = await recordBoostDelivery(selectedPosts, mode, relationship.currentUserId).catch((error) => {
    log.warn('Failed to record boost delivery', { error: String(error), mode });
    return new Set();
  });
  await recordFeedImpressions(selectedPosts, {
    userId: relationship.currentUserId,
    mode,
    sessionSeed
  });
  const nextCursorPost = pickNextCursorPost({
    selectedPosts,
    candidates,
    incomingCursor: query.cursor,
    excludedCount: effectiveExcludedIds.length
  });
  const nextCursor = candidates.length >= limit ? encodeCursor(nextCursorPost) : null;
  const total = !query.cursor
    ? await Post.countDocuments(baseFilter).catch(() => null)
    : null;
  const isGuest = user && user.userType === 'guest';
  // Development-only ranking diagnostics (Phase 4 feed contract + Phase 14
  // observability). Never emitted in production so internal scoring stays
  // private, but locally it exposes exactly why each post holds its slot so a
  // repeated-order/boost-pinning report can be reproduced with real evidence.
  const includeRankingDebug = process.env.NODE_ENV !== 'production';
  const rankingNow = Date.now();
  const scoreById = includeRankingDebug
    ? new Map(selected.map((item) => [normalizeId(item.post._id), item.score]))
    : null;

  const posts = selectedPosts.map((post, position) => {
    const dto = formatPostDTO(
      post,
      isGuest,
      Boolean(relationship.currentUserId && normalizeId(post.author) === relationship.currentUserId),
      relationship.currentUserId
    );
    if (dto) {
      const postId = normalizeId(post._id);
      dto.deliverySource = attributedBoostPostIds.has(postId) ? 'boost' : 'organic';
      dto.isSaved = Boolean(relationship.currentUserId && interestProfile.savedPostIds.has(postId));
      if (includeRankingDebug) {
        const hoursOld = Math.max(0, (rankingNow - new Date(post.createdAt).getTime()) / 36e5);
        const isBoosted = isActiveBoost(post, rankingNow);
        const isPreviouslySeen = seenMap.has(postId);
        dto._ranking = {
          position,
          rankingScore: scoreById.get(postId) ?? null,
          isBoosted,
          boostWeight: isBoosted ? getDampedBoostScore(post, { mode, now: rankingNow, boostDeliveryMap }) : 0,
          isPreviouslySeen,
          seenPenalty: Math.round(getSeenPenalty(seenMap.get(postId), rankingNow) * 100) / 100,
          freshness: Math.round(Math.exp(-hoursOld / (mode === 'clips' ? 96 : 72)) * 1000) / 1000,
          hoursOld: Math.round(hoursOld * 10) / 10,
          newPostKicker: hoursOld < NEW_POST_KICKER_HOURS,
          createdAt: post.createdAt,
          rankingReason: isBoosted
            ? 'boost+organic'
            : isPreviouslySeen
              ? 'organic(seen-penalized)'
              : hoursOld < NEW_POST_KICKER_HOURS
                ? 'fresh'
                : 'organic',
        };
      }
    }
    return dto;
  });

  if (includeRankingDebug) {
    log.info('feed-ranking', {
      mode,
      viewer: relationship.currentUserId ? String(relationship.currentUserId) : 'guest',
      sessionSeed,
      cursor: query.cursor || null,
      nextCursor,
      count: selectedPosts.length,
      boostedCount: selectedPosts.filter((p) => isActiveBoost(p, rankingNow)).length,
      seenCount: selectedPosts.filter((p) => seenMap.has(normalizeId(p._id))).length,
      returnedIds: selectedPosts.map((p) => normalizeId(p._id)),
    });
  }

  return {
    posts,
    pagination: {
      current: page,
      total: total !== null ? Math.ceil(total / limit) : undefined,
      count: selectedPosts.length,
      totalPosts: mode === 'feed' ? total : undefined,
      totalClips: mode === 'clips' ? total : undefined,
      hasMore: Boolean(nextCursor),
      nextCursor,
      cursor: query.cursor || null
    },
    recommendation: {
      algorithm: 'weighted-v2',
      mode,
      sessionSeed,
      signals: [
        'visibility',
        'follow_graph',
        'engagement',
        'freshness_decay',
        'new_post_kicker',
        'tag_affinity',
        'author_affinity',
        'quality_penalty',
        'diversity',
        'session_exploration',
        'seen_post_cooldown',
        'boost_campaign_score',
        'boost_frequency_cap',
        'boost_slot_rotation',
        mode === 'clips' ? 'watched_exclusion' : 'fresh_content'
      ],
      exhaustedFreshClips
    }
  };
}

async function recordEngagementEvent({
  userId,
  postId,
  authorId,
  eventType,
  context = 'unknown',
  durationMs = 0,
  completionRate = 0,
  metadata = {},
  source = 'organic',
  boostCampaign = null
}) {
  if (!userId || !postId || !eventType) return;
  const normalizedContext = normalizeEngagementContext(context);
  const normalizedDurationMs = normalizeEngagementDuration(durationMs);
  const normalizedCompletionRate = normalizeCompletionRate(completionRate);
  const payload = {
    user: userId,
    post: postId,
    author: authorId,
    eventType,
    context: normalizedContext,
    durationMs: normalizedDurationMs,
    completionRate: normalizedCompletionRate,
    source: source === 'boost' ? 'boost' : 'organic',
    boostCampaign,
    metadata
  };

  try {
    if (eventType === 'view') {
      const filter = { user: userId, post: postId, eventType, context: normalizedContext };
      const update = buildViewEngagementUpdate(payload);
      try {
        await PostEngagement.updateOne(filter, update, { upsert: true });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        // A concurrent first view won the unique-index race. Re-apply the
        // monotonic fields so the losing request's watch progress is not lost.
        await PostEngagement.updateOne(filter, update, { upsert: false });
      }
      return;
    }
    await PostEngagement.create(payload);
  } catch (error) {
    if (error?.code !== 11000) {
      log.warn('Failed to record post engagement event', { error: String(error), eventType, postId: String(postId) });
    }
  }
}

module.exports = {
  getRecommendedPosts,
  recordEngagementEvent,
  scorePost,
  selectDiversePosts,
  applyBoostPlacement,
  applyCursorAndExclusions,
  pickNextCursorPost,
  buildImpressionOps,
  getSeenPenalty,
  getDampedBoostScore,
  normalizeSessionSeed,
  stableNoise,
  encodeCursor,
  decodeCursor,
  parseExcludedIds,
  buildAudienceFilter,
  buildViewEngagementUpdate,
  normalizeEngagementContext,
  normalizeEngagementDuration,
  normalizeCompletionRate,
  MAX_ENGAGEMENT_DURATION_MS,
  SEEN_COOLDOWN_HOURS,
  BOOST_USER_COOLDOWN_HOURS,
  BOOST_FREQUENCY_CAP,
  BOOST_TOP_WINDOW
};
