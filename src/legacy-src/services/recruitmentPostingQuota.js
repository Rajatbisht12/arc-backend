const RecruitmentPostingQuota = require('../models/RecruitmentPostingQuota');
const PlayerProfile = require('../models/PlayerProfile');

const PLAYER_CARD_DAILY_LIMIT = 2;

const utcDayWindow = (value = new Date()) => {
  const now = new Date(value);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const resetsAt = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    dayKey: start.toISOString().slice(0, 10),
    start,
    resetsAt
  };
};

const ensureDailyQuota = async ({
  playerId,
  now = new Date(),
  quotaModel = RecruitmentPostingQuota,
  profileModel = PlayerProfile
}) => {
  const window = utcDayWindow(now);
  let quota = await quotaModel.findOne({ player: playerId, dayKey: window.dayKey });
  if (quota) return { quota, ...window };

  const existingCount = Math.min(
    PLAYER_CARD_DAILY_LIMIT,
    await profileModel.countDocuments({
      player: playerId,
      createdAt: { $gte: window.start, $lt: window.resetsAt }
    })
  );

  try {
    quota = await quotaModel.create({
      player: playerId,
      dayKey: window.dayKey,
      count: existingCount,
      // Keep the row briefly after the reset so delayed TTL cleanup cannot race
      // a request for the new UTC day. dayKey remains the uniqueness boundary.
      expiresAt: new Date(window.resetsAt.getTime() + 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    quota = await quotaModel.findOne({ player: playerId, dayKey: window.dayKey });
    if (!quota) throw error;
  }
  return { quota, ...window };
};

const getPlayerCardDailyLimit = async (options) => {
  const state = await ensureDailyQuota(options);
  return {
    used: Math.max(0, Math.min(PLAYER_CARD_DAILY_LIMIT, Number(state.quota.count) || 0)),
    limit: PLAYER_CARD_DAILY_LIMIT,
    resetsAt: state.resetsAt,
    dayKey: state.dayKey
  };
};

const reservePlayerCardSlot = async ({
  playerId,
  now = new Date(),
  quotaModel = RecruitmentPostingQuota,
  profileModel = PlayerProfile
}) => {
  const state = await ensureDailyQuota({ playerId, now, quotaModel, profileModel });
  const quota = await quotaModel.findOneAndUpdate(
    {
      _id: state.quota._id,
      count: { $lt: PLAYER_CARD_DAILY_LIMIT }
    },
    { $inc: { count: 1 } },
    { new: true }
  );
  if (!quota) return null;
  return { quota, dayKey: state.dayKey, resetsAt: state.resetsAt };
};

const releasePlayerCardSlot = async ({ quotaId, quotaModel = RecruitmentPostingQuota }) => {
  if (!quotaId) return;
  await quotaModel.updateOne(
    { _id: quotaId, count: { $gt: 0 } },
    { $inc: { count: -1 } }
  );
};

module.exports = {
  PLAYER_CARD_DAILY_LIMIT,
  utcDayWindow,
  ensureDailyQuota,
  getPlayerCardDailyLimit,
  reservePlayerCardSlot,
  releasePlayerCardSlot
};
