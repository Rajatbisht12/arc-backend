const mongoose = require('mongoose');
const { USAGE_TYPES } = require('../config/recruitmentLimits');

// One document per (identity, usageType, calendar month). `count` is the
// authoritative monthly usage: it is seeded once from the identity's actual
// current-month records (so switching to the monthly model does not zero out
// people who already posted/applied this month) and then advanced only via
// atomic $inc during slot reservation — which is what makes concurrent creates
// unable to exceed the quota. A new month means a new monthKey, hence a fresh
// document that naturally starts at the current record count (0 for the new
// period), so no cron rollover is required.
const recruitmentMonthlyUsageSchema = new mongoose.Schema({
  owner: {
    // The identity that owns the quota: the User for player cards/applications,
    // the Team (also a User document) for team recruitments.
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  usageType: {
    type: String,
    enum: Object.values(USAGE_TYPES),
    required: true
  },
  monthKey: {
    // Calendar month in UTC, e.g. "2026-08".
    type: String,
    required: true,
    match: /^\d{4}-\d{2}$/
  },
  count: {
    type: Number,
    min: 0,
    default: 0
  },
  expiresAt: {
    // Kept ~2 months past period end so delayed TTL cleanup can never race a
    // request in the active month; monthKey remains the uniqueness boundary.
    type: Date,
    required: true
  }
}, { timestamps: true });

recruitmentMonthlyUsageSchema.index({ owner: 1, usageType: 1, monthKey: 1 }, { unique: true });
recruitmentMonthlyUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RecruitmentMonthlyUsage', recruitmentMonthlyUsageSchema);
