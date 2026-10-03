const Report = require('../models/Report');
const Post = require('../models/Post');
const User = require('../models/User');
const TeamRecruitment = require('../models/TeamRecruitment');
const mongoose = require('mongoose');
const log = require('../utils/logger');

const idString = (value) => String(value?._id || value || '').trim();

const resolveCommentTarget = async (targetId) => {
  const post = await Post.findOne({ 'comments._id': targetId, isActive: { $ne: false } })
    .select('author postType content.media comments');
  if (!post) return null;
  const comment = (post.comments || []).find((entry) => idString(entry?._id) === idString(targetId));
  if (!comment) return null;
  const isClip = post.postType === 'clip'
    || (post.content?.media || []).some((media) => String(media?.type || '').toLowerCase() === 'video');
  return {
    post,
    comment,
    context: {
      parentContentType: isClip ? 'clip' : 'post',
      parentContentId: post._id,
      contentOwner: post.author,
      targetAuthor: comment.user,
      parentCommentId: comment.parentComment || undefined,
      rootCommentId: comment.rootComment || undefined,
      textSnapshot: String(comment.text || '').slice(0, 500)
    }
  };
};

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
  if (targetType === 'comment') return Boolean(await resolveCommentTarget(targetId));
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

    const commentTarget = targetType === 'comment' ? await resolveCommentTarget(targetId) : null;
    if (targetType === 'comment' && commentTarget && idString(commentTarget.comment.user) === idString(reporterId)) {
      return res.status(400).json({
        success: false,
        code: 'SELF_REPORT_NOT_ALLOWED',
        message: 'You cannot report your own comment'
      });
    }

    if (targetType === 'comment' ? !commentTarget : !await reportTargetExists(targetType, targetId)) {
      return res.status(404).json({ success: false, message: 'Report target not found' });
    }

    // A user may report a given piece of content only once, regardless of the
    // prior report's status (pending/dismissed/action_taken). This check short
    // -circuits the common case; the unique index on the Report model is what
    // actually guarantees it under concurrent/duplicate/retry/offline requests.
    const existing = await Report.findOne({
      reporter: reporterId,
      targetType,
      targetId
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already reported this content' });
    }

    let report;
    try {
      report = await Report.create({
        reporter: reporterId,
        targetType,
        targetId,
        reason: finalReason,
        details: typeof details === 'string' ? details.slice(0, 500) : '',
        ...(commentTarget ? { targetContext: commentTarget.context } : {})
      });
    } catch (err) {
      // Duplicate key => a concurrent request already created this report.
      // Treat as the already-reported case rather than a server error so the
      // outcome is identical to the sequential path (idempotent per user).
      if (err && err.code === 11000) {
        return res.status(409).json({ success: false, message: 'You have already reported this content' });
      }
      throw err;
    }

    if (targetType === 'post') {
      // Guard the embedded reports array against duplicate pushes on retry so
      // a post never accumulates two report entries from the same reporter.
      await Post.findOneAndUpdate(
        { _id: targetId, 'reports.user': { $ne: reporterId } },
        {
          $push: {
            reports: {
              user: reporterId,
              reason: finalReason,
              reportedAt: new Date()
            }
          }
        }
      );
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
