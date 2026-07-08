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
    enum: ['open', 'closing', 'closed', 'paid'],
    default: 'open',
    index: true
  },
  /**
   * Durable close lease. Every ECS task schedules the same cron, so the cycle
   * document is also the cross-process coordinator. No payout calculation may
   * run for a closing cycle without owning this lease.
   */
  closeLeaseKey: {
    type: String,
    default: '',
    select: false
  },
  closeLeaseExpiresAt: {
    type: Date,
    default: null
  },
  closeStartedAt: {
    type: Date,
    default: null
  },
  closeLastAttemptAt: {
    type: Date,
    default: null
  },
  closeAttemptCount: {
    type: Number,
    default: 0,
    min: 0
  },
  earningsFinalizedAt: {
    type: Date,
    default: null
  },
  closeCompletedAt: {
    type: Date,
    default: null
  },
  closeLastError: {
    type: String,
    default: '',
    maxlength: 1000
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
