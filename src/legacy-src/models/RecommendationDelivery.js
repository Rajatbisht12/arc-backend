const mongoose = require('mongoose');

// Short-lived pagination reservations are NOT exposure. They prevent the same
// item being served twice in one browsing cycle, even with concurrent requests.
const schema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${session}:${post}`
  session: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  claim: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ session: 1, expiresAt: 1 });
schema.index({ user: 1 });
module.exports = mongoose.model('RecommendationDelivery', schema);
