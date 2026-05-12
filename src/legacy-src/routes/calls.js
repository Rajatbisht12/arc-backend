const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  generateCallToken,
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,
  generateGroupCallToken
} = require('../controllers/callController');

// Generate a general ZegoCloud token (for manual room joining)
router.post('/token', protect, generateCallToken);

// 1:1 Call flow
router.post('/initiate', protect, initiateCall);
router.post('/accept', protect, acceptCall);
router.post('/reject', protect, rejectCall);
router.post('/end', protect, endCall);

// Group call token
router.post('/group-token', protect, generateGroupCallToken);

module.exports = router;
