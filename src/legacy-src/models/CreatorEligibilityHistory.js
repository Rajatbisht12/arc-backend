const mongoose = require('mongoose');

const requirementSchema = new mongoose.Schema({
  condition: { type: String, required: true },
  current: { type: mongoose.Schema.Types.Mixed },
  required: { type: mongoose.Schema.Types.Mixed },
  progressPercent: { type: Number, default: 0 },
  isMet: { type: Boolean, default: false }
}, { _id: false });

const creatorEligibilityHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },
  isEligible: { type: Boolean, default: false, index: true },
  progressPercent: { type: Number, default: 0, min: 0, max: 100 },
  requirements: [requirementSchema],
  failedConditions: [requirementSchema],
  metrics: {
    followersCount: { type: Number, default: 0 },
    hasActivePremiumMembership: { type: Boolean, default: false },
    totalOrganicClipViews45d: { type: Number, default: 0 },
    totalBoostedClipViews45d: { type: Number, default: 0 },
    totalClipViews45d: { type: Number, default: 0 },
    clipsWith3kOrganicViews45d: { type: Number, default: 0 },
    activeDays45d: { type: Number, default: 0 },
    creatorHealthScore: { type: Number, default: 0 },
    suspiciousViewSpike: { type: Boolean, default: false },
    policyViolations: { type: Number, default: 0 }
  },
  reason: {
    type: String,
    enum: ['profile_load', 'scheduled_recalculation', 'manual_recalculation', 'application_submit'],
    default: 'scheduled_recalculation',
    index: true
  },
  calculatedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

creatorEligibilityHistorySchema.index({ user: 1, calculatedAt: -1 });
creatorEligibilityHistorySchema.index({ calculatedAt: 1 });

module.exports = mongoose.model('CreatorEligibilityHistory', creatorEligibilityHistorySchema);
