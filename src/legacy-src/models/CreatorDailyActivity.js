const mongoose = require('mongoose');

const creatorDailyActivitySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  day: {
    type: String,
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true
  },
  postsCreated: { type: Number, default: 0 },
  clipsCreated: { type: Number, default: 0 },
  storiesCreated: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  saves: { type: Number, default: 0 },
  meaningfulEngagements: { type: Number, default: 0 },
  lastCalculatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

creatorDailyActivitySchema.index({ user: 1, day: 1 }, { unique: true });
creatorDailyActivitySchema.index({ date: 1 });

module.exports = mongoose.model('CreatorDailyActivity', creatorDailyActivitySchema);
