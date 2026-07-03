const express = require('express');
const rateLimit = require('express-rate-limit').default || require('express-rate-limit');
const router = express.Router();
const { body, param } = require('express-validator');
const { protect } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const {
  generateCallToken,
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,
  generateGroupCallToken
} = require('../controllers/callController');
const {
  getPendingCall,
  getCallSession,
  acceptCallSession,
  declineCallSession,
  endCallSession
} = require('../controllers/callSessionController');

const callInitiationLimiter = rateLimit({
  windowMs: 60_000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || 'authenticated'),
  message: { success: false, message: 'Too many call attempts. Try again shortly.' }
});

// Generate a general ZegoCloud token (for manual room joining)
const callIdBody = () => body('roomId')
  .isString()
  .matches(/^[A-Za-z0-9:_-]{8,160}$/)
  .withMessage('Valid roomId is required');
const callIdParam = () => param('callId')
  .matches(/^[A-Za-z0-9:_-]{8,160}$/)
  .withMessage('Valid callId is required');

router.post('/token', protect, callIdBody(), handleValidationErrors, generateCallToken);

// 1:1 Call flow
router.post(
  '/initiate',
  protect,
  callInitiationLimiter,
  body('targetUserId').isString().isMongoId().withMessage('Valid targetUserId is required'),
  body('callType').isIn(['voice', 'video']).withMessage('Invalid callType'),
  handleValidationErrors,
  initiateCall
);
router.post(
  '/accept',
  protect,
  callIdBody(),
  body('callerId').isString().isMongoId().withMessage('Valid callerId is required'),
  handleValidationErrors,
  acceptCall
);
router.post(
  '/reject',
  protect,
  callIdBody(),
  body('callerId').isString().isMongoId().withMessage('Valid callerId is required'),
  handleValidationErrors,
  rejectCall
);
router.post(
  '/end',
  protect,
  callIdBody(),
  body('callType').optional().isIn(['voice', 'video']).withMessage('Invalid callType'),
  body('outcome').optional().isIn(['answered', 'missed', 'declined']).withMessage('Invalid call outcome'),
  body('durationSeconds').optional().isInt({ min: 0, max: 86400 }).withMessage('Invalid call duration'),
  body('participantId').optional().isString().isMongoId().withMessage('Invalid participantId'),
  handleValidationErrors,
  endCall
);

// Durable call state used by killed-app notification actions and multi-device
// reconciliation. These routes do not expose media credentials.
router.get('/sessions/pending', protect, getPendingCall);
router.get('/sessions/:callId', protect, callIdParam(), handleValidationErrors, getCallSession);
router.post('/sessions/:callId/accept', protect, callIdParam(), handleValidationErrors, acceptCallSession);
router.post('/sessions/:callId/decline', protect, callIdParam(), handleValidationErrors, declineCallSession);
router.post('/sessions/:callId/end', protect, callIdParam(), handleValidationErrors, endCallSession);

// Group call token
router.post(
  '/group-token',
  protect,
  body('chatRoomId').isString().isMongoId().withMessage('Valid chatRoomId is required'),
  handleValidationErrors,
  generateGroupCallToken
);

module.exports = router;
