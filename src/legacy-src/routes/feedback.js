const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { submitFeedback, getAllFeedback, updateFeedbackStatus, deleteFeedback, getFeedbackStats } = require('../controllers/feedbackController');
const { requireAdmin } = require('../middleware/adminAuth');

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Public route - Submit feedback
router.post('/', [
  body('feedback')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Feedback must be between 10 and 2000 characters')
    .notEmpty()
    .withMessage('Feedback is required'),
  handleValidationErrors
], submitFeedback);

// Admin routes
router.get('/', requireAdmin, getAllFeedback);
router.get('/stats', requireAdmin, getFeedbackStats);
router.put('/:id/status', requireAdmin, [
  body('status')
    .isIn(['pending', 'reviewed', 'addressed'])
    .withMessage('Status must be pending, reviewed, or addressed'),
  body('adminNotes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Admin notes must be less than 500 characters'),
  handleValidationErrors
], updateFeedbackStatus);
router.delete('/:id', requireAdmin, deleteFeedback);

module.exports = router;
