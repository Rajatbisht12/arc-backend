const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  game: {
    type: String,
    required: true,
    enum: ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'General']
  },
  reason: {
    type: String,
    required: false,
    default: 'No reason provided',
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewNotes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
leaveRequestSchema.index({ team: 1, status: 1 });
leaveRequestSchema.index({ player: 1, status: 1 });
leaveRequestSchema.index({ team: 1, player: 1, game: 1, status: 1 });

const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);

module.exports = LeaveRequest;