const mongoose = require('mongoose');

const creatorBankDetailsHistorySchema = new mongoose.Schema({
  bankDetails: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreatorBankDetails',
    default: null,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: [
      'created',
      'updated',
      'deleted',
      'verification_changed',
      'notes_updated',
      'sensitive_viewed',
      'legacy_sensitive_data_redacted'
    ],
    required: true,
    index: true
  },
  actor: {
    actorKey: { type: String, required: true },
    username: { type: String, default: '' },
    role: { type: String, default: '' },
    type: { type: String, enum: ['user', 'admin', 'system'], required: true }
  },
  previous: { type: mongoose.Schema.Types.Mixed, default: null },
  next: { type: mongoose.Schema.Types.Mixed, default: null },
  reason: { type: String, trim: true, maxlength: 1000, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' }
}, { timestamps: true });

creatorBankDetailsHistorySchema.index({ user: 1, createdAt: -1 });
creatorBankDetailsHistorySchema.index({ bankDetails: 1, createdAt: -1 });

const rejectMutation = function(next) {
  next(new Error('Creator bank detail history is immutable'));
};

creatorBankDetailsHistorySchema.pre('updateOne', rejectMutation);
creatorBankDetailsHistorySchema.pre('updateMany', rejectMutation);
creatorBankDetailsHistorySchema.pre('findOneAndUpdate', rejectMutation);
creatorBankDetailsHistorySchema.pre('replaceOne', rejectMutation);
creatorBankDetailsHistorySchema.pre('findOneAndReplace', rejectMutation);
creatorBankDetailsHistorySchema.pre('deleteOne', rejectMutation);
creatorBankDetailsHistorySchema.pre('deleteOne', { document: true, query: false }, rejectMutation);
creatorBankDetailsHistorySchema.pre('deleteMany', rejectMutation);
creatorBankDetailsHistorySchema.pre('findOneAndDelete', rejectMutation);
creatorBankDetailsHistorySchema.pre('save', function(next) {
  if (!this.isNew) return next(new Error('Creator bank detail history is immutable'));
  return next();
});
creatorBankDetailsHistorySchema.pre('bulkWrite', function(next, operations) {
  if ((operations || []).some((operation) => !operation.insertOne)) {
    return next(new Error('Creator bank detail history is immutable'));
  }
  return next();
});

module.exports = mongoose.model('CreatorBankDetailsHistory', creatorBankDetailsHistorySchema);
