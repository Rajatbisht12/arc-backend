const mongoose = require('mongoose');

const postEngagementSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
    index: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  eventType: {
    type: String,
    enum: [
      'view',
      'watch',
      'like',
      'unlike',
      'comment',
      'share',
      'save',
      'unsave',
      'skip',
      'dwell',
      // Server-recorded delivery: the post was served in a ranked surface.
      // Used for seen-post cooldown ranking; never treated as intent.
      'impression'
    ],
    required: true,
    index: true
  },
  context: {
    type: String,
    enum: ['feed', 'clips', 'profile', 'search', 'post', 'unknown'],
    default: 'unknown',
    index: true
  },
  source: {
    type: String,
    enum: ['organic', 'boost'],
    default: 'organic',
    index: true
  },
  boostCampaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BoostCampaign',
    index: true
  },
  durationMs: {
    type: Number,
    default: 0,
    min: 0
  },
  completionRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Delivery tracking for seen-post cooldown ranking. createdAt doubles as
  // firstShownAt and updatedAt as lastShownAt for impression rows.
  impressionCount: {
    type: Number,
    default: 0,
    min: 0
  },
  positionShown: {
    type: Number,
    default: null
  },
  sessionId: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

postEngagementSchema.index({ user: 1, createdAt: -1 });
postEngagementSchema.index({ post: 1, eventType: 1, createdAt: -1 });
postEngagementSchema.index({ author: 1, eventType: 1, createdAt: -1 });
postEngagementSchema.index({ eventType: 1, source: 1, createdAt: -1, author: 1 });
postEngagementSchema.index({ author: 1, createdAt: -1, eventType: 1, source: 1 });
postEngagementSchema.index(
  { user: 1, post: 1, eventType: 1, context: 1 },
  {
    unique: true,
    partialFilterExpression: { eventType: 'view' }
  }
);
// Impression rows are upserted once per (user, post, surface); a distinct key
// order keeps this from colliding with the existing partial view index.
postEngagementSchema.index(
  { user: 1, context: 1, post: 1, eventType: 1 },
  {
    unique: true,
    partialFilterExpression: { eventType: 'impression' }
  }
);
// Seen-post lookup: recent deliveries for one user in one surface.
postEngagementSchema.index({ user: 1, context: 1, eventType: 1, updatedAt: -1 });

module.exports = mongoose.model('PostEngagement', postEngagementSchema);
