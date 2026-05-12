const express = require('express');
const router = express.Router();
const {
  matchPlayersToTeam,
  analyzeApplication,
  generateRecruitmentPost,
  generateInterviewQuestions,
  rankCandidates,
  smartSearch
} = require('../controllers/aiRecruitmentController');
const { protect } = require('../middleware/auth');
const { aiCoachLimiter } = require('../middleware/rateLimiter');

// All routes require authentication
router.use(protect);

// Smart search for candidates based on natural language
router.post('/smart-search', aiCoachLimiter, smartSearch);

// Match players to team requirements
router.post('/match-players', aiCoachLimiter, matchPlayersToTeam);

// Analyze a player application
router.post('/analyze-application', aiCoachLimiter, analyzeApplication);

// Generate recruitment post content
router.post('/generate-post', aiCoachLimiter, generateRecruitmentPost);

// Generate interview questions
router.post('/generate-questions', aiCoachLimiter, generateInterviewQuestions);

// Rank candidates for a recruitment post
router.post('/rank-candidates', aiCoachLimiter, rankCandidates);

module.exports = router;

