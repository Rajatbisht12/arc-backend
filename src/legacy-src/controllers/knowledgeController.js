const GamingKnowledge = require('../models/GamingKnowledge');
const { retrieveKnowledge, formatKnowledgeContext, getKnowledgeStats } = require('../utils/knowledgeRetrieval');
const log = require('../utils/logger');

/**
 * Add new knowledge to database
 */
const addKnowledge = async (req, res) => {
  try {
    const {
      question,
      answer,
      topic = 'general',
      game = 'general',
      language = 'english',
      keywords = [],
      tags = [],
      skillLevel = 'all',
      priority = 1,
      source = 'manual'
    } = req.body;
    
    // Validation
    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        message: 'Question and answer are required'
      });
    }
    
    // Check if similar knowledge already exists
    const existing = await GamingKnowledge.findOne({
      question: { $regex: new RegExp(question, 'i') },
      language,
      isActive: true
    });
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Similar knowledge already exists',
        existing: existing._id
      });
    }
    
    // Create new knowledge
    const knowledge = await GamingKnowledge.create({
      question: question.trim(),
      answer: answer.trim(),
      topic,
      game,
      language,
      keywords: keywords.map(k => k.toLowerCase().trim()),
      tags: tags.map(t => t.toLowerCase().trim()),
      skillLevel,
      priority,
      source,
      createdBy: req.user?.id || 'system'
    });
    
    res.status(201).json({
      success: true,
      message: 'Knowledge added successfully',
      data: knowledge
    });
    
  } catch (error) {
    log.error('Add knowledge error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to add knowledge',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all knowledge (with filters)
 */
const getAllKnowledge = async (req, res) => {
  try {
    const {
      topic,
      game,
      language,
      skillLevel,
      isActive = true,
      page = 1,
      limit = 20,
      search
    } = req.query;
    
    const query = { isActive: isActive === 'true' };
    
    if (topic) query.topic = topic;
    if (game) query.game = game;
    if (language) query.language = language;
    if (skillLevel) query.skillLevel = skillLevel;
    if (search) {
      query.$or = [
        { question: { $regex: search, $options: 'i' } },
        { answer: { $regex: search, $options: 'i' } },
        { keywords: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const knowledge = await GamingKnowledge.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await GamingKnowledge.countDocuments(query);
    
    res.json({
      success: true,
      data: knowledge,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
    
  } catch (error) {
    log.error('Get knowledge error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to get knowledge',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get single knowledge item
 */
const getKnowledgeById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const knowledge = await GamingKnowledge.findById(id);
    
    if (!knowledge) {
      return res.status(404).json({
        success: false,
        message: 'Knowledge not found'
      });
    }
    
    res.json({
      success: true,
      data: knowledge
    });
    
  } catch (error) {
    log.error('Get knowledge by ID error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to get knowledge',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update knowledge
 */
const updateKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Whitelist fields to prevent NoSQL Mass Assignment / Injection
    const allowedUpdates = [
      'question', 'answer', 'topic', 'game', 'language',
      'keywords', 'tags', 'skillLevel', 'priority', 'source', 'isActive'
    ];
    
    const updateData = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });
    
    // Normalize keywords and tags if provided
    if (updateData.keywords) {
      updateData.keywords = updateData.keywords.map(k => k.toLowerCase().trim());
    }
    if (updateData.tags) {
      updateData.tags = updateData.tags.map(t => t.toLowerCase().trim());
    }
    
    const knowledge = await GamingKnowledge.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    
    if (!knowledge) {
      return res.status(404).json({
        success: false,
        message: 'Knowledge not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Knowledge updated successfully',
      data: knowledge
    });
    
  } catch (error) {
    log.error('Update knowledge error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to update knowledge',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Delete knowledge (soft delete)
 */
const deleteKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    
    const knowledge = await GamingKnowledge.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );
    
    if (!knowledge) {
      return res.status(404).json({
        success: false,
        message: 'Knowledge not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Knowledge deleted successfully'
    });
    
  } catch (error) {
    log.error('Delete knowledge error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to delete knowledge',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Test knowledge retrieval
 */
const testRetrieval = async (req, res) => {
  try {
    const { query, language = 'english', topic = null, game = null, limit = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Query is required'
      });
    }
    
    const knowledge = await retrieveKnowledge(query, language, topic, game, limit);
    const context = formatKnowledgeContext(knowledge, language);
    
    res.json({
      success: true,
      data: {
        query,
        language,
        topic,
        game,
        retrievedCount: knowledge.length,
        knowledge,
        formattedContext: context
      }
    });
    
  } catch (error) {
    log.error('Test retrieval error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to test retrieval',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get knowledge statistics
 */
const getStats = async (req, res) => {
  try {
    const stats = await getKnowledgeStats();
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    log.error('Get stats error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Bulk add knowledge
 */
const bulkAddKnowledge = async (req, res) => {
  try {
    const { knowledgeItems } = req.body;
    
    if (!Array.isArray(knowledgeItems) || knowledgeItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'knowledgeItems array is required'
      });
    }
    
    const results = {
      success: [],
      failed: []
    };
    
    for (const item of knowledgeItems) {
      try {
        if (!item.question || !item.answer) {
          results.failed.push({
            item,
            error: 'Question and answer are required'
          });
          continue;
        }
        
        const knowledge = await GamingKnowledge.create({
          question: item.question.trim(),
          answer: item.answer.trim(),
          topic: item.topic || 'general',
          game: item.game || 'general',
          language: item.language || 'english',
          keywords: (item.keywords || []).map(k => k.toLowerCase().trim()),
          tags: (item.tags || []).map(t => t.toLowerCase().trim()),
          skillLevel: item.skillLevel || 'all',
          priority: item.priority || 1,
          source: item.source || 'manual',
          createdBy: req.user?.id || 'system'
        });
        
        results.success.push(knowledge._id);
        
      } catch (error) {
        results.failed.push({
          item,
          error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
    
    res.json({
      success: true,
      message: `Added ${results.success.length} items, ${results.failed.length} failed`,
      data: results
    });
    
  } catch (error) {
    log.error('Bulk add error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to bulk add knowledge',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  addKnowledge,
  getAllKnowledge,
  getKnowledgeById,
  updateKnowledge,
  deleteKnowledge,
  testRetrieval,
  getStats,
  bulkAddKnowledge
};

