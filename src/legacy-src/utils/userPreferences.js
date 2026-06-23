const AICoachInteraction = require('../models/AICoachInteraction');

/**
 * Get most frequent value from array
 * @param {Array} arr - Array of values
 * @returns {*} Most frequent value
 */
const getMostFrequent = (arr) => {
  if (!arr || arr.length === 0) return null;
  
  const frequency = {};
  arr.forEach(item => {
    frequency[item] = (frequency[item] || 0) + 1;
  });
  
  return Object.keys(frequency).reduce((a, b) => 
    frequency[a] > frequency[b] ? a : b
  );
};

/**
 * Get top N values from array
 * @param {Array} arr - Array of values
 * @param {number} n - Number of top values to return
 * @returns {Array} Top N values
 */
const getTopN = (arr, n = 3) => {
  if (!arr || arr.length === 0) return [];
  
  const frequency = {};
  arr.forEach(item => {
    frequency[item] = (frequency[item] || 0) + 1;
  });
  
  return Object.entries(frequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key]) => key);
};

/**
 * Estimate user's skill level based on interaction history
 * @param {Array} interactions - User's interactions
 * @returns {string} Skill level (beginner, intermediate, advanced, professional)
 */
const estimateSkillLevel = (interactions) => {
  if (!interactions || interactions.length < 5) {
    return 'beginner';
  }
  
  // Analyze topics and complexity of questions
  const topics = interactions.map(i => i.topic);
  const messages = interactions.map(i => i.userMessage.toLowerCase());
  
  // Advanced indicators
  const advancedKeywords = ['meta', 'optimal', 'pro', 'tournament', 'competitive', 'scrim', 'vod review', 'agent comp', 'utility lineup'];
  const intermediateKeywords = ['strategy', 'tactics', 'rotation', 'crosshair placement', 'spray pattern'];
  const beginnerKeywords = ['how to', 'basic', 'start', 'beginner', 'first time', 'new'];
  
  const advancedCount = messages.filter(msg => 
    advancedKeywords.some(keyword => msg.includes(keyword))
  ).length;
  
  const intermediateCount = messages.filter(msg => 
    intermediateKeywords.some(keyword => msg.includes(keyword))
  ).length;
  
  const beginnerCount = messages.filter(msg => 
    beginnerKeywords.some(keyword => msg.includes(keyword))
  ).length;
  
  if (advancedCount > interactions.length * 0.3) {
    return 'advanced';
  } else if (intermediateCount > interactions.length * 0.3) {
    return 'intermediate';
  } else {
    return 'beginner';
  }
};

/**
 * Analyze user's preferred response style
 * @param {Array} highRatedResponses - Highly rated responses
 * @returns {string} Response style preference
 */
const analyzeResponseStyle = (highRatedResponses) => {
  if (!highRatedResponses || highRatedResponses.length === 0) {
    return 'balanced';
  }
  
  // Analyze response characteristics
  let detailedCount = 0;
  let conciseCount = 0;
  
  highRatedResponses.forEach(response => {
    const responseLength = response.aiResponse.length;
    const hasEmojis = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]/u.test(response.aiResponse);
    const hasBulletPoints = response.aiResponse.includes('-') || response.aiResponse.includes('•');
    
    if (responseLength > 500 && hasBulletPoints) {
      detailedCount++;
    } else if (responseLength < 300) {
      conciseCount++;
    }
  });
  
  if (detailedCount > conciseCount) {
    return 'detailed with examples';
  } else if (conciseCount > detailedCount) {
    return 'concise and direct';
  } else {
    return 'balanced';
  }
};

/**
 * Get user preferences based on interaction history
 * @param {string} userId - User ID
 * @returns {Object} User preferences
 */
const getUserPreferences = async (userId) => {
  try {
    // Get recent interactions (last 50)
    const interactions = await AICoachInteraction.find({ userId })
      .sort({ timestamp: -1 })
      .limit(50);
    
    if (interactions.length === 0) {
      return {
        preferredLanguage: 'english',
        favoriteTopics: ['general'],
        skillLevel: 'beginner',
        responseStyle: 'balanced',
        totalInteractions: 0,
        averageRating: 0
      };
    }
    
    // Extract data
    const languages = interactions.map(i => i.language);
    const topics = interactions.map(i => i.topic);
    const ratings = interactions.filter(i => i.userRating).map(i => i.userRating);
    const highRatedResponses = interactions.filter(i => i.userRating >= 4);
    
    // Calculate preferences
    const preferences = {
      preferredLanguage: getMostFrequent(languages),
      favoriteTopics: getTopN(topics, 3),
      skillLevel: estimateSkillLevel(interactions),
      responseStyle: analyzeResponseStyle(highRatedResponses),
      totalInteractions: interactions.length,
      averageRating: ratings.length > 0 
        ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
        : 0,
      recentTopics: interactions.slice(0, 5).map(i => i.topic),
      lastInteraction: interactions[0].timestamp
    };
    
    return preferences;
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return {
      preferredLanguage: 'english',
      favoriteTopics: ['general'],
      skillLevel: 'beginner',
      responseStyle: 'balanced',
      totalInteractions: 0,
      averageRating: 0
    };
  }
};

/**
 * Generate personalized prompt enhancement based on user preferences
 * @param {Object} preferences - User preferences
 * @returns {string} Personalized prompt instructions
 */
const getPersonalizedInstructions = (preferences) => {
  let instructions = '\nUSER PROFILE & PERSONALIZATION:\n';
  
  // Skill level adjustment
  if (preferences.skillLevel === 'beginner') {
    instructions += '- User is a BEGINNER: Use simple explanations, avoid jargon, provide step-by-step guidance\n';
  } else if (preferences.skillLevel === 'intermediate') {
    instructions += '- User is INTERMEDIATE: Provide detailed strategies, some technical terms okay\n';
  } else if (preferences.skillLevel === 'advanced') {
    instructions += '- User is ADVANCED: Use technical terminology, focus on optimization and meta strategies\n';
  }
  
  // Response style
  if (preferences.responseStyle === 'detailed with examples') {
    instructions += '- User prefers DETAILED responses with EXAMPLES and SCENARIOS\n';
  } else if (preferences.responseStyle === 'concise and direct') {
    instructions += '- User prefers CONCISE, DIRECT answers without excessive details\n';
  }
  
  // Favorite topics
  if (preferences.favoriteTopics && preferences.favoriteTopics.length > 0) {
    instructions += `- User's favorite topics: ${preferences.favoriteTopics.join(', ')}\n`;
  }
  
  // Total interactions
  if (preferences.totalInteractions > 20) {
    instructions += '- User is a REGULAR: You can reference previous discussions and build continuity\n';
  } else if (preferences.totalInteractions < 5) {
    instructions += '- User is NEW: Be extra welcoming and provide foundational guidance\n';
  }
  
  return instructions;
};

module.exports = {
  getUserPreferences,
  getPersonalizedInstructions,
  getMostFrequent,
  getTopN,
  estimateSkillLevel,
  analyzeResponseStyle
};

