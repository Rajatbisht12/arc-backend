const express = require('express');
const { protect } = require('../middleware/auth');
const { getMembership, getPlans } = require('../controllers/membershipController');
const { createOrder, verifyPayment } = require('../controllers/paymentController');

const router = express.Router();

router.get('/plans', getPlans);       // public – list all plans
router.get('/', protect, getMembership);
router.post('/payment/create-order', protect, createOrder);
router.post('/payment/verify', protect, verifyPayment);

module.exports = router;
