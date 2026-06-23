/**
 * Auto-Learning System for AI Coach
 * Automatically learns from user feedback and adds knowledge to database
 */

const GamingKnowledge = require('../models/GamingKnowledge');
const AICoachInteraction = require('../models/AICoachInteraction');

/**
 * Extract knowledge from high-rated interactions and add to database
 */
const learnFromFeedback = async (interactionId) => {
  try {
    const interaction = await AICoachInteraction.findById(interactionId);
    
    if (!interaction) {
      console.log('⚠️ Interaction not found for learning');
      return;
    }

    // Only learn from high-rated interactions (4+ stars)
    if (!interaction.userRating || interaction.userRating < 4) {
      console.log(`⏭️ Skipping learning - Rating too low: ${interaction.userRating}`);
      return;
    }

    // Check if knowledge already exists
    const existing = await GamingKnowledge.findOne({
      question: { $regex: new RegExp(interaction.userMessage, 'i') },
      language: interaction.language,
      isActive: true
    });

    if (existing) {
      console.log('⏭️ Similar knowledge already exists');
      // Update usage count and quality rating
      existing.usageCount += 1;
      existing.qualityRating = (existing.qualityRating + interaction.userRating) / 2;
      await existing.save();
      return;
    }

    // Extract topic and game from message
    const topic = interaction.topic || 'general';
    const game = extractGameFromMessage(interaction.userMessage);
    
    // Extract keywords from user message
    const keywords = extractKeywords(interaction.userMessage);
    
    // Create new knowledge entry
    const newKnowledge = await GamingKnowledge.create({
      question: interaction.userMessage.trim(),
      answer: interaction.aiResponse.trim(),
      topic: topic,
      game: game,
      language: interaction.language || 'english',
      keywords: keywords,
      tags: [topic, game],
      skillLevel: 'all',
      priority: interaction.userRating >= 5 ? 8 : 6, // Higher priority for 5-star
      source: 'auto_learned',
      qualityRating: interaction.userRating,
      usageCount: 1,
      metadata: {
        learnedFrom: interactionId,
        userId: interaction.userId,
        aiType: interaction.aiType,
        timestamp: new Date()
      }
    });

    console.log(`✅ Auto-learned new knowledge: ${newKnowledge.question.substring(0, 50)}...`);
    return newKnowledge;

  } catch (error) {
    console.error('❌ Auto-learning error:', error);
    return null;
  }
};

/**
 * Extract game name from message
 */
const extractGameFromMessage = (message) => {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('bgmi') || lowerMessage.includes('pubg')) return 'bgmi';
  if (lowerMessage.includes('valorant') || lowerMessage.includes('valo')) return 'valorant';
  if (lowerMessage.includes('csgo') || lowerMessage.includes('cs2') || lowerMessage.includes('counter strike')) return 'csgo';
  if (lowerMessage.includes('freefire') || lowerMessage.includes('free fire')) return 'freefire';
  if (lowerMessage.includes('codm') || lowerMessage.includes('call of duty')) return 'codm';
  if (lowerMessage.includes('fortnite')) return 'fortnite';
  if (lowerMessage.includes('apex')) return 'apex';
  
  return 'general';
};

/**
 * Extract keywords from message
 */
const extractKeywords = (message) => {
  const lowerMessage = message.toLowerCase();
  
  // Common gaming keywords
  const gamingKeywords = [
    'aim', 'sensitivity', 'recoil', 'spray', 'flick', 'headshot',
    'rank', 'ranking', 'rank up', 'elo', 'mmr',
    'warmup', 'practice', 'training', 'routine',
    'communication', 'callout', 'team', 'squad',
    'strategy', 'tactics', 'positioning', 'rotation',
    'sniper', 'rifle', 'smg', 'shotgun', 'pistol',
    'map', 'location', 'drop', 'landing',
    'gyroscope', 'controls', 'settings', 'layout'
  ];
  
  const extracted = [];
  gamingKeywords.forEach(keyword => {
    if (lowerMessage.includes(keyword)) {
      extracted.push(keyword);
    }
  });
  
  // Also extract important words (length > 4)
  const words = lowerMessage.split(/\s+/).filter(word => 
    word.length > 4 && 
    !['what', 'when', 'where', 'which', 'how', 'should', 'could', 'would'].includes(word)
  );
  
  extracted.push(...words.slice(0, 5));
  
  return [...new Set(extracted)].slice(0, 10); // Remove duplicates, limit to 10
};

/**
 * Batch learn from multiple high-rated interactions
 */
const batchLearn = async (limit = 50) => {
  try {
    console.log('🔄 Starting batch learning...');
    
    // Get high-rated interactions that haven't been learned yet
    const highRatedInteractions = await AICoachInteraction.find({
      userRating: { $gte: 4 },
      'metadata.learned': { $ne: true }
    })
    .sort({ userRating: -1, timestamp: -1 })
    .limit(limit);
    
    console.log(`📚 Found ${highRatedInteractions.length} high-rated interactions to learn from`);
    
    let learned = 0;
    let skipped = 0;
    
    for (const interaction of highRatedInteractions) {
      const result = await learnFromFeedback(interaction._id);
      
      if (result) {
        learned++;
        // Mark as learned
        interaction.metadata = interaction.metadata || {};
        interaction.metadata.learned = true;
        await interaction.save();
      } else {
        skipped++;
      }
    }
    
    console.log(`✅ Batch learning complete: ${learned} learned, ${skipped} skipped`);
    return { learned, skipped };
    
  } catch (error) {
    console.error('❌ Batch learning error:', error);
    return { learned: 0, skipped: 0 };
  }
};

/**
 * Improve existing knowledge based on feedback
 */
const improveKnowledge = async (interactionId) => {
  try {
    const interaction = await AICoachInteraction.findById(interactionId);
    
    if (!interaction || !interaction.userRating || interaction.userRating < 3) {
      return;
    }

    // Find similar knowledge
    const similarKnowledge = await GamingKnowledge.findOne({
      question: { $regex: new RegExp(interaction.userMessage, 'i') },
      isActive: true
    });

    if (similarKnowledge) {
      // Update quality rating
      const currentRating = similarKnowledge.qualityRating || 0;
      const newRating = (currentRating + interaction.userRating) / 2;
      similarKnowledge.qualityRating = newRating;
      
      // If user feedback provided, consider updating answer
      if (interaction.userFeedback && interaction.userRating >= 4) {
        // Could use AI to improve answer, but for now just update rating
        console.log(`📈 Improved knowledge quality rating: ${similarKnowledge._id}`);
      }
      
      await similarKnowledge.save();
    }
    
  } catch (error) {
    console.error('❌ Knowledge improvement error:', error);
  }
};

module.exports = {
  learnFromFeedback,
  batchLearn,
  improveKnowledge,
  extractGameFromMessage,
  extractKeywords
};

