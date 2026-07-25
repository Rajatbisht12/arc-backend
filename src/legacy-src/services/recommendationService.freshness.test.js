const assert = require('assert');
const {
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
  BOOST_USER_COOLDOWN_HOURS,
  BOOST_FREQUENCY_CAP,
  BOOST_TOP_WINDOW
} = require('./recommendationService');

const HOUR_MS = 60 * 60 * 1000;
const USER_ID = '507f1f77bcf86cd799439099';

function makePost(id, overrides = {}) {
  return {
    _id: id,
    author: { _id: overrides.authorId || `a-${id}` },
    postType: 'general',
    tags: overrides.tags || ['bgmi'],
    content: { media: [] },
    likes: overrides.likes || [],
    comments: [],
    shares: [],
    reports: [],
    viewedBy: [],
    views: overrides.views || 0,
    createdAt: overrides.createdAt || new Date(Date.now() - 12 * HOUR_MS),
    ...(overrides.boostMeta ? { boostMeta: overrides.boostMeta } : {})
  };
}

function runningBoostMeta(overrides = {}) {
  return {
    status: 'running',
    activeCampaign: 'c1',
    budget: 999,
    purchasedReach: 8000,
    remainingReach: 6000,
    totalSpend: 100,
    endTime: new Date(Date.now() + 24 * HOUR_MS),
    ...overrides
  };
}

function baseContext(overrides = {}) {
  return {
    mode: 'feed',
    relationship: {
      currentUserId: USER_ID,
      followingIds: new Set()
    },
    interestProfile: {
      tagWeights: new Map(),
      authorWeights: new Map(),
      postTypeWeights: new Map()
    },
    seed: 'session-a',
    ...overrides
  };
}

// ── Session seed ──────────────────────────────────────────────────────────

assert.strictEqual(normalizeSessionSeed('  abc  '), 'abc');
assert.strictEqual(normalizeSessionSeed('x'.repeat(200)).length, 64);
const fallbackSeed = normalizeSessionSeed(undefined);
assert.strictEqual(fallbackSeed, new Date().toISOString().slice(0, 13),
  'without a client session the seed must rotate hourly, not daily');

// Different session seeds must produce different exploration noise so
// consecutive refresh sessions do not return one frozen ordering.
const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
const noiseA = ids.map((id) => stableNoise(`${USER_ID}:feed:refresh-1`, id));
const noiseB = ids.map((id) => stableNoise(`${USER_ID}:feed:refresh-2`, id));
assert.notDeepStrictEqual(noiseA, noiseB, 'session seeds must rotate exploration noise');
assert.deepStrictEqual(
  noiseA,
  ids.map((id) => stableNoise(`${USER_ID}:feed:refresh-1`, id)),
  'the same session seed must stay deterministic for stable pagination'
);

// ── Seen-post cooldown ────────────────────────────────────────────────────

const now = Date.now();
assert.strictEqual(getSeenPenalty(undefined, now), 0);
const justShown = getSeenPenalty({ lastShownAt: now - (0.5 * HOUR_MS), impressionCount: 1 }, now);
const shownYesterday = getSeenPenalty({ lastShownAt: now - (30 * HOUR_MS), impressionCount: 1 }, now);
const shownLongAgo = getSeenPenalty({ lastShownAt: now - (40 * HOUR_MS), impressionCount: 6 }, now);
assert(justShown > 50, 'a post shown minutes ago must be strongly down-ranked');
assert(shownYesterday < justShown && shownYesterday > 0, 'the penalty must decay, not hard-hide');
assert.strictEqual(shownLongAgo, 0, 'posts resurface after the cooldown');
const repeatShown = getSeenPenalty({ lastShownAt: now - (0.5 * HOUR_MS), impressionCount: 4 }, now);
assert(repeatShown > justShown, 'repeat impressions must sink a post harder');

const seenContext = baseContext({
  seenMap: new Map([['p-seen', { lastShownAt: now - (1 * HOUR_MS), impressionCount: 2 }]])
});
const unseenScore = scorePost(makePost('p-new'), seenContext);
const seenScore = scorePost(makePost('p-seen'), seenContext);
assert(unseenScore > seenScore, 'recently shown posts must rank below unseen peers');

// ── New-post freshness kicker ─────────────────────────────────────────────

const brandNew = scorePost(makePost('p-a', { createdAt: new Date(now - (10 * 60 * 1000)) }), baseContext());
const older = scorePost(makePost('p-a', { createdAt: new Date(now - (12 * HOUR_MS)) }), baseContext());
assert(brandNew > older + 15, 'newly created posts get a temporary head start');

// ── Boost frequency cap / damping ─────────────────────────────────────────

const boostedPost = makePost('p-boost', { boostMeta: runningBoostMeta() });
const freshDelivery = new Map([[String(boostedPost._id), {
  deliveredAt: now - (1 * HOUR_MS),
  deliveryCount: 1
}]]);
const staleDelivery = new Map([[String(boostedPost._id), {
  deliveredAt: now - ((BOOST_USER_COOLDOWN_HOURS + 2) * HOUR_MS),
  deliveryCount: 1
}]]);
const cappedDelivery = new Map([[String(boostedPost._id), {
  deliveredAt: now - ((BOOST_USER_COOLDOWN_HOURS + 2) * HOUR_MS),
  deliveryCount: BOOST_FREQUENCY_CAP
}]]);

assert(getDampedBoostScore(boostedPost, { mode: 'feed', now, boostDeliveryMap: new Map() }) > 0,
  'undelivered campaigns keep their paid score');
assert.strictEqual(
  getDampedBoostScore(boostedPost, { mode: 'feed', now, boostDeliveryMap: freshDelivery }), 0,
  'a viewer who just received the boost must not get it re-pinned within the cooldown'
);
assert(getDampedBoostScore(boostedPost, { mode: 'feed', now, boostDeliveryMap: staleDelivery }) > 0,
  'after the cooldown the campaign becomes eligible for the viewer again');
assert.strictEqual(
  getDampedBoostScore(boostedPost, { mode: 'feed', now, boostDeliveryMap: cappedDelivery }), 0,
  'the per-user frequency cap must hold even after the cooldown'
);

const boostedScoreDamped = scorePost(boostedPost, baseContext({ boostDeliveryMap: freshDelivery }));
const boostedScoreFull = scorePost(boostedPost, baseContext({ boostDeliveryMap: new Map() }));
assert(boostedScoreFull > boostedScoreDamped, 'damping must remove the paid advantage, not the post');

// ── Boost slot rotation ───────────────────────────────────────────────────

function makeRankedList() {
  const boosted = { post: makePost('b1', { boostMeta: runningBoostMeta() }), score: 120 };
  const organics = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'].map((id, index) => ({
    post: makePost(id),
    score: 100 - index
  }));
  return [boosted, ...organics];
}

const placedA = applyBoostPlacement(makeRankedList(), { seed: 'session-a' });
assert.notStrictEqual(String(placedA[0].post._id), 'b1',
  'a post that leads only through paid weight must not sit at position 1');
const slotA = placedA.findIndex((item) => String(item.post._id) === 'b1');
assert(slotA >= 1 && slotA < BOOST_TOP_WINDOW, 'the boosted post stays inside the top window');
assert.deepStrictEqual(
  applyBoostPlacement(makeRankedList(), { seed: 'session-a' }).map((item) => String(item.post._id)),
  placedA.map((item) => String(item.post._id)),
  'placement is deterministic within one session'
);
const slots = new Set(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((seed) =>
  applyBoostPlacement(makeRankedList(), { seed }).findIndex((item) => String(item.post._id) === 'b1')
));
assert(slots.size > 1, 'the boosted slot must rotate across refresh sessions');

// A boosted post that would win on organic merit alone keeps position 1.
const organicallyStrong = [
  { post: makePost('b2', { boostMeta: runningBoostMeta() }), score: 500 },
  { post: makePost('o1'), score: 90 },
  { post: makePost('o2'), score: 80 },
  { post: makePost('o3'), score: 70 }
];
assert.strictEqual(String(applyBoostPlacement(organicallyStrong, { seed: 's' })[0].post._id), 'b2');

// Only one boosted post may occupy the top window.
const twoBoosted = [
  { post: makePost('b1', { boostMeta: runningBoostMeta() }), score: 120 },
  { post: makePost('b2', { boostMeta: runningBoostMeta({ activeCampaign: 'c2' }) }), score: 119 },
  { post: makePost('o1'), score: 100 },
  { post: makePost('o2'), score: 99 },
  { post: makePost('o3'), score: 98 },
  { post: makePost('o4'), score: 97 },
  { post: makePost('o5'), score: 96 }
];
const placedTwo = applyBoostPlacement(twoBoosted, { seed: 'x' });
const boostedInWindow = placedTwo.slice(0, BOOST_TOP_WINDOW)
  .filter((item) => Boolean(item.post.boostMeta)).length;
assert.strictEqual(boostedInWindow, 1, 'at most one boosted post in the first window');
assert.strictEqual(placedTwo.length, twoBoosted.length, 'placement never drops posts');

// Limited inventory: tiny result sets are left exactly as ranked.
const tiny = [
  { post: makePost('b1', { boostMeta: runningBoostMeta() }), score: 120 },
  { post: makePost('o1'), score: 100 }
];
assert.deepStrictEqual(applyBoostPlacement(tiny, { seed: 's' }), tiny);

// ── Cursor: no skips, guaranteed progress ─────────────────────────────────

const CURSOR_IDS = [1, 2, 3, 4, 5, 6].map((n) => `65a00000000000000000000${n}`);
const candidates = CURSOR_IDS.map((id, index) =>
  makePost(id, { createdAt: new Date(now - (index * HOUR_MS)) }));
const selectedPosts = [candidates[0], candidates[2]];

const boundary = pickNextCursorPost({
  selectedPosts,
  candidates,
  incomingCursor: null,
  excludedCount: 0
});
assert.strictEqual(String(boundary._id), CURSOR_IDS[2],
  'the boundary advances only to the oldest delivered post so ranked-over posts stay eligible');

const priorCursor = encodeCursor(candidates[4]);
const saturated = pickNextCursorPost({
  selectedPosts: [candidates[0], candidates[1]],
  candidates,
  incomingCursor: priorCursor,
  excludedCount: 110
});
assert.strictEqual(String(saturated._id), CURSOR_IDS[5],
  'once the exclusion window saturates, pagination falls back to chronological progress');

const cursorFilter = applyCursorAndExclusions({ isActive: true }, {
  cursor: encodeCursor(candidates[2]),
  excludedIds: ['507f1f77bcf86cd799439011']
});
const cursorBranch = cursorFilter.$and.find((clause) => Array.isArray(clause.$or));
assert(cursorBranch.$or.some((clause) => clause.createdAt && clause.createdAt.$gt),
  'pages after the first must keep newer-but-undelivered posts eligible');
assert(cursorFilter.$and.some((clause) => clause._id && clause._id.$nin),
  'delivered posts stay excluded to prevent duplicates');

const saturatedFilter = applyCursorAndExclusions({ isActive: true }, {
  cursor: encodeCursor(candidates[2]),
  excludedIds: new Array(115).fill('507f1f77bcf86cd799439011')
});
const saturatedBranch = saturatedFilter.$and.find((clause) => Array.isArray(clause.$or));
assert(!saturatedBranch.$or.some((clause) => clause.createdAt && clause.createdAt.$gt),
  'a saturated exclusion window falls back to strictly older pages');

assert.strictEqual(decodeCursor(encodeCursor(candidates[2])).id, CURSOR_IDS[2]);

// ── Server-side impression records ────────────────────────────────────────

const ops = buildImpressionOps([makePost('p1'), makePost('p2')], {
  userId: USER_ID,
  mode: 'feed',
  sessionSeed: 'refresh-9'
});
assert.strictEqual(ops.length, 2);
assert.strictEqual(ops[0].updateOne.filter.eventType, 'impression');
assert.strictEqual(ops[0].updateOne.filter.context, 'feed');
assert.strictEqual(ops[0].updateOne.upsert, true);
assert.strictEqual(ops[0].updateOne.update.$set.positionShown, 0);
assert.strictEqual(ops[1].updateOne.update.$set.positionShown, 1);
assert.strictEqual(ops[0].updateOne.update.$set.sessionId, 'refresh-9');
assert.deepStrictEqual(ops[0].updateOne.update.$inc, { impressionCount: 1 });
assert(!('durationMs' in ops[0].updateOne.update.$set), 'impressions must not clobber watch progress fields');

// ── Repeated-refresh simulation ───────────────────────────────────────────

function rankPool(seed, seenMap) {
  const pool = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'].map((id, index) =>
    makePost(id, {
      authorId: `author-${index}`,
      createdAt: new Date(now - ((index + 2) * HOUR_MS)),
      likes: new Array(Math.max(0, 6 - index)).fill({ user: 'u' })
    }));
  const context = baseContext({ seed, seenMap: seenMap || new Map() });
  const scored = pool
    .map((post) => ({ post, score: scorePost(post, context) }))
    .sort((a, b) => (b.score !== a.score
      ? b.score - a.score
      : new Date(b.post.createdAt).getTime() - new Date(a.post.createdAt).getTime()));
  return selectDiversePosts(scored, 5, 'feed').map((item) => String(item.post._id));
}

const sessionOne = rankPool(`${USER_ID}:feed:session-1`);
const sessionOneAgain = rankPool(`${USER_ID}:feed:session-1`);
assert.deepStrictEqual(sessionOne, sessionOneAgain,
  'within one session the ordering is stable (pagination-safe)');

const differingSessions = ['session-2', 'session-3', 'session-4', 'session-5']
  .map((s) => rankPool(`${USER_ID}:feed:${s}`))
  .filter((order) => JSON.stringify(order) !== JSON.stringify(sessionOne));
assert(differingSessions.length > 0,
  'across refresh sessions the ordering must not stay frozen');

const seenAfterFirstPage = new Map(sessionOne.map((id, index) => [id, {
  lastShownAt: now - (5 * 60 * 1000),
  impressionCount: 1 + (index === 0 ? 1 : 0)
}]));
const nextSession = rankPool(`${USER_ID}:feed:session-6`, seenAfterFirstPage);
assert.notStrictEqual(nextSession[0], sessionOne[0],
  'the previous top post must not immediately repeat at position 1');
assert(nextSession.slice(0, 3).some((id) => !sessionOne.includes(id)),
  'fresh unseen posts must break into the top after a refresh');

// No duplicates within a ranked page.
assert.strictEqual(new Set(nextSession).size, nextSession.length);

console.log('recommendation freshness, seen-post, boost-rotation, and cursor tests passed');
