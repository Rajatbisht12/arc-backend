const mongoose = require('mongoose');

/**
 * Per-creator, per-payout-cycle earnings snapshot. Final payable amount only (no wallet).
 */
const earningsSnapshotSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  payoutCycle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PayoutCycle',
    required: true,
    index: true
  },
  /** Final amount for this cycle (in INR or base currency) */
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  /** Inputs used for calculation (for audit) */
  inputs: {
    watchTimeMinutes: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 },
    originalityScore: { type: Number, default: 0 },
    contentViolations: { type: Number, default: 0 },
    platformSharePercent: { type: Number, default: 0 }
  },
  /** If payout was held (fraud/review) */
  held: {
    type: Boolean,
    default: false
  },
  holdReason: {
    type: String,
    default: ''
  },
  calculatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

earningsSnapshotSchema.index({ user: 1, payoutCycle: 1 }, { unique: true });
earningsSnapshotSchema.index({ payoutCycle: 1 });
module.exports = mongoose.model('EarningsSnapshot', earningsSnapshotSchema);
