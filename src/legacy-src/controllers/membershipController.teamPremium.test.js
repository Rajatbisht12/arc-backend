const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PLAYER_PLANS,
  TEAM_PLANS
} = require('./membershipController');
const {
  buildTeamPremiumEntitlement
} = require('../services/entitlementService');

const EXPECTED_TEAM_PRO_FEATURES = [
  'Premium Badge',
  'Extended Recruitment Posting Limits',
  'More Visibility Across All Post Types',
  'Early Access to Exclusive Features',
  'Unlimited Tournament Hosting'
];

const teamPro = TEAM_PLANS.find((plan) => plan.id === 'team_pro');
assert(teamPro, 'Team Pro must remain in the shared membership catalog');
assert.deepStrictEqual(teamPro.features, EXPECTED_TEAM_PRO_FEATURES);
assert.deepStrictEqual(
  teamPro.exploreDetails.map((detail) => detail.heading),
  EXPECTED_TEAM_PRO_FEATURES,
  'main and included-details Team Pro benefits must stay in parity'
);
assert.equal(teamPro.priceMonthly, 249);
assert.equal(teamPro.priceQuarterly, 699);
assert.equal(teamPro.priceYearly, 2490);

const visibility = teamPro.exploreDetails.find(
  (detail) => detail.heading === 'More Visibility Across All Post Types'
);
for (const postType of ['recruitment', 'achievement', 'normal']) {
  assert.match(visibility.text, new RegExp(postType, 'i'));
}

const serializedTeamPro = JSON.stringify(teamPro);
for (const staleCopy of [
  'Recruitment support',
  'Management assistance',
  'Financial modeling assistance',
  'Better visibility for recruitment posts'
]) {
  assert.equal(serializedTeamPro.includes(staleCopy), false, `stale Team Pro copy remains: ${staleCopy}`);
}

const teamEntitlement = buildTeamPremiumEntitlement({
  accountType: 'team',
  isPremium: true,
  plan: 'team_pro'
});
assert.deepStrictEqual(teamEntitlement, {
  version: 1,
  enabled: true,
  plan: 'team_pro',
  premiumBadge: true,
  extendedRecruitmentPostingLimits: true,
  postVisibilityBoost: true,
  earlyAccess: true,
  unlimitedTournamentHosting: true
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

const playerPlanSnapshot = PLAYER_PLANS.map((plan) => ({
  id: plan.id,
  prices: [plan.priceMonthly, plan.priceQuarterly, plan.priceYearly],
  features: [...plan.features]
}));
assert.deepStrictEqual(playerPlanSnapshot, [
  {
    id: 'free',
    prices: [0, null, null],
    features: [
      'AI Coach – 15 messages/day',
      'Random Connect – 5–6 connections/day',
      'Normal visibility in suggestions',
      'Full access to posts, tournaments, messages'
    ]
  },
  {
    id: 'player_pro',
    prices: [99, 249, 990],
    features: [
      'Unlimited Random Connect + gender filter',
      'Get discovered – more visibility',
      'Pro badge on profile',
      'Eligible for Creator monetization',
      'Higher player card visibility'
    ]
  },
  {
    id: 'player_pro_plus',
    prices: [199, 499, 1990],
    features: [
      'Everything in Pro',
      '20 credits/month to boost posts (vs 8/month in Pro)',
      'Advanced analytics & insights',
      'Priority support',
      'Early access to new features',
      'Featured in discover (top slots)',
      'Pro+ badge & exclusive profile themes'
    ]
  }
], 'Player plan pricing and benefits must remain unchanged');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const webPremium = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'pages', 'Premium.tsx'), 'utf8');
const mobilePremium = fs.readFileSync(path.join(repoRoot, 'mobile-ui', 'arc-mobile', 'app', 'premium.tsx'), 'utf8');
for (const [platform, source] of [['Web', webPremium], ['Mobile', mobilePremium]]) {
  assert(source.includes("isTeam ? membership?.plans?.team : membership?.plans?.player"), `${platform} must select plans by account type`);
  assert(source.includes('plan.features.map'), `${platform} main benefits must consume the shared feature list`);
  assert(source.includes('explorePlan.exploreDetails'), `${platform} included-details UI must consume the shared details`);
  assert.equal(source.includes('Financial modeling assistance'), false, `${platform} must not hardcode stale Team copy`);
}

const webTournament = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'components', 'CreateTournamentModal.tsx'), 'utf8');
const mobileTournament = fs.readFileSync(path.join(repoRoot, 'mobile-ui', 'arc-mobile', 'app', 'create-tournament.tsx'), 'utf8');
for (const [platform, source] of [['Web', webTournament], ['Mobile', mobileTournament]]) {
  assert(source.includes('isPremiumTeam'), `${platform} must recognize Team Premium hosting status`);
  assert(source.includes('unlimited'), `${platform} must distinguish unlimited from the standard active limit`);
  assert(/Prize(?:-pool| pools?) .*require Verified Host/i.test(source), `${platform} must preserve Verified Host prize authorization copy`);
}

const tournamentController = fs.readFileSync(path.join(__dirname, 'tournamentController.js'), 'utf8');
assert(tournamentController.includes('resolveTeamPremiumEntitlement'));
assert(tournamentController.includes('createLock = hostPermissions.hasUnlimitedTournamentHosting'));
assert(tournamentController.includes('if (!hostPermissions.hasUnlimitedTournamentHosting)'));
assert(tournamentController.includes("normalizedPrizePoolType === 'with_prize' && hostPermissions.isVerifiedHost !== true"));
assert(tournamentController.includes("period: hasUnlimitedTournamentHosting ? 'unlimited' : 'active_tournament'"));

console.log('Team Premium catalog, parity, isolation, and tournament entitlement tests passed');
