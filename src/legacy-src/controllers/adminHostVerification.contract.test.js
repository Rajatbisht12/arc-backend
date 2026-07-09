const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = require('./adminController');
const {
  bestEffortHostVerificationSideEffect,
  sendHostVerificationMutationError
} = controller.__testables;

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

(async () => {
  await assert.doesNotReject(() => bestEffortHostVerificationSideEffect(
    'test notification',
    '507f1f77bcf86cd799439011',
    async () => { throw new Error('simulated delivery outage'); },
    { error() {} }
  ));

  const validationResponse = responseRecorder();
  sendHostVerificationMutationError(validationResponse, Object.assign(new Error('Too long'), {
    statusCode: 400,
    code: 'HOST_REJECTION_REASON_TOO_LONG'
  }), 'Fallback');
  assert.equal(validationResponse.statusCode, 400);
  assert.equal(validationResponse.body.code, 'HOST_REJECTION_REASON_TOO_LONG');

  const source = fs.readFileSync(path.join(__dirname, 'adminController.js'), 'utf8');
  const section = (start, end) => {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert(startIndex >= 0 && endIndex > startIndex, `Missing controller section ${start}`);
    return source.slice(startIndex, endIndex);
  };
  const approve = section(
    'const approveHostVerificationApplication = async',
    '// Task 5.3: Reject host verification application'
  );
  const reject = section(
    'const rejectHostVerificationApplication = async',
    '// Get all verified hosts'
  );
  const revoke = section(
    'const revokeHostVerification = async',
    'const listCreatorPayouts = async'
  );

  for (const [name, block, transitionCall] of [
    ['approve', approve, 'approveHostVerificationReview({'],
    ['reject', reject, 'rejectHostVerificationReview({'],
    ['revoke', revoke, 'revokeHostVerificationReview({']
  ]) {
    assert(block.includes(transitionCall), `${name} must use the transactional review service`);
    assert(block.includes('bestEffortHostVerificationSideEffect('), `${name} side effects must be best-effort`);
    assert(
      block.indexOf(transitionCall) < block.indexOf('createSystemNotification('),
      `${name} notification must run only after the database transition commits`
    );
  }

  console.log('Admin Host Verification post-commit side-effect contracts passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
