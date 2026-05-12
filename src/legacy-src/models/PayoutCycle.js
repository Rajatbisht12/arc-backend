const mongoose = require('mongoose');

/**
 * Defines a payout period (e.g. monthly). Earnings snapshots link to this.
 */
const payoutCycleSchema = new mongoose.Schema({
  /** e.g. "2025-02", "2025-W06" */
  cycleLabel: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  periodType: {
    type: String,
    enum: ['weekly', 'monthly'],
    default: 'monthly'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  /** Payouts executed for this cycle (status tracked in CreatorPayout) */
  payoutExecutedAt: {
    type: Date
  },
  status: {
    type: String,
    enum: ['open', 'closed', 'paid'],
    default: 'open',
    index: true
  },
  /** Minimum amount to trigger payout (below = rollover) */
  minimumPayoutThreshold: {
    type: Number,
    default: 500,
    min: 0
  }
}, { timestamps: true });

payoutCycleSchema.index({ startDate: 1, endDate: 1 });
module.exports = mongoose.model('PayoutCycle', payoutCycleSchema);
