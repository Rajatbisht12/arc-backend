const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema({
  // Creator Information
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },
  
  // Challenge Basic Info
  title: {
    type: String,
    required: [true, 'Challenge title is required'],
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    required: [true, 'Challenge description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  // Challenge Type & Category
  challengeType: {
    type: String,
    enum: ['kill_count', 'win_count', 'survival_time', 'damage_dealt', 'custom'],
    required: [true, 'Challenge type is required']
  },
  
  game: {
    type: String,
    required: [true, 'Game is required'],
    enum: ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'CS:GO', 'Fortnite', 'Apex Legends', 'League of Legends', 'Dota 2']
  },
  
  category: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'special', 'tournament'],
    default: 'daily'
  },
  
  // Challenge Requirements
  requirements: {
    targetValue: {
      type: Number,
      required: function() {
        return this.challengeType !== 'custom';
      }
    },
    targetUnit: {
      type: String,
      enum: ['kills', 'wins', 'minutes', 'damage', 'matches', 'custom'],
      required: function() {
        return this.challengeType !== 'custom';
      }
    },
    timeLimit: {
      type: Number, // in hours
      default: 24
    },
    maxParticipants: {
      type: Number,
      default: 1000
    },
    minSkillLevel: {
      type: String,
      enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'predator', 'any'],
      default: 'any'
    }
  },
  
  // Rewards & Perks
  rewards: {
    primaryReward: {
      type: String,
      required: [true, 'Primary reward is required'],
      maxlength: [200, 'Primary reward description cannot exceed 200 characters']
    },
    secondaryRewards: [{
      type: String,
      maxlength: [200, 'Secondary reward description cannot exceed 200 characters']
    }],
    rewardType: {
      type: String,
      enum: ['cash', 'gift_card', 'in_game_items', 'merchandise', 'recognition', 'custom'],
      required: [true, 'Reward type is required']
    },
    rewardValue: {
      type: Number,
      min: [0, 'Reward value cannot be negative']
    },
    rewardCurrency: {
      type: String,
      enum: ['INR', 'USD', 'EUR', 'GBP', 'tokens', 'points'],
      default: 'INR'
    }
  },
  
  // Challenge Status & Settings
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'completed', 'cancelled'],
    default: 'draft'
  },
  
  visibility: {
    type: String,
    enum: ['public', 'followers', 'private'],
    default: 'public'
  },
  
  // Dates
  startDate: {
    type: Date,
    required: [true, 'Start date is required']
  },
  
  endDate: {
    type: Date,
    required: [true, 'End date is required']
  },
  
  // Participation Tracking
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    progress: {
      currentValue: {
        type: Number,
        default: 0
      },
      completed: {
        type: Boolean,
        default: false
      },
      completedAt: {
        type: Date
      },
      rank: {
        type: Number
      }
    },
    rewardClaimed: {
      type: Boolean,
      default: false
    },
    rewardClaimedAt: {
      type: Date
    }
  }],
  
  // Statistics
  stats: {
    totalParticipants: {
      type: Number,
      default: 0
    },
    completedParticipants: {
      type: Number,
      default: 0
    },
    totalRewardsDistributed: {
      type: Number,
      default: 0
    },
    views: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 0
    }
  },
  
  // Media & Content
  media: {
    thumbnail: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(v);
        },
        message: 'Invalid thumbnail URL'
      }
    },
    banner: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(v);
        },
        message: 'Invalid banner URL'
      }
    },
    video: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/.+\.(mp4|webm|ogg)$/i.test(v);
        },
        message: 'Invalid video URL'
      }
    }
  },
  
  // Tags for discoverability
  tags: [{
    type: String,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  
  // Creator Settings
  creatorSettings: {
    allowLateJoin: {
      type: Boolean,
      default: true
    },
    requireVerification: {
      type: Boolean,
      default: false
    },
    autoDistributeRewards: {
      type: Boolean,
      default: true
    },
    showLeaderboard: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

// Indexes for better performance
challengeSchema.index({ creator: 1, status: 1 });
challengeSchema.index({ game: 1, status: 1 });
challengeSchema.index({ startDate: 1, endDate: 1 });
challengeSchema.index({ 'participants.user': 1 });
challengeSchema.index({ tags: 1 });

// Virtual for active participants count
challengeSchema.virtual('activeParticipantsCount').get(function() {
  return this.participants.filter(p => !p.progress.completed).length;
});

// Virtual for completion rate
challengeSchema.virtual('completionRate').get(function() {
  if (this.participants.length === 0) return 0;
  return (this.stats.completedParticipants / this.participants.length) * 100;
});

// Pre-save middleware to update stats
challengeSchema.pre('save', function(next) {
  if (this.isModified('participants')) {
    this.stats.totalParticipants = this.participants.length;
    this.stats.completedParticipants = this.participants.filter(p => p.progress.completed).length;
  }
  next();
});

// Method to add participant
challengeSchema.methods.addParticipant = function(userId) {
  const existingParticipant = this.participants.find(p => p.user.toString() === userId.toString());
  if (existingParticipant) {
    throw new Error('User is already participating in this challenge');
  }
  
  if (this.participants.length >= this.requirements.maxParticipants) {
    throw new Error('Challenge has reached maximum participants');
  }
  
  if (new Date() > this.endDate) {
    throw new Error('Challenge has ended');
  }
  
  this.participants.push({
    user: userId,
    joinedAt: new Date(),
    progress: {
      currentValue: 0,
      completed: false
    }
  });
  
  return this.save();
};

// Method to update participant progress
challengeSchema.methods.updateProgress = function(userId, newValue) {
  const participant = this.participants.find(p => p.user.toString() === userId.toString());
  if (!participant) {
    throw new Error('User is not participating in this challenge');
  }
  
  participant.progress.currentValue = newValue;
  
  // Check if challenge is completed
  if (newValue >= this.requirements.targetValue && !participant.progress.completed) {
    participant.progress.completed = true;
    participant.progress.completedAt = new Date();
    
    // Update rank based on completion time
    const completedParticipants = this.participants.filter(p => p.progress.completed);
    participant.progress.rank = completedParticipants.length;
  }
  
  return this.save();
};

// Method to distribute rewards
challengeSchema.methods.distributeRewards = function() {
  const completedParticipants = this.participants
    .filter(p => p.progress.completed && !p.rewardClaimed)
    .sort((a, b) => a.progress.rank - b.progress.rank);
  
  completedParticipants.forEach(participant => {
    participant.rewardClaimed = true;
    participant.rewardClaimedAt = new Date();
  });
  
  this.stats.totalRewardsDistributed += completedParticipants.length;
  return this.save();
};

module.exports = mongoose.model('Challenge', challengeSchema);
