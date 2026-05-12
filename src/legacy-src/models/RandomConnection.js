const mongoose = require('mongoose');

const randomConnectionSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    username: String,
    displayName: String,
    avatar: String,
    videoEnabled: {
      type: Boolean,
      default: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: Date
  }],
  selectedGame: {
    type: String,
    required: false // Made optional to support tags-only matching
  },
  tags: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['waiting', 'active', 'ended', 'disconnected'],
    default: 'waiting'
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: Date,
  duration: Number, // in seconds
  messages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  usedGenderFilter: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for better query performance
randomConnectionSchema.index({ roomId: 1 });
randomConnectionSchema.index({ status: 1, selectedGame: 1 });
randomConnectionSchema.index({ 'participants.userId': 1 });

module.exports = mongoose.model('RandomConnection', randomConnectionSchema);
