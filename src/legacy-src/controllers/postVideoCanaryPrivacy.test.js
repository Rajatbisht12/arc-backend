const assert = require('node:assert/strict');
const test = require('node:test');
const Post = require('../models/Post');
const { createPost, updatePost } = require('./postController');
const videoUploadService = require('../services/videoUploadService');
const videoUploadController = require('./videoUploadController');

test('upload policy responses cannot be reused across a feature-flag change', async () => {
  const originalPolicy = videoUploadService.policy;
  videoUploadService.policy = async () => ({ enabled: false });
  const headers = {};
  const res = {
    set(name, value) { headers[name] = value; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await videoUploadController.policy({ user: { _id: '507f1f77bcf86cd799439011' } }, res);
    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.equal(res.body.data.enabled, false);
  } finally { videoUploadService.policy = originalPolicy; }
});

test('an active production canary rejects its owner legacy video before S3 publication', async () => {
  const owner = '507f1f77bcf86cd799439011';
  const keys = ['NODE_ENV', 'DEPLOYMENT_ENVIRONMENT', 'POST_VIDEO_UPLOADS_ENABLED', 'POST_VIDEO_ROLLOUT_MODE', 'POST_VIDEO_CANARY_USER_IDS'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { NODE_ENV: 'production', DEPLOYMENT_ENVIRONMENT: 'production', POST_VIDEO_UPLOADS_ENABLED: 'true', POST_VIDEO_ROLLOUT_MODE: 'canary', POST_VIDEO_CANARY_USER_IDS: owner });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await createPost({ user: { _id: owner }, body: { text: 'Synthetic QA', postType: 'general', clientPostId: '9e484dcc-1352-4238-81c6-bad021b9c719' }, files: { media: [{ mimetype: 'video/mp4', buffer: Buffer.from('test') }] } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'CANARY_VIDEO_UPLOAD_PATH_REQUIRED');
  } finally {
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
});

test('a persisted canary post rejects a public or followers-only edit before saving', async () => {
  const originalFindById = Post.findById;
  const owner = '507f1f77bcf86cd799439011';
  let saves = 0;
  Post.findById = async () => ({
    author: { toString: () => owner },
    postVideoCanaryRestricted: true,
    visibility: 'private',
    content: { text: 'Synthetic test video' },
    save: async () => { saves += 1; }
  });
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    for (const visibility of ['public', 'followers']) {
      const res = response();
      await updatePost({ params: { id: '507f1f77bcf86cd799439012' }, user: { _id: owner }, body: { visibility } }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, 'CANARY_POST_PRIVATE');
    }
    assert.equal(saves, 0);
  } finally {
    Post.findById = originalFindById;
  }
});

test('the owner-only marker is an internal persisted Post field', () => {
  const path = Post.schema.path('postVideoCanaryRestricted');
  assert.ok(path);
  assert.equal(path.options.default, undefined);
  assert.equal(path.options.immutable, true);
});
