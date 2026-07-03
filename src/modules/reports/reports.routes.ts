import { Router } from "express";
import { body } from "express-validator";
import { handleValidationErrors, reportController, protect } from "./reports.legacy-adapters";

const router = Router();

router.post(
  "/",
  protect,
  body("targetType")
    .isIn(["post", "recruitment", "user", "comment"])
    .withMessage("Invalid targetType"),
  body("targetId").isString().isMongoId().withMessage("Valid targetId is required"),
  body("reason")
    .optional()
    .isIn(["spam", "harassment", "hate_speech", "violence", "nudity", "misinformation", "copyright", "other"])
    .withMessage("Invalid report reason"),
  body("details").optional().isString().isLength({ max: 500 }).withMessage("Report details cannot exceed 500 characters"),
  handleValidationErrors,
  reportController.createReport
);

export default router;
