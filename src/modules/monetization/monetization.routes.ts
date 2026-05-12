import { Router } from "express";
import { monetizationController, protect } from "./monetization.legacy-adapters";

const router = Router();

router.use(protect);
router.use(monetizationController.assertPlayer);

router.get("/eligibility", monetizationController.getEligibility);
router.get("/application", monetizationController.getApplication);
router.post("/apply", monetizationController.applyForMonetization);
router.get("/dashboard", monetizationController.getDashboard);
router.get("/bank-details", monetizationController.getBankDetails);
router.put("/bank-details", monetizationController.upsertBankDetails);
router.get("/status", monetizationController.getMonetizationStatus);
router.post("/withdrawal-request", protect, monetizationController.assertPlayer, monetizationController.submitWithdrawalRequest);

export default router;
