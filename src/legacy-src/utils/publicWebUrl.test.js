const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CANONICAL_PUBLIC_WEB_ORIGIN,
  canonicalizePublicWebUrl,
  resolvePublicWebOrigin
} = require('./publicWebUrl');

test('canonicalizes current and legacy public Web origins without losing URL state', () => {
  assert.equal(resolvePublicWebOrigin(), CANONICAL_PUBLIC_WEB_ORIGIN);
  assert.equal(resolvePublicWebOrigin('https://squadhunt.in'), CANONICAL_PUBLIC_WEB_ORIGIN);
  assert.equal(
    canonicalizePublicWebUrl('https://www.squadhunt.in/post/1?from=email#comments'),
    'https://www.squadhunt.com/post/1?from=email#comments'
  );
});

test('preserves staging and API service origins', () => {
  assert.equal(resolvePublicWebOrigin('https://staging.squadhunt.dev'), 'https://staging.squadhunt.dev');
  assert.equal(resolvePublicWebOrigin('https://staging.squadhunt.dev/app/'), 'https://staging.squadhunt.dev/app');
  assert.equal(canonicalizePublicWebUrl('https://api.squadhunt.in/health'), 'https://api.squadhunt.in/health');
});
