// Authoritative monthly Recruitment usage/entitlement service.
//
// Backend is the single source of truth: it resolves the identity's subscription
// tier, computes the correct monthly limit from the canonical config, tracks
// usage in a race-safe monthly document, and exposes both a reservation API (used
// by the create/apply controllers) and a read API (used by the entitlements
// endpoint that Web + Mobile render from). Counting rule: a slot is consumed when
// a unique record is successfully created; it is NOT refunded on reject/withdraw/
// close/delete (usage reflects actions taken this month).

const RecruitmentMonthlyUsage = require('../models/RecruitmentMonthlyUsage');
const PlayerProfile = require('../models/PlayerProfile');
const RecruitmentApplication = require('../models/RecruitmentApplication');
const TeamRecruitment = require('../models/TeamRecruitment');
const { resolvePremiumEntitlement, resolveTeamPremiumEntitlement } = require('./entitlementService');
const {
  USAGE_TYPES,
  RECRUITMENT_LIMIT_ERROR_CODES,
  playerLimits,
  teamLimits
} = require('../config/recruitmentLimits');

// ── Calendar-month window (UTC) ─────────────────────────────────────────────
const monthWindow = (value = new Date()) => {
  const now = new Date(value);
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthKey = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return { monthKey, periodStart, resetAt };
};

// ── Seed counters: derive current-month usage from real records once ─────────
// Used only when the monthly usage document is first created, so switching to
// the monthly model does not zero out identities that already acted this month.
const seedPlayerCardCount = ({ owner, periodStart, resetAt }) =>
  PlayerProfile.countDocuments({ player: owner, createdAt: { $gte: periodStart, $lt: resetAt } });

const seedApplicationCount = ({ owner, periodStart, resetAt }) =>
  RecruitmentApplication.countDocuments({ applicant: owner, createdAt: { $gte: periodStart, $lt: resetAt } });

const seedTeamRecruitmentCount = ({ owner, periodStart, resetAt }) =>
  TeamRecruitment.countDocuments({ team: owner, createdAt: { $gte: periodStart, $lt: resetAt } });

const SEED_COUNTERS = {
  [USAGE_TYPES.PLAYER_CARD]: seedPlayerCardCount,
  [USAGE_TYPES.APPLICATION]: seedApplicationCount,
  [USAGE_TYPES.TEAM_RECRUITMENT]: seedTeamRecruitmentCount
};

// Ensure the (owner, usageType, monthKey) document exists, seeded from records.
const ensureUsageDoc = async ({ owner, usageType, now = new Date(), usageModel = RecruitmentMonthlyUsage, seedCounters = SEED_COUNTERS }) => {
  const window = monthWindow(now);
  let doc = await usageModel.findOne({ owner, usageType, monthKey: window.monthKey });
  if (doc) return { doc, ...window };

  const seededCount = await seedCounters[usageType]({ owner, periodStart: window.periodStart, resetAt: window.resetAt });
  try {
    doc = await usageModel.create({
      owner,
      usageType,
      monthKey: window.monthKey,
      count: Math.max(0, Number(seededCount) || 0),
      // Retain well past reset so late TTL cleanup can't race the active month.
      expiresAt: new Date(window.resetAt.getTime() + 32 * 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    doc = await usageModel.findOne({ owner, usageType, monthKey: window.monthKey });
    if (!doc) throw error;
  }
  return { doc, ...window };
};

// Atomically reserve one slot iff current usage is below `limit`. Returns the
// reservation (for rollback) or null when the monthly quota is exhausted.
// Concurrent callers cannot exceed `limit`: the guarded $inc is atomic in Mongo.
const reserveSlot = async ({ owner, usageType, limit, now = new Date(), usageModel = RecruitmentMonthlyUsage, seedCounters = SEED_COUNTERS }) => {
  const state = await ensureUsageDoc({ owner, usageType, now, usageModel, seedCounters });
  const doc = await usageModel.findOneAndUpdate(
    { _id: state.doc._id, count: { $lt: limit } },
    { $inc: { count: 1 } },
    { new: true }
  );
  if (!doc) return null;
  return { usageId: doc._id, count: doc.count, monthKey: state.monthKey, resetAt: state.resetAt };
};

const releaseSlot = async ({ usageId, usageModel = RecruitmentMonthlyUsage }) => {
  if (!usageId) return;
  await usageModel.updateOne({ _id: usageId, count: { $gt: 0 } }, { $inc: { count: -1 } });
};

const readUsage = async ({ owner, usageType, limit, now = new Date(), usageModel = RecruitmentMonthlyUsage, seedCounters = SEED_COUNTERS }) => {
  const state = await ensureUsageDoc({ owner, usageType, now, usageModel, seedCounters });
  const used = Math.max(0, Number(state.doc.count) || 0);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: state.resetAt
  };
};

// ── Tier resolution (reuses the canonical subscription service) ──────────────
const resolvePlayerTier = async ({ userId, now = new Date() }) => {
  const entitlement = await resolvePremiumEntitlement({ userId, now, requestSource: 'recruitment_usage' });
  return { tier: entitlement.isPremium ? 'premium' : 'free', visibilityBoostEligible: entitlement.isPremium === true };
};

const resolveTeamTier = async ({ teamId, now = new Date() }) => {
  const team = await resolveTeamPremiumEntitlement({ userId: teamId, now, requestSource: 'recruitment_usage' });
  return { tier: team.enabled ? 'premium' : 'free', visibilityBoostEligible: team.postVisibilityBoost === true };
};

// ── High-level entitlement composition (for the read endpoint + enforcement) ─
const getPlayerRecruitmentEntitlements = async ({ userId, now = new Date() }) => {
  const { tier, visibilityBoostEligible } = await resolvePlayerTier({ userId, now });
  const limits = playerLimits(tier);
  const [playerCards, applications] = await Promise.all([
    readUsage({ owner: userId, usageType: USAGE_TYPES.PLAYER_CARD, limit: limits.playerCardsPerMonth, now }),
    readUsage({ owner: userId, usageType: USAGE_TYPES.APPLICATION, limit: limits.applicationsPerMonth, now })
  ]);
  return {
    accountType: 'user',
    tier,
    period: 'monthly',
    playerCards: { used: playerCards.used, limit: playerCards.limit, remaining: playerCards.remaining },
    applications: { used: applications.used, limit: applications.limit, remaining: applications.remaining },
    visibilityBoost: visibilityBoostEligible,
    resetAt: playerCards.resetAt
  };
};

const getTeamRecruitmentEntitlements = async ({ teamId, now = new Date() }) => {
  const { tier, visibilityBoostEligible } = await resolveTeamTier({ teamId, now });
  const limits = teamLimits(tier);
  const recruitments = await readUsage({
    owner: teamId, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit: limits.recruitmentsPerMonth, now
  });
  return {
    accountType: 'team',
    tier,
    period: 'monthly',
    recruitments: { used: recruitments.used, limit: recruitments.limit, remaining: recruitments.remaining },
    visibilityBoost: visibilityBoostEligible,
    resetAt: recruitments.resetAt
  };
};

// ── Reservation helpers used by controllers (resolve tier + limit + reserve) ──
// Each returns { ok: true, reservation } on success, or { ok: false, error }
// where `error` is the structured payload to return to the client (HTTP 429).
const buildLimitError = ({ usageType, used, limit, resetAt, tier }) => ({
  code: RECRUITMENT_LIMIT_ERROR_CODES[usageType],
  used,
  limit,
  remaining: 0,
  resetAt,
  tier
});

const reservePlayerCard = async ({ userId, now = new Date() }) => {
  const { tier } = await resolvePlayerTier({ userId, now });
  const limit = playerLimits(tier).playerCardsPerMonth;
  const reservation = await reserveSlot({ owner: userId, usageType: USAGE_TYPES.PLAYER_CARD, limit, now });
  if (reservation) return { ok: true, reservation, tier, limit };
  const usage = await readUsage({ owner: userId, usageType: USAGE_TYPES.PLAYER_CARD, limit, now });
  return { ok: false, error: buildLimitError({ usageType: USAGE_TYPES.PLAYER_CARD, used: usage.used, limit, resetAt: usage.resetAt, tier }) };
};

const reserveApplication = async ({ userId, now = new Date() }) => {
  const { tier } = await resolvePlayerTier({ userId, now });
  const limit = playerLimits(tier).applicationsPerMonth;
  const reservation = await reserveSlot({ owner: userId, usageType: USAGE_TYPES.APPLICATION, limit, now });
  if (reservation) return { ok: true, reservation, tier, limit };
  const usage = await readUsage({ owner: userId, usageType: USAGE_TYPES.APPLICATION, limit, now });
  return { ok: false, error: buildLimitError({ usageType: USAGE_TYPES.APPLICATION, used: usage.used, limit, resetAt: usage.resetAt, tier }) };
};

const reserveTeamRecruitment = async ({ teamId, now = new Date() }) => {
  const { tier } = await resolveTeamTier({ teamId, now });
  const limit = teamLimits(tier).recruitmentsPerMonth;
  const reservation = await reserveSlot({ owner: teamId, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit, now });
  if (reservation) return { ok: true, reservation, tier, limit };
  const usage = await readUsage({ owner: teamId, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit, now });
  return { ok: false, error: buildLimitError({ usageType: USAGE_TYPES.TEAM_RECRUITMENT, used: usage.used, limit, resetAt: usage.resetAt, tier }) };
};

module.exports = {
  monthWindow,
  ensureUsageDoc,
  reserveSlot,
  releaseSlot,
  readUsage,
  resolvePlayerTier,
  resolveTeamTier,
  getPlayerRecruitmentEntitlements,
  getTeamRecruitmentEntitlements,
  reservePlayerCard,
  reserveApplication,
  reserveTeamRecruitment
};
