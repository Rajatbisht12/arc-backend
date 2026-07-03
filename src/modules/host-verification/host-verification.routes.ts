import { Router } from "express";
import { body } from "express-validator";
import { handleValidationErrors, hostVerificationController, protect } from "./host-verification.legacy-adapters";

const router = Router();

// POST /api/host-verification/apply - Submit a new host verification application
router.post(
  "/apply",
  protect,
  body("fullName").isString().trim().isLength({ min: 1, max: 100 }).withMessage("Full name is required and cannot exceed 100 characters"),
  body("contactNumber").isString().trim().isLength({ min: 5, max: 20 }).withMessage("Contact number must be between 5 and 20 characters"),
  body("gamingExperience").isString().trim().isLength({ min: 1, max: 1000 }).withMessage("Gaming experience is required and cannot exceed 1000 characters"),
  body("reasonForHosting").isString().trim().isLength({ min: 1, max: 1000 }).withMessage("Reason for hosting is required and cannot exceed 1000 characters"),
  body("socialLinks").optional().isString().trim().isLength({ max: 500 }).withMessage("Social links cannot exceed 500 characters"),
  handleValidationErrors,
  hostVerificationController.applyForHostVerification
);

// GET /api/host-verification/status - Get current application status
router.get("/status", protect, hostVerificationController.getMyHostVerificationStatus);

export default router;
