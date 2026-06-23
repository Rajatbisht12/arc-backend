const express = require('express');
const { protect } = require('../middleware/auth');
const {
  applyForHostVerification,
  getMyHostVerificationStatus
} = require('../controllers/hostVerificationController');

const router = express.Router();

// POST /api/host-verification/apply - Submit a new host verification application
router.post('/apply', protect, applyForHostVerification);

// GET /api/host-verification/status - Get current application status
router.get('/status', protect, getMyHostVerificationStatus);

module.exports = router;