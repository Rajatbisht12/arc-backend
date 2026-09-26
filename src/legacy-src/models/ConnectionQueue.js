const mongoose = require('mongoose');
const {
  normalizeMatchmakingGender,
  normalizePreferredGender
} = require('../utils/randomConnectGender');

const connectionQueueSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // A Random Connect lease belongs to the explicit client session that created
  // it, not to every browser/app logged into the same account. Older rows are
  // intentionally allowed to load so the server sweeper can expire them.
  clientSessionId: {
    type: String,
    default: '',
    maxlength: 128
  },
  clientPlatform: {
    type: String,
    enum: ['', 'web', 'android', 'ios'],
    default: ''
  },
  lastHeartbeatAt: {
    type: Date,
    default: null
  },
  username: String,
  displayName: String,
  avatar: String,
  selectedGame: {
    type: String,
    required: false // Made optional to support tags-only matching
  },
  tags: {
    type: [String],
    default: [],
    index: true // Index for faster tag-based queries
  },
  videoEnabled: {
    type: Boolean,
    default: true
  },
  gender: {
    type: String,
    enum: ['', 'male', 'female'],
    default: '',
    set: normalizeMatchmakingGender
  },
  preferredGender: {
    type: String,
    enum: ['', 'male', 'female'],
    default: '',
    set: normalizePreferredGender
  },
  region: {
    type: String,
    default: ''
  },
  lastMatchedUserIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  status: {
    type: String,
    enum: ['waiting', 'matched', 'cancelled'],
    default: 'waiting'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 60 * 1000)
  }
}, {
  timestamps: true
});

// Index for better query performance
connectionQueueSchema.index({ userId: 1 });
connectionQueueSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'waiting' } }
);
connectionQueueSchema.index({ status: 1, selectedGame: 1 });
connectionQueueSchema.index({ status: 1, tags: 1 }); // For tag-based matching
connectionQueueSchema.index({ status: 1, selectedGame: 1, tags: 1 }); // Combined matching
connectionQueueSchema.index({ status: 1, joinedAt: 1 });
connectionQueueSchema.index({ status: 1, gender: 1, joinedAt: 1 });
connectionQueueSchema.index({ status: 1, lastHeartbeatAt: 1, expiresAt: 1 });
connectionQueueSchema.index({ userId: 1, clientSessionId: 1, status: 1 });

// TTL index to automatically remove expired entries
connectionQueueSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ConnectionQueue', connectionQueueSchema);
