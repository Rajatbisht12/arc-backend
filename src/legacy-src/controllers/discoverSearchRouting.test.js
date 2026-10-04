const test = require('node:test');
const assert = require('node:assert/strict');

const recommendationPath = require.resolve('../services/recommendationService');
const searchPath = require.resolve('../services/discoverPostSearchService');
const controllerPath = require.resolve('./postController');
const recommendation = require(recommendationPath);
const search = require(searchPath);
const originalRecommendation = recommendation.getRecommendedPosts;
const originalSearch = search.getDiscoverSearchPosts;
const originalControllerCache = require.cache[controllerPath];
const calls = [];

recommendation.getRecommendedPosts = async ({ mode }) => {
  calls.push(`recommendation:${mode}`);
  return { posts: [], pagination: { current: 1, count: 0, hasMore: false } };
};
search.getDiscoverSearchPosts = async ({ mode }) => {
  calls.push(`search:${mode}`);
  return { posts: [], pagination: { current: 1, count: 0, hasMore: false } };
};
delete require.cache[controllerPath];
const { getPosts, getClips } = require(controllerPath);

test.after(() => {
  recommendation.getRecommendedPosts = originalRecommendation;
  search.getDiscoverSearchPosts = originalSearch;
  delete require.cache[controllerPath];
  if (originalControllerCache) require.cache[controllerPath] = originalControllerCache;
});

const invoke = async (handler, query) => {
  const headers = new Map();
  let response;
  const res = {
    set: (key, value) => { headers.set(key, value); return res; },
    status: (code) => { response = { status: code }; return res; },
    json: (body) => { response.body = body; return res; }
  };
  await handler({ query, user: null }, res);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.pagination, { current: 1, count: 0, hasMore: false });
  assert.equal(headers.get('Cache-Control'), 'no-store');
};

test('nonempty context=search uses dedicated search for both Posts and Clips', async () => {
  calls.length = 0;
  await invoke(getPosts, { search: 'zo', context: 'search' });
  await invoke(getClips, { search: 'zo', context: 'search' });
  assert.deepEqual(calls, ['search:feed', 'search:clips']);
});

test('ordinary Feed/Clips and hashtag requests retain recommendation delivery', async () => {
  calls.length = 0;
  await invoke(getPosts, {});
  await invoke(getClips, { search: 'zo' });
  await invoke(getPosts, { tags: 'valorant', context: 'search' });
  await invoke(getClips, { search: '   ', context: 'search' });
  assert.deepEqual(calls, [
    'recommendation:feed',
    'recommendation:clips',
    'recommendation:feed',
    'recommendation:clips'
  ]);
});
