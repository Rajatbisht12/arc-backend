/**
 * Single source of truth for user-uploaded audio limits + validation, shared by
 * the upload route (server-side enforcement) and mirrored by the Mobile client
 * (mobile-ui/arc-mobile/src/features/music/audioUploadPolicy.ts). Keeping the
 * limits here means Mobile and Backend can never drift.
 *
 * Types are validated by allow-list, never by file extension alone.
 */
const AUDIO_LIMITS = {
  // Bounded below the 50MB multer cap; audio attachments are short.
  maxBytes: Number(process.env.AUDIO_MAX_BYTES) || 25 * 1024 * 1024, // 25 MB
  // The full upload may be long; trimming (startTime/endTime) picks a segment.
  maxDurationSec: Number(process.env.AUDIO_MAX_DURATION_SEC) || 600, // 10 min
  minDurationSec: Number(process.env.AUDIO_MIN_DURATION_SEC) || 1,
};

// MP3 / M4A / AAC / WAV — the containers the playback stack (expo-av / <audio>)
// decodes reliably. mp4 audio containers report several of these.
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/x-aac',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
]);

const normalizeMime = (mimeType) =>
  typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';

const isAllowedAudioMime = (mimeType) => ALLOWED_AUDIO_MIME_TYPES.has(normalizeMime(mimeType));

/**
 * Validate audio metadata. Returns { ok: true } or { ok: false, message } with a
 * user-facing message. `durationSec` is optional (some clients cannot read it
 * before upload); when absent, duration is validated later if the server derives
 * it, and is not treated as a failure here.
 */
const validateAudioUpload = ({ mimeType, size, durationSec } = {}) => {
  if (!isAllowedAudioMime(mimeType)) {
    return { ok: false, code: 'unsupported_format', message: 'Unsupported audio format' };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, code: 'unreadable', message: 'Audio file could not be read' };
  }
  if (bytes > AUDIO_LIMITS.maxBytes) {
    return { ok: false, code: 'too_large', message: 'File is too large' };
  }
  if (durationSec != null) {
    const seconds = Number(durationSec);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return { ok: false, code: 'unreadable', message: 'Audio file could not be read' };
    }
    if (seconds < AUDIO_LIMITS.minDurationSec) {
      return { ok: false, code: 'too_short', message: 'Audio is too short' };
    }
    if (seconds > AUDIO_LIMITS.maxDurationSec) {
      return { ok: false, code: 'too_long', message: 'Audio is too long' };
    }
  }
  return { ok: true };
};

module.exports = {
  AUDIO_LIMITS,
  ALLOWED_AUDIO_MIME_TYPES,
  normalizeMime,
  isAllowedAudioMime,
  validateAudioUpload,
};
