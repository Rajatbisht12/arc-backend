const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MESSAGE_MEDIA_POLICY,
  getPublicMessageMediaPolicy,
} = require('./messageMediaPolicy');

assert.equal(MESSAGE_MEDIA_POLICY.maxVideoBytes, 50 * 1024 * 1024);
assert.equal(MESSAGE_MEDIA_POLICY.maxFileBytes, MESSAGE_MEDIA_POLICY.maxVideoBytes);
assert.equal(MESSAGE_MEDIA_POLICY.maxVideoDurationSeconds, null);
assert.deepEqual(MESSAGE_MEDIA_POLICY.acceptedVideoMimeTypes, ['video/*']);
assert.equal(MESSAGE_MEDIA_POLICY.uploadRequestTimeoutMs, 120_000);

const publicPolicy = getPublicMessageMediaPolicy();
assert.deepEqual(publicPolicy, {
  video: {
    maxBytes: 50 * 1024 * 1024,
    maxMegabytes: 50,
    maxDurationSeconds: null,
    acceptedMimeTypes: ['video/*'],
    codecValidation: false,
  },
  uploadTimeoutMs: 120_000,
});

const uploadSource = fs.readFileSync(path.join(__dirname, '../middleware/upload.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../../server.ts'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '../../modules/messages/messages.routes.ts'), 'utf8');
assert.match(uploadSource, /MESSAGE_MEDIA_POLICY\.maxFileBytes/);
assert.match(serverSource, /MESSAGE_MEDIA_POLICY\.uploadRequestTimeoutMs/);
assert.match(routeSource, /router\.get\("\/media-policy", protect, messageController\.getMessageMediaPolicy\)/);

console.log('Message media policy contract passed');
