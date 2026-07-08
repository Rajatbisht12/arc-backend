const mongoose = require('mongoose');

const PROFILE_VISIT_RETENTION_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

// Privacy-minimized daily unique profile visit. The row deliberately stores
// only the two account identifiers and a UTC day bucket: never IP, user-agent,
// device, location, request path, or arbitrary metadata.
const profileVisitDailySchema = new mongoose.Schema({
  profileOwner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  viewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  day: {
    type: Date,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, {
  strict: 'throw',
  timestamps: { createdAt: true, updatedAt: false }
});

profileVisitDailySchema.index(
  { profileOwner: 1, viewer: 1, day: 1 },
  { unique: true, name: 'profile_owner_viewer_day_unique' }
);
profileVisitDailySchema.index(
  { profileOwner: 1, day: -1 },
  { name: 'profile_owner_day_analytics' }
);
profileVisitDailySchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'profile_visit_retention_ttl' }
);

profileVisitDailySchema.statics.PROFILE_VISIT_RETENTION_DAYS = PROFILE_VISIT_RETENTION_DAYS;
profileVisitDailySchema.statics.PROFILE_VISIT_RETENTION_MS = PROFILE_VISIT_RETENTION_DAYS * DAY_MS;

module.exports = mongoose.model('ProfileVisitDaily', profileVisitDailySchema);
