const mongoose = require('mongoose');

const appleNotificationReceiptSchema = new mongoose.Schema({
  notificationUUID: { type: String, required: true, unique: true, index: true, trim: true },
  notificationType: { type: String, default: '', maxlength: 100, index: true },
  subtype: { type: String, default: '', maxlength: 100 },
  environment: { type: String, default: '', maxlength: 30 },
  status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing', index: true },
  transactionId: { type: String, default: '', maxlength: 255, index: true },
  errorCode: { type: String, default: '', maxlength: 120 },
  payloadDigest: { type: String, required: true, maxlength: 64 },
  processedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.models.AppleNotificationReceipt || mongoose.model('AppleNotificationReceipt', appleNotificationReceiptSchema);
