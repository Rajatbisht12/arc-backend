const assert = require('node:assert/strict');
const test = require('node:test');
const Post = require('../models/Post');
const controller = require('./publicPostSeoController');
const { clearLocalCursors } = require('../utils/publicSitemapPagination');

const post = () => ({
  _id: '507f1f77bcf86cd799439011', visibility: 'public', isActive: true, hiddenByAdmin: false,
  content: { text: 'Public caption', media: [{ type: 'image', url: 'https://media.squadhunt.com/gaming-social/posts/a.jpg', width: 800, height: 600 }] },
  author: { username: 'WriterOne', userType: 'creator', isActive: true, moderationStatus: 'active',
    privacySettings: { profileVisibility: 'public', showPostsToFollowers: true }, profile: { displayName: 'Writer One' } },
  createdAt: new Date('2026-10-01T00:00:00Z')
});
const response = () => ({
  headers: {}, setHeader(key, value) { this.headers[key] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; }
});

test('minimal SEO endpoint withdraws private posts without leaking caption or media', async () => {
  const original = Post.findOne;
  let record = post();
  let filter;
  Post.findOne = nextFilter => {
    filter = nextFilter;
    const query = { select() { return query; }, populate() { return query; }, async lean() { return record; } };
    return query;
  };
  try {
    const visible = response();
    await controller.getPublicPostSeo({ params: { id: post()._id } }, visible);
    assert.equal(filter.visibility, 'public');
    assert.equal(visible.statusCode, 200);
    assert.deepEqual(Object.keys(visible.body.data.post).sort(), ['author', 'caption', 'createdAt', 'editedAt', 'id', 'preview']);
    assert.equal(visible.body.data.post.preview.url, 'https://media.squadhunt.com/gaming-social/posts/a.jpg');
    assert.equal(visible.headers['Cache-Control'], 'private, no-store, max-age=0');
    for (const changes of [
      { visibility: 'private' },
      { author: { ...post().author, moderationStatus: 'suspended' } },
      { author: { ...post().author, privacySettings: { profileVisibility: 'private', showPostsToFollowers: true } } },
    ]) {
      record = { ...post(), ...changes };
      const hidden = response();
      await controller.getPublicPostSeo({ params: { id: post()._id } }, hidden);
      assert.equal(hidden.statusCode, 404);
      assert.equal(hidden.body.data, undefined);
    }
  } finally { Post.findOne = original; }
});

test('sitemap page uses bounded indexed post query and rechecks author eligibility', async () => {
  clearLocalCursors();
  const originalFind = Post.find;
  const originalCount = Post.countDocuments;
  const reads = [];
  Post.countDocuments = async filter => { assert.equal(filter.visibility, 'public'); return 10001; };
  Post.find = filter => {
    assert.equal(filter.visibility, 'public');
    const read = { filter };
    reads.push(read);
    const query = {
      sort(value) { read.sort = value; return query; },
      limit(value) { read.limit = value; return query; }, select(value) { read.select = value; return query; },
      populate() { return query; }, async lean() {
        return read.select === '_id'
          ? Array.from({ length: 10000 }, (_, index) => ({ _id: index.toString(16).padStart(24, '0') }))
          : [post(), { ...post(), _id: '507f1f77bcf86cd799439012', author: { ...post().author, moderationStatus: 'banned' } }];
      }
    };
    return query;
  };
  try {
    const count = response();
    await controller.getPublicPostSitemapCount({}, count);
    assert.equal(count.body.data.pages, 2);
    const page = response();
    await controller.getPublicPostSitemap({ query: { page: '2' } }, page);
    assert.equal(reads.length, 2);
    assert(reads.every(read => read.limit === 10000));
    assert(reads.every(read => !('skip' in read)));
    assert.deepEqual(reads[1].sort, { _id: 1 });
    assert.equal(reads[1].filter._id.$gt, '00000000000000000000270f');
    assert.deepEqual(page.body.data.posts, [{ id: post()._id }]);
  } finally { Post.find = originalFind; Post.countDocuments = originalCount; }
});
