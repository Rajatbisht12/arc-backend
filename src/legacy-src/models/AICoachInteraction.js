const mongoose = require('mongoose');

const aiCoachInteractionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userMessage: {
    type: String,
    required: true,
    trim: true
  },
  aiResponse: {
    type: String,
    required: true,
    trim: true
  },
  userRating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  userFeedback: {
    type: String,
    trim: true,
    default: null
  },
  topic: {
    type: String,
    enum: ['aim', 'valorant', 'csgo', 'rank', 'communication', 'warmup', 'general', 'other'],
    default: 'general'
  },
  responseTime: {
    type: Number, // in milliseconds
    default: 0
  },
  conversationId: {
    type: String,
    required: true
  },
  language: {
    type: String,
    enum: ['english', 'hindi', 'roman_hindi', 'devanagari_hindi', 'marathi', 'roman_marathi', 'devanagari_marathi', 'mixed'],
    default: 'english'
  },
  aiType: {
    type: String,
    enum: ['gemini', 'llama', 'chatgpt', 'deepseek', 'grok', 'perplexity', 'fallback'],
    default: 'gemini'
  },
  customTitle: {
    type: String,
    trim: true,
    default: null
  },
  mediaType: {
    type: String,
    enum: ['text', 'image', 'video', 'image+text', 'video+text'],
    default: 'text'
  },
  mediaUrl: {
    type: String,
    default: null
  },
  mediaPublicId: {
    type: String,
    default: null
  },
  analysisType: {
    type: String,
    enum: ['general', 'rotation', 'positioning', 'aim', 'strategy', 'other'],
    default: 'general'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for better query performance
aiCoachInteractionSchema.index({ userId: 1, timestamp: -1 });
aiCoachInteractionSchema.index({ topic: 1, timestamp: -1 });
aiCoachInteractionSchema.index({ conversationId: 1 });

// Virtual for response quality score
aiCoachInteractionSchema.virtual('qualityScore').get(function() {
  if (this.userRating) {
    return this.userRating;
  }
  // Calculate based on response length and complexity
  const responseLength = this.aiResponse.length;
  const hasEmojis = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(this.aiResponse);
  const hasFormatting = this.aiResponse.includes('**') || this.aiResponse.includes('•');
  
  let score = 1;
  if (responseLength > 100) score += 1;
  if (responseLength > 300) score += 1;
  if (hasEmojis) score += 0.5;
  if (hasFormatting) score += 0.5;
  
  return Math.min(score, 5);
});

module.exports = mongoose.model('AICoachInteraction', aiCoachInteractionSchema);
