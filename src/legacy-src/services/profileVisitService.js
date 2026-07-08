const mongoose = require('mongoose');
const ProfileVisitDaily = require('../models/ProfileVisitDaily');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = Number(ProfileVisitDaily.PROFILE_VISIT_RETENTION_DAYS) || 400;

const utcDayStart = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const recordSuccessfulProfileVisit = async ({ viewerId, profileOwnerId, now = new Date() } = {}) => {
  if (!mongoose.isValidObjectId(viewerId) || !mongoose.isValidObjectId(profileOwnerId)) {
    return { recorded: false, reason: 'invalid_identity' };
  }
  if (String(viewerId) === String(profileOwnerId)) {
    return { recorded: false, reason: 'self_view' };
  }
  const day = utcDayStart(now);
  if (!day) return { recorded: false, reason: 'invalid_time' };
  const expiresAt = new Date(day.getTime() + (RETENTION_DAYS * DAY_MS));
  try {
    const result = await ProfileVisitDaily.updateOne(
      { profileOwner: profileOwnerId, viewer: viewerId, day },
      { $setOnInsert: { expiresAt } },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
    return {
      recorded: Boolean(result?.upsertedCount || result?.upsertedId),
      deduped: !result?.upsertedCount && !result?.upsertedId,
      day
    };
  } catch (error) {
    // Concurrent first visits can race on the unique daily identity. The
    // winner already recorded the visit, so the loser is a successful dedupe.
    if (error?.code === 11000) return { recorded: false, deduped: true, day };
    throw error;
  }
};

module.exports = {
  RETENTION_DAYS,
  recordSuccessfulProfileVisit,
  utcDayStart
};
