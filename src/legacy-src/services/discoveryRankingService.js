const { createHash, randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const User = require('../models/User');
const ContentExposure = require('../models/ContentExposure');
const RecommendationDelivery = require('../models/RecommendationDelivery');
const RecommendationState = require('../models/RecommendationState');

const RANKING_POLICY = 'unseen-only-45d-v1';
const FRESH_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const DELIVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 240;
const EXHAUSTION_CHECK_TTL_MS = 60_000;
const id = value => String(value?._id || value);
const objectId = value => new mongoose.Types.ObjectId(String(value));
const sessionKey = (userId, mode, seed) => createHash('sha256').update(`${userId || 'guest'}:${mode}:${seed}`).digest('hex');
function decodeDiscoveryCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length > 4096) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return value.v === 3 && typeof value.seed === 'string' && value.seed.length <= 64
      && /^[a-f0-9]{64}$/.test(value.session) ? value : null;
  } catch { return null; }
}

// Aggregation is not cast by Mongoose. Cast only actual audience id fields,
// preserving dates and existing ObjectIds (including nested $or/$and clauses).
function castAudience(value, key = '') {
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  if (Array.isArray(value)) return value.map(item => castAudience(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, castAudience(item, field.startsWith('$') ? key : field)]));
  return ['_id', 'author', 'reports.user'].includes(key) && typeof value === 'string' && mongoose.isValidObjectId(value)
    ? objectId(value) : value;
}

const candidateProjection = {
  _id: 1, author: 1, createdAt: 1, postType: 1, tags: 1, boostMeta: 1, boostExpiresAt: 1,
  'content.media.type': 1, views: 1,
  likeCount: { $size: { $ifNull: ['$likes', []] } },
  commentCount: { $size: { $ifNull: ['$comments', []] } },
  shareCount: { $size: { $ifNull: ['$shares', []] } },
  reportCount: { $size: { $ifNull: ['$reports', []] } },
  uniqueViewCount: { $size: { $ifNull: ['$viewedBy', []] } }
};

function deliveryLookup(session, now) {
  return [
    { $addFields: { _deliveryKey: { $concat: [`${session}:`, { $toString: '$_id' }] } } },
    { $lookup: { from: RecommendationDelivery.collection.name, localField: '_deliveryKey', foreignField: '_id', as: '_delivery' } },
    { $match: { '_delivery.expiresAt': { $not: { $gt: now } } } }
  ];
}

function activeAuthorLookup() {
  return [
    { $lookup: { from: User.collection.name, localField: 'author', foreignField: '_id', as: '_author' } },
    { $match: { '_author.0.isActive': true, '_author.moderationStatus': { $nin: ['suspended', 'banned', 'soft_deleted'] } } }
  ];
}

async function unseenCandidates({ filter, userId, session, tier, now, candidateLimit, changedSince }) {
  const boundary = new Date(now.getTime() - FRESH_WINDOW_MS);
  // Both sources are strictly unseen. Older content stays eligible, never
  // consumed fallback; a future publication is not eligible yet.
  const match = { $and: [filter, { createdAt: tier === 2 ? { $lt: boundary } : { $gte: boundary, $lte: now } }] };
  if (changedSince) match.$and.push({ $or: [{ createdAt: { $gte: changedSince } }, { updatedAt: { $gte: changedSince } }] });
  // Stable, indexed candidate enumeration, independent of upload timestamps.
  // Personalization/quality rank each bounded window within its unseen tier.
  const pipeline = [{ $match: match }, { $sort: { _id: 1 } }, ...activeAuthorLookup()];
  if (userId) {
    // Equality lookup by the built-in _id index works on DocumentDB without
    // correlated subqueries or loading the viewer's lifetime history.
    pipeline.push(
      { $addFields: { _exposureKey: { $concat: [`${userId}:`, { $toString: '$_id' }] } } },
      { $lookup: { from: ContentExposure.collection.name, localField: '_exposureKey', foreignField: '_id', as: '_exposure' } },
      { $match: {
        '_exposure.lastViewedAt': { $exists: false },
        '_exposure.firstViewedAt': { $exists: false },
        '_exposure.interacted': { $ne: true },
        'likes.user': { $ne: objectId(userId) },
        'comments.user': { $ne: objectId(userId) },
        'shares.user': { $ne: objectId(userId) }
      } }
    );
  }
  pipeline.push(...deliveryLookup(session, now), { $limit: candidateLimit }, { $project: candidateProjection });
  return Post.aggregate(pipeline).read('primary').option({ maxTimeMS: 5000 });
}

async function reserve(posts, { session, userId, now }) {
  if (!posts.length) return [];
  const claim = randomUUID();
  const keys = posts.map(post => `${session}:${id(post)}`);
  // Each insert atomically claims a unique session/content key. A competing
  // request cannot overwrite it or return the same recommendation again.
  await RecommendationDelivery.bulkWrite(posts.map((post, index) => ({ updateOne: {
    filter: { _id: keys[index], expiresAt: { $lte: now } },
    update: { $set: { session, ...(userId ? { user: userId } : {}), post: post._id, claim, expiresAt: new Date(now.getTime() + DELIVERY_TTL_MS) } },
    upsert: true
  } })), { ordered: false }).catch(error => {
    if (error.code !== 11000 || error.writeErrors?.some(entry => entry.code !== 11000)) throw error;
  });
  const won = new Set((await RecommendationDelivery.find({ _id: { $in: keys }, claim }).read('primary').select('post').lean()).map(row => id(row.post)));
  return posts.filter(post => won.has(id(post)));
}

async function getDiscoveryPage({ userId, mode, seed, baseFilter, excludedIds = [], limit, rank, cursor, targetPost }) {
  const incoming = decodeDiscoveryCursor(cursor);
  const expectedSession = sessionKey(userId, mode, seed);
  // The cursor restores server-owned session progress. It is scoped again by
  // authenticated identity and mode; another user's cursor cannot select their
  // delivery/history records. Older clients' date cursors start a v3 session.
  const session = incoming?.session === expectedSession ? incoming.session : expectedSession;
  const now = new Date();
  // An explicitly opened Home/Search video is returned separately from ranked
  // recommendations. Reserve it too so deep pagination cannot re-serve it.
  if (targetPost) await reserve([targetPost], { session, userId, now });
  // Remember authorized client exclusions as session delivery too. Rolling
  // exclusion windows must not reintroduce them later, including old clients
  // resuming a pre-v3 cursor. These reservations never become viewed history.
  if (excludedIds.length) {
    const existing = await RecommendationDelivery.find({ _id: { $in: excludedIds.map(post => `${session}:${post.toLowerCase()}`) }, expiresAt: { $gt: now } }).read('primary').select('post').lean();
    const existingIds = new Set(existing.map(row => id(row.post)));
    const missing = excludedIds.filter(post => !existingIds.has(post.toLowerCase()));
    if (missing.length) {
      const authorized = await Post.find({ $and: [baseFilter, { _id: { $in: missing } }] }).read('primary').select('_id').limit(120).lean();
      await reserve(authorized, { session, userId, now });
    }
  }
  const filter = castAudience({ $and: [baseFilter, ...(excludedIds.length ? [{ _id: { $nin: excludedIds } }] : [])] });
  // Invalidate only old ranking checkpoints, not session reservations/history.
  const filterHash = createHash('sha256').update(`${RANKING_POLICY}:${JSON.stringify(baseFilter)}`).digest('hex');
  const exhaustion = await RecommendationState.findById(session).read('primary').lean();
  const changedSince = exhaustion?.filterHash === filterHash && exhaustion.expiresAt > now
    ? exhaustion.unseenCheckedAt : null;
  const candidateLimit = Math.min(MAX_CANDIDATES, Math.max(limit * 8, limit + 1));
  const selected = [];
  const tierById = new Map();
  let hasMore = false;
  let lastTier = 0;
  const exhaustedUnseenTiers = new Set();
  for (let tier = 1; tier <= 2; tier += 1) {
    // Check both unseen tiers on EVERY page: new uploads and
    // cross-device interactions become authoritative without a session reset.
    let attempts = 0;
    while (selected.length < limit && attempts++ < 4) {
      const candidates = await unseenCandidates({ filter, userId, session, tier, now, candidateLimit, changedSince });
      if (!candidates.length) {
        exhaustedUnseenTiers.add(tier);
        break; // source exhaustion, not a short scored window
      }
      const remaining = limit - selected.length;
      const ranked = rank(candidates, remaining);
      const won = await reserve(ranked.map(item => item.post), { session, userId, now });
      const wonIds = new Set(won.map(id));
      for (const item of ranked) if (wonIds.has(id(item.post))) {
        selected.push(item);
        tierById.set(id(item.post), tier);
        lastTier = tier;
      }
      if (selected.length >= limit) { hasMore = true; break; }
      // A short batch does not authorize the older tier until a new global query
      // confirms there are no eligible higher-tier rows left.
      if (attempts >= 4) { hasMore = true; break; }
    }
    if (selected.length >= limit || hasMore) break;
  }
  if (exhaustedUnseenTiers.size === 2) {
    // Never extend a checkpoint past the first delivery expiration. The TTL
    // monitor may lag; eligibility checks expiry timestamps explicitly.
    const firstDelivery = await RecommendationDelivery.findOne({ session, expiresAt: { $gt: now } }).read('primary').sort({ expiresAt: 1 }).select('expiresAt').lean();
    const expiresAt = new Date(Math.min(now.getTime() + EXHAUSTION_CHECK_TTL_MS, firstDelivery?.expiresAt?.getTime() || Infinity));
    await RecommendationState.updateOne({ _id: session }, { $set: {
      ...(userId ? { user: userId } : {}), filterHash, unseenCheckedAt: now, expiresAt
    } }, { upsert: true }).catch(async error => {
      if (error.code !== 11000) throw error;
      await RecommendationState.updateOne({ _id: session }, { $set: { filterHash, unseenCheckedAt: now, expiresAt } });
    });
  }
  // Cursors identify continuation in the bounded server session. Reservation
  // anti-joins carry progress without skipped ranking candidates, deep skip,
  // or growing arrays of every delivered/seen id in the cursor.
  const last = selected[selected.length - 1]?.post;
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({
    v: 3, session, seed, continuation: randomUUID(),
    createdAt: last?.createdAt || now, id: last ? id(last) : new mongoose.Types.ObjectId().toString()
  })).toString('base64url') : null;
  return { selected, tierById, nextCursor, lastTier, session };
}

module.exports = { RANKING_POLICY, FRESH_WINDOW_MS, DELIVERY_TTL_MS, sessionKey, decodeDiscoveryCursor, castAudience, unseenCandidates, getDiscoveryPage };
