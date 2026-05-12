const mongoose = require('mongoose');
const { Schema } = mongoose;

const withdrawalRequestSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  payoutCycle: { type: Schema.Types.ObjectId, ref: 'PayoutCycle', required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  requestedAt: { type: Date, default: Date.now },
  bankReference: { type: String, default: '', maxlength: 100 },
  rejectionReason: { type: String, default: '', maxlength: 500 },
  paidAt: { type: Date },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

withdrawalRequestSchema.index({ user: 1, payoutCycle: 1 }, { unique: true });

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
