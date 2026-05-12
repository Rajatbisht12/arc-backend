const mongoose = require('mongoose');

/**
 * One application per user at a time. Snapshot eligibility on apply.
 */
const monetizationApplicationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  adminRemark: {
    type: String,
    default: '',
    maxlength: 1000
  },
  /** Rejection reason shown to creator (e.g. "Policy violation") */
  rejectionReason: {
    type: String,
    default: '',
    maxlength: 500
  },
  appliedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  /** Snapshot of eligibility at apply time */
  eligibilitySnapshot: {
    isEligible: Boolean,
    progressPercent: Number,
    failedConditions: [{
      condition: String,
      current: mongoose.Schema.Types.Mixed,
      required: mongoose.Schema.Types.Mixed,
      progressPercent: Number
    }],
    metrics: {
      followersCount: Number,
      totalWatchTimeMinutes: Number,
      originalContentRatio: Number,
      accountAgeDays: Number,
      hasPolicyViolations: Boolean
    }
  },
  /** Cooldown: cannot re-apply until this date (set on reject) */
  reapplyAfter: {
    type: Date
  }
}, { timestamps: true });

monetizationApplicationSchema.index({ user: 1, status: 1 });
monetizationApplicationSchema.index({ status: 1, appliedAt: -1 });
module.exports = mongoose.model('MonetizationApplication', monetizationApplicationSchema);
