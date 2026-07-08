const mongoose = require('mongoose');

const creatorPayoutHistorySchema = new mongoose.Schema({
  payout: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreatorPayout',
    required: true,
    index: true
  },
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
  action: {
    type: String,
    enum: ['generated', 'approved', 'processing', 'paid', 'failed', 'rejected', 'held', 'resumed', 'cancelled', 'statement_generated'],
    required: true,
    index: true
  },
  previousStatus: { type: String, default: '' },
  newStatus: { type: String, default: '' },
  amount: { type: Number, required: true, min: 0 },
  amountMinor: { type: Number, min: 0, default: null },
  currency: { type: String, uppercase: true, trim: true, maxlength: 3, default: 'INR' },
  idempotencyKey: { type: String, trim: true, maxlength: 160, default: '' },
  payment: {
    transactionId: { type: String, trim: true, maxlength: 120, default: '' },
    referenceNumber: { type: String, trim: true, maxlength: 120, default: '' },
    method: { type: String, enum: ['', 'bank_transfer', 'neft', 'rtgs', 'imps', 'upi', 'razorpay', 'cash', 'other'], default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    paymentDate: { type: Date, default: null }
  },
  actor: {
    actorKey: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    username: { type: String, default: '' },
    role: { type: String, default: '' }
  },
  reason: { type: String, trim: true, maxlength: 1000, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

creatorPayoutHistorySchema.index({ payout: 1, createdAt: -1 });
creatorPayoutHistorySchema.index(
  { payout: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } } }
);
creatorPayoutHistorySchema.index({ user: 1, createdAt: -1 });
creatorPayoutHistorySchema.index({ payoutCycle: 1, action: 1, createdAt: -1 });

const rejectMutation = function(next) {
  next(new Error('Creator payout history is immutable'));
};

for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  creatorPayoutHistorySchema.pre(hook, rejectMutation);
}
creatorPayoutHistorySchema.pre('save', function(next) {
  if (!this.isNew) return next(new Error('Creator payout history is immutable'));
  return next();
});
creatorPayoutHistorySchema.pre('bulkWrite', function(next, operations) {
  if ((operations || []).some((operation) => !operation.insertOne)) return next(new Error('Creator payout history is immutable'));
  return next();
});

module.exports = mongoose.model('CreatorPayoutHistory', creatorPayoutHistorySchema);
