const mongoose = require('mongoose');

const challengeParticipationSchema = new mongoose.Schema({
  // References
  challenge: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Challenge',
    required: [true, 'Challenge reference is required']
  },
  
  participant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Participant reference is required']
  },
  
  // Participation Details
  joinedAt: {
    type: Date,
    default: Date.now
  },
  
  // Progress Tracking
  progress: {
    currentValue: {
      type: Number,
      default: 0,
      min: [0, 'Progress value cannot be negative']
    },
    targetValue: {
      type: Number,
      required: [true, 'Target value is required']
    },
    completed: {
      type: Boolean,
      default: false
    },
    completedAt: {
      type: Date
    },
    rank: {
      type: Number,
      min: [1, 'Rank must be at least 1']
    },
    completionTime: {
      type: Number, // in minutes from start
      min: [0, 'Completion time cannot be negative']
    }
  },
  
  // Verification & Proof
  verification: {
    required: {
      type: Boolean,
      default: false
    },
    submitted: {
      type: Boolean,
      default: false
    },
    submittedAt: {
      type: Date
    },
    proof: {
      screenshots: [{
        url: String,
        description: String,
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      }],
      video: {
        url: String,
        description: String,
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      },
      description: {
        type: String,
        maxlength: [500, 'Verification description cannot exceed 500 characters']
      }
    },
    verified: {
      type: Boolean,
      default: false
    },
    verifiedAt: {
      type: Date
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    verificationNotes: {
      type: String,
      maxlength: [200, 'Verification notes cannot exceed 200 characters']
    }
  },
  
  // Rewards
  rewards: {
    eligible: {
      type: Boolean,
      default: true
    },
    claimed: {
      type: Boolean,
      default: false
    },
    claimedAt: {
      type: Date
    },
    rewardType: {
      type: String,
      enum: ['cash', 'gift_card', 'in_game_items', 'merchandise', 'recognition', 'custom']
    },
    rewardValue: {
      type: Number,
      min: [0, 'Reward value cannot be negative']
    },
    rewardCurrency: {
      type: String,
      enum: ['INR', 'USD', 'EUR', 'GBP', 'tokens', 'points'],
      default: 'INR'
    },
    rewardDescription: {
      type: String,
      maxlength: [200, 'Reward description cannot exceed 200 characters']
    }
  },
  
  // Activity Log
  activityLog: [{
    action: {
      type: String,
      enum: ['joined', 'progress_updated', 'completed', 'reward_claimed', 'verification_submitted', 'verification_approved', 'verification_rejected'],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: {
      type: String,
      maxlength: [200, 'Activity details cannot exceed 200 characters']
    },
    value: {
      type: Number
    }
  }],
  
  // Status
  status: {
    type: String,
    enum: ['active', 'completed', 'disqualified', 'withdrawn'],
    default: 'active'
  },
  
  // Creator Notes (for creator's internal tracking)
  creatorNotes: {
    type: String,
    maxlength: [500, 'Creator notes cannot exceed 500 characters']
  }
}, {
  timestamps: true
});

// Compound index to ensure unique participation
challengeParticipationSchema.index({ challenge: 1, participant: 1 }, { unique: true });

// Indexes for better performance
challengeParticipationSchema.index({ participant: 1, status: 1 });
challengeParticipationSchema.index({ challenge: 1, 'progress.rank': 1 });
challengeParticipationSchema.index({ 'rewards.claimed': 1, 'rewards.eligible': 1 });

// Virtual for completion percentage
challengeParticipationSchema.virtual('completionPercentage').get(function() {
  if (this.progress.targetValue === 0) return 0;
  return Math.min((this.progress.currentValue / this.progress.targetValue) * 100, 100);
});

// Virtual for time remaining (if challenge is still active)
challengeParticipationSchema.virtual('timeRemaining').get(function() {
  // This would need to be calculated based on challenge end date
  return null; // Placeholder
});

// Pre-save middleware to log activities
challengeParticipationSchema.pre('save', function(next) {
  if (this.isModified('progress.currentValue')) {
    this.activityLog.push({
      action: 'progress_updated',
      details: `Progress updated to ${this.progress.currentValue}`,
      value: this.progress.currentValue
    });
  }
  
  if (this.isModified('progress.completed') && this.progress.completed) {
    this.activityLog.push({
      action: 'completed',
      details: 'Challenge completed successfully'
    });
  }
  
  if (this.isModified('rewards.claimed') && this.rewards.claimed) {
    this.activityLog.push({
      action: 'reward_claimed',
      details: `Reward claimed: ${this.rewards.rewardDescription}`
    });
  }
  
  next();
});

// Method to update progress
challengeParticipationSchema.methods.updateProgress = function(newValue, challenge) {
  if (this.status !== 'active') {
    throw new Error('Cannot update progress for inactive participation');
  }
  
  if (newValue < this.progress.currentValue) {
    throw new Error('Progress cannot decrease');
  }
  
  this.progress.currentValue = newValue;
  
  // Check if challenge is completed
  if (newValue >= this.progress.targetValue && !this.progress.completed) {
    this.progress.completed = true;
    this.progress.completedAt = new Date();
    
    // Calculate completion time
    const challengeStart = challenge.startDate;
    const completionTime = (this.progress.completedAt - challengeStart) / (1000 * 60); // in minutes
    this.progress.completionTime = completionTime;
    
    // Update status
    this.status = 'completed';
  }
  
  return this.save();
};

// Method to submit verification
challengeParticipationSchema.methods.submitVerification = function(proof) {
  if (!this.verification.required) {
    throw new Error('Verification not required for this challenge');
  }
  
  if (this.verification.submitted) {
    throw new Error('Verification already submitted');
  }
  
  this.verification.submitted = true;
  this.verification.submittedAt = new Date();
  this.verification.proof = proof;
  
  return this.save();
};

// Method to claim reward
challengeParticipationSchema.methods.claimReward = function() {
  if (!this.rewards.eligible) {
    throw new Error('Not eligible for rewards');
  }
  
  if (this.rewards.claimed) {
    throw new Error('Reward already claimed');
  }
  
  if (!this.progress.completed) {
    throw new Error('Challenge not completed');
  }
  
  this.rewards.claimed = true;
  this.rewards.claimedAt = new Date();
  
  return this.save();
};

module.exports = mongoose.model('ChallengeParticipation', challengeParticipationSchema);
