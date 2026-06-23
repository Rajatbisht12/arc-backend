const express = require('express');
const { requireAdminWithAuth, requireSuperAdmin, auditLog } = require('../middleware/adminAuth');
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
  getMonetizationApplications,
  approveMonetizationApplication,
  rejectMonetizationApplication,
  holdCreatorPayout,
  getApprovedCreators,
  revokeMonetization,
  grantMonetization,
  setCreatorCpm,
  getCreatorCpm,
  listWithdrawalRequests,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
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
router.get('/monetization/applications', auditLog('VIEW_MONETIZATION_APPLICATIONS'), getMonetizationApplications);
router.post('/monetization/applications/:applicationId/approve', auditLog('APPROVE_MONETIZATION'), approveMonetizationApplication);
router.post('/monetization/applications/:applicationId/reject', auditLog('REJECT_MONETIZATION'), rejectMonetizationApplication);
router.post('/monetization/payout-hold/:userId', auditLog('HOLD_CREATOR_PAYOUT'), holdCreatorPayout);

// Creator management
router.get('/monetization/creators', getApprovedCreators);
router.post('/monetization/revoke/:userId', revokeMonetization);
router.post('/monetization/grant/:userId', grantMonetization);

// Per-creator CPM
router.put('/monetization/cpm/:userId', setCreatorCpm);
router.get('/monetization/cpm/:userId', getCreatorCpm);

// Withdrawal requests
router.get('/monetization/withdrawal-requests', listWithdrawalRequests);
router.post('/monetization/withdrawal-requests/:id/approve', approveWithdrawalRequest);
router.post('/monetization/withdrawal-requests/:id/reject', rejectWithdrawalRequest);

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
