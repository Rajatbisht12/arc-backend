const express = require('express');
const { protect } = require('../middleware/auth');
const { 
  createOrder, 
  verifyPayment, 
  createTournamentOrder, 
  verifyTournamentPayment,
  createBoostOrder,
  verifyBoostPayment
} = require('../controllers/paymentController');

const router = express.Router();

// Subscription payment routes
router.post('/subscription/create-order', protect, createOrder);
router.post('/subscription/verify', protect, verifyPayment);

// Tournament payment routes  
router.post('/tournament/create-order', protect, createTournamentOrder);
router.post('/tournament/verify', protect, verifyTournamentPayment);

// Boost payment routes
router.post('/boost/create-order', protect, createBoostOrder);
router.post('/boost/verify', protect, verifyBoostPayment);

module.exports = router;
