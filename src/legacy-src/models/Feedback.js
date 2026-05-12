const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  feedback: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'addressed'],
    default: 'pending'
  },
  adminNotes: {
    type: String,
    default: ''
  },
  ipAddress: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for better query performance
feedbackSchema.index({ timestamp: -1 });
feedbackSchema.index({ status: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
