const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  joinQueue,
  leaveQueue,
  getCurrentConnection,
  disconnectConnection,
  cleanupCurrentConnection
} = require('../controllers/randomConnectionControllerNew');

// All routes require authentication
router.use(protect);

// Join the random connection queue
router.post('/join-queue', joinQueue);

// Leave the queue
router.delete('/leave-queue', leaveQueue);

// Get current connection
router.get('/current-connection', getCurrentConnection);

// Disconnect from current connection
router.post('/disconnect', disconnectConnection);

// Cleanup current connection (used on page refresh/navigation)
router.post('/cleanup-current', cleanupCurrentConnection);

module.exports = router;
