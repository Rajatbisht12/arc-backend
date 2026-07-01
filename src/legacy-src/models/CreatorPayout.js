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
    enum: ['pending', 'approved', 'processing', 'paid', 'completed', 'failed', 'held', 'cancelled', 'rejected'],
    default: 'pending',
    index: true
  },
  approvedAt: {
    type: Date
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  processedAt: {
    type: Date
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancelledAt: {
    type: Date
  },
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancellationReason: {
    type: String,
    default: '',
    maxlength: 500
  },
  failureReason: {
    type: String,
    default: '',
    maxlength: 500
  },
  paidAt: {
    type: Date
  },
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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
