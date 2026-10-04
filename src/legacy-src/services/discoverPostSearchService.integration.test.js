const test = require('node:test');
const assert = require('node:assert/strict');
const Post = require('../models/Post');
const User = require('../models/User');
const recommendation = require('./recommendationService');
const mediaDelivery = require('../utils/privateMediaDelivery');

test('search service preserves visibility, paginates before DTO, and bounds broad creator lookup', async () => {
  const originals = {
    postFind: Post.find,
    userFind: User.find,
    relationship: recommendation.getRelationshipContext,
    audience: recommendation.buildAudienceFilter,
    delivery: mediaDelivery.resolveClientMediaPayload
  };
  const searchPath = require.resolve('./discoverPostSearchService');
  const originalCache = require.cache[searchPath];
  let postFilter;
  let projection;
  let skip;
  let limit;
  let authorLookupCount = 0;
  const rows = [1, 2, 3].map((number) => ({
    _id: `post-${number}`,
    author: { _id: 'author-1', username: 'zoro', profile: { displayName: 'Zoro' } },
    content: { text: 'hello zo', media: [{ type: 'image', url: 'https://example.invalid/a.webp' }] },
    postType: 'general',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    views: number
  }));

  try {
    recommendation.getRelationshipContext = async () => ({ currentUserId: null, followingIds: new Set() });
    recommendation.buildAudienceFilter = () => ({
      isActive: true,
      visibility: 'public',
      $and: [{ author: { $nin: ['blocked-author'] } }]
    });
    mediaDelivery.resolveClientMediaPayload = async (payload) => payload;
    User.find = () => {
      authorLookupCount += 1;
      return {
        select() { return this; },
        limit() { return this; },
        async lean() { return [{ _id: 'author-1' }]; }
      };
    };
    Post.find = (filter) => {
      postFilter = filter;
      return {
        select(fields) { projection = fields; return this; },
        populate() { return this; },
        sort() { return this; },
        skip(value) { skip = value; return this; },
        limit(value) { limit = value; return this; },
        lean() { return this; },
        async exec() { return rows; }
      };
    };
    delete require.cache[searchPath];
    const { getDiscoverSearchPosts } = require(searchPath);
    const result = await getDiscoverSearchPosts({
      user: null,
      query: { search: 'zo', context: 'search', page: 2, limit: 2 },
      mode: 'feed'
    });

    assert.equal(authorLookupCount, 1);
    assert.equal(postFilter.visibility, 'public');
    assert.deepEqual(postFilter.$and[0], { author: { $nin: ['blocked-author'] } });
    assert.deepEqual(postFilter['content.media'], { $not: { $elemMatch: { type: 'video' } } });
    assert.equal(skip, 2);
    assert.equal(limit, 3);
    assert.match(projection, /content\.media\.coverUrl/);
    assert.doesNotMatch(projection, /\blikes\b|\bcomments\b/);
    assert.deepEqual(result.posts.map((post) => post._id), ['post-1', 'post-2']);
    assert.deepEqual(result.pagination, { current: 2, count: 2, hasMore: true, nextCursor: null, cursor: null });

    await getDiscoverSearchPosts({ user: null, query: { search: 'a', context: 'search', page: 1, limit: 2 }, mode: 'clips' });
    assert.equal(authorLookupCount, 1, 'one-character search must not fan out a creator-ID query');
  } finally {
    Post.find = originals.postFind;
    User.find = originals.userFind;
    recommendation.getRelationshipContext = originals.relationship;
    recommendation.buildAudienceFilter = originals.audience;
    mediaDelivery.resolveClientMediaPayload = originals.delivery;
    delete require.cache[searchPath];
    if (originalCache) require.cache[searchPath] = originalCache;
  }
});
