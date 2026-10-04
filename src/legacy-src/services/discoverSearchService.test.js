const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiscoverSearchFilter, toDiscoverSearchTile } = require('./discoverPostSearchService');
const { getVisibleFollowCounts } = require('./discoverUserCounts');

test('post search preserves server audience constraints without excluding video posts', () => {
  const audienceFilter = {
    isActive: true,
    visibility: 'public',
    $and: [{ author: { $nin: ['blocked-user'] } }]
  };
  const filter = buildDiscoverSearchFilter({
    audienceFilter,
    search: 'a.*',
    matchingAuthorIds: ['matched-author'],
    mode: 'feed'
  });

  assert.equal(filter.isActive, true);
  assert.equal(filter.visibility, 'public');
  assert.deepEqual(filter.$and[0], audienceFilter.$and[0]);
  assert.equal(filter['content.media'], undefined);
  assert.deepEqual(filter.$and[1].$or, [
    { 'content.text': { $regex: 'a\\.\\*', $options: 'i' } },
    { tags: { $regex: 'a\\.\\*', $options: 'i' } },
    { author: { $in: ['matched-author'] } }
  ]);
  assert.equal(audienceFilter['content.media'], undefined);
});

test('clip search keeps the video audience requirement and text/tag search', () => {
  const filter = buildDiscoverSearchFilter({
    audienceFilter: { 'content.media': { $elemMatch: { type: 'video' } } },
    search: 'hello',
    matchingAuthorIds: [],
    mode: 'clips'
  });
  assert.deepEqual(filter['content.media'], { $elemMatch: { type: 'video' } });
  assert.equal(filter.$and[0].$or.length, 2);
});

test('search response sends only the preview fields used by Web and Mobile tiles', () => {
  const tile = toDiscoverSearchTile({
    _id: 'post-id',
    author: { _id: 'author-id', username: 'zoro', profile: { displayName: 'Zoro' } },
    content: { text: 'hello', media: [{ type: 'video', url: 'https://example.invalid/video.mp4', coverUrl: 'https://example.invalid/cover.webp' }] },
    postType: 'general',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    views: 7,
    likes: [{ user: 'private-user' }],
    comments: [{ text: 'private comment' }]
  }, false);
  assert.equal(tile._id, 'post-id');
  assert.equal(tile.author.username, 'zoro');
  assert.equal(tile.content.media[0].coverUrl, 'https://example.invalid/cover.webp');
  assert.equal(tile.viewCount, 7);
  assert.equal('likes' in tile, false);
  assert.equal('comments' in tile, false);
});

test('visible follow counts batch a page into two active-user aggregations', async () => {
  const pipelines = [];
  const Follow = {
    aggregate: async (pipeline) => {
      pipelines.push(pipeline);
      return pipeline[0].$match.following
        ? [{ _id: 'a', total: 3 }]
        : [{ _id: 'b', total: 4 }];
    }
  };
  const result = await getVisibleFollowCounts(Follow, ['a', 'b']);
  assert.equal(pipelines.length, 2);
  assert.deepEqual(pipelines[0][0].$match, { following: { $in: ['a', 'b'] } });
  assert.deepEqual(pipelines[1][0].$match, { follower: { $in: ['a', 'b'] } });
  assert.deepEqual(pipelines[0][3], { $match: { 'relatedUser.isActive': true } });
  assert.equal(result.followers.get('a'), 3);
  assert.equal(result.following.get('b'), 4);
});

test('empty user page skips follow aggregation', async () => {
  const Follow = { aggregate: () => { throw new Error('unexpected query'); } };
  const result = await getVisibleFollowCounts(Follow, []);
  assert.equal(result.followers.size, 0);
  assert.equal(result.following.size, 0);
});
