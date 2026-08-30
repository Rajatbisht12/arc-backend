const mongoose = require('mongoose');

const storyMediaAssetSchema = new mongoose.Schema({
  story: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  publicIds: [{ type: String, required: true, trim: true }],
  expiresAt: { type: Date, required: true, index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('StoryMediaAsset', storyMediaAssetSchema);
