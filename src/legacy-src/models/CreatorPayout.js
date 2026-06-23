const mongoose = require('mongoose');

/**
 * Single payout record: one per creator per cycle when we actually send money.
 */
const creatorPayoutSchema = new mongoose.Schema({
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
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  /** Bank reference / UTR from payment gateway */
  bankReference: {
    type: String,
    default: '',
    maxlength: 100
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'held'],
    default: 'pending',
    index: true
  },
  failureReason: {
    type: String,
    default: '',
    maxlength: 500
  },
  paidAt: {
    type: Date
  },
  /** Fraud/hold flag */
  heldReason: {
    type: String,
    default: ''
  }
}, { timestamps: true });

creatorPayoutSchema.index({ user: 1, payoutCycle: 1 }, { unique: true });
creatorPayoutSchema.index({ payoutCycle: 1, status: 1 });
module.exports = mongoose.model('CreatorPayout', creatorPayoutSchema);
