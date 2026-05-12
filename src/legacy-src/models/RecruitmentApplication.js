const mongoose = require('mongoose');

const recruitmentApplicationSchema = new mongoose.Schema({
  applicant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Applicant is required']
  },
  recruitment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TeamRecruitment',
    required: [true, 'Recruitment is required']
  },
  applicationType: {
    type: String,
    enum: ['team-recruitment', 'player-profile'],
    required: [true, 'Application type is required']
  },
  // Application details
  message: {
    type: String,
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  resume: {
    type: String,
    default: ''
  },
  portfolio: {
    type: String,
    default: ''
  },
  // Application status
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'shortlisted', 'rejected', 'accepted', 'withdrawn'],
    default: 'pending'
  },
  // Team's response
  teamResponse: {
    message: String,
    respondedAt: {
      type: Date,
      default: null
    },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  // Interview/Meeting details
  interview: {
    scheduledAt: Date,
    meetingLink: String,
    notes: String,
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'cancelled', 'no-show'],
      default: undefined
    }
  },
  // Additional documents
  documents: [{
    name: String,
    url: String,
    type: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
recruitmentApplicationSchema.index({ applicant: 1, createdAt: -1 });
recruitmentApplicationSchema.index({ recruitment: 1, status: 1 });
recruitmentApplicationSchema.index({ status: 1, createdAt: -1 });
recruitmentApplicationSchema.index({ applicationType: 1 });

// Ensure only one active application per recruitment per applicant
recruitmentApplicationSchema.index({ 
  applicant: 1, 
  recruitment: 1, 
  isActive: 1 
}, { 
  unique: true, 
  partialFilterExpression: { isActive: true } 
});

module.exports = mongoose.model('RecruitmentApplication', recruitmentApplicationSchema);
