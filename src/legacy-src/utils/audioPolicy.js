const path = require('path');

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

// MP3 / M4A / AAC / WAV / OGG / FLAC — shared by Story/Post custom music.
// Server still verifies actual media readability with ffprobe before publish.
const AUDIO_FORMAT_LABEL = 'MP3, M4A, AAC, WAV, OGG, or FLAC';

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
  'audio/ogg',
  'application/ogg',
  'audio/flac',
  'audio/x-flac',
]);

const normalizeMime = (mimeType) =>
  typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';

const isAllowedAudioMime = (mimeType) => ALLOWED_AUDIO_MIME_TYPES.has(normalizeMime(mimeType));

const EXTENSION_MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
};

const extensionOf = (value) => {
  const ext = path.extname(String(value || '')).replace(/^\./, '').toLowerCase();
  return ext || '';
};

/**
 * Resolve a canonical audio MIME for server validation/storage.
 * Priority:
 * 1. trusted allow-listed MIME observed by Multer
 * 2. supported extension as a recovery path for generic OS/browser MIME
 * 3. non-generic reported MIME so validation can reject it clearly
 *
 * This does not by itself trust the extension: upload controllers still verify
 * media readability/duration with ffprobe before persisting or publishing.
 */
const resolveAudioMimeType = (filename, reportedMimeType) => {
  const reported = normalizeMime(reportedMimeType);
  if (reported && isAllowedAudioMime(reported)) return reported;
  const fromExt = EXTENSION_MIME[extensionOf(filename)];
  if (fromExt) return fromExt;
  return reported && reported !== 'application/octet-stream' ? reported : '';
};

/**
 * Validate audio metadata. Returns { ok: true } or { ok: false, message } with a
 * user-facing message. `durationSec` is optional (some clients cannot read it
 * before upload); when absent, duration is validated later if the server derives
 * it, and is not treated as a failure here.
 */
const validateAudioUpload = ({ mimeType, size, durationSec } = {}) => {
  if (!isAllowedAudioMime(mimeType)) {
    return { ok: false, code: 'unsupported_format', message: `Unsupported audio format. Please upload ${AUDIO_FORMAT_LABEL}.` };
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
  AUDIO_FORMAT_LABEL,
  ALLOWED_AUDIO_MIME_TYPES,
  normalizeMime,
  isAllowedAudioMime,
  resolveAudioMimeType,
  validateAudioUpload,
};
