const mongoose = require('mongoose');
const { generateRecruitmentCode } = require('../utils/recruitmentShareCode');

// Generate unique shareable ID with prefix and role
const generateShareableId = function() {
  return generateRecruitmentCode(this);
};

const teamRecruitmentSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Team is required']
  },
  // Unique shareable ID for recruitment posts
  recruitmentCode: {
    type: String,
    unique: true,
    default: generateShareableId,
    index: true
  },
  recruitmentType: {
    type: String,
    enum: ['roster', 'staff'],
    required: [true, 'Recruitment type is required']
  },
  // Game and Role Information
  game: {
    type: String,
    required: function() {
      return this.recruitmentType === 'roster';
    },
    enum: ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'CS:GO', 'Fortnite', 'Apex Legends', 'League of Legends', 'Dota 2']
  },
  role: {
    type: String,
    maxlength: 120,
    required: function() {
      return this.recruitmentType === 'roster';
    }
  },
  // For staff recruitment
  staffRole: {
    type: String,
    enum: ['Coach', 'Manager', 'Content Creator', 'Video Editor', 'Social Media Manager', 'GFX Artist', 'Scrims Manager', 'Tournament Manager', 'Analyst', 'Stream Manager'],
    required: function() {
      return this.recruitmentType === 'staff';
    }
  },
  // Requirements
  requirements: {
    dailyPlayingTime: { type: String, maxlength: 120 },
    tournamentExperience: { type: String, maxlength: 500 },
    requiredDevice: { type: String, maxlength: 200 },
    experienceLevel: { type: String, maxlength: 120 },
    language: { type: String, maxlength: 300 },
    additionalRequirements: { type: String, maxlength: 1500 },
    // Staff specific requirements
    availability: { type: String, maxlength: 500 },
    requiredSkills: { type: String, maxlength: 1500 },
    portfolioRequirements: { type: String, maxlength: 800 }
  },
  // Benefits and Contact
  benefits: {
    salary: { type: String, maxlength: 200 },
    customSalary: { type: String, maxlength: 200 },
    location: { type: String, maxlength: 120 },
    benefitsAndPerks: { type: String, maxlength: 1000 },
    contactInformation: { type: String, maxlength: 300 }
  },
  // Status and Metadata
  status: {
    type: String,
    enum: ['active', 'paused', 'closed', 'filled'],
    default: 'active'
  },
  applicants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    appliedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'shortlisted', 'rejected', 'accepted'],
      default: 'pending'
    },
    message: { type: String, maxlength: 1000 },
    resume: { type: String, maxlength: 2000 },
    portfolio: { type: String, maxlength: 2000 }
  }],
  views: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    }
  }
}, {
  timestamps: true
});

// Indexes for better performance
teamRecruitmentSchema.index({ team: 1, createdAt: -1 });
teamRecruitmentSchema.index({ recruitmentType: 1, game: 1, status: 1 });
teamRecruitmentSchema.index({ 'benefits.location': 1 });
teamRecruitmentSchema.index({ createdAt: -1 });
teamRecruitmentSchema.index({ expiresAt: 1 });
teamRecruitmentSchema.index({ isActive: 1, status: 1, expiresAt: 1, recruitmentType: 1, game: 1, createdAt: -1 });

// Virtual for applicant count
teamRecruitmentSchema.virtual('applicantCount').get(function() {
  return this.applicants ? this.applicants.length : 0;
});

// Pre-save hook to ensure recruitmentCode is always uppercase
teamRecruitmentSchema.pre('save', function(next) {
  if (this.recruitmentCode && typeof this.recruitmentCode === 'string') {
    this.recruitmentCode = this.recruitmentCode.toUpperCase().trim();
  }
  next();
});

// Ensure virtual fields are included in JSON
teamRecruitmentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('TeamRecruitment', teamRecruitmentSchema);
