const assert = require('assert');

const stubModule = (request, exportsValue) => {
  const filename = require.resolve(request);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: exportsValue,
    children: [],
    paths: []
  };
};

let verifyGoogle = null;
let tokenCalls = 0;
let refreshTokenCalls = 0;
let avatarUploadCalls = 0;
let saveCalls = 0;
let findOneImpl = async () => mockUser;
let createImpl = async () => { throw new Error('User.create should not be called'); };
const lookupQueries = [];
let mockUser = {
  _id: 'deactivated-user-id',
  email: 'deactivated@example.com',
  username: 'deactivated_user',
  userType: 'player',
  isActive: false,
  async save() { saveCalls += 1; }
};

class GoogleStrategy {
  constructor(_options, verify) {
    verifyGoogle = verify;
  }
}

stubModule('passport', { use: () => {} });
stubModule('passport-google-oauth20', { Strategy: GoogleStrategy });
stubModule('../models/User', {
  findOne: async (query) => {
    lookupQueries.push(query);
    return findOneImpl(query);
  },
  create: async (data) => createImpl(data)
});
stubModule('../utils/jwt', {
  generateToken: () => {
    tokenCalls += 1;
    return 'token';
  },
  generateRefreshToken: () => {
    refreshTokenCalls += 1;
    return 'refresh-token';
  }
});
stubModule('../utils/cloudinary', {
  uploadAvatarFromUrl: async () => {
    avatarUploadCalls += 1;
    return { url: 'avatar' };
  }
});

require('./passport');

(async () => {
  assert.strictEqual(typeof verifyGoogle, 'function');

  const result = await new Promise((resolve, reject) => {
    verifyGoogle(
      'google-access-token',
      'google-refresh-token',
      {
        id: 'google-subject',
        displayName: 'Deactivated User',
        emails: [{ value: 'deactivated@example.com' }],
        photos: [{ value: 'https://example.test/avatar.png' }]
      },
      (error, user, info) => {
        if (error) return reject(error);
        return resolve({ user, info });
      }
    );
  });

  assert.strictEqual(result.user, false);
  assert.deepStrictEqual(lookupQueries[0], { googleId: 'google-subject' });
  assert.deepStrictEqual(result.info, { message: 'Account is deactivated.' });
  assert.strictEqual(avatarUploadCalls, 0);
  assert.strictEqual(saveCalls, 0);
  assert.strictEqual(tokenCalls, 0);
  assert.strictEqual(refreshTokenCalls, 0);

  findOneImpl = async (query) => query.googleId ? null : mockUser;
  mockUser = {
    ...mockUser,
    _id: 'password-account-id',
    email: 'password-account@example.com',
    isSystemAccount: false,
    userType: 'player',
    isActive: true
  };
  const conflict = await new Promise((resolve, reject) => verifyGoogle(
    'google-access-token', 'google-refresh-token',
    { id: 'unlinked-subject', emails: [{ value: 'password-account@example.com' }], _json: { email_verified: true } },
    (error, user, info) => error ? reject(error) : resolve({ user, info })
  ));
  assert.strictEqual(conflict.user, false);
  assert.match(conflict.info.message, /sign in before linking Google/i);
  assert.strictEqual(tokenCalls, 0);

  let created = null;
  findOneImpl = async () => null;
  createImpl = async (data) => {
    created = data;
    return { _id: 'new-oauth-id', ...data };
  };
  const newAccount = await new Promise((resolve, reject) => verifyGoogle(
    'google-access-token', 'google-refresh-token',
    { id: 'new-subject', displayName: 'New User', emails: [{ value: 'new@example.com' }], _json: { email_verified: true } },
    (error, value, info) => error ? reject(error) : resolve({ value, info })
  ));
  assert.strictEqual(newAccount.value.user._id, 'new-oauth-id');
  assert.strictEqual(created.googleId, 'new-subject');
  assert.strictEqual(created.requiresPasswordSetup, true);
  assert.strictEqual(created.needsProfileCompletion, true);

  findOneImpl = async () => mockUser;
  mockUser = {
    ...mockUser,
    _id: 'official-system-id',
    username: 'SquadHunt',
    userType: 'system',
    isSystemAccount: true,
    isActive: true
  };
  const systemResult = await new Promise((resolve, reject) => {
    verifyGoogle(
      'google-access-token',
      'google-refresh-token',
      { id: 'google-subject', emails: [{ value: 'official-system@squadhunt.invalid' }] },
      (error, user, info) => error ? reject(error) : resolve({ user, info })
    );
  });
  assert.strictEqual(systemResult.user, false);
  assert.deepStrictEqual(systemResult.info, { message: 'Account is unavailable.' });
  assert.strictEqual(tokenCalls, 1);
  assert.strictEqual(refreshTokenCalls, 1);

  console.log('Passport OAuth contract tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
