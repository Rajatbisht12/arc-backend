const mongoose = require('mongoose');
// A brief proof of unseen-source exhaustion, scoped to the current audience.
// Exposure is monotonic; new/changed content is still queried on every page.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  filterHash: { type: String, required: true },
  unseenCheckedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true }
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ user: 1 });
module.exports = mongoose.model('RecommendationState', schema);
