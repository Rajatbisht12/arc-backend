import { Router } from "express";
import { body, param } from "express-validator";
import { handleValidationErrors, leaveRequestController, protect } from "./leave-requests.legacy-adapters";

const router = Router();

// Create leave request (staff member)
router.post(
  "/team/:teamId/leave-request",
  protect,
  param("teamId").isMongoId().withMessage("Invalid team ID"),
  body("reason").optional().isString().trim().isLength({ max: 1000 }).withMessage("Reason cannot exceed 1000 characters"),
  handleValidationErrors,
  leaveRequestController.createLeaveRequest
);

// Get leave requests for a team (admin only)
router.get(
  "/team/:teamId/leave-requests",
  protect,
  param("teamId").isMongoId().withMessage("Invalid team ID"),
  handleValidationErrors,
  leaveRequestController.getTeamLeaveRequests
);

// Get user's own leave requests
router.get("/user/leave-requests", protect, leaveRequestController.getUserLeaveRequests);

// Approve or reject leave request (admin only)
router.patch(
  "/team/:teamId/leave-request/:requestId",
  protect,
  param("teamId").isMongoId().withMessage("Invalid team ID"),
  param("requestId").isMongoId().withMessage("Invalid leave request ID"),
  body("action").isIn(["approve", "reject"]).withMessage("Action must be approve or reject"),
  body("adminResponse").optional().isString().isLength({ max: 1000 }).withMessage("Admin response cannot exceed 1000 characters"),
  handleValidationErrors,
  leaveRequestController.respondToLeaveRequest
);

// Cancel leave request (staff member only)
router.delete(
  "/team/:teamId/leave-request/:requestId",
  protect,
  param("teamId").isMongoId().withMessage("Invalid team ID"),
  param("requestId").isMongoId().withMessage("Invalid leave request ID"),
  handleValidationErrors,
  leaveRequestController.cancelLeaveRequest
);

export default router;
