const User = require('../models/User');
const Post = require('../models/Post');
const Report = require('../models/Report');
const { Message } = require('../models/Message');
const Tournament = require('../models/Tournament');
const Notification = require('../models/Notification');
const MonetizationApplication = require('../models/MonetizationApplication');
const CreatorBankDetails = require('../models/CreatorBankDetails');
const CreatorPayout = require('../models/CreatorPayout');
const EarningsSnapshot = require('../models/EarningsSnapshot');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const HostVerificationApplication = require('../models/HostVerificationApplication');
const mongoose = require('mongoose');
const { createSystemNotification } = require('../utils/notificationService');
const { PLATFORM_DEFAULT_CPM } = require('../services/CreatorEarningsCalculationService');
const log = require('../utils/logger');

// Get dashboard stats
const getDashboardStats = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') { console.log('Getting dashboard stats...');
    }
    // Get basic counts with error handling (excluding deleted items)
    // Only count users with isActive: true (treating isActive: false as deleted for all types)
    const totalUsers = await User.countDocuments({ isActive: true }).catch(() => 0);
    
    const totalPosts = await Post.countDocuments().catch(() => 0);
    const totalMessages = await Message.countDocuments({ isDeleted: { $ne: true } }).catch(() => 0);
    const totalTournaments = await Tournament.countDocuments().catch(() => 0);
    const totalNotifications = await Notification.countDocuments().catch(() => 0);
    
    // Get active users (last 24 hours, excluding deleted users)
    const activeUsers = await User.countDocuments({ 
      isActive: true,
      lastSeen: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
    }).catch(() => 0);
    
    // Get new items today (excluding deleted users)
    const newUsersToday = await User.countDocuments({ 
      isActive: true,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
    }).catch(() => 0);
    
    const newPostsToday = await Post.countDocuments({ 
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
    }).catch(() => 0);
    
    const newTournamentsToday = await Tournament.countDocuments({ 
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
    }).catch(() => 0);

    // Get user type breakdown (excluding deleted users)
    const userTypeStats = await User.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$userType',
          count: { $sum: 1 }
        }
      }
    ]).catch(() => []);

    // Get post type breakdown
    const postTypeStats = await Post.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]).catch(() => []);

    // Get tournament status breakdown
    const tournamentStats = await Tournament.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).catch(() => []);

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          totalPosts,
          totalMessages,
          totalTournaments,
          totalNotifications,
          activeUsers,
          newUsersToday,
          newPostsToday,
          newTournamentsToday
        },
        breakdowns: {
          userTypes: userTypeStats,
          postTypes: postTypeStats,
          tournamentStatuses: tournamentStats
        },
        server: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          timestamp: new Date()
        }
      }
    });
  } catch (error) {
    log.error('Admin dashboard stats error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch dashboard stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Get user analytics
const getUserAnalytics = async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 1;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const userStats = await User.aggregate([
      {
        $match: { createdAt: { $gte: startDate } }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 },
          players: {
            $sum: { $cond: [{ $eq: ['$userType', 'player'] }, 1, 0] }
          },
          teams: {
            $sum: { $cond: [{ $eq: ['$userType', 'team'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({ success: true, data: userStats });
  } catch (error) {
    log.error('User analytics error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch user analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Get system health
const getSystemHealth = async (req, res) => {
  try {
    // Test database connection
    const dbStatus = await mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    const health = {
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      database: dbStatus,
      services: {
        api: 'running',
        socket: 'running',
        database: dbStatus
      },
      environment: process.env.NODE_ENV || 'development'
    };

    res.json({ success: true, data: health });
  } catch (error) {
    log.error('System health error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch system health',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Get recent activities
const getRecentActivities = async (req, res) => {
  try {
    const activities = await Promise.all([
      User.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('username profile.displayName createdAt userType isActive'),
      Post.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('author', 'username profile.displayName')
        .select('content type createdAt author'),
      Tournament.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('host', 'username profile.displayName')
        .select('name game status createdAt host')
    ]);

    res.json({
      success: true,
      data: {
        recentUsers: activities[0],
        recentPosts: activities[1],
        recentTournaments: activities[2]
      }
    });
  } catch (error) {
    log.error('Recent activities error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch recent activities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Get all users with pagination
const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const userType = req.query.userType || '';
    const isActive = req.query.isActive;

    const query = {
      // Exclude duo teams (temporary teams created for tournaments)
      username: { $not: /^duo_/ }
    };
    
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { 'profile.displayName': { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (userType) {
      query.userType = userType;
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  } catch (error) {
    log.error('Get users error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Update user status
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: user
    });
  } catch (error) {
    log.error('Update user status error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update user status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Delete user
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete user and related data
    await Promise.all([
      User.findByIdAndDelete(userId),
      Post.deleteMany({ author: userId }),
      Message.deleteMany({ $or: [{ sender: userId }, { receiver: userId }] }),
      Notification.deleteMany({ user: userId })
    ]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    log.error('Delete user error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Get posts with pagination
const getPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const author = req.query.author || '';
    const isActive = req.query.isActive;

    const query = {};
    
    if (search) {
      query.$or = [
        { content: { $regex: search, $options: 'i' } },
        { 'author.username': { $regex: search, $options: 'i' } },
        { 'author.profile.displayName': { $regex: search, $options: 'i' } }
      ];
    }
    
    if (author) {
      query['author.userType'] = author;
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const posts = await Post.find(query)
      .populate('author', 'username email profile.displayName profile.avatar userType')
      .select('content images likes comments createdAt updatedAt isActive author')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Post.countDocuments(query);

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  } catch (error) {
    log.error('Get posts error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch posts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Delete post
const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findByIdAndDelete(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    log.error('Delete post error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Tournament Management
const getTournaments = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    
    let query = {};
    
    // Search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { game: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const tournaments = await Tournament.find(query)
      .select('name description game startDate endDate totalSlots participants prizePool status isActive createdAt updatedAt host')
      .populate('host', 'username profile.displayName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Tournament.countDocuments(query);

    res.json({
      success: true,
      tournaments,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    log.error('Get tournaments error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteTournament = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    
    const tournament = await Tournament.findByIdAndDelete(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    res.json({ success: true, message: 'Tournament deleted successfully' });
  } catch (error) {
    log.error('Delete tournament error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Reports: list all reports
const getReports = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, targetType } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (targetType && targetType !== 'all') query.targetType = targetType;

    const reports = await Report.find(query)
      .populate('reporter', 'username profile.displayName profile.avatar email')
      .populate('reviewedBy', 'username profile.displayName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const total = await Report.countDocuments(query);

    res.json({
      success: true,
      data: { reports, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    log.error('Get reports error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to fetch reports' });
  }
};

// Reports: update status / take action
const updateReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, adminAction } = req.body;
    const adminId = req.user._id;

    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    if (status) report.status = status;
    if (adminAction) report.adminAction = adminAction;
    report.reviewedBy = adminId;
    report.reviewedAt = new Date();
    if (adminAction === 'dismiss' || !adminAction) report.status = 'dismissed';
    else report.status = 'action_taken';
    await report.save();

    if (adminAction === 'hide_content' && report.targetType === 'post') {
      await Post.findByIdAndUpdate(report.targetId, { hiddenByAdmin: true, isActive: false });
    } else if (adminAction === 'delete_content' && report.targetType === 'post') {
      await Post.findByIdAndDelete(report.targetId);
    } else if (adminAction === 'warn_user') {
      const post = await Post.findById(report.targetId).select('author');
      if (post?.author) {
        await createSystemNotification(
          post.author,
          'Content Report Warning',
          'Your content was reported and reviewed. Please ensure it follows community guidelines.'
        );
      }
    } else if (adminAction === 'ban_user') {
      const post = await Post.findById(report.targetId).select('author');
      if (post?.author) {
        await User.findByIdAndUpdate(post.author, { isActive: false });
      }
    }

    const updated = await Report.findById(reportId)
      .populate('reporter', 'username profile.displayName')
      .populate('reviewedBy', 'username profile.displayName');
    res.json({ success: true, message: 'Report updated', data: { report: updated } });
  } catch (error) {
    log.error('Update report error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to update report' });
  }
};

// Reset user password
const resetUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    // Validate password
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update password (the pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    log.error('Reset user password error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to reset password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// --- Monetization (creator applications) ---

const getMonetizationApplications = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;

    const applications = await MonetizationApplication.find(query)
      .populate('user', 'username profile.displayName profile.avatar profile.bio email createdAt')
      .sort({ appliedAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const total = await MonetizationApplication.countDocuments(query);

    // Enrich with follower count and content sample (post count, recent posts)
    const enriched = await Promise.all(applications.map(async (app) => {
      const u = await User.findById(app.user._id).select('followers').lean();
      const followersCount = (u?.followers && u.followers.length) || 0;
      const recentPosts = await Post.find({ author: app.user._id })
        .select('content postType createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      const postCount = await Post.countDocuments({ author: app.user._id });
      const contentSamples = recentPosts.map(p => ({
        _id: p._id,
        text: p.content?.text?.slice(0, 100),
        postType: p.postType,
        createdAt: p.createdAt
      }));
      const userPostIds = await Post.find({ author: app.user._id }).select('_id').lean().then(p => p.map(x => x._id));
      const reportsAgainstUser = await Report.countDocuments({
        $or: [
          { targetType: 'user', targetId: app.user._id },
          { targetType: 'post', targetId: { $in: userPostIds } }
        ],
        status: { $in: ['pending', 'action_taken'] }
      });
      const suspiciousViewSpike = Boolean(app?.eligibilitySnapshot?.metrics?.suspiciousViewSpike);
      return {
        ...app,
        applicantStats: { followersCount, postCount, reportsAgainstUser },
        contentSamples,
        fraudRiskIndicators: {
          highReportCount: reportsAgainstUser > 2,
          lowContent: postCount < 3,
          suspiciousViewSpike
        }
      };
    }));

    res.json({
      success: true,
      data: {
        applications: enriched,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    log.error('Get monetization applications error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to fetch applications', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

const approveMonetizationApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const adminId = req.user._id;

    const application = await MonetizationApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    if (application.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Application is not pending' });
    }

    application.status = 'approved';
    application.reviewedAt = new Date();
    application.reviewedBy = adminId;
    await application.save();

    await User.findByIdAndUpdate(application.user, { isCreator: true });

    await createSystemNotification(
      application.user,
      'Monetization Approved',
      'Your creator monetization application has been approved. You can now add bank details and start earning.',
      { type: 'monetization_approved', applicationId: application._id }
    );

    res.json({
      success: true,
      message: 'Application approved. Creator has been enabled for the user.',
      data: { application: { _id: application._id, status: application.status } }
    });
  } catch (error) {
    log.error('Approve monetization error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to approve', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

const rejectMonetizationApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { rejectionReason, cooldownDays = 30 } = req.body || {};
    const adminId = req.user._id;

    const application = await MonetizationApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    if (application.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Application is not pending' });
    }

    const reapplyAfter = new Date();
    reapplyAfter.setDate(reapplyAfter.getDate() + (parseInt(cooldownDays) || 30));

    application.status = 'rejected';
    application.rejectionReason = rejectionReason || 'Your application did not meet our criteria.';
    application.adminRemark = (req.body.adminRemark || '').slice(0, 1000);
    application.reviewedAt = new Date();
    application.reviewedBy = adminId;
    application.reapplyAfter = reapplyAfter;
    await application.save();

    await createSystemNotification(
      application.user,
      'Monetization Application Rejected',
      application.rejectionReason + (reapplyAfter ? ` You can re-apply after ${reapplyAfter.toLocaleDateString()}.` : ''),
      { type: 'monetization_rejected', applicationId: application._id, reapplyAfter }
    );

    res.json({
      success: true,
      message: 'Application rejected.',
      data: { application: { _id: application._id, status: application.status, reapplyAfter } }
    });
  } catch (error) {
    log.error('Reject monetization error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to reject', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

const holdCreatorPayout = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};

    const snapshot = await EarningsSnapshot.findOneAndUpdate(
      { user: userId, held: false },
      { held: true, holdReason: reason || 'Under review' },
      { new: true }
    );
    if (snapshot) {
      await CreatorPayout.updateMany(
        { user: userId, status: 'pending' },
        { status: 'held', heldReason: reason || 'Under review' }
      );
    }

    await createSystemNotification(
      userId,
      'Payout On Hold',
      reason || 'Your payout is under review. Our team will contact you if needed.',
      { type: 'payout_held' }
    );

    res.json({
      success: true,
      message: 'Payout held for creator.',
      data: { userId }
    });
  } catch (error) {
    log.error('Hold payout error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to hold payout', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// Task 5.1: List all approved creators
const getApprovedCreators = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const creators = await User.find({ isCreator: true, isActive: true })
      .select('username profile.displayName profile.avatar creatorCpm')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .lean();

    const total = await User.countDocuments({ isCreator: true, isActive: true });

    res.json({
      success: true,
      data: {
        creators,
        pagination: { page, pages: Math.ceil(total / limit), total }
      }
    });
  } catch (error) {
    log.error('Get approved creators error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to fetch creators' });
  }
};

// Task 5.2: Revoke creator monetization
const revokeMonetization = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.isCreator) return res.status(400).json({ success: false, message: 'User is not an approved creator' });

    user.isCreator = false;
    await user.save();

    await createSystemNotification(
      userId,
      'Creator Monetization Revoked',
      'Your creator monetization access has been revoked by the platform. Please contact support if you have questions.',
      { type: 'monetization_revoked' }
    );

    res.json({ success: true, message: 'Monetization revoked successfully' });
  } catch (error) {
    log.error('Revoke monetization error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to revoke monetization' });
  }
};

// Task 5.3: Grant creator monetization
const grantMonetization = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.isCreator = true;
    await user.save();

    await createSystemNotification(
      userId,
      'Creator Monetization Granted',
      'Congratulations! Creator monetization has been enabled for your account. You can now add bank details and start earning.',
      { type: 'monetization_granted' }
    );

    res.json({ success: true, message: 'Monetization granted successfully' });
  } catch (error) {
    log.error('Grant monetization error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to grant monetization' });
  }
};

// Task 5.4: Set and get per-creator CPM
const setCreatorCpm = async (req, res) => {
  try {
    const { userId } = req.params;
    const { cpm } = req.body;

    if (!cpm || typeof cpm !== 'number' || cpm <= 0) {
      return res.status(400).json({ success: false, message: 'CPM must be a positive number' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.creatorCpm = cpm;
    await user.save();

    res.json({ success: true, message: 'CPM updated successfully', data: { userId, cpm } });
  } catch (error) {
    log.error('Set creator CPM error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to set CPM' });
  }
};

const getCreatorCpm = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('creatorCpm').lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isDefault = user.creatorCpm == null || user.creatorCpm <= 0;
    res.json({
      success: true,
      data: {
        cpm: isDefault ? PLATFORM_DEFAULT_CPM : user.creatorCpm,
        isDefault,
        platformDefault: PLATFORM_DEFAULT_CPM
      }
    });
  } catch (error) {
    log.error('Get creator CPM error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to get CPM' });
  }
};

// Task 5.5: List withdrawal requests (admin)
const listWithdrawalRequests = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;

    const requests = await WithdrawalRequest.find(query)
      .populate('user', 'username profile.displayName profile.avatar')
      .populate('payoutCycle', 'cycleLabel periodType endDate')
      .sort({ requestedAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // Enrich with bank details
    const enriched = await Promise.all(requests.map(async (r) => {
      const bank = await CreatorBankDetails.findOne({ user: r.user._id })
        .select('accountHolderName bankName lastFourDigits ifsc verificationStatus')
        .lean();
      return { ...r, bankDetails: bank || null };
    }));

    const total = await WithdrawalRequest.countDocuments(query);

    res.json({
      success: true,
      data: {
        requests: enriched,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    log.error('List withdrawal requests error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to fetch withdrawal requests' });
  }
};

// Task 5.6: Approve and reject withdrawal requests
const approveWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { bankReference } = req.body || {};
    const adminId = req.user._id;

    const request = await WithdrawalRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'Request is not pending' });

    request.status = 'approved';
    request.bankReference = bankReference || '';
    request.paidAt = new Date();
    request.reviewedBy = adminId;
    await request.save();

    await createSystemNotification(
      request.user,
      'Withdrawal Request Approved',
      `Your withdrawal request has been approved${bankReference ? ` (Reference: ${bankReference})` : ''}. The amount will be credited to your bank account.`,
      { type: 'withdrawal_approved', requestId: request._id }
    );

    res.json({ success: true, message: 'Withdrawal request approved', data: { _id: request._id, status: request.status } });
  } catch (error) {
    log.error('Approve withdrawal error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to approve withdrawal request' });
  }
};

const rejectWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body || {};
    const adminId = req.user._id;

    if (!rejectionReason) return res.status(400).json({ success: false, message: 'rejectionReason is required' });

    const request = await WithdrawalRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'Request is not pending' });

    request.status = 'rejected';
    request.rejectionReason = rejectionReason;
    request.reviewedBy = adminId;
    await request.save();

    await createSystemNotification(
      request.user,
      'Withdrawal Request Rejected',
      `Your withdrawal request has been rejected. Reason: ${rejectionReason}`,
      { type: 'withdrawal_rejected', requestId: request._id }
    );

    res.json({ success: true, message: 'Withdrawal request rejected', data: { _id: request._id, status: request.status } });
  } catch (error) {
    log.error('Reject withdrawal error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to reject withdrawal request' });
  }
};

// Task 5.1: Get host verification applications
const getHostVerificationApplications = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    
    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    const applications = await HostVerificationApplication.find(query)
      .populate('user', 'username profile.displayName profile.avatar email')
      .populate('reviewedBy', 'username')
      .sort({ appliedAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const total = await HostVerificationApplication.countDocuments(query);

    res.json({
      success: true,
      data: {
        applications,
        pagination: {
          total,
          pages: Math.ceil(total / parseInt(limit)),
          current: parseInt(page),
          limit: parseInt(limit)
        }
      }
    });
  } catch (error) {
    log.error('Get host verification applications error:', { error: String(error) });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch host verification applications',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Task 5.2: Approve host verification application
const approveHostVerificationApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user._id;

    // Find application by ID
    const application = await HostVerificationApplication.findById(id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Check if application is pending
    if (application.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Application is not pending'
      });
    }

    // Update application status
    application.status = 'approved';
    application.reviewedAt = new Date();
    application.reviewedBy = adminId;
    await application.save();

    // Set user.isVerifiedHost = true
    await User.findByIdAndUpdate(application.user, { isVerifiedHost: true });

    // Send system notification with approval message from Requirement 6.6
    await createSystemNotification(
      application.user,
      'Verified Host Application Approved',
      'Congratulations! Your Verified Host application has been approved. You can now host prize pool tournaments and scrims.'
    );

    res.json({
      success: true,
      message: 'Application approved successfully',
      data: {
        application: {
          _id: application._id,
          status: application.status,
          reviewedAt: application.reviewedAt,
          reviewedBy: application.reviewedBy
        }
      }
    });
  } catch (error) {
    log.error('Approve host verification application error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to approve application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Task 5.3: Reject host verification application
const rejectHostVerificationApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body || {};
    const adminId = req.user._id;

    // Find application by ID
    const application = await HostVerificationApplication.findById(id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Check if application is pending
    if (application.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Application is not pending'
      });
    }

    // Update application status
    application.status = 'rejected';
    application.reviewedAt = new Date();
    application.reviewedBy = adminId;
    application.rejectionReason = rejectionReason || '';
    await application.save();

    // Do NOT change user.isVerifiedHost (as specified in task details)

    // Send system notification with rejection message from Requirement 6.7
    const notificationMessage = 'Your Verified Host application has been reviewed. Unfortunately, it was not approved at this time.' + 
      (rejectionReason ? ` ${rejectionReason}` : '');
    
    await createSystemNotification(
      application.user,
      'Verified Host Application Rejected',
      notificationMessage
    );

    res.json({
      success: true,
      message: 'Application rejected successfully',
      data: {
        application: {
          _id: application._id,
          status: application.status,
          reviewedAt: application.reviewedAt,
          reviewedBy: application.reviewedBy,
          rejectionReason: application.rejectionReason
        }
      }
    });
  } catch (error) {
    log.error('Reject host verification application error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to reject application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all verified hosts
const getVerifiedHosts = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { isVerifiedHost: true };
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { 'profile.displayName': { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('username email profile.displayName profile.avatar isVerifiedHost createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        hosts: users,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (err) {
    log.error('getVerifiedHosts error:', { error: String(err) });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Revoke host verification for a user
const revokeHostVerification = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.isVerifiedHost) {
      return res.status(400).json({ success: false, message: 'User is not a verified host' });
    }

    // Revoke verification
    await User.findByIdAndUpdate(userId, { isVerifiedHost: false });

    // Also update their approved application status back to pending (optional — mark as revoked)
    await HostVerificationApplication.findOneAndUpdate(
      { user: userId, status: 'approved' },
      { status: 'rejected', rejectionReason: 'Verification revoked by admin', reviewedAt: new Date(), reviewedBy: req.user._id }
    );

    res.json({
      success: true,
      message: `Host verification revoked for @${user.username}`
    });
  } catch (err) {
    log.error('revokeHostVerification error:', { error: String(err) });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
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
};
