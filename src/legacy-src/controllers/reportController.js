const Report = require('../models/Report');
const Post = require('../models/Post');
const User = require('../models/User');
const TeamRecruitment = require('../models/TeamRecruitment');
const log = require('../utils/logger');

// Create report (user)
const createReport = async (req, res) => {
  try {
    const { targetType, targetId, reason, details } = req.body;
    const reporterId = req.user._id;

    if (!targetType || !targetId) {
      return res.status(400).json({ success: false, message: 'targetType and targetId are required' });
    }
    const allowedTypes = ['post', 'recruitment', 'user', 'comment'];
    if (!allowedTypes.includes(targetType)) {
      return res.status(400).json({ success: false, message: 'Invalid targetType' });
    }
    const allowedReasons = ['spam', 'harassment', 'hate_speech', 'violence', 'nudity', 'misinformation', 'copyright', 'other'];
    const finalReason = allowedReasons.includes(reason) ? reason : 'other';

    const existing = await Report.findOne({
      reporter: reporterId,
      targetType,
      targetId,
      status: 'pending'
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already reported this content' });
    }

    const report = await Report.create({
      reporter: reporterId,
      targetType,
      targetId,
      reason: finalReason,
      details: (details || '').slice(0, 500)
    });

    if (targetType === 'post') {
      await Post.findByIdAndUpdate(targetId, {
        $push: {
          reports: {
            user: reporterId,
            reason: finalReason,
            reportedAt: new Date()
          }
        }
      });
    }

    const populated = await Report.findById(report._id).populate('reporter', 'username profile.displayName');
    res.status(201).json({
      success: true,
      message: 'Report submitted. Our team will review it.',
      data: { report: populated }
    });
  } catch (error) {
    log.error('Create report error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to submit report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  createReport
};
