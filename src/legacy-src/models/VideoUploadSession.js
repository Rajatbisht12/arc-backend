const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientUploadId: { type: String, required: true },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true, min: 1, max: 524288000 },
  partSize: { type: Number, required: true },
  partCount: { type: Number, required: true },
  objectKey: { type: String, required: true, select: false },
  multipartUploadId: { type: String, select: false },
  status: { type: String, required: true, enum: ['CREATED', 'UPLOADING', 'UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED', 'EXPIRED'], default: 'CREATED' },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  error: { code: String, message: String },
  leaseToken: { type: String, select: false },
  leaseExpiresAt: Date,
  completionLeaseToken: { type: String, select: false },
  completionLeaseExpiresAt: Date,
  uploadVerifiedAt: Date,
  completedAt: Date,
  cleanedAt: Date,
  sourceCleanedAt: Date,
  derivativesCleanedAt: Date,
  cleanupCheckedAt: Date,
  orphanedAt: Date,
  ownerDeletedAt: Date,
  outputPrefixes: [String],
  cleanupErrorAt: Date,
  // Reserve before publication; a retry uses the same post ID and never steals a session.
  claimedPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  claimToken: { type: String, select: false },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  metadata: mongoose.Schema.Types.Mixed,
  output: mongoose.Schema.Types.Mixed,
}, { timestamps: true, autoIndex: false });

schema.index({ owner: 1, clientUploadId: 1 }, { unique: true, name: 'video_upload_owner_client_unique' });
schema.index({ owner: 1, status: 1, expiresAt: 1 }, { name: 'video_upload_owner_quota' });
schema.index({ status: 1, leaseExpiresAt: 1, updatedAt: 1 }, { name: 'video_upload_recovery' });
schema.index({ status: 1, expiresAt: 1, cleanedAt: 1 }, { name: 'video_upload_cleanup' });
schema.index({ derivativesCleanedAt: 1, cleanupCheckedAt: 1, _id: 1 }, { name: 'video_upload_attached_cleanup' });
// No TTL index: cleanup must abort S3 multipart uploads before deleting metadata.
module.exports = mongoose.models.VideoUploadSession || mongoose.model('VideoUploadSession', schema);
