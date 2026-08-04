const mongoose = require('mongoose');

/**
 * A single piece of audio a user uploaded themselves (not licensed catalog
 * music). One row records ownership, storage location and server-derived
 * metadata; posts/reels/stories reference it by `_id` via
 * `attachedMusic.audioId` rather than trusting a raw client URL.
 *
 * Nothing here is trusted from the client blindly: `mimeType`/`fileSize` are
 * taken from the multer-parsed upload (server-observed), `url`/`publicId` come
 * from our own storage layer, and ownership is the authenticated uploader.
 */
const userAudioSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Audio owner is required'],
    index: true
  },
  // Storage handle + playback URL from our storage layer (S3-backed).
  publicId: { type: String, default: '' },      // storage key (for deletion)
  url: { type: String, required: true },         // playback URL
  waveformUrl: { type: String, default: '' },    // optional; empty until derived

  // Display metadata. `title` is user-supplied (sanitised/bounded); `artistName`
  // is optional and never implies a licensed catalog artist.
  title: { type: String, default: '', maxlength: 200 },
  artistName: { type: String, default: '', maxlength: 200 },

  // Server-observed technical facts.
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },        // bytes, from the upload buffer
  duration: { type: Number, default: 0 },        // seconds; 0 until known

  // Always 'user_upload' for this collection — kept explicit so downstream
  // code can treat UserAudio and catalog tracks uniformly by reading sourceType.
  sourceType: { type: String, enum: ['user_upload'], default: 'user_upload' },

  // 'ready' when playable immediately; 'processing' if a normalize/waveform step
  // is deferred; 'failed' if post-upload processing gave up. The client must not
  // block indefinitely on 'processing'.
  status: {
    type: String,
    enum: ['ready', 'processing', 'failed'],
    default: 'ready',
    index: true
  },

  // Copyright affirmation captured at upload/attach time. A timestamp records
  // that the uploader confirmed rights; it is NOT proof the platform verified
  // ownership. Null until the user confirms.
  copyrightConfirmedAt: { type: Date, default: null },

  // Moderation / takedown support.
  removed: { type: Boolean, default: false },
  removedAt: { type: Date, default: null }
}, { timestamps: true });

// Cheap idempotency guard: the same owner re-uploading an identical file
// (same storage key) should not create duplicate rows.
userAudioSchema.index({ owner: 1, publicId: 1 });

module.exports = mongoose.models.UserAudio || mongoose.model('UserAudio', userAudioSchema);
