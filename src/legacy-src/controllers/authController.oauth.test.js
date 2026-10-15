const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

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

let findOneImpl = () => null;
let createImpl = async () => {
  throw new Error('User.create should not be called in this test');
};
let completionUser = null;
let tokenCalls = 0;
let refreshTokenCalls = 0;
const invalidatedUserIds = [];
const completionEvents = [];
let passwordObservedBeforeSave = null;

const User = {
  findOne(query) {
    return findOneImpl(query);
  },
  async findById() {
    return completionUser;
  },
  async create(data) {
    return createImpl(data);
  }
};

stubModule('../models/User', User);
stubModule('../models/OtpVerification', {});
stubModule('../models/Follow', {});
stubModule('../utils/jwt', {
  generateToken() {
    tokenCalls += 1;
    return 'app-token';
  },
  generateRefreshToken() {
    refreshTokenCalls += 1;
    return 'refresh-token';
  }
});
stubModule('../utils/cloudinary', {
  uploadAvatar: async () => ({}),
  uploadImage: async () => ({}),
  uploadAvatarFromUrl: async () => ({ url: '' })
});
stubModule('../utils/email', { sendOTPEmail: async () => {} });
stubModule('../utils/logger', { error: () => {}, warn: () => {}, info: () => {} });
stubModule('../middleware/auth', {
  invalidateUserCache: async (userId) => {
    invalidatedUserIds.push(String(userId));
    completionEvents.push('invalidate');
  }
});
let googleProfile = {
  sub: 'google-admin-subject',
  email: 'admin@example.com'
};
const { privateKey: applePrivateKey, publicKey: applePublicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const appleJwk = { ...applePublicKey.export({ format: 'jwk' }), kid: 'test-apple-key' };
const appleToken = (subject, email) => jwt.sign({
  iss: 'https://appleid.apple.com',
  aud: 'com.arcSquadHunt',
  sub: subject,
  ...(email ? { email, email_verified: 'true' } : {})
}, applePrivateKey, { algorithm: 'RS256', expiresIn: '5m', keyid: 'test-apple-key' });
stubModule('axios', { get: async (url) => ({ data: url.includes('appleid.apple.com') ? { keys: [appleJwk] } : googleProfile }) });

const { completeGoogleProfile, completeProfile, googleTokenLogin, appleMobileLogin, register } = require('./authController');

const createRes = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

const dateYearsAgo = (years) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
};

(async () => {
  let adminSaveCalled = false;
  findOneImpl = () => Promise.resolve({
    _id: 'admin-id',
    email: 'admin@example.com',
    username: 'admin-user',
    userType: 'admin',
    async save() {
      adminSaveCalled = true;
    }
  });

  const adminRes = createRes();
  await googleTokenLogin({ body: { access_token: 'google-access-token' } }, adminRes);

  assert.strictEqual(adminRes.statusCode, 403);
  assert.deepStrictEqual(adminRes.body, {
    success: false,
    message: 'Admin accounts must sign in through the dedicated Admin Portal.'
  });
  assert.strictEqual(adminSaveCalled, false);
  assert.strictEqual(tokenCalls, 0);
  assert.strictEqual(refreshTokenCalls, 0);

  let deactivatedSaveCalled = false;
  googleProfile = {
    sub: 'deactivated-google-subject',
    email: 'deactivated@example.com'
  };
  findOneImpl = () => Promise.resolve({
    _id: 'deactivated-user-id',
    email: 'deactivated@example.com',
    username: 'deactivated_user',
    userType: 'player',
    isActive: false,
    async save() {
      deactivatedSaveCalled = true;
    }
  });

  const deactivatedRes = createRes();
  await googleTokenLogin({ body: { access_token: 'google-access-token' } }, deactivatedRes);
  assert.strictEqual(deactivatedRes.statusCode, 401);
  assert.deepStrictEqual(deactivatedRes.body, {
    success: false,
    message: 'Account is deactivated.'
  });
  assert.strictEqual(deactivatedSaveCalled, false);
  assert.strictEqual(tokenCalls, 0);
  assert.strictEqual(refreshTokenCalls, 0);

  let existingGoogleSaveCalled = false;
  const existingGoogleUser = {
    _id: 'existing-google-id',
    email: 'existing@example.com',
    username: 'existing_player',
    userType: 'player',
    isActive: true,
    profile: { displayName: 'Existing Player', gender: 'prefer_not_to_say' },
    needsProfileCompletion: false,
    async save() {
      existingGoogleSaveCalled = true;
    },
    toObject() {
      return { ...this };
    }
  };
  googleProfile = {
    sub: 'existing-google-subject',
    email: 'existing@example.com',
    name: 'Existing Player'
  };
  findOneImpl = () => Promise.resolve(existingGoogleUser);

  const existingGoogleRes = createRes();
  await googleTokenLogin({
    body: { access_token: 'google-access-token', requirePasswordSetup: true }
  }, existingGoogleRes);
  assert.strictEqual(existingGoogleRes.statusCode, 200);
  assert.strictEqual(existingGoogleRes.body.profileComplete, true);
  assert.strictEqual(existingGoogleRes.body.data.user.profile.displayName, 'Existing Player');
  assert.strictEqual(existingGoogleRes.body.data.user.profile.gender, 'prefer_not_to_say');
  assert.strictEqual(existingGoogleSaveCalled, true);
  assert.strictEqual(existingGoogleUser.requiresPasswordSetup, undefined);

  let createdGoogleData = null;
  googleProfile = {
    sub: 'new-google-subject',
    email: 'new@example.com',
    email_verified: true,
    name: 'New Google User'
  };
  findOneImpl = () => Promise.resolve(null);
  createImpl = async (data) => {
    createdGoogleData = data;
    return {
      _id: 'new-google-id',
      ...data,
      toObject() {
        return { ...this };
      }
    };
  };

  const newGoogleRes = createRes();
  await googleTokenLogin({
    body: { access_token: 'google-access-token', requirePasswordSetup: true }
  }, newGoogleRes);
  assert.strictEqual(newGoogleRes.statusCode, 200);
  assert.strictEqual(newGoogleRes.body.profileComplete, false);
  assert.strictEqual(newGoogleRes.body.user.needsProfileCompletion, true);
  assert.strictEqual(createdGoogleData.needsProfileCompletion, true);
  assert.strictEqual(createdGoogleData.requiresPasswordSetup, true);
  assert.strictEqual(createdGoogleData.profile.displayName, 'New Google User');

  let createdWebGoogleData = null;
  googleProfile = {
    sub: 'new-web-google-subject',
    email: 'new-web@example.com',
    email_verified: true,
    name: 'New Web Google User'
  };
  createImpl = async (data) => {
    createdWebGoogleData = data;
    return {
      _id: 'new-web-google-id',
      ...data,
      toObject() {
        return { ...this };
      }
    };
  };
  const newWebGoogleRes = createRes();
  await googleTokenLogin({ body: { access_token: 'google-access-token' } }, newWebGoogleRes);
  assert.strictEqual(newWebGoogleRes.statusCode, 200);
  assert.strictEqual(createdWebGoogleData.requiresPasswordSetup, true);

  let sameSubjectLookups = 0;
  findOneImpl = (query) => {
    if (query.googleId) {
      sameSubjectLookups += 1;
      return Promise.resolve(sameSubjectLookups === 1 ? null : existingGoogleUser);
    }
    return Promise.resolve(null);
  };
  createImpl = async () => { throw Object.assign(new Error('duplicate provider subject'), { code: 11000 }); };
  const retryRes = createRes();
  await googleTokenLogin({ body: { access_token: 'google-access-token' } }, retryRes);
  assert.strictEqual(retryRes.statusCode, 200);
  assert.strictEqual(retryRes.body.data.user._id, existingGoogleUser._id);

  googleProfile = {
    sub: 'unlinked-google-subject',
    email: 'existing@example.com',
    email_verified: true
  };
  findOneImpl = (query) => Promise.resolve(query.googleId ? null : existingGoogleUser);
  const conflictRes = createRes();
  await googleTokenLogin({ body: { access_token: 'google-access-token' } }, conflictRes);
  assert.strictEqual(conflictRes.statusCode, 409);
  assert.strictEqual(conflictRes.body.code, 'ACCOUNT_LINK_REQUIRED');
  assert.strictEqual(existingGoogleUser.googleId, undefined);

  let createdAppleData = null;
  findOneImpl = () => Promise.resolve(null);
  createImpl = async (data) => {
    createdAppleData = data;
    return { _id: 'new-apple-id', ...data, toObject() { return { ...this }; } };
  };
  const newAppleRes = createRes();
  await appleMobileLogin({ body: { identityToken: appleToken('new-apple-subject', 'apple@example.com'), displayName: 'Apple User' } }, newAppleRes);
  assert.strictEqual(newAppleRes.statusCode, 200);
  assert.strictEqual(createdAppleData.appleId, 'new-apple-subject');
  assert.strictEqual(createdAppleData.requiresPasswordSetup, true);
  assert.strictEqual(createdAppleData.needsProfileCompletion, true);

  createImpl = async () => { throw new Error('Apple must not auto-link an email collision'); };
  findOneImpl = (query) => Promise.resolve(query.email ? existingGoogleUser : null);
  const appleConflictRes = createRes();
  await appleMobileLogin({ body: { identityToken: appleToken('unlinked-apple-subject', 'existing@example.com') } }, appleConflictRes);
  assert.strictEqual(appleConflictRes.statusCode, 409);
  assert.strictEqual(appleConflictRes.body.code, 'ACCOUNT_LINK_REQUIRED');
  assert.strictEqual(existingGoogleUser.appleId, undefined);

  findOneImpl = (query) => Promise.resolve(query.appleId ? {
    ...existingGoogleUser,
    appleId: 'linked-apple-subject',
    async save() {}
  } : null);
  const existingAppleRes = createRes();
  await appleMobileLogin({ body: { identityToken: appleToken('linked-apple-subject') } }, existingAppleRes);
  assert.strictEqual(existingAppleRes.statusCode, 200);
  assert.strictEqual(existingAppleRes.body.profileComplete, true);

  createImpl = async () => {
    throw new Error('User.create should not be called during profile completion');
  };

  completionUser = {
    _id: 'google-user-id',
    email: 'player@example.com',
    username: 'temporary-name',
    userType: 'player',
    password: 'temporary-password',
    googleId: 'new-google-subject',
    profile: {
      displayName: 'Google Name',
      avatar: 'https://example.test/avatar.png'
    },
    needsProfileCompletion: true,
    requiresPasswordSetup: true,
    teamInfo: null,
    async save() {
      if (this.password !== 'temporary-password') {
        passwordObservedBeforeSave = this.password;
        // The real User model pre-save hook replaces this value with a bcrypt
        // hash. The stub mirrors that observable controller contract without
        // retaining plaintext in its response fixture.
        this.password = '$2b$10$hashed-oauth-password';
      }
      completionEvents.push('save');
    },
    toObject() {
      return { ...this };
    }
  };
  findOneImpl = () => ({ select: async () => null });

  const missingDisplayNameRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team',
      username: 'completed_team'
    }
  }, missingDisplayNameRes);

  assert.strictEqual(missingDisplayNameRes.statusCode, 400);
  assert.strictEqual(missingDisplayNameRes.body.message, 'Display name is required and must be less than 50 characters');
  assert.strictEqual(completionUser.needsProfileCompletion, true);
  assert.deepStrictEqual(completionEvents, []);

  const validDob = dateYearsAgo(25);
  const missingGenderRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team',
      username: 'completed_team',
      displayName: 'Completed Team',
      dob: validDob
    }
  }, missingGenderRes);
  assert.strictEqual(missingGenderRes.statusCode, 400);
  assert.strictEqual(missingGenderRes.body.message, 'Gender is required');

  const missingDobRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team',
      username: 'completed_team',
      displayName: 'Completed Team',
      gender: 'female'
    }
  }, missingDobRes);
  assert.strictEqual(missingDobRes.statusCode, 400);
  assert.strictEqual(missingDobRes.body.message, 'Date of birth is required');

  const missingUsernameRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team', displayName: 'Completed Team', gender: 'female',
      dob: validDob, password: 'valid-password'
    }
  }, missingUsernameRes);
  assert.strictEqual(missingUsernameRes.statusCode, 400);
  assert.match(missingUsernameRes.body.message, /username/i);

  const legacyGenderRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team',
      username: 'completed_team',
      displayName: 'Completed Team',
      gender: 'prefer_not_to_say',
      dob: validDob
    }
  }, legacyGenderRes);
  assert.strictEqual(legacyGenderRes.statusCode, 400);
  assert.strictEqual(legacyGenderRes.body.message, 'Gender must be male, female, or other');

  const registrationWithoutGenderRes = createRes();
  await register({
    body: {
      userType: 'player',
      displayName: 'New Player',
      username: 'new_player',
      email: 'new-player@example.com',
      password: 'password',
      dob: validDob,
      otp: '123456'
    }
  }, registrationWithoutGenderRes);
  assert.strictEqual(registrationWithoutGenderRes.statusCode, 400);
  assert.strictEqual(registrationWithoutGenderRes.body.message, 'Gender is required');

  const registrationWithoutDobRes = createRes();
  await register({
    body: {
      userType: 'player',
      displayName: 'New Player',
      username: 'new_player',
      email: 'new-player@example.com',
      password: 'password',
      gender: 'male',
      otp: '123456'
    }
  }, registrationWithoutDobRes);
  assert.strictEqual(registrationWithoutDobRes.statusCode, 400);
  assert.strictEqual(registrationWithoutDobRes.body.message, 'Date of birth is required');

  const underageRegistrationRes = createRes();
  await register({
    body: {
      userType: 'player',
      displayName: 'Young Player',
      gender: 'other',
      username: 'young_player',
      email: 'young@example.com',
      password: 'password',
      dob: dateYearsAgo(10),
      otp: '123456'
    }
  }, underageRegistrationRes);

  assert.strictEqual(underageRegistrationRes.statusCode, 400);
  assert.strictEqual(underageRegistrationRes.body.message, 'You must be at least 13 years old');

  const missingPasswordRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team',
      username: 'completed_team',
      displayName: 'Completed Team',
      gender: 'other',
      dob: validDob,
      bio: 'Ready to compete'
    }
  }, missingPasswordRes);
  assert.strictEqual(missingPasswordRes.statusCode, 400);
  assert.strictEqual(missingPasswordRes.body.error, 'PASSWORD_POLICY_FAILED');
  assert.strictEqual(completionUser.needsProfileCompletion, true);

  const weakPasswordRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team',
      username: 'completed_team',
      displayName: 'Completed Team',
      gender: 'other',
      dob: validDob,
      password: '12345'
    }
  }, weakPasswordRes);
  assert.strictEqual(weakPasswordRes.statusCode, 400);
  assert.strictEqual(weakPasswordRes.body.error, 'PASSWORD_POLICY_FAILED');

  const completionRes = createRes();
  await completeProfile({
    user: { _id: 'google-user-id' },
    body: {
      userType: 'team',
      username: 'completed_team',
      displayName: 'Completed Team',
      gender: 'other',
      dob: validDob,
      bio: 'Ready to compete',
      password: 'oauth-local-password'
    }
  }, completionRes);

  assert.strictEqual(completionRes.statusCode, 200);
  assert.deepStrictEqual(completionEvents.slice(0, 2), ['save', 'invalidate']);
  assert.deepStrictEqual(invalidatedUserIds, ['google-user-id']);
  assert.strictEqual(completionUser.userType, 'team');
  assert.strictEqual(completionUser.username, 'completed_team');
  assert.strictEqual(passwordObservedBeforeSave, 'oauth-local-password');
  assert.strictEqual(completionUser.password, '$2b$10$hashed-oauth-password');
  assert.strictEqual(completionUser.profile.displayName, 'Completed Team');
  assert.strictEqual(completionUser.profile.gender, 'other');
  assert.strictEqual(completionUser.profile.dob.toISOString(), `${validDob}T00:00:00.000Z`);
  assert.strictEqual(completionUser.profile.bio, 'Ready to compete');
  assert.strictEqual(completionUser.needsProfileCompletion, false);
  assert.strictEqual(completionUser.requiresPasswordSetup, false);
  assert.strictEqual(completionRes.body.profileComplete, true);
  assert.strictEqual(completionRes.body.data.token, 'app-token');
  assert.strictEqual(completionRes.body.data.refreshToken, 'refresh-token');
  assert.strictEqual(completionRes.body.data.user.password, undefined);

  const completedTeamUser = completionUser;
  completionEvents.length = 0;
  invalidatedUserIds.length = 0;
  passwordObservedBeforeSave = null;
  completionUser = {
    _id: 'google-player-id',
    email: 'oauth-player@example.com',
    username: 'temporary-player',
    userType: 'player',
    password: 'temporary-password',
    googleId: 'new-player-google-subject',
    profile: { displayName: 'OAuth Player', avatar: '' },
    needsProfileCompletion: true,
    requiresPasswordSetup: true,
    playerInfo: null,
    async save() {
      if (this.password !== 'temporary-password') {
        passwordObservedBeforeSave = this.password;
        this.password = '$2b$10$hashed-player-password';
      }
      completionEvents.push('save');
    },
    toObject() {
      return { ...this };
    }
  };
  const playerCompletionRes = createRes();
  await completeProfile({
    user: { _id: 'google-player-id' },
    body: {
      userType: 'player',
      username: 'completed_player',
      displayName: 'Completed Player',
      gender: 'male',
      dob: validDob,
      password: 'player-local-password'
    }
  }, playerCompletionRes);
  assert.strictEqual(playerCompletionRes.statusCode, 200);
  assert.strictEqual(passwordObservedBeforeSave, 'player-local-password');
  assert.strictEqual(completionUser.password, '$2b$10$hashed-player-password');
  assert.strictEqual(completionUser.requiresPasswordSetup, false);
  assert.strictEqual(completionUser.needsProfileCompletion, false);
  assert.deepStrictEqual(completionUser.playerInfo.games, []);
  assert.strictEqual(playerCompletionRes.body.data.user.password, undefined);

  completionEvents.length = 0;
  invalidatedUserIds.length = 0;
  completionUser = completedTeamUser;
  completionUser.needsProfileCompletion = true;
  completionUser.username = 'temporary-name';
  const passwordBeforeCompatibilityCompletion = completionUser.password;
  const compatibilityRes = createRes();
  await completeGoogleProfile({
    user: {
      _id: 'google-user-id',
      profile: { displayName: 'Stored OAuth Name' }
    },
    body: {
      userType: 'player',
      username: 'compatible_user',
      gender: 'female',
      dob: validDob,
      password: 'legacy-client-password'
    }
  }, compatibilityRes);

  assert.strictEqual(compatibilityRes.statusCode, 200);
  assert.strictEqual(completionUser.profile.displayName, 'Stored OAuth Name');
  assert.strictEqual(completionUser.password, passwordBeforeCompatibilityCompletion);
  assert.strictEqual(completionUser.needsProfileCompletion, false);

  console.log('Auth OAuth contract tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
