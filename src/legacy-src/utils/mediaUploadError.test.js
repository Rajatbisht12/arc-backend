const assert = require('node:assert/strict');
const { respondToMediaUploadError } = require('./mediaUploadError');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

const invalid = responseRecorder();
respondToMediaUploadError(invalid, Object.assign(new Error('sharp internals'), { statusCode: 422 }));
assert.equal(invalid.statusCode, 422);
assert.equal(invalid.body.code, 'INVALID_MEDIA');
assert.equal(JSON.stringify(invalid.body).includes('sharp internals'), false);

const unavailable = responseRecorder();
respondToMediaUploadError(unavailable, new Error('s3://private-bucket/key'));
assert.equal(unavailable.statusCode, 503);
assert.equal(unavailable.body.code, 'MEDIA_STORAGE_UNAVAILABLE');
assert.equal(JSON.stringify(unavailable.body).includes('private-bucket'), false);

console.log('Media upload status and error-redaction contracts passed');
