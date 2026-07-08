const mongoose = require('mongoose');

// Cross-collection idempotency key shared by automatic payouts and creator
// withdrawal requests. The unique index guarantees one disbursement path per
// creator and payout cycle, including under concurrent cron/API requests.
const creatorDisbursementReservationSchema = new mongoose.Schema({
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
  source: {
    type: String,
    enum: ['creator_payout', 'withdrawal'],
    required: true
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }
}, { timestamps: true });

creatorDisbursementReservationSchema.index({ user: 1, payoutCycle: 1 }, { unique: true });
creatorDisbursementReservationSchema.index({ source: 1, sourceId: 1 }, { unique: true });

module.exports = mongoose.model('CreatorDisbursementReservation', creatorDisbursementReservationSchema);
