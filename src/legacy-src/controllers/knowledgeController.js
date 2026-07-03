const GamingKnowledge = require('../models/GamingKnowledge');
const mongoose = require('mongoose');
const { retrieveKnowledge, formatKnowledgeContext, getKnowledgeStats } = require('../utils/knowledgeRetrieval');
const log = require('../utils/logger');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const boundedInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};
const invalidKnowledgeId = (id) => !mongoose.isValidObjectId(id);
const normalizeStringList = (value, maximumItems = 50) => {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 100) return null;
    const trimmed = item.toLowerCase().trim();
    if (trimmed) normalized.push(trimmed);
  }
  return normalized;
};

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
    if (typeof question !== 'string' || !question.trim() || question.length > 500
      || typeof answer !== 'string' || !answer.trim() || answer.length > 10_000) {
      return res.status(400).json({
        success: false,
        message: 'Question and answer are required and must be within the allowed length'
      });
    }
    const normalizedKeywords = normalizeStringList(keywords);
    const normalizedTags = normalizeStringList(tags);
    if (!normalizedKeywords || !normalizedTags) {
      return res.status(400).json({ success: false, message: 'Keywords and tags must be bounded string arrays' });
    }
    
    // Check if similar knowledge already exists
    const existing = await GamingKnowledge.findOne({
      question: { $regex: new RegExp(`^${escapeRegex(question.trim())}$`, 'i') },
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
      keywords: normalizedKeywords,
      tags: normalizedTags,
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
    
    if (!['true', 'false'].includes(String(isActive))) {
      return res.status(400).json({ success: false, message: 'isActive must be true or false' });
    }
    const normalizedPage = boundedInteger(page, 1, 10_000);
    const normalizedLimit = boundedInteger(limit, 20, 100);
    const query = { isActive: String(isActive) === 'true' };
    
    if (topic) query.topic = topic;
    if (game) query.game = game;
    if (language) query.language = language;
    if (skillLevel) query.skillLevel = skillLevel;
    if (search) {
      if (typeof search !== 'string' || search.length > 200) {
        return res.status(400).json({ success: false, message: 'Search must be at most 200 characters' });
      }
      const safeSearch = escapeRegex(search.trim());
      query.$or = [
        { question: { $regex: safeSearch, $options: 'i' } },
        { answer: { $regex: safeSearch, $options: 'i' } },
        { keywords: { $in: [new RegExp(safeSearch, 'i')] } }
      ];
    }

    const skip = (normalizedPage - 1) * normalizedLimit;
    
    const knowledge = await GamingKnowledge.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit);
    
    const total = await GamingKnowledge.countDocuments(query);
    
    res.json({
      success: true,
      data: knowledge,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        pages: Math.ceil(total / normalizedLimit)
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

    if (invalidKnowledgeId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid knowledge ID' });
    }
    
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

    if (invalidKnowledgeId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid knowledge ID' });
    }
    
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
    if (updateData.question !== undefined
      && (typeof updateData.question !== 'string' || !updateData.question.trim() || updateData.question.length > 500)) {
      return res.status(400).json({ success: false, message: 'Invalid question' });
    }
    if (updateData.answer !== undefined
      && (typeof updateData.answer !== 'string' || !updateData.answer.trim() || updateData.answer.length > 10_000)) {
      return res.status(400).json({ success: false, message: 'Invalid answer' });
    }
    if (updateData.keywords !== undefined) {
      updateData.keywords = normalizeStringList(updateData.keywords);
      if (!updateData.keywords) {
        return res.status(400).json({ success: false, message: 'Keywords must be a bounded string array' });
      }
    }
    if (updateData.tags !== undefined) {
      updateData.tags = normalizeStringList(updateData.tags);
      if (!updateData.tags) {
        return res.status(400).json({ success: false, message: 'Tags must be a bounded string array' });
      }
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

    if (invalidKnowledgeId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid knowledge ID' });
    }
    
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

    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Query is required'
      });
    }
    if (query.length > 500) {
      return res.status(400).json({ success: false, message: 'Query must be at most 500 characters' });
    }
    const normalizedLimit = boundedInteger(limit, 5, 20);

    const knowledge = await retrieveKnowledge(query.trim(), language, topic, game, normalizedLimit);
    const context = formatKnowledgeContext(knowledge, language);
    
    res.json({
      success: true,
      data: {
        query: query.trim(),
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
    
    if (!Array.isArray(knowledgeItems) || knowledgeItems.length === 0 || knowledgeItems.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'knowledgeItems must contain between 1 and 100 items'
      });
    }
    
    const results = {
      success: [],
      failed: []
    };
    
    for (const item of knowledgeItems) {
      try {
        if (!item || typeof item !== 'object'
          || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 500
          || typeof item.answer !== 'string' || !item.answer.trim() || item.answer.length > 10_000) {
          results.failed.push({
            item,
            error: 'Question and answer are required and must be within the allowed length'
          });
          continue;
        }
        const normalizedKeywords = normalizeStringList(item.keywords || []);
        const normalizedTags = normalizeStringList(item.tags || []);
        if (!normalizedKeywords || !normalizedTags) {
          results.failed.push({ item, error: 'Keywords and tags must be bounded string arrays' });
          continue;
        }
        
        const knowledge = await GamingKnowledge.create({
          question: item.question.trim(),
          answer: item.answer.trim(),
          topic: item.topic || 'general',
          game: item.game || 'general',
          language: item.language || 'english',
          keywords: normalizedKeywords,
          tags: normalizedTags,
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

