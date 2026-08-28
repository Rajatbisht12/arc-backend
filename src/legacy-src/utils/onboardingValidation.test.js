const assert = require('assert');
const { parseDateOnly, validateOnboardingProfile } = require('./onboardingValidation');

const now = new Date('2026-07-01T12:00:00.000Z');

const valid = validateOnboardingProfile({
  userType: ' TEAM ',
  displayName: '  ARC Team  ',
  gender: 'OTHER',
  dob: '2000-02-29',
  bio: '  Competitive team  '
}, now);

assert.deepStrictEqual(valid.value, {
  userType: 'team',
  displayName: 'ARC Team',
  gender: 'other',
  dob: new Date('2000-02-29T00:00:00.000Z'),
  bio: 'Competitive team'
});

const missingGender = validateOnboardingProfile({
  userType: 'player',
  displayName: 'Player',
  dob: '2000-01-15'
}, now);
assert.strictEqual(missingGender.error, 'Gender is required');

const missingDob = validateOnboardingProfile({
  userType: 'player',
  displayName: 'Player',
  gender: 'male'
}, now);
assert.strictEqual(missingDob.error, 'Date of birth is required');

assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: 'Player' }, now).error,
  'Gender is required'
);

assert.strictEqual(parseDateOnly('2024-02-30'), null);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: 'Player', gender: 'female', dob: '2024-02-30' }, now).error,
  'Please enter a valid date of birth'
);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: 'Player', gender: 'female', dob: '2013-07-02' }, now).error,
  'You must be at least 13 years old'
);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: 'Player', gender: 'female', dob: '1925-06-30' }, now).error,
  'Please enter a valid date of birth'
);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'creator', displayName: 'Player' }, now).error,
  'User type must be either player or team'
);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: '' }, now).error,
  'Display name is required and must be less than 50 characters'
);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: 'Player', gender: 'unknown', dob: '2000-01-15' }, now).error,
  'Gender must be male, female, or other'
);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: 'Player', gender: 'other', dob: '2000-01-15', bio: 'x'.repeat(501) }, now).error,
  'Bio cannot exceed 500 characters'
);
assert.strictEqual(
  validateOnboardingProfile({
    userType: 'player',
    displayName: 'Legacy Choice',
    gender: 'prefer_not_to_say',
    dob: '2000-01-15'
  }, now).error,
  'Gender must be male, female, or other'
);
assert.strictEqual(
  validateOnboardingProfile({ userType: 'player', displayName: 'Future', gender: 'other', dob: '2027-01-01' }, now).error,
  'Please enter a valid date of birth'
);

console.log('Onboarding validation tests passed');
