const assert = require('assert');
const User = require('./User');

const runPreSaveHooks = (document) => new Promise((resolve, reject) => {
  User.schema.s.hooks.execPre('save', document, [], (error) => {
    if (error) reject(error);
    else resolve();
  });
});

(async () => {
  const document = new User({
    email: 'oauth-password-contract@example.com',
    username: 'oauth_pw_contract',
    password: 'local-oauth-password',
    userType: 'player',
    profile: {
      displayName: 'OAuth Password Contract',
      gender: 'other',
      dob: new Date('2000-01-01T00:00:00.000Z')
    },
    googleId: 'oauth-password-google-subject',
    needsProfileCompletion: true,
    requiresPasswordSetup: true
  });

  await runPreSaveHooks(document);

  assert.notStrictEqual(document.password, 'local-oauth-password');
  assert.match(document.password, /^\$2[aby]\$/);
  assert.strictEqual(await document.comparePassword('local-oauth-password'), true);
  assert.strictEqual(await document.comparePassword('wrong-password'), false);

  const legacyDocument = new User({
    email: 'legacy-oauth-contract@example.com',
    username: 'legacy_oauth',
    password: 'legacy-placeholder-password',
    userType: 'player',
    profile: {
      displayName: 'Legacy OAuth Contract',
      gender: 'other',
      dob: new Date('2000-01-01T00:00:00.000Z')
    },
    googleId: 'legacy-google-subject',
    needsProfileCompletion: false
  });
  assert.strictEqual(legacyDocument.requiresPasswordSetup, false);

  console.log('OAuth password hashing and legacy-default contract tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
