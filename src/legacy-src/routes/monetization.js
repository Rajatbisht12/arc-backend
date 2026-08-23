const express = require('express');
const { protect } = require('../middleware/auth');
const {
  assertPlayer,
  assertApprovedCreator,
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
router.get('/dashboard', assertApprovedCreator, getDashboard);
router.get('/earnings', assertApprovedCreator, getEarnings);
router.get('/payout-history', assertApprovedCreator, getPayoutHistory);
router.get('/bank-details', assertApprovedCreator, getBankDetails);
router.put('/bank-details', assertApprovedCreator, upsertBankDetails);
router.delete('/bank-details/tax-id', assertApprovedCreator, deleteBankTaxId);
router.delete('/bank-details', assertApprovedCreator, deleteBankDetails);
router.get('/status', getMonetizationStatus);
router.post('/withdrawal-request', assertApprovedCreator, submitWithdrawalRequest);

module.exports = router;
