const assert = require('node:assert/strict');
const test = require('node:test');
const { publicPostSeoFilter, isPublicPostSeoEligible, publicPostPreviewUrl, postPreview } = require('./publicPostSeoPolicy');

const author = () => ({
  username: 'WriterOne', userType: 'creator', isActive: true,
  moderationStatus: 'active', privacySettings: { profileVisibility: 'public', showPostsToFollowers: true }
});
const post = () => ({
  visibility: 'public', isActive: true, hiddenByAdmin: false, author: author(),
  content: { media: [] }
});

test('post indexing requires explicit public state and an eligible public author', () => {
  assert.equal(publicPostSeoFilter.visibility, 'public');
  assert.equal(isPublicPostSeoEligible(post()), true);
  for (const changes of [
    { visibility: 'private' }, { visibility: 'followers' }, { visibility: undefined },
    { isActive: false }, { hiddenByAdmin: true }, { author: null },
    { author: { ...author(), moderationStatus: 'suspended' } },
    { author: { ...author(), isActive: false } },
    { author: { ...author(), deletedAt: new Date() } },
    { author: { ...author(), privacySettings: { profileVisibility: 'private', showPostsToFollowers: true } } },
    { author: { ...author(), privacySettings: { profileVisibility: 'public', showPostsToFollowers: false } } },
  ]) assert.equal(isPublicPostSeoEligible({ ...post(), ...changes }), false, JSON.stringify(changes));
});

test('eligibility responds immediately to visibility and account changes', () => {
  const value = post();
  assert.equal(isPublicPostSeoEligible(value), true);
  value.visibility = 'followers';
  assert.equal(isPublicPostSeoEligible(value), false);
  value.visibility = 'public';
  value.author.privacySettings.profileVisibility = 'private';
  assert.equal(isPublicPostSeoEligible(value), false);
});

test('public preview accepts only image files on public post media paths', () => {
  const image = 'https://media.squadhunt.com/gaming-social/posts/photo.jpg';
  const cover = 'https://media.squadhunt.com/gaming-social/post-covers/cover.webp';
  assert.equal(publicPostPreviewUrl(image), image);
  assert.equal(postPreview({ content: { media: [{ type: 'image', url: image, width: 640, height: 480 }] } }).width, 640);
  assert.equal(postPreview({ content: { media: [
    { type: 'video', url: 'https://media.squadhunt.com/gaming-social/posts/movie.mp4' },
    { type: 'image', url: image }
  ] } }).url, image);
  assert.equal(postPreview({ content: { media: [{ type: 'video', url: 'https://media.squadhunt.com/gaming-social/posts/movie.mp4', coverUrl: cover }] } }).url, cover);
  assert.equal(postPreview({ content: { media: [] } }), null);
  const prior = {
    AWS_S3_CDN_URL: process.env.AWS_S3_CDN_URL,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_REGION: process.env.AWS_REGION
  };
  try {
    process.env.AWS_S3_CDN_URL = 'https://media.squadhunt.com';
    process.env.AWS_S3_BUCKET = 'squadhunt-test';
    process.env.AWS_REGION = 'ap-south-1';
    assert.equal(publicPostPreviewUrl('https://squadhunt-test.s3.ap-south-1.amazonaws.com/gaming-social/posts/photo.jpg'), image);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  for (const candidate of [
    'https://media.squadhunt.com/gaming-social/posts/photo.jpg?X-Amz-Signature=secret',
    'https://media.squadhunt.com/gaming-social/messages/private.jpg',
    'https://media.squadhunt.com/gaming-social/posts/movie.mp4',
    'https://bucket.s3.amazonaws.com/private/photo.jpg',
    'http://media.squadhunt.com/gaming-social/posts/photo.jpg',
    '/uploads/photo.jpg'
  ]) assert.equal(publicPostPreviewUrl(candidate), '');
});
