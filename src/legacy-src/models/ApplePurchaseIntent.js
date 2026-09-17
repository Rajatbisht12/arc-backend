const mongoose = require('mongoose');

const applePurchaseIntentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  appAccountToken: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  kind: { type: String, enum: ['subscription', 'boost'], required: true, index: true },
  productId: { type: String, required: true, trim: true, maxlength: 255, index: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'expired'],
    default: 'pending',
    index: true
  },
  planKey: { type: String, default: '', maxlength: 80 },
  billingPeriod: { type: String, enum: ['', 'monthly', 'quarterly', 'yearly'], default: '' },
  boost: {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'BoostCampaign', default: null },
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: undefined },
    targetReach: { type: Number, min: 1, default: undefined },
    targetPlayers: { type: Boolean, default: undefined },
    targetTeams: { type: Boolean, default: undefined }
  },
  transactionId: { type: String, trim: true, default: undefined },
  originalTransactionId: { type: String, trim: true, default: undefined, index: true },
  environment: { type: String, enum: ['Sandbox', 'Production', 'Xcode'], default: undefined },
  processingAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: true },
  failureCode: { type: String, maxlength: 120, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

applePurchaseIntentSchema.index({ user: 1, createdAt: -1 });
applePurchaseIntentSchema.index(
  { transactionId: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: 'string', $gt: '' } } }
);

module.exports = mongoose.models.ApplePurchaseIntent || mongoose.model('ApplePurchaseIntent', applePurchaseIntentSchema);
