const assert = require('node:assert/strict');
const test = require('node:test');
const Post = require('../models/Post');
const { toPostMediaItem } = require('./postMediaDimensions');

test('image upload dimensions and ratio are retained in post media', () => {
  assert.deepEqual(toPostMediaItem({
    type: 'image',
    url: 'https://cdn.example/image.webp',
    publicId: 'posts/image.webp',
    width: 960,
    height: 1200,
  }), {
    type: 'image',
    url: 'https://cdn.example/image.webp',
    publicId: 'posts/image.webp',
    width: 960,
    height: 1200,
    aspectRatio: 0.8,
  });
});

test('media without valid dimensions remains backwards compatible', () => {
  assert.deepEqual(toPostMediaItem({
    type: 'video',
    url: 'https://cdn.example/video.mp4',
    publicId: 'posts/video.mp4',
  }), {
    type: 'video',
    url: 'https://cdn.example/video.mp4',
    publicId: 'posts/video.mp4',
  });
});

test('Post schema exposes optional intrinsic media metadata', () => {
  assert.ok(Post.schema.path('content.media').schema.path('width'));
  assert.ok(Post.schema.path('content.media').schema.path('height'));
  assert.ok(Post.schema.path('content.media').schema.path('aspectRatio'));
});
