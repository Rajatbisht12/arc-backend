import { Router, Request, Response, NextFunction } from "express";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import { feedbackController } from "./feedback.legacy-adapters";
import { requireHardcodedAdminAuth } from "../admin/admin-auth.middleware";

const router = Router();
const feedbackSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many feedback submissions. Try again later." }
});

// Validation middleware
const handleValidationErrors = (req: Request, res: Response, next: NextFunction): Response | void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((error) => ({ field: error.type === "field" ? error.path : "request", message: error.msg }))
    });
  }
  next();
};

// Public route - Submit feedback
router.post("/", feedbackSubmissionLimiter, [
  body("feedback")
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage("Feedback must be between 10 and 2000 characters")
    .notEmpty()
    .withMessage("Feedback is required"),
  handleValidationErrors
], feedbackController.submitFeedback);

// Admin routes
router.get("/", requireHardcodedAdminAuth, feedbackController.getAllFeedback);
router.get("/stats", requireHardcodedAdminAuth, feedbackController.getFeedbackStats);
router.put("/:id/status", requireHardcodedAdminAuth, [
  body("status")
    .isIn(["pending", "reviewed", "addressed"])
    .withMessage("Status must be pending, reviewed, or addressed"),
  body("adminNotes")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Admin notes must be less than 500 characters"),
  handleValidationErrors
], feedbackController.updateFeedbackStatus);
router.delete("/:id", requireHardcodedAdminAuth, feedbackController.deleteFeedback);

export default router;
