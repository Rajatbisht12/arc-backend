const mongoose = require('mongoose');

// Server-authored proof that a specific viewer received a post through a paid
// boost placement. Engagement APIs never trust the client-provided `source`.
const boostDeliveryAttributionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'BoostCampaign', required: true, index: true },
  context: { type: String, enum: ['feed', 'clips', 'profile', 'search', 'post', 'unknown'], required: true },
  deliveredAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

boostDeliveryAttributionSchema.index({ user: 1, post: 1, campaign: 1, context: 1 }, { unique: true });
boostDeliveryAttributionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
boostDeliveryAttributionSchema.index({ user: 1, post: 1, campaign: 1, expiresAt: -1 });
boostDeliveryAttributionSchema.index({ user: 1, post: 1, context: 1, expiresAt: -1 });

module.exports = mongoose.model('BoostDeliveryAttribution', boostDeliveryAttributionSchema);
