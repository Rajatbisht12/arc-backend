const assert = require('assert');
const fs = require('fs');
const {
  decodeCursor,
  encodeCursor,
  parseExcludedIds,
  preserveTargetClipInExclusions,
  buildTargetClipFilter,
  scorePost,
  selectDiversePosts,
  buildAudienceFilter
} = require('./recommendationService');
const { getOrganicViewCount } = require('./boostService');

const basePost = {
  _id: '507f1f77bcf86cd799439011',
  author: { _id: '507f1f77bcf86cd799439012' },
  postType: 'general',
  tags: ['bgmi'],
  content: { media: [{ type: 'video', url: 'https://example.com/a.mp4' }] },
  likes: [],
  comments: [],
  shares: [],
  reports: [],
  viewedBy: [],
  views: 0,
  createdAt: new Date()
};

const context = {
  mode: 'clips',
  relationship: {
    currentUserId: '507f1f77bcf86cd799439099',
    followingIds: new Set(['507f1f77bcf86cd799439012'])
  },
  interestProfile: {
    tagWeights: new Map([['bgmi', 10]]),
    authorWeights: new Map(),
    postTypeWeights: new Map()
  },
  seed: 'test'
};

const cursor = encodeCursor(basePost);
assert.strictEqual(decodeCursor(cursor).id, basePost._id);
assert.strictEqual(decodeCursor('not-valid'), null);

assert.deepStrictEqual(parseExcludedIds(`${basePost._id},bad-id`), [basePost._id]);
assert.deepStrictEqual(
  preserveTargetClipInExclusions([basePost._id, '507f1f77bcf86cd799439022'], basePost._id, 'clips'),
  ['507f1f77bcf86cd799439022'],
  'a canonical Home Feed target remains eligible at its normal Clips rank'
);
assert.deepStrictEqual(
  preserveTargetClipInExclusions([basePost._id], basePost._id, 'feed'),
  [basePost._id],
  'the target exception is scoped to the Clips feed'
);
assert.deepStrictEqual(
  preserveTargetClipInExclusions([basePost._id], 'invalid', 'clips'),
  [basePost._id],
  'invalid target ids cannot alter exclusions'
);

const targetAudienceFilter = {
  isActive: true,
  hiddenByAdmin: { $ne: true },
  'content.media': { $elemMatch: { type: 'video' } },
  visibility: 'public'
};
assert.deepStrictEqual(
  buildTargetClipFilter(targetAudienceFilter, basePost._id, 'clips'),
  { ...targetAudienceFilter, _id: basePost._id },
  'targeted Clip resolution must retain the canonical Clips audience/media filter'
);
assert.strictEqual(
  buildTargetClipFilter(targetAudienceFilter, basePost._id, 'feed'),
  null,
  'targeted Clip resolution must never alter the normal Home Feed'
);
assert.strictEqual(
  buildTargetClipFilter(targetAudienceFilter, 'not-an-id', 'clips'),
  null,
  'malformed target ids must fail closed'
);

const recommendationSource = fs.readFileSync(__filename.replace(/\.test\.js$/, '.js'), 'utf8');
assert(
  recommendationSource.includes('...(query.targetClipId ? { targetClip } : {})'),
  'the existing Clips response must expose the independently resolved target additively'
);
assert(
  recommendationSource.includes("const impressionContext = query.context === 'search' ? 'search' : mode"),
  'Discover tile delivery must not mutate the normal Clips seen-session history'
);

const highEngagementScore = scorePost({
  ...basePost,
  likes: [{ user: 'u1' }, { user: 'u2' }],
  comments: [{ user: 'u3' }],
  shares: [{ user: 'u4' }],
  viewedBy: [{ user: 'u5' }, { user: 'u6' }]
}, context);
const reportedScore = scorePost({
  ...basePost,
  reports: [{ user: 'u9' }, { user: 'u10' }]
}, context);
assert(highEngagementScore > reportedScore, 'engagement should outrank reported content');

const boostedScore = scorePost({
  ...basePost,
  boostMeta: {
    status: 'running',
    budget: 499,
    purchasedReach: 6000,
    remainingReach: 4000,
    totalSpend: 499,
    endTime: new Date(Date.now() + 24 * 60 * 60 * 1000)
  }
}, context);
const unboostedScore = scorePost(basePost, context);
assert(boostedScore > unboostedScore, 'active boost campaigns should improve ranking score');

assert.strictEqual(getOrganicViewCount({
  views: 5000,
  viewedBy: new Array(5000).fill({ user: 'u' }),
  boostedAt: new Date()
}), 0, 'legacy boosted view totals must not count as organic monetization views');
assert.strictEqual(getOrganicViewCount({
  metrics: { organicViews: 3200, boostViews: 10000 },
  boostedAt: new Date()
}), 3200, 'explicit organic views must remain monetizable even if a campaign exists');

const diverse = selectDiversePosts([
  { post: { ...basePost, _id: '507f1f77bcf86cd799439001', author: { _id: 'a1' }, tags: ['x'] }, score: 100 },
  { post: { ...basePost, _id: '507f1f77bcf86cd799439002', author: { _id: 'a1' }, tags: ['x'] }, score: 99 },
  { post: { ...basePost, _id: '507f1f77bcf86cd799439003', author: { _id: 'a2' }, tags: ['y'] }, score: 98 }
], 2, 'clips');
assert.deepStrictEqual(diverse.map((item) => item.post.author._id), ['a1', 'a2']);

const audienceRelationship = {
  currentUserId: '507f1f77bcf86cd799439099',
  followingIds: new Set(['507f1f77bcf86cd799439012']),
  blockedEitherWayIds: new Set(),
  invisiblePrivateAuthorIds: new Set()
};
const privateAudience = buildAudienceFilter({
  user: { _id: audienceRelationship.currentUserId },
  mode: 'feed',
  relationship: audienceRelationship,
  query: { visibility: 'private', author: '507f1f77bcf86cd799439012' }
});
assert.strictEqual(privateAudience.visibility, 'private');
assert.strictEqual(privateAudience.author, '507f1f77bcf86cd799439012');
assert(privateAudience.$and.some((condition) => condition.author === audienceRelationship.currentUserId), 'private visibility must remain owner-only');

const followerAudience = buildAudienceFilter({
  user: { _id: audienceRelationship.currentUserId },
  mode: 'feed',
  relationship: audienceRelationship,
  query: { visibility: 'followers' }
});
assert.strictEqual(followerAudience.visibility, 'followers');
assert(followerAudience.$and.some((condition) => Array.isArray(condition.$or)), 'followers visibility must retain relationship scope');

const guestAudience = buildAudienceFilter({
  user: null,
  mode: 'feed',
  relationship: { ...audienceRelationship, currentUserId: null },
  query: { visibility: 'private' }
});
assert.strictEqual(guestAudience.visibility, 'public', 'guest filters cannot request private posts');

console.log('recommendation service tests passed');
