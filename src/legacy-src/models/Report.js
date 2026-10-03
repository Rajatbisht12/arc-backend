const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetType: {
    type: String,
    enum: ['post', 'recruitment', 'user', 'comment'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  reason: {
    type: String,
    enum: ['spam', 'harassment', 'hate_speech', 'violence', 'nudity', 'misinformation', 'copyright', 'other'],
    default: 'other'
  },
  details: {
    type: String,
    maxlength: 500,
    default: ''
  },
  // A bounded moderation snapshot keeps a comment report intelligible if the
  // reported comment or its parent post is deleted before an admin reviews it.
  targetContext: {
    parentContentType: {
      type: String,
      enum: ['post', 'clip']
    },
    parentContentId: mongoose.Schema.Types.ObjectId,
    contentOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    targetAuthor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    parentCommentId: mongoose.Schema.Types.ObjectId,
    rootCommentId: mongoose.Schema.Types.ObjectId,
    textSnapshot: {
      type: String,
      maxlength: 500,
      default: ''
    }
  },
  status: {
    type: String,
    enum: ['pending', 'dismissed', 'action_taken'],
    default: 'pending'
  },
  adminAction: {
    type: String,
    enum: ['', 'dismiss', 'hide_content', 'delete_content', 'warn_user', 'ban_user'],
    default: ''
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date
}, {
  timestamps: true
});

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });
// One report per user per piece of content. This unique index is the
// source of truth that enforces de-duplication atomically, so rapid,
// retried, offline-replayed, or multi-device submissions can never create
// a second report even if they race past the application-level check.
reportSchema.index({ reporter: 1, targetType: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);
