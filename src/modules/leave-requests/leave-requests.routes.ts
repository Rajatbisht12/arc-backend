import { Router } from "express";
import { leaveRequestController, protect } from "./leave-requests.legacy-adapters";

const router = Router();

// Create leave request (staff member)
router.post("/team/:teamId/leave-request", protect, leaveRequestController.createLeaveRequest);

// Get leave requests for a team (admin only)
router.get("/team/:teamId/leave-requests", protect, leaveRequestController.getTeamLeaveRequests);

// Get user's own leave requests
router.get("/user/leave-requests", protect, leaveRequestController.getUserLeaveRequests);

// Approve or reject leave request (admin only)
router.patch("/team/:teamId/leave-request/:requestId", protect, leaveRequestController.respondToLeaveRequest);

// Cancel leave request (staff member only)
router.delete("/team/:teamId/leave-request/:requestId", protect, leaveRequestController.cancelLeaveRequest);

export default router;
