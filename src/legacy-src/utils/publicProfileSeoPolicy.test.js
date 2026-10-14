const assert = require('node:assert/strict');
const test = require('node:test');
const {
  publicProfileSeoFilter,
  isPublicProfileSeoEligible,
  publicAvatarUrl
} = require('./publicProfileSeoPolicy');

const publicUser = () => ({
  username: 'Gamer_One', userType: 'player', isActive: true,
  moderationStatus: 'active', privacySettings: { profileVisibility: 'public' }
});

test('SEO policy requires an explicit public profile and active person account', () => {
  assert.equal(isPublicProfileSeoEligible(publicUser()), true);
  assert.equal(isPublicProfileSeoEligible({ ...publicUser(), userType: 'team' }), true);
  const blocked = [
    { privacySettings: { profileVisibility: 'private' } },
    { privacySettings: { profileVisibility: 'followers' } },
    { privacySettings: { accountType: 'public' } },
    { isActive: false }, { moderationStatus: 'suspended' },
    { moderationStatus: 'banned' }, { moderationStatus: 'soft_deleted' },
    { deletedAt: new Date() }, { userType: 'admin' },
    { isSystemAccount: true }, { isSuperUser: true },
    { needsProfileCompletion: true }, { adminControls: { loginDisabled: true } },
    { username: 'invalid/path' }
  ];
  for (const overrides of blocked) {
    assert.equal(isPublicProfileSeoEligible({ ...publicUser(), ...overrides }), false, JSON.stringify(overrides));
  }
  assert.equal(publicProfileSeoFilter['privacySettings.profileVisibility'], 'public');
  assert.equal(publicProfileSeoFilter.isActive, true);
  assert.equal(publicProfileSeoFilter.username.test('Gamer_One'), true);
  assert.equal(publicProfileSeoFilter.username.test('invalid/path'), false);
});

test('visibility transitions take effect without cached eligibility', () => {
  const user = publicUser();
  assert.equal(isPublicProfileSeoEligible(user), true);
  user.privacySettings.profileVisibility = 'private';
  assert.equal(isPublicProfileSeoEligible(user), false);
  user.privacySettings.profileVisibility = 'public';
  assert.equal(isPublicProfileSeoEligible(user), true);
});

test('SEO avatar excludes private paths, signatures, and non-public origins', () => {
  assert.equal(publicAvatarUrl('https://media.squadhunt.com/gaming-social/avatars/a.jpg'), 'https://media.squadhunt.com/gaming-social/avatars/a.jpg');
  const previous = {
    AWS_S3_CDN_URL: process.env.AWS_S3_CDN_URL,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_REGION: process.env.AWS_REGION
  };
  try {
    process.env.AWS_S3_CDN_URL = 'https://media.squadhunt.com';
    process.env.AWS_S3_BUCKET = 'squadhunt-test';
    process.env.AWS_REGION = 'ap-south-1';
    assert.equal(publicAvatarUrl('https://squadhunt-test.s3.ap-south-1.amazonaws.com/gaming-social/avatars/a.jpg'), 'https://media.squadhunt.com/gaming-social/avatars/a.jpg');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  for (const candidate of [
    'http://media.squadhunt.com/a.jpg',
    'https://media.squadhunt.com/a.jpg?X-Amz-Signature=secret',
    'https://s3.amazonaws.com/private/avatar.jpg',
    'https://media.squadhunt.com/gaming-social/messages/private.jpg',
    'file:///private/avatar.jpg',
    '/uploads/avatar.jpg'
  ]) assert.equal(publicAvatarUrl(candidate), '');
});
