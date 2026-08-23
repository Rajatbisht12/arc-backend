import { Router } from "express";
import { monetizationController, protect } from "./monetization.legacy-adapters";

const router = Router();

router.use(protect);
router.use(monetizationController.assertPlayer);

router.get("/eligibility", monetizationController.getEligibility);
router.get("/application", monetizationController.getApplication);
router.get("/application/history", monetizationController.getApplicationHistory);
router.post("/apply", monetizationController.applyForMonetization);
router.post("/application/withdraw", monetizationController.withdrawApplication);
router.get("/dashboard", monetizationController.assertApprovedCreator, monetizationController.getDashboard);
router.get("/earnings", monetizationController.assertApprovedCreator, monetizationController.getEarnings);
router.get("/payout-history", monetizationController.assertApprovedCreator, monetizationController.getPayoutHistory);
router.get("/bank-details", monetizationController.assertApprovedCreator, monetizationController.getBankDetails);
router.put("/bank-details", monetizationController.assertApprovedCreator, monetizationController.upsertBankDetails);
router.delete("/bank-details/tax-id", monetizationController.assertApprovedCreator, monetizationController.deleteBankTaxId);
router.delete("/bank-details", monetizationController.assertApprovedCreator, monetizationController.deleteBankDetails);
router.get("/status", monetizationController.getMonetizationStatus);
router.post("/withdrawal-request", monetizationController.assertApprovedCreator, monetizationController.submitWithdrawalRequest);

export default router;
