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
    required: true
  },
  /** Final amount for this cycle (in INR or base currency) */
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  amountMinor: { type: Number, min: 0, default: null },
  currency: { type: String, uppercase: true, trim: true, maxlength: 3, default: 'INR' },
  /** Inputs used for calculation (for audit) */
  inputs: {
    totalClipViews: { type: Number, default: 0 },
    totalOrganicClipViews: { type: Number, default: 0 },
    totalBoostedClipViews: { type: Number, default: 0 },
    cpm: { type: Number, default: 0 },
    watchTimeMinutes: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 },
    originalityScore: { type: Number, default: 0 },
    contentViolations: { type: Number, default: 0 },
    platformSharePercent: { type: Number, default: 0 }
  },
  breakdown: {
    organicRevenue: { type: Number, min: 0, default: 0 },
    bonusRevenue: { type: Number, min: 0, default: 0 },
    referralRevenue: { type: Number, min: 0, default: 0 },
    platformAdjustments: { type: Number, default: 0 },
    taxes: { type: Number, min: 0, default: 0 },
    grossAmount: { type: Number, min: 0, default: 0 },
    finalPayoutAmount: { type: Number, min: 0, default: 0 }
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
  // Written in the same transaction that creates the cross-collection
  // disbursement reservation. Holding this snapshot and reserving it then
  // contend on the same document, closing the hold-vs-payout race.
  disbursementReservedAt: {
    type: Date,
    default: null
  },
  disbursementSource: {
    type: String,
    enum: ['creator_payout', 'withdrawal'],
    default: null
  },
  disbursementId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  disbursementReviewedAt: {
    type: Date,
    default: null
  },
  calculatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

earningsSnapshotSchema.index({ user: 1, payoutCycle: 1 }, { unique: true });
earningsSnapshotSchema.index({ payoutCycle: 1 });
module.exports = mongoose.model('EarningsSnapshot', earningsSnapshotSchema);
