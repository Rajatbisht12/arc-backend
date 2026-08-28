const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PLAYER_PLANS,
  TEAM_PLANS
} = require('./membershipController');
const {
  buildPlayerPremiumEntitlement,
  buildTeamPremiumEntitlement
} = require('../services/entitlementService');

const EXPECTED_TEAM_PRO_FEATURES = [
  'Premium Badge',
  'Extended Recruitment Posting Limits — 30/month',
  'More Visibility Across All Posts & Recruitment Listings',
  'Priority Notifications for Squad Tournaments',
  'Enhanced Team Profile Visibility'
];
const EXPECTED_TEAM_DETAIL_HEADINGS = [
  'Premium Badge',
  'Extended Recruitment Posting Limits',
  'More Visibility Across All Posts & Recruitment Listings',
  'Priority Notifications for Squad Tournaments',
  'Enhanced Team Profile Visibility'
];
const EXPECTED_TEAM_DETAIL_COPY = [
  'Display the Premium badge on your team profile and across relevant areas where Premium badges are supported.',
  'Create up to 30 recruitment posts per month, including roster and staff recruitment openings. Free teams can create up to 7 recruitment posts per month.',
  "Get higher visibility for your team's normal, achievement, and recruitment posts, helping your team reach more players and get discovered faster.",
  'Receive priority notifications for relevant squad tournaments, helping your team discover and respond to tournament opportunities sooner.',
  'Your team profile gets increased visibility across relevant discovery and search surfaces, making it easier for players to find and connect with your team.'
];
const EXPECTED_PLAYER_PRO_FEATURES = [
  'Pro Badge on Profile',
  'Eligible for Creator Monetization',
  'Random Connect — Unlimited Call Duration',
  'Gender Filter — Unlimited Daily Uses',
  'Extended Player Card Limits — 10/month',
  'Extended Recruitment Applications — 20/month',
  'Get Discovered — More Visibility'
];
const EXPECTED_PLAYER_DETAIL_HEADINGS = [
  'Pro Badge on Profile',
  'Eligible for Creator Monetization',
  'Random Connect',
  'Gender Filter',
  'Extended Player Card Limits',
  'Extended Recruitment Applications',
  'Get Discovered — More Visibility'
];
const EXPECTED_PLAYER_DETAIL_COPY = [
  'Display the Pro badge on your profile and in relevant discovery and search areas.',
  'Eligible to apply for Creator Monetization with an active Pro plan, subject to applicable eligibility requirements.',
  'Pro users get unlimited call duration for each session, compared to 3 minutes per session for free users.',
  'Use the gender filter with unlimited daily access. Free users can use the gender filter up to 5 times per day.',
  'Post up to 10 player cards per month, compared to 2 player cards per month for free users.',
  'Apply to up to 20 recruitment posts per month, including staff recruitment posts. Free users can apply to up to 5 recruitment posts per month.',
  'Your profile, posts, and player cards receive higher visibility across relevant discovery and search surfaces, helping more users and teams discover you.'
];

const teamPro = TEAM_PLANS.find((plan) => plan.id === 'team_pro');
assert(teamPro, 'Team Pro must remain in the shared membership catalog');
assert.deepStrictEqual(teamPro.features, EXPECTED_TEAM_PRO_FEATURES);
assert.deepStrictEqual(
  teamPro.exploreDetails.map((detail) => detail.heading),
  EXPECTED_TEAM_DETAIL_HEADINGS,
  'main and included-details Team Pro benefits must stay in parity'
);
assert.deepStrictEqual(teamPro.exploreDetails.map((detail) => detail.text), EXPECTED_TEAM_DETAIL_COPY);
assert.equal(teamPro.priceMonthly, 249);
assert.equal(teamPro.priceQuarterly, 699);
assert.equal(teamPro.priceYearly, 2490);

const visibility = teamPro.exploreDetails.find(
  (detail) => detail.heading === 'More Visibility Across All Posts & Recruitment Listings'
);
for (const postType of ['recruitment', 'achievement', 'normal']) {
  assert.match(visibility.text, new RegExp(postType, 'i'));
}

const serializedTeamPro = JSON.stringify(teamPro);
for (const staleCopy of [
  'Recruitment support',
  'Management assistance',
  'Financial modeling assistance',
  'Better visibility for recruitment posts',
  'Early Access to Exclusive Features',
  'Unlimited Tournament Hosting'
]) {
  assert.equal(serializedTeamPro.includes(staleCopy), false, `stale Team Pro copy remains: ${staleCopy}`);
}

const teamEntitlement = buildTeamPremiumEntitlement({
  accountType: 'team',
  isPremium: true,
  plan: 'team_pro'
});
assert.deepStrictEqual(teamEntitlement, {
  version: 2,
  enabled: true,
  plan: 'team_pro',
  premiumBadge: true,
  extendedRecruitmentPostingLimits: true,
  recruitmentPostsPerMonth: 30,
  postVisibilityBoost: true,
  recruitmentVisibilityBoost: true,
  prioritySquadTournamentNotifications: true,
  enhancedTeamProfileVisibility: true
});
assert.equal(buildTeamPremiumEntitlement({
  accountType: 'player',
  isPremium: true,
  plan: 'player_pro'
}).enabled, false, 'Player Premium must not receive Team Premium capabilities');
assert.equal(buildTeamPremiumEntitlement({
  accountType: 'team',
  isPremium: false,
  plan: 'free'
}).enabled, false, 'Free Team accounts must not receive Team Premium capabilities');

const playerPro = PLAYER_PLANS.find((plan) => plan.id === 'player_pro');
assert(playerPro, 'Player Pro must remain in the shared membership catalog');
assert.deepStrictEqual(playerPro.features, EXPECTED_PLAYER_PRO_FEATURES);
assert.deepStrictEqual(playerPro.exploreDetails.map((detail) => detail.heading), EXPECTED_PLAYER_DETAIL_HEADINGS);
assert.deepStrictEqual(playerPro.exploreDetails.map((detail) => detail.text), EXPECTED_PLAYER_DETAIL_COPY);
assert.deepStrictEqual(
  [playerPro.priceMonthly, playerPro.priceQuarterly, playerPro.priceYearly],
  [99, 249, 990],
  'Player Pro pricing must remain unchanged'
);
const playerEntitlement = buildPlayerPremiumEntitlement({
  accountType: 'player',
  isPremium: true,
  plan: 'player_pro'
});
assert.deepStrictEqual(playerEntitlement, {
  version: 1,
  enabled: true,
  plan: 'player_pro',
  proBadge: true,
  creatorMonetizationPrerequisite: true,
  randomConnectSessionDurationSeconds: null,
  unlimitedRandomConnectSessionDuration: true,
  genderFilterUsesPerDay: null,
  unlimitedGenderFilter: true,
  playerCardsPerMonth: 10,
  recruitmentApplicationsPerMonth: 20,
  profileVisibilityBoost: true,
  postVisibilityBoost: true,
  playerCardVisibilityBoost: true
});
assert.deepStrictEqual(buildPlayerPremiumEntitlement({ accountType: 'player', isPremium: false, plan: 'free' }), {
  version: 1,
  enabled: false,
  plan: 'free',
  proBadge: false,
  creatorMonetizationPrerequisite: false,
  randomConnectSessionDurationSeconds: 180,
  unlimitedRandomConnectSessionDuration: false,
  genderFilterUsesPerDay: 5,
  unlimitedGenderFilter: false,
  playerCardsPerMonth: 2,
  recruitmentApplicationsPerMonth: 5,
  profileVisibilityBoost: false,
  postVisibilityBoost: false,
  playerCardVisibilityBoost: false
});

assert.deepStrictEqual(PLAYER_PLANS.map((plan) => [plan.id, plan.priceMonthly, plan.priceQuarterly, plan.priceYearly]), [
  ['free', 0, null, null],
  ['player_pro', 99, 249, 990],
  ['player_pro_plus', 199, 499, 1990]
], 'Player plan pricing must remain unchanged');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const webPremium = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'pages', 'Premium.tsx'), 'utf8');
const mobilePremium = fs.readFileSync(path.join(repoRoot, 'mobile-ui', 'arc-mobile', 'app', 'premium.tsx'), 'utf8');
for (const [platform, source] of [['Web', webPremium], ['Mobile', mobilePremium]]) {
  assert(source.includes("isTeam ? membership?.plans?.team : membership?.plans?.player"), `${platform} must select plans by account type`);
  assert(source.includes('plan.features.map'), `${platform} main benefits must consume the shared feature list`);
  assert(source.includes('explorePlan.exploreDetails'), `${platform} included-details UI must consume the shared details`);
  assert.equal(source.includes('Financial modeling assistance'), false, `${platform} must not hardcode stale Team copy`);
  assert(source.includes('Squadhunt'), `${platform} must display Squadhunt Premium branding`);
  assert.equal(source.includes("ARC{' '}"), false, `${platform} must not retain responsive ARC Premium branding`);
}

const webSettings = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'pages', 'Settings.tsx'), 'utf8');
const webNavbar = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'components', 'Navbar.tsx'), 'utf8');
const mobileSettings = fs.readFileSync(path.join(repoRoot, 'mobile-ui', 'arc-mobile', 'app', 'settings.tsx'), 'utf8');
const mobileLayout = fs.readFileSync(path.join(repoRoot, 'mobile-ui', 'arc-mobile', 'app', '_layout.tsx'), 'utf8');
assert(webSettings.includes('label="Squadhunt Premium"'));
assert(webNavbar.includes('>Squadhunt Premium</span>'));
assert(mobileSettings.includes("label: 'Squadhunt Premium'"));
assert(mobileLayout.includes("title: 'Squadhunt Premium'"));

const ownMobileProfile = fs.readFileSync(path.join(repoRoot, 'mobile-ui', 'arc-mobile', 'app', '(tabs)', 'profile.tsx'), 'utf8');
const publicMobileProfile = fs.readFileSync(path.join(repoRoot, 'mobile-ui', 'arc-mobile', 'app', 'user', '[username].tsx'), 'utf8');
const webProfile = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'pages', 'Profile.tsx'), 'utf8');
const webTeamProfile = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'pages', 'TeamProfile.tsx'), 'utf8');
for (const source of [ownMobileProfile, publicMobileProfile]) {
  assert(source.includes("isTeamProfile ? 'Premium' : 'Pro'"));
}
assert(webProfile.includes("isTeam ? 'Premium' : 'Pro'"));
assert(webTeamProfile.includes('team?.isPremium'));
assert(webTeamProfile.includes('Premium'));

const tournamentController = fs.readFileSync(path.join(__dirname, 'tournamentController.js'), 'utf8');
assert(tournamentController.includes('createLock = hostPermissions.hasUnlimitedTournamentHosting'));
assert(tournamentController.includes('if (!hostPermissions.hasUnlimitedTournamentHosting)'));
assert(tournamentController.includes("normalizedPrizePoolType === 'with_prize' && hostPermissions.isVerifiedHost !== true"));
assert(tournamentController.includes("period: hasUnlimitedTournamentHosting ? 'unlimited' : 'active_tournament'"));
assert.equal(tournamentController.includes('Upgrade to Team Premium or get Verified Host'), false);

console.log('Team Premium catalog, parity, isolation, and tournament entitlement tests passed');
