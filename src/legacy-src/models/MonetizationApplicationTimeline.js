const mongoose = require('mongoose');

const monetizationApplicationTimelineSchema = new mongoose.Schema({
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MonetizationApplication',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['applied', 'withdrawn', 'approved', 'rejected', 'suspended', 'resumed', 'disabled', 'reactivated', 'cpm_updated', 'commented'],
    required: true,
    index: true
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  actorType: {
    type: String,
    enum: ['creator', 'admin', 'system'],
    default: 'system'
  },
  reason: {
    type: String,
    default: '',
    maxlength: 1000
  },
  oldValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

monetizationApplicationTimelineSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('MonetizationApplicationTimeline', monetizationApplicationTimelineSchema);
