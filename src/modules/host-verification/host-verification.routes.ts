import { Router } from "express";
import { hostVerificationController, protect } from "./host-verification.legacy-adapters";

const router = Router();

// POST /api/host-verification/apply - Submit a new host verification application
router.post("/apply", protect, hostVerificationController.applyForHostVerification);

// GET /api/host-verification/status - Get current application status
router.get("/status", protect, hostVerificationController.getMyHostVerificationStatus);

export default router;
