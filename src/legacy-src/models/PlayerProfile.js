const mongoose = require('mongoose');
const { generatePlayerProfileCode } = require('../utils/recruitmentShareCode');

// Generate unique shareable ID with prefix and role
const generateShareableId = function() {
  return generatePlayerProfileCode(this);
};

const playerProfileSchema = new mongoose.Schema({
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Player is required']
  },
  // Unique shareable ID for player profiles
  profileCode: {
    type: String,
    unique: true,
    index: true,
    default: generateShareableId
  },
  profileType: {
    type: String,
    enum: ['looking-for-team', 'staff-position'],
    required: [true, 'Profile type is required']
  },
  // Game and Role Information
  game: {
    type: String,
    required: function() {
      return this.profileType === 'looking-for-team';
    },
    enum: ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'CS:GO', 'Fortnite', 'Apex Legends', 'League of Legends', 'Dota 2']
  },
  role: {
    type: String,
    maxlength: 120,
    required: function() {
      return this.profileType === 'looking-for-team';
    }
  },
  // For staff profiles
  staffRole: {
    type: String,
    enum: ['Coach', 'Manager', 'Content Creator', 'Video Editor', 'Social Media Manager', 'GFX Artist', 'Scrims Manager', 'Tournament Manager', 'Analyst', 'Stream Manager'],
    required: function() {
      return this.profileType === 'staff-position';
    }
  },
  // Player/Staff Information
  playerInfo: {
    playerName: { type: String, maxlength: 120 },
    currentRank: { type: String, maxlength: 120 },
    experienceLevel: { type: String, maxlength: 120 },
    tournamentExperience: { type: String, maxlength: 500 },
    achievements: { type: String, maxlength: 1500 },
    availability: { type: String, maxlength: 500 },
    languages: { type: String, maxlength: 300 },
    additionalInfo: { type: String, maxlength: 1000 }
  },
  // Staff specific information
  professionalInfo: {
    fullName: { type: String, maxlength: 120 },
    experienceLevel: { type: String, maxlength: 120 },
    availability: { type: String, maxlength: 500 },
    preferredLocation: { type: String, maxlength: 120 },
    skillsAndExpertise: { type: String, maxlength: 1500 },
    professionalAchievements: { type: String, maxlength: 1500 },
    portfolio: { type: String, maxlength: 800 }
  },
  // Expectations and Contact
  expectations: {
    expectedSalary: { type: String, maxlength: 200 },
    compensationPreference: { type: String, maxlength: 200 },
    preferredTeamSize: { type: String, maxlength: 120 },
    teamType: { type: String, maxlength: 120 },
    preferredLocation: { type: String, maxlength: 120 },
    additionalInfo: { type: String, maxlength: 1000 },
    contactInformation: { type: String, maxlength: 300 }
  },
  // Status and Metadata
  status: {
    type: String,
    enum: ['active', 'paused', 'inactive'],
    default: 'active'
  },
  interestedTeams: [{
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    interestedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'shortlisted', 'rejected', 'accepted'],
      default: 'pending'
    },
    message: { type: String, maxlength: 1000 }
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
playerProfileSchema.index({ player: 1, createdAt: -1 });
playerProfileSchema.index({ profileType: 1, game: 1, status: 1 });
playerProfileSchema.index({ 'expectations.preferredLocation': 1 });
playerProfileSchema.index({ createdAt: -1 });
playerProfileSchema.index({ expiresAt: 1 });
playerProfileSchema.index({ isActive: 1, status: 1, expiresAt: 1, profileType: 1, game: 1, createdAt: -1 });

// Virtual for interested teams count
playerProfileSchema.virtual('interestedTeamsCount').get(function() {
  return this.interestedTeams ? this.interestedTeams.length : 0;
});

// Ensure virtual fields are included in JSON
playerProfileSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('PlayerProfile', playerProfileSchema);
