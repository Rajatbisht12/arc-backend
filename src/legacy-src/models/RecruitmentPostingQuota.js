const mongoose = require('mongoose');

const recruitmentPostingQuotaSchema = new mongoose.Schema({
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dayKey: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/
  },
  count: {
    type: Number,
    min: 0,
    max: 2,
    default: 0
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, { timestamps: true });

recruitmentPostingQuotaSchema.index({ player: 1, dayKey: 1 }, { unique: true });
recruitmentPostingQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RecruitmentPostingQuota', recruitmentPostingQuotaSchema);
