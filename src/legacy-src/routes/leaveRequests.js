const express = require('express');
const { protect } = require('../middleware/auth');
const {
  createLeaveRequest,
  getTeamLeaveRequests,
  getUserLeaveRequests,
  respondToLeaveRequest,
  cancelLeaveRequest
} = require('../controllers/leaveRequestController');

const router = express.Router();

// Create leave request (staff member)
router.post('/team/:teamId/leave-request', protect, createLeaveRequest);

// Get leave requests for a team (admin only)
router.get('/team/:teamId/leave-requests', protect, getTeamLeaveRequests);

// Get user's own leave requests
router.get('/user/leave-requests', protect, getUserLeaveRequests);

// Approve or reject leave request (admin only)
router.patch('/team/:teamId/leave-request/:requestId', protect, respondToLeaveRequest);

// Cancel leave request (staff member only)
router.delete('/team/:teamId/leave-request/:requestId', protect, cancelLeaveRequest);

module.exports = router;
