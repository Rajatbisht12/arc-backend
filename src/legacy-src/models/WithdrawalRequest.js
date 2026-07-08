const mongoose = require('mongoose');
const { Schema } = mongoose;

const withdrawalBankSnapshotSchema = new Schema({
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

const withdrawalRequestSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  payoutCycle: { type: Schema.Types.ObjectId, ref: 'PayoutCycle', required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  amountMinor: { type: Number, min: 0, default: null },
  currency: { type: String, uppercase: true, trim: true, maxlength: 3, default: 'INR' },
  bankDetails: { type: Schema.Types.ObjectId, ref: 'CreatorBankDetails', default: null },
  bankDetailsVersion: { type: Number, min: 1, default: null },
  bankDetailsSnapshot: { type: withdrawalBankSnapshotSchema, default: null },
  status: {
    type: String,
    enum: ['pending', 'approved', 'processing', 'paid', 'completed', 'failed', 'cancelled', 'rejected'],
    default: 'pending',
    index: true
  },
  requestedAt: { type: Date, default: Date.now },
  bankReference: { type: String, default: '', maxlength: 100 },
  transactionId: { type: String, trim: true, maxlength: 120, default: '' },
  paymentMethod: { type: String, enum: ['', 'bank_transfer', 'neft', 'rtgs', 'imps', 'upi', 'razorpay', 'cash', 'other'], default: '' },
  paymentNotes: { type: String, trim: true, maxlength: 1000, default: '' },
  paymentDate: { type: Date, default: null },
  rejectionReason: { type: String, default: '', maxlength: 500 },
  failureReason: { type: String, default: '', maxlength: 500 },
  cancellationReason: { type: String, default: '', maxlength: 500 },
  paidAt: { type: Date },
  processedAt: { type: Date },
  cancelledAt: { type: Date },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

withdrawalRequestSchema.index({ user: 1, payoutCycle: 1 }, { unique: true });

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
