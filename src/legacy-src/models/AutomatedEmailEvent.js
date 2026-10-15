const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true, maxlength: 200 },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  templateId: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'sending', 'failed', 'sent', 'suppressed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: '' }
}, { timestamps: true });

schema.index({ status: 1, createdAt: 1 });
schema.index({ user: 1, templateId: 1, createdAt: -1 });

module.exports = mongoose.model('AutomatedEmailEvent', schema);
