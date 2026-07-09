const Report = require('../models/Report');
const Post = require('../models/Post');
const User = require('../models/User');
const TeamRecruitment = require('../models/TeamRecruitment');
const mongoose = require('mongoose');
const log = require('../utils/logger');

const reportTargetExists = async (targetType, targetId) => {
  if (targetType === 'post') {
    return Boolean(await Post.exists({ _id: targetId, isActive: { $ne: false } }));
  }
  if (targetType === 'recruitment') {
    return Boolean(await TeamRecruitment.exists({ _id: targetId, isActive: { $ne: false } }));
  }
  if (targetType === 'user') {
    return Boolean(await User.exists({ _id: targetId, isActive: { $ne: false } }));
  }
  if (targetType === 'comment') {
    return Boolean(await Post.exists({ 'comments._id': targetId, isActive: { $ne: false } }));
  }
  return false;
};

// Create report (user)
const createReport = async (req, res) => {
  try {
    const { targetType, targetId, reason, details } = req.body;
    const reporterId = req.user._id;

    const allowedTypes = ['post', 'recruitment', 'user', 'comment'];
    if (!allowedTypes.includes(targetType)) {
      return res.status(400).json({ success: false, message: 'Invalid targetType' });
    }
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid report target ID' });
    }
    const allowedReasons = ['spam', 'harassment', 'hate_speech', 'violence', 'nudity', 'misinformation', 'copyright', 'other'];
    const finalReason = allowedReasons.includes(reason) ? reason : 'other';

    if (!await reportTargetExists(targetType, targetId)) {
      return res.status(404).json({ success: false, message: 'Report target not found' });
    }

    const existing = await Report.findOne({
      reporter: reporterId,
      targetType,
      targetId,
      status: 'pending'
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already reported this content' });
    }

    const report = await Report.create({
      reporter: reporterId,
      targetType,
      targetId,
      reason: finalReason,
      details: typeof details === 'string' ? details.slice(0, 500) : ''
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
