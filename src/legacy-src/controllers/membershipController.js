/**
 * Membership: current user's tier, validUntil, credits.
 * Plans catalog: Player (Free, Pro, Pro+) and Team (Free, Pro, Org) with pricing and features.
 */
const User = require('../models/User');
const log = require('../utils/logger');
const { sendInternalError } = require('../utils/internalErrorResponse');

// Plans catalog: credits + exploreDetails for each plan
const PLAYER_PLANS = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceQuarterly: null,
    priceYearly: null,
    creditsPerMonth: 0,
    description: 'Get started with basic limits.',
    features: [
      'AI Coach – 15 messages/day',
      'Random Connect — 3-minute call duration',
      'Gender Filter — 5 uses/day',
      '2 player cards/month',
      '5 recruitment applications/month',
      'Normal visibility in suggestions',
      'Full access to posts, tournaments, messages'
    ],
    cta: 'Current plan',
    highlighted: false,
    exploreDetails: [
      { heading: 'Random Connect', text: 'Random Connect sessions last up to 3 minutes for free users.' },
      { heading: 'Gender Filter', text: 'Use the gender filter up to 5 times per day.' },
      { heading: 'Player Cards', text: 'Post up to 2 player cards per month.' },
      { heading: 'Recruitment Applications', text: 'Apply to up to 5 recruitment posts per month, including staff recruitment posts.' },
      { heading: 'Visibility', text: 'Your profile and player card appear in suggestions and discover like everyone else—no boost. Full access to post, join tournaments and use messages.' },
      { heading: 'Credits', text: 'No boost credits on Free. You can still create and join everything; only paid plans get credits to boost posts for more reach.' }
    ]
  },
  {
    id: 'player_pro',
    name: 'Pro',
    priceMonthly: 99,
    priceQuarterly: 249,
    priceYearly: 990,
    creditsPerMonth: 0,
    creditsPerWeek: 0,
    description: 'Most popular for serious players.',
    features: [
      'Pro Badge on Profile',
      'Eligible for Creator Monetization',
      'Random Connect — Unlimited Call Duration',
      'Gender Filter — Unlimited Daily Uses',
      'Extended Player Card Limits — 10/month',
      'Extended Recruitment Applications — 20/month',
      'Get Discovered — More Visibility'
    ],
    cta: 'Upgrade to Pro',
    highlighted: true,
    exploreDetails: [
      { heading: 'Pro Badge on Profile', text: 'Display the Pro badge on your profile and in relevant discovery and search areas.' },
      { heading: 'Eligible for Creator Monetization', text: 'Eligible to apply for Creator Monetization with an active Pro plan, subject to applicable eligibility requirements.' },
      { heading: 'Random Connect', text: 'Pro users get unlimited call duration for each session, compared to 3 minutes per session for free users.' },
      { heading: 'Gender Filter', text: 'Use the gender filter with unlimited daily access. Free users can use the gender filter up to 5 times per day.' },
      { heading: 'Extended Player Card Limits', text: 'Post up to 10 player cards per month, compared to 2 player cards per month for free users.' },
      { heading: 'Extended Recruitment Applications', text: 'Apply to up to 20 recruitment posts per month, including staff recruitment posts. Free users can apply to up to 5 recruitment posts per month.' },
      { heading: 'Get Discovered — More Visibility', text: 'Your profile, posts, and player cards receive higher visibility across relevant discovery and search surfaces, helping more users and teams discover you.' }
    ]
  },
  {
    id: 'player_pro_plus',
    name: 'Pro+',
    priceMonthly: 199,
    priceQuarterly: 499,
    priceYearly: 1990,
    creditsPerMonth: 20,
    creditsPerWeek: 0,
    description: 'Maximum value with monthly credits and exclusive features.',
    features: [
      'Everything in Pro',
      '20 credits/month to boost posts (vs 8/month in Pro)',
      'Advanced analytics & insights',
      'Priority support',
      'Early access to new features',
      'Featured in discover (top slots)',
      'Pro+ badge & exclusive profile themes'
    ],
    cta: 'Upgrade to Pro+',
    highlighted: false,
    exploreDetails: [
      { heading: 'Credits – best value', text: '5 credits every week. 1 credit = 1 post boost (same as ₹100 value per boost). So for ₹199/month you get 5 boosts per week. Unused credits don’t roll over to the next week.' },
      { heading: 'Everything in Pro', text: 'All Pro benefits included: Pro Badge on Profile, eligibility to apply for Creator Monetization subject to all requirements, unlimited Random Connect call duration, unlimited daily Gender Filter use, 10 player cards per month, 20 recruitment applications per month, and increased visibility.' },
      { heading: 'Priority support', text: 'Your tickets and help requests are handled before Free and Pro users so you get faster resolution. Direct line to support team.' },
      { heading: 'Early access', text: 'Get access to new features (e.g. new AI tools, advanced discovery options, new monetization features) before they roll out to other plans.' },
      { heading: 'Featured in discover', text: 'Your profile appears in top slots of discover and suggestions 3x more often than Pro users. Maximum visibility for serious creators.' },
      { heading: 'Advanced analytics', text: 'See detailed insights: player card views, connection stats, profile engagement trends, and post performance analytics. Understand what works so you can grow faster.' },
      { heading: 'Pro+ badge & themes', text: 'Exclusive Pro+ badge on your profile and access to premium profile themes to make your profile stand out.' }
    ]
  }
];

const TEAM_PLANS = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceQuarterly: null,
    priceYearly: null,
    creditsPerMonth: 0,
    description: 'Run your team with core features.',
    features: [
      '7 recruitment posts/month',
      'Standard tournament hosting limits',
      'Full roster & staff management',
      'Basic visibility'
    ],
    cta: 'Current plan',
    highlighted: false,
    exploreDetails: [
      { heading: 'Recruitment', text: 'Create up to 7 recruitment posts per month across roster and staff openings.' },
      { heading: 'Tournaments & scrims', text: 'Standard tournament and scrim hosting limits apply.' },
      { heading: 'Roster & staff', text: 'Add and manage full rosters per game and staff (coach, manager, etc.). All core management features are included.' },
      { heading: 'Visibility', text: 'Your team profile and recruitment posts get normal visibility. No boost credits on Free.' },
      { heading: 'Credits', text: 'No boost credits on Free. Paid plans get monthly credits to boost normal posts and recruitment posts for more reach.' }
    ]
  },
  {
    id: 'team_pro',
    name: 'Pro',
    priceMonthly: 249,
    priceQuarterly: 699,
    priceYearly: 2490,
    creditsPerMonth: 0,
    description: 'For growing teams.',
    features: [
      'Premium Badge',
      'Extended Recruitment Posting Limits — 30/month',
      'More Visibility Across All Posts & Recruitment Listings',
      'Priority Notifications for Squad Tournaments',
      'Enhanced Team Profile Visibility'
    ],
    cta: 'Upgrade to Pro',
    highlighted: true,
    exploreDetails: [
      { heading: 'Premium Badge', text: 'Display the Premium badge on your team profile and across relevant areas where Premium badges are supported.' },
      { heading: 'Extended Recruitment Posting Limits', text: 'Create up to 30 recruitment posts per month, including roster and staff recruitment openings. Free teams can create up to 7 recruitment posts per month.' },
      { heading: 'More Visibility Across All Posts & Recruitment Listings', text: "Get higher visibility for your team's normal, achievement, and recruitment posts, helping your team reach more players and get discovered faster." },
      { heading: 'Priority Notifications for Squad Tournaments', text: 'Receive priority notifications for relevant squad tournaments, helping your team discover and respond to tournament opportunities sooner.' },
      { heading: 'Enhanced Team Profile Visibility', text: 'Your team profile gets increased visibility across relevant discovery and search surfaces, making it easier for players to find and connect with your team.' }
    ]
  },
  {
    id: 'team_org',
    name: 'Org',
    priceMonthly: 499,
    priceQuarterly: 1299,
    priceYearly: 4990,
    creditsPerMonth: 0,
    description: 'For orgs and academies.',
    features: [
      'Everything in Pro',
      'Custom branding & verified badge',
      'Priority support',
      'Advanced analytics & export',
      'Featured in discover (top slots)'
    ],
    cta: 'Upgrade to Org',
    highlighted: false,
    exploreDetails: [
      { heading: 'Credits – best value', text: '60 credits every month. 1 credit = 1 post boost (₹100 value each). So for ₹499 you get 60 boosts—₹6000 value. Ideal for orgs that post and recruit frequently.' },
      { heading: 'Everything in Pro', text: 'All Pro benefits: Premium Badge, 30 recruitment posts per month, higher visibility across posts and recruitment listings, priority notifications for relevant squad tournaments, and enhanced team profile visibility.' },
      { heading: 'Custom branding & verified badge', text: 'Org badge and verified status on your team profile. Optional custom branding so your org stands out.' },
      { heading: 'Priority support', text: 'Your support requests are prioritised so you get faster help for billing, features and issues.' },
      { heading: 'Advanced analytics & export', text: 'Deeper analytics and ability to export data (e.g. recruitment reports, tournament stats) for internal use or sponsors.' }
    ]
  }
];

/**
 * GET /api/membership/plans
 * Returns all plans (player + team) with pricing and features. No auth required for listing.
 */
async function getPlans(req, res) {
  try {
    res.status(200).json({
      success: true,
      data: {
        player: PLAYER_PLANS,
        team: TEAM_PLANS
      }
    });
  } catch (err) {
    return sendInternalError({
      res,
      log,
      operation: 'Membership plan catalog lookup failed',
      publicMessage: 'Failed to get plans',
      error: err
    });
  }
}

/**
 * GET /api/membership
 * Returns current user's membership info: tier, validUntil, credits + plans for display.
 */
async function getMembership(req, res) {
  try {
    const user = await User.findById(req.user._id)
      .select('userType membership isPremium')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const projectedMembership = user.membership || {
      tier: 'free',
      validUntil: null,
      credits: 0
    };
    const premiumService = require('../services/premiumMembershipService');
    const {
      resolvePremiumEntitlement,
      buildPlayerPremiumEntitlement,
      buildTeamPremiumEntitlement
    } = require('../services/entitlementService');
    const canonical = await premiumService.currentForUser(req.user._id).lean();
    const premiumEntitlement = await resolvePremiumEntitlement({
      userId: req.user._id,
      requestSource: 'membership_api'
    });

    // PremiumMembership is authoritative once present. The User membership
    // fields are retained only as a compatibility projection for accounts that
    // have not yet been backfilled.
    const isActivePro = premiumEntitlement.isPremium;
    const tier = premiumEntitlement.plan;
    const validUntil = premiumEntitlement.validUntil;
    const credits = isActivePro ? Math.max(0, Number(projectedMembership.credits) || 0) : 0;
    const isExpired = Boolean(validUntil && new Date(validUntil) <= new Date());
    const currentPlanId = tier;
    const plans = user.userType === 'team' ? TEAM_PLANS : PLAYER_PLANS;
    const benefits = (plans.find(p => p.id === currentPlanId) || plans[0]).features;

    res.set('Cache-Control', 'private, no-store');

    res.status(200).json({
      success: true,
      data: {
        tier,
        validUntil,
        credits,
        isPremium: isActivePro,
        isActivePro,
        isExpired,
        userType: user.userType,
        currentPlanId,
        benefits,
        membershipId: canonical?._id || null,
        source: premiumEntitlement.source,
        billingPeriod: premiumEntitlement.subscriptionType === 'legacy' ? null : premiumEntitlement.subscriptionType,
        membershipStatus: premiumEntitlement.membershipStatus,
        subscriptionStatus: premiumEntitlement.subscriptionStatus,
        autoRenew: canonical?.autoRenew === true,
        cancelAtCycleEnd: canonical?.cancelAtCycleEnd === true,
        currentPeriodStart: canonical?.currentPeriodStart || null,
        currentPeriodEnd: canonical?.currentPeriodEnd || validUntil,
        providerSubscriptionId: canonical?.razorpay?.subscriptionId || null,
        providerControlsAvailable: Boolean(canonical?.razorpay?.subscriptionId),
        entitlements: {
          playerPremium: buildPlayerPremiumEntitlement(premiumEntitlement),
          teamPremium: buildTeamPremiumEntitlement(premiumEntitlement)
        },
        plans: {
          player: PLAYER_PLANS,
          team: TEAM_PLANS
        }
      }
    });
  } catch (err) {
    return sendInternalError({
      res,
      log,
      operation: 'Membership lookup failed',
      publicMessage: 'Failed to get membership',
      error: err
    });
  }
}

module.exports = {
  getMembership,
  getPlans,
  PLAYER_PLANS,
  TEAM_PLANS
};
