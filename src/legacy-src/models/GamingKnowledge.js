const mongoose = require('mongoose');

const gamingKnowledgeSchema = new mongoose.Schema({
  // Question/Query that users might ask
  question: {
    type: String,
    required: true,
    trim: true,
    index: true // For faster search
  },
  
  // Answer/Knowledge content
  answer: {
    type: String,
    required: true,
    trim: true
  },
  
  // Topic category
  topic: {
    type: String,
    enum: ['aim', 'valorant', 'csgo', 'rank', 'communication', 'warmup', 'bgmi', 'freefire', 'codm', 'general', 'other'],
    default: 'general',
    index: true
  },
  
  // Game this knowledge applies to
  game: {
    type: String,
    enum: ['valorant', 'csgo', 'bgmi', 'freefire', 'codm', 'fortnite', 'apex', 'general', 'all'],
    default: 'general',
    index: true
  },
  
  // Language of the knowledge
  language: {
    type: String,
    enum: ['english', 'hindi', 'roman_hindi', 'devanagari_hindi', 'marathi', 'roman_marathi', 'devanagari_marathi', 'mixed'],
    default: 'english',
    index: true
  },
  
  // Keywords for better search
  keywords: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  
  // Tags for categorization
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  
  // Skill level this knowledge is for
  skillLevel: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'professional', 'all'],
    default: 'all'
  },
  
  // Priority/Relevance score (higher = more important)
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  
  // Usage statistics
  usageCount: {
    type: Number,
    default: 0
  },
  
  // Last used timestamp
  lastUsed: {
    type: Date,
    default: null
  },
  
  // Quality rating (from user feedback)
  qualityRating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  
  // Is this knowledge active
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  // Additional context/metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Created/Updated by
  createdBy: {
    type: String,
    default: 'system'
  },
  
  // Source of knowledge
  source: {
    type: String,
    enum: ['manual', 'user_feedback', 'ai_generated', 'community', 'pro_player'],
    default: 'manual'
  }
}, {
  timestamps: true
});

// Compound indexes for better query performance
gamingKnowledgeSchema.index({ topic: 1, game: 1, language: 1, isActive: 1 });
gamingKnowledgeSchema.index({ keywords: 1, isActive: 1 });
gamingKnowledgeSchema.index({ question: 'text', answer: 'text' }); // Text search index

// Method to increment usage
gamingKnowledgeSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  this.lastUsed = new Date();
  return this.save();
};

// Method to update quality rating
gamingKnowledgeSchema.methods.updateRating = function(rating) {
  if (this.qualityRating === 0) {
    this.qualityRating = rating;
  } else {
    // Average with existing rating
    this.qualityRating = (this.qualityRating + rating) / 2;
  }
  return this.save();
};

module.exports = mongoose.model('GamingKnowledge', gamingKnowledgeSchema);

