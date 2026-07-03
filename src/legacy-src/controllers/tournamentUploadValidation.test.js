const assert = require('node:assert/strict');
const multer = require('multer');
const { _private } = require('./tournamentController');

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

const oversized = responseRecorder();
_private.sendTournamentUploadError(oversized, new multer.MulterError('LIMIT_FILE_SIZE'));
assert.equal(oversized.statusCode, 413);
assert.equal(oversized.body.code, 'FILE_TOO_LARGE');

const unsupported = responseRecorder();
_private.sendTournamentUploadError(unsupported, new Error('Only image files are allowed'));
assert.equal(unsupported.statusCode, 415);
assert.equal(unsupported.body.code, 'UNSUPPORTED_MEDIA_TYPE');

const secret = 's3://private-bucket/tournament-banner';
const internal = responseRecorder();
_private.sendTournamentUploadError(internal, new Error(secret));
assert.equal(internal.statusCode, 400);
assert.equal(internal.body.code, 'FILE_UPLOAD_REJECTED');
assert.equal(JSON.stringify(internal.body).includes(secret), false);

console.log('Tournament upload status and error-redaction contracts passed');
