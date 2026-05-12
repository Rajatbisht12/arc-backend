import { Router, Request, Response, NextFunction } from "express";
import { body, validationResult } from "express-validator";
import { feedbackController, requireAdmin } from "./feedback.legacy-adapters";

const router = Router();

// Validation middleware
const handleValidationErrors = (req: Request, res: Response, next: NextFunction): Response | void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array()
    });
  }
  next();
};

// Public route - Submit feedback
router.post("/", [
  body("feedback")
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage("Feedback must be between 10 and 2000 characters")
    .notEmpty()
    .withMessage("Feedback is required"),
  handleValidationErrors
], feedbackController.submitFeedback);

// Admin routes
router.get("/", requireAdmin, feedbackController.getAllFeedback);
router.get("/stats", requireAdmin, feedbackController.getFeedbackStats);
router.put("/:id/status", requireAdmin, [
  body("status")
    .isIn(["pending", "reviewed", "addressed"])
    .withMessage("Status must be pending, reviewed, or addressed"),
  body("adminNotes")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Admin notes must be less than 500 characters"),
  handleValidationErrors
], feedbackController.updateFeedbackStatus);
router.delete("/:id", requireAdmin, feedbackController.deleteFeedback);

export default router;
