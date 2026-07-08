const mongoose = require('mongoose');

const payoutBankSnapshotSchema = new mongoose.Schema({
  accountHolderName: { type: String, default: '', maxlength: 100 },
  bankName: { type: String, default: '', maxlength: 200 },
  lastFourDigits: { type: String, default: '', maxlength: 4 },
  ifsc: { type: String, default: '', maxlength: 11 },
  swiftCode: { type: String, default: '', maxlength: 11 },
  branch: { type: String, default: '', maxlength: 200 },
  country: { type: String, default: 'IN', maxlength: 2 },
  version: { type: Number, min: 1, default: 1 },
  capturedAt: { type: Date, default: Date.now }
}, { _id: false });

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
  // Integer minor units are the accounting source of truth for newly-written
  // records. `amount` remains as a backward-compatible display field while
  // legacy rows are backfilled.
  amountMinor: {
    type: Number,
    min: 0,
    default: null
  },
  currency: {
    type: String,
    uppercase: true,
    trim: true,
    maxlength: 3,
    default: 'INR'
  },
  /** Bank reference / UTR from payment gateway */
  bankReference: {
    type: String,
    default: '',
    maxlength: 100
  },
  transactionId: {
    type: String,
    trim: true,
    maxlength: 120,
    default: '',
    index: true
  },
  sourceSnapshots: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EarningsSnapshot'
  }],
  paymentMethod: {
    type: String,
    enum: ['', 'bank_transfer', 'neft', 'rtgs', 'imps', 'upi', 'razorpay', 'cash', 'other'],
    default: ''
  },
  paymentNotes: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  paymentDate: {
    type: Date,
    default: null,
    index: true
  },
  statementNumber: {
    type: String,
    trim: true,
    maxlength: 120,
    default: ''
  },
  statementGeneratedAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'processing', 'paid', 'completed', 'failed', 'held', 'cancelled', 'rejected'],
    default: 'pending',
    index: true
  },
  preHoldStatus: {
    type: String,
    enum: ['', 'pending', 'approved', 'processing'],
    default: ''
  },
  version: {
    type: Number,
    min: 0,
    default: 0
  },
  attemptNumber: {
    type: Number,
    min: 1,
    default: 1
  },
  bankDetails: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreatorBankDetails',
    default: null
  },
  bankDetailsVersion: {
    type: Number,
    default: null,
    min: 1
  },
  // Immutable masked destination used by payout history even after the user
  // later changes or deletes the live bank record. Full account data is never
  // copied into payout history.
  bankDetailsSnapshot: {
    type: payoutBankSnapshotSchema,
    default: null
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
creatorPayoutSchema.index({ status: 1, paymentDate: -1, createdAt: -1 });
module.exports = mongoose.model('CreatorPayout', creatorPayoutSchema);
