const express = require('express');
const { protect } = require('../middleware/auth');
const {
  assertPlayer,
  getEligibility,
  getApplication,
  applyForMonetization,
  withdrawApplication,
  getApplicationHistory,
  getDashboard,
  getEarnings,
  getPayoutHistory,
  getBankDetails,
  upsertBankDetails,
  deleteBankDetails,
  deleteBankTaxId,
  getMonetizationStatus,
  submitWithdrawalRequest
} = require('../controllers/monetizationController');

const router = express.Router();

router.use(protect);
router.use(assertPlayer);

router.get('/eligibility', getEligibility);
router.get('/application', getApplication);
router.get('/application/history', getApplicationHistory);
router.post('/apply', applyForMonetization);
router.post('/application/withdraw', withdrawApplication);
router.get('/dashboard', getDashboard);
router.get('/earnings', getEarnings);
router.get('/payout-history', getPayoutHistory);
router.get('/bank-details', getBankDetails);
router.put('/bank-details', upsertBankDetails);
router.delete('/bank-details/tax-id', deleteBankTaxId);
router.delete('/bank-details', deleteBankDetails);
router.get('/status', getMonetizationStatus);
router.post('/withdrawal-request', protect, assertPlayer, submitWithdrawalRequest);

module.exports = router;
