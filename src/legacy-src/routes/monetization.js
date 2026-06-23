const express = require('express');
const { protect } = require('../middleware/auth');
const {
  assertPlayer,
  getEligibility,
  getApplication,
  applyForMonetization,
  getDashboard,
  getBankDetails,
  upsertBankDetails,
  getMonetizationStatus,
  submitWithdrawalRequest
} = require('../controllers/monetizationController');

const router = express.Router();

router.use(protect);
router.use(assertPlayer);

router.get('/eligibility', getEligibility);
router.get('/application', getApplication);
router.post('/apply', applyForMonetization);
router.get('/dashboard', getDashboard);
router.get('/bank-details', getBankDetails);
router.put('/bank-details', upsertBankDetails);
router.get('/status', getMonetizationStatus);
router.post('/withdrawal-request', protect, assertPlayer, submitWithdrawalRequest);

module.exports = router;
