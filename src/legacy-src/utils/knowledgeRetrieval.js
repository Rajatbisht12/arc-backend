const GamingKnowledge = require('../models/GamingKnowledge');

/**
 * Simple keyword-based search for knowledge retrieval
 * @param {string} query - User's query/question
 * @param {string} language - User's language
 * @param {string} topic - Detected topic (optional)
 * @param {string} game - Game name (optional)
 * @param {number} limit - Number of results to return
 * @returns {Array} Array of relevant knowledge items
 */
const retrieveKnowledge = async (query, language = 'english', topic = null, game = null, limit = 5) => {
  try {
    // Normalize query for search
    const normalizedQuery = query.toLowerCase().trim();
    
    // Extract keywords from query
    const queryKeywords = normalizedQuery
      .split(/\s+/)
      .filter(word => word.length > 2) // Filter short words
      .slice(0, 10); // Limit to 10 keywords
    
    // Build search query
    const searchQuery = {
      isActive: true
    };
    
    // Add language filter
    if (language && language !== 'mixed') {
      searchQuery.language = language;
    }
    
    // Add topic filter if provided
    if (topic && topic !== 'general') {
      searchQuery.topic = topic;
    }
    
    // Add game filter if provided
    if (game && game !== 'general') {
      searchQuery.$or = [
        { game: game },
        { game: 'general' },
        { game: 'all' }
      ];
    }
    
    // Search for knowledge
    let knowledgeItems = await GamingKnowledge.find(searchQuery)
      .sort({ priority: -1, usageCount: -1 }) // Sort by priority and usage
      .limit(limit * 3); // Get more results for filtering
    
    // If no results with filters, try without topic/game filters
    if (knowledgeItems.length === 0) {
      const relaxedQuery = {
        isActive: true,
        language: language || 'english'
      };
      knowledgeItems = await GamingKnowledge.find(relaxedQuery)
        .sort({ priority: -1, usageCount: -1 })
        .limit(limit * 3);
    }
    
    // Score and rank results based on keyword matching
    const scoredItems = knowledgeItems.map(item => {
      let score = item.priority || 1;
      
      // Check keyword matches
      const questionLower = item.question.toLowerCase();
      const answerLower = item.answer.toLowerCase();
      
      queryKeywords.forEach(keyword => {
        // Exact match in question = high score
        if (questionLower.includes(keyword)) {
          score += 5;
        }
        // Exact match in answer = medium score
        if (answerLower.includes(keyword)) {
          score += 2;
        }
        // Match in keywords array = high score
        if (item.keywords && item.keywords.some(k => k.includes(keyword))) {
          score += 4;
        }
        // Match in tags = medium score
        if (item.tags && item.tags.some(t => t.includes(keyword))) {
          score += 3;
        }
      });
      
      // Boost score if topic matches
      if (topic && item.topic === topic) {
        score += 3;
      }
      
      // Boost score if game matches
      if (game && (item.game === game || item.game === 'all' || item.game === 'general')) {
        score += 2;
      }
      
      return {
        ...item.toObject(),
        relevanceScore: score
      };
    });
    
    // Sort by relevance score and return top results
    const topResults = scoredItems
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
    
    // Increment usage count for retrieved items
    topResults.forEach(item => {
      GamingKnowledge.findByIdAndUpdate(item._id, {
        $inc: { usageCount: 1 },
        lastUsed: new Date()
      }).catch(err => console.error('Error updating usage:', err));
    });
    
    return topResults;
    
  } catch (error) {
    console.error('Knowledge retrieval error:', error);
    return []; // Return empty array on error
  }
};

/**
 * Format retrieved knowledge into context string for AI prompt
 * @param {Array} knowledgeItems - Array of knowledge items from retrieveKnowledge
 * @param {string} language - User's language
 * @returns {string} Formatted context string
 */
const formatKnowledgeContext = (knowledgeItems, language = 'english') => {
  if (!knowledgeItems || knowledgeItems.length === 0) {
    return '';
  }
  
  let context = '\n\nRELEVANT GAMING KNOWLEDGE FROM DATABASE:\n';
  context += 'Use this knowledge to provide accurate and helpful responses:\n\n';
  
  knowledgeItems.forEach((item, index) => {
    context += `${index + 1}. Question: ${item.question}\n`;
    context += `   Answer: ${item.answer}\n`;
    
    if (item.game && item.game !== 'general' && item.game !== 'all') {
      context += `   Game: ${item.game}\n`;
    }
    
    if (item.topic && item.topic !== 'general') {
      context += `   Topic: ${item.topic}\n`;
    }
    
    context += '\n';
  });
  
  context += 'IMPORTANT: Use this knowledge to enhance your response, but make it natural and conversational. Don\'t just copy-paste.\n';
  
  return context;
};

/**
 * Get knowledge statistics
 * @returns {Object} Statistics about knowledge base
 */
const getKnowledgeStats = async () => {
  try {
    const total = await GamingKnowledge.countDocuments({ isActive: true });
    const byTopic = await GamingKnowledge.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$topic', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const byGame = await GamingKnowledge.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$game', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const byLanguage = await GamingKnowledge.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    return {
      total,
      byTopic,
      byGame,
      byLanguage,
      mostUsed: await GamingKnowledge.find({ isActive: true })
        .sort({ usageCount: -1 })
        .limit(5)
        .select('question usageCount')
    };
  } catch (error) {
    console.error('Error getting knowledge stats:', error);
    return {
      total: 0,
      byTopic: [],
      byGame: [],
      byLanguage: [],
      mostUsed: []
    };
  }
};

module.exports = {
  retrieveKnowledge,
  formatKnowledgeContext,
  getKnowledgeStats
};

