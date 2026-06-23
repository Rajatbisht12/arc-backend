const express = require('express');
const router = express.Router();
const { 
  chatWithAI, 
  getMultipleResponses, 
  getAIStatus, 
  getPersonalizedSuggestions, 
  rateResponse, 
  getAnalytics,
  getConversationHistory,
  renameConversation,
  deleteConversation,
  getCacheStatistics,
  analyzeGameplay
} = require('../controllers/aiCoachController');
const { protect } = require('../middleware/auth');
const { aiCoachLimiter, analyticsLimiter } = require('../middleware/rateLimiter');
const { uploadSingle } = require('../middleware/upload');

// Chat with AI Coach (single AI) - with rate limiting
router.post('/chat', protect, aiCoachLimiter, chatWithAI);

// Get multiple AI responses (for comparison) - with stricter rate limiting
router.post('/multiple', protect, aiCoachLimiter, getMultipleResponses);

// Get AI status and health
router.get('/status', protect, getAIStatus);

// Get personalized suggestions
router.get('/suggestions', protect, getPersonalizedSuggestions);

// Rate AI response
router.post('/rate', protect, rateResponse);

// Get AI Coach analytics - with rate limiting
router.get('/analytics', protect, analyticsLimiter, getAnalytics);

// Get conversation history
router.get('/conversation/:conversationId', protect, getConversationHistory);
router.put('/conversation/:conversationId/rename', protect, renameConversation);
router.delete('/conversation/:conversationId', protect, deleteConversation);

// Get cache statistics
router.get('/cache/stats', protect, getCacheStatistics);

// Analyze gameplay image/video - with file upload
router.post('/analyze', protect, aiCoachLimiter, uploadSingle('media'), analyzeGameplay);

module.exports = router;
