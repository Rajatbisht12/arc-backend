const express = require('express');
const { requireAdminWithAuth, requireSuperAdmin, requireAdminPermission, auditLog } = require('../middleware/adminAuth');
const { 
  getDashboardStats, 
  getUserAnalytics, 
  getSystemHealth, 
  getRecentActivities,
  getUsers,
  updateUserStatus,
  deleteUser,
  getPosts,
  deletePost,
  getTournaments,
  deleteTournament,
  resetUserPassword,
  getReports,
  updateReport,
  getMonetizationSummary,
  getMonetizationApplications,
  approveMonetizationApplication,
  rejectMonetizationApplication,
  holdCreatorPayout,
  getCreatorAnalytics,
  getCreatorBankDetailsForAdmin,
  getApprovedCreators,
  revokeMonetization,
  grantMonetization,
  suspendMonetization,
  resumeMonetization,
  disableMonetization,
  setCreatorCpm,
  getCreatorCpm,
  listWithdrawalRequests,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
  listCreatorPayouts,
  approveCreatorPayout,
  markCreatorPayoutProcessing,
  markCreatorPayoutPaid,
  rejectCreatorPayout,
  cancelCreatorPayout,
  exportCreatorPayoutsCsv,
  exportCreatorsCsv,
  getHostVerificationApplications,
  approveHostVerificationApplication,
  rejectHostVerificationApplication,
  getVerifiedHosts,
  revokeHostVerification
} = require('../controllers/adminController');

const router = express.Router();

// All admin routes require authentication and admin role
router.use(requireAdminWithAuth);

// Dashboard routes
router.get('/dashboard', auditLog('VIEW_DASHBOARD'), getDashboardStats);
router.get('/analytics/users', auditLog('VIEW_USER_ANALYTICS'), getUserAnalytics);
router.get('/health', auditLog('VIEW_SYSTEM_HEALTH'), getSystemHealth);
router.get('/activities', auditLog('VIEW_RECENT_ACTIVITIES'), getRecentActivities);

// User management routes
router.get('/users', auditLog('VIEW_USERS'), getUsers);
router.put('/users/:userId/status', auditLog('UPDATE_USER_STATUS'), updateUserStatus);
router.put('/users/:userId/reset-password', auditLog('RESET_USER_PASSWORD'), resetUserPassword);
router.delete('/users/:userId', auditLog('DELETE_USER'), requireSuperAdmin, deleteUser);

// Post management routes
router.get('/posts', auditLog('VIEW_POSTS'), getPosts);
router.delete('/posts/:postId', auditLog('DELETE_POST'), deletePost);

// Tournament management routes
router.get('/tournaments', auditLog('VIEW_TOURNAMENTS'), getTournaments);
router.delete('/tournaments/:tournamentId', auditLog('DELETE_TOURNAMENT'), deleteTournament);

// Report management routes
router.get('/reports', auditLog('VIEW_REPORTS'), getReports);
router.put('/reports/:reportId', auditLog('UPDATE_REPORT'), updateReport);

// Monetization (creator applications)
router.get('/monetization/summary', auditLog('VIEW_MONETIZATION_SUMMARY'), requireAdminPermission('monetization:manage'), getMonetizationSummary);
router.get('/monetization/applications', auditLog('VIEW_MONETIZATION_APPLICATIONS'), requireAdminPermission('monetization:manage'), getMonetizationApplications);
router.post('/monetization/applications/:applicationId/approve', auditLog('APPROVE_MONETIZATION'), requireSuperAdmin, approveMonetizationApplication);
router.post('/monetization/applications/:applicationId/reject', auditLog('REJECT_MONETIZATION'), requireSuperAdmin, rejectMonetizationApplication);
router.post('/monetization/payout-hold/:userId', auditLog('HOLD_CREATOR_PAYOUT'), requireSuperAdmin, holdCreatorPayout);

// Creator management
router.get('/monetization/creators/export.csv', auditLog('EXPORT_CREATORS'), requireAdminPermission('monetization:manage'), exportCreatorsCsv);
router.get('/monetization/creators/:userId/bank-details', auditLog('VIEW_CREATOR_BANK_DETAILS'), requireSuperAdmin, getCreatorBankDetailsForAdmin);
router.get('/monetization/creators/:userId/analytics', auditLog('VIEW_CREATOR_ANALYTICS'), requireAdminPermission('monetization:manage'), getCreatorAnalytics);
router.get('/monetization/creators', auditLog('VIEW_CREATORS'), requireAdminPermission('monetization:manage'), getApprovedCreators);
router.post('/monetization/revoke/:userId', auditLog('REVOKE_MONETIZATION'), requireSuperAdmin, revokeMonetization);
router.post('/monetization/grant/:userId', auditLog('GRANT_MONETIZATION'), requireSuperAdmin, grantMonetization);
router.post('/monetization/suspend/:userId', auditLog('SUSPEND_MONETIZATION'), requireSuperAdmin, suspendMonetization);
router.post('/monetization/resume/:userId', auditLog('RESUME_MONETIZATION'), requireSuperAdmin, resumeMonetization);
router.post('/monetization/disable/:userId', auditLog('DISABLE_MONETIZATION'), requireSuperAdmin, disableMonetization);

// Per-creator CPM
router.put('/monetization/cpm/:userId', auditLog('SET_CREATOR_CPM'), requireSuperAdmin, setCreatorCpm);
router.get('/monetization/cpm/:userId', auditLog('VIEW_CREATOR_CPM'), requireAdminPermission('monetization:manage'), getCreatorCpm);

// Withdrawal requests
router.get('/monetization/withdrawal-requests', auditLog('VIEW_WITHDRAWALS'), requireAdminPermission('monetization:manage'), listWithdrawalRequests);
router.post('/monetization/withdrawal-requests/:id/approve', auditLog('APPROVE_WITHDRAWAL'), requireSuperAdmin, approveWithdrawalRequest);
router.post('/monetization/withdrawal-requests/:id/reject', auditLog('REJECT_WITHDRAWAL'), requireSuperAdmin, rejectWithdrawalRequest);

// Creator payouts
router.get('/monetization/payouts/export.csv', auditLog('EXPORT_CREATOR_PAYOUTS'), requireAdminPermission('monetization:manage'), exportCreatorPayoutsCsv);
router.get('/monetization/payouts', auditLog('VIEW_CREATOR_PAYOUTS'), requireAdminPermission('monetization:manage'), listCreatorPayouts);
router.post('/monetization/payouts/:id/approve', auditLog('APPROVE_CREATOR_PAYOUT'), requireSuperAdmin, approveCreatorPayout);
router.post('/monetization/payouts/:id/processing', auditLog('PROCESS_CREATOR_PAYOUT'), requireSuperAdmin, markCreatorPayoutProcessing);
router.post('/monetization/payouts/:id/paid', auditLog('MARK_CREATOR_PAYOUT_PAID'), requireSuperAdmin, markCreatorPayoutPaid);
router.post('/monetization/payouts/:id/reject', auditLog('REJECT_CREATOR_PAYOUT'), requireSuperAdmin, rejectCreatorPayout);
router.post('/monetization/payouts/:id/cancel', auditLog('CANCEL_CREATOR_PAYOUT'), requireSuperAdmin, cancelCreatorPayout);

// Host verification applications
router.get('/host-verification/applications', auditLog('VIEW_HOST_VERIFICATION_APPLICATIONS'), getHostVerificationApplications);
router.post('/host-verification/applications/:id/approve', auditLog('APPROVE_HOST_VERIFICATION_APPLICATION'), approveHostVerificationApplication);
router.post('/host-verification/applications/:id/reject', auditLog('REJECT_HOST_VERIFICATION_APPLICATION'), rejectHostVerificationApplication);
router.get('/host-verification/verified-hosts', auditLog('VIEW_VERIFIED_HOSTS'), getVerifiedHosts);
router.post('/host-verification/revoke/:userId', auditLog('REVOKE_HOST_VERIFICATION'), revokeHostVerification);

// Add X-Robots-Tag header to prevent indexing
router.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

module.exports = router;
