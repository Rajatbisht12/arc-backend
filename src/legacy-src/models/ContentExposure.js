const mongoose = require('mongoose');

// One durable record per authenticated viewer and canonical Post. Feed videos,
// Clips, profiles and direct links all refer to that same Post, never a URL.
const schema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${user}:${post}`; indexed equality join
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  contentType: { type: String, enum: ['post', 'video'], required: true },
  firstViewedAt: Date,
  lastViewedAt: Date,
  interacted: { type: Boolean, default: false },
  firstInteractedAt: Date,
  lastInteractedAt: Date
}, { versionKey: false });
schema.index({ user: 1, post: 1 }, { unique: true });
schema.index({ user: 1, interacted: 1, lastViewedAt: 1, post: 1 });
schema.index({ user: 1, interacted: 1, lastInteractedAt: 1, post: 1 });
schema.index({ post: 1 });
module.exports = mongoose.model('ContentExposure', schema);
