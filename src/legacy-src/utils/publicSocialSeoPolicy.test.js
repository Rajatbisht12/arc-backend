const assert = require('node:assert/strict');
const test = require('node:test');
const {
  publicShareCode, publicSocialImageUrl, isLiveRecruitmentSeoEligible, isPublicCompetitionSeoEligible
} = require('./publicSocialSeoPolicy');

const owner = () => ({
  username: 'PublicTeam', userType: 'team', isActive: true, moderationStatus: 'active',
  privacySettings: { profileVisibility: 'public' }
});

test('only active, unexpired public-owner listings qualify for social SEO', () => {
  const listing = { isActive: true, status: 'active', expiresAt: new Date('2030-01-01') };
  assert.equal(isLiveRecruitmentSeoEligible(listing, owner(), new Date('2026-10-15')), true);
  assert.equal(isLiveRecruitmentSeoEligible({ ...listing, status: 'paused' }, owner()), false);
  assert.equal(isLiveRecruitmentSeoEligible({ ...listing, expiresAt: new Date('2020-01-01') }, owner()), false);
  assert.equal(isLiveRecruitmentSeoEligible(listing, { ...owner(), privacySettings: { profileVisibility: 'private' } }), false);
  assert.equal(isLiveRecruitmentSeoEligible(listing, { ...owner(), moderationStatus: 'suspended' }), false);
});

test('cancelled competitions and private or banned hosts are not indexable', () => {
  assert.equal(isPublicCompetitionSeoEligible({ status: 'Ongoing' }, owner(), ['Upcoming', 'Ongoing']), true);
  assert.equal(isPublicCompetitionSeoEligible({ status: 'Cancelled' }, owner(), ['Upcoming', 'Ongoing']), false);
  assert.equal(isPublicCompetitionSeoEligible({ status: 'Ongoing' }, { ...owner(), isActive: false }, ['Ongoing']), false);
});

test('social preview images exclude signed, private, and non-image URLs', () => {
  assert.equal(publicShareCode('trn-bgmi-123'), 'TRN-BGMI-123');
  assert.equal(publicSocialImageUrl('https://media.squadhunt.com/gaming-social/tournaments/a.webp'),
    'https://media.squadhunt.com/gaming-social/tournaments/a.webp');
  for (const value of [
    'https://media.squadhunt.com/gaming-social/tournaments/a.webp?signature=x',
    'https://s3.amazonaws.com/private/a.jpg',
    'https://media.squadhunt.com/gaming-social/tournaments/a.mp4',
  ]) assert.equal(publicSocialImageUrl(value), '');
});
