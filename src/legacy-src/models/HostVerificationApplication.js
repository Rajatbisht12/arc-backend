const mongoose = require('mongoose');

const hostVerificationApplicationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  contactNumber: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20
  },
  gamingExperience: {
    type: String,
    required: true,
    maxlength: 1000
  },
  reasonForHosting: {
    type: String,
    required: true,
    maxlength: 1000
  },
  socialLinks: {
    type: String,
    default: '',
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  appliedAt: {
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
  rejectionReason: {
    type: String,
    default: '',
    maxlength: 500
  }
}, { timestamps: true });

hostVerificationApplicationSchema.index({ status: 1, appliedAt: -1 });

module.exports = mongoose.model('HostVerificationApplication', hostVerificationApplicationSchema);
