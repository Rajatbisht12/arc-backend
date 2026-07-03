const assert = require('node:assert/strict');
const multer = require('multer');
const { _sendUploadError } = require('./upload');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
});

const fileSizeResponse = responseRecorder();
_sendUploadError(fileSizeResponse, new multer.MulterError('LIMIT_FILE_SIZE'));
assert.equal(fileSizeResponse.statusCode, 413);
assert.equal(fileSizeResponse.body.code, 'FILE_TOO_LARGE');

const fileCountResponse = responseRecorder();
_sendUploadError(fileCountResponse, new multer.MulterError('LIMIT_FILE_COUNT'), 3);
assert.equal(fileCountResponse.statusCode, 413);
assert.equal(fileCountResponse.body.code, 'TOO_MANY_FILES');
assert.match(fileCountResponse.body.message, /3/);

const mediaTypeResponse = responseRecorder();
_sendUploadError(mediaTypeResponse, new Error('Only image files are allowed for avatars and images'));
assert.equal(mediaTypeResponse.statusCode, 415);
assert.equal(mediaTypeResponse.body.code, 'UNSUPPORTED_MEDIA_TYPE');

const internalMessage = 's3://private-bucket/internal-upload-key';
const unknownResponse = responseRecorder();
_sendUploadError(unknownResponse, new Error(internalMessage));
assert.equal(unknownResponse.statusCode, 400);
assert.equal(unknownResponse.body.code, 'FILE_UPLOAD_REJECTED');
assert.equal(JSON.stringify(unknownResponse.body).includes(internalMessage), false);

console.log('Upload middleware status and error-redaction contracts passed');
