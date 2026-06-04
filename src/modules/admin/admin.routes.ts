import { Router } from "express";
import { adminController, auditLog, requireSuperAdmin } from "./admin.legacy-adapters";
import { requireHardcodedAdminAuth } from "./admin-auth.middleware";

const router = Router();

// All admin routes are protected by the hardcoded-admin JWT check
router.use(requireHardcodedAdminAuth);

router.get("/dashboard", auditLog("VIEW_DASHBOARD"), adminController.getDashboardStats);
router.get("/analytics/users", auditLog("VIEW_USER_ANALYTICS"), adminController.getUserAnalytics);
router.get("/health", auditLog("VIEW_SYSTEM_HEALTH"), adminController.getSystemHealth);
router.get("/activities", auditLog("VIEW_RECENT_ACTIVITIES"), adminController.getRecentActivities);
router.get("/users", auditLog("VIEW_USERS"), adminController.getUsers);
router.put("/users/:userId/status", auditLog("UPDATE_USER_STATUS"), adminController.updateUserStatus);
router.put("/users/:userId/reset-password", auditLog("RESET_USER_PASSWORD"), adminController.resetUserPassword);
router.delete("/users/:userId", auditLog("DELETE_USER"), requireSuperAdmin, adminController.deleteUser);
router.get("/posts", auditLog("VIEW_POSTS"), adminController.getPosts);
router.delete("/posts/:postId", auditLog("DELETE_POST"), adminController.deletePost);
router.get("/tournaments", auditLog("VIEW_TOURNAMENTS"), adminController.getTournaments);
router.delete("/tournaments/:tournamentId", auditLog("DELETE_TOURNAMENT"), adminController.deleteTournament);
router.get("/reports", auditLog("VIEW_REPORTS"), adminController.getReports);
router.put("/reports/:reportId", auditLog("UPDATE_REPORT"), adminController.updateReport);
router.get("/monetization/applications", auditLog("VIEW_MONETIZATION_APPLICATIONS"), adminController.getMonetizationApplications);
router.post("/monetization/applications/:applicationId/approve", auditLog("APPROVE_MONETIZATION"), adminController.approveMonetizationApplication);
router.post("/monetization/applications/:applicationId/reject", auditLog("REJECT_MONETIZATION"), adminController.rejectMonetizationApplication);
router.post("/monetization/payout-hold/:userId", auditLog("HOLD_CREATOR_PAYOUT"), adminController.holdCreatorPayout);
router.get("/monetization/creators", adminController.getApprovedCreators);
router.post("/monetization/revoke/:userId", adminController.revokeMonetization);
router.post("/monetization/grant/:userId", adminController.grantMonetization);
router.put("/monetization/cpm/:userId", adminController.setCreatorCpm);
router.get("/monetization/cpm/:userId", adminController.getCreatorCpm);
router.get("/monetization/withdrawal-requests", adminController.listWithdrawalRequests);
router.post("/monetization/withdrawal-requests/:id/approve", adminController.approveWithdrawalRequest);
router.post("/monetization/withdrawal-requests/:id/reject", adminController.rejectWithdrawalRequest);
router.get("/host-verification/applications", auditLog("VIEW_HOST_VERIFICATION_APPLICATIONS"), adminController.getHostVerificationApplications);
router.post(
  "/host-verification/applications/:id/approve",
  auditLog("APPROVE_HOST_VERIFICATION_APPLICATION"),
  adminController.approveHostVerificationApplication
);
router.post(
  "/host-verification/applications/:id/reject",
  auditLog("REJECT_HOST_VERIFICATION_APPLICATION"),
  adminController.rejectHostVerificationApplication
);
router.get("/host-verification/verified-hosts", auditLog("VIEW_VERIFIED_HOSTS"), adminController.getVerifiedHosts);
router.post("/host-verification/revoke/:userId", auditLog("REVOKE_HOST_VERIFICATION"), adminController.revokeHostVerification);

router.use((_, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

export default router;
