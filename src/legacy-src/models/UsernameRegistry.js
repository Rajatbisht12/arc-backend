const mongoose = require('mongoose');

// One namespace for user claims and admin reservations. A unique key here
// arbitrates a concurrent signup/rename against an admin reservation.
const usernameRegistrySchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  normalizedUsername: { type: String, required: true, immutable: true },
  kind: { type: String, enum: ['user', 'reservation'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  reservedBy: { type: String, trim: true, maxlength: 100, default: '' }
}, { timestamps: true });

usernameRegistrySchema.index({ normalizedUsername: 1 }, { unique: true });
usernameRegistrySchema.index({ kind: 1, createdAt: -1 });
usernameRegistrySchema.index({ kind: 1, normalizedUsername: 1 });

module.exports = mongoose.models.UsernameRegistry || mongoose.model('UsernameRegistry', usernameRegistrySchema);
