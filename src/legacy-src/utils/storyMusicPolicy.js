const path = require('path');
const {
  ALLOWED_AUDIO_MIME_TYPES,
  AUDIO_FORMAT_LABEL,
  AUDIO_LIMITS,
  normalizeMime,
  isAllowedAudioMime,
} = require('./audioPolicy');

const STORY_MUSIC_MIME_TYPES = ALLOWED_AUDIO_MIME_TYPES;

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

const resolveAudioMimeType = (filename, reportedMimeType) => {
  const reported = normalizeMime(reportedMimeType);
  if (reported && isAllowedAudioMime(reported)) return reported;
  const fromExt = EXTENSION_MIME[extensionOf(filename)];
  if (fromExt) return fromExt;
  return reported && reported !== 'application/octet-stream' ? reported : '';
};

const hasMp3Signature = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  // MPEG audio frame sync: eleven leading 1 bits.
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
};

const hasSupportedAudioSignature = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (hasMp3Signature(buffer)) return true;
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return true;
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return true;
  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') return true;
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return true;
  // AAC ADTS frame sync.
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) return true;
  return false;
};

const safeMusicFilename = (value) => {
  const basename = path.basename(String(value || 'story-audio.m4a'));
  const ext = EXTENSION_MIME[extensionOf(basename)] ? extensionOf(basename) : 'm4a';
  const stem = basename.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._ -]/g, '').trim();
  return `${(stem || 'story-audio').slice(0, 120)}.${ext}`;
};

const validateStoryMusicFile = (file) => {
  if (!file) return { ok: true };
  const mimeType = resolveAudioMimeType(file.originalname, file.mimetype);
  if (!isAllowedAudioMime(mimeType)) {
    return {
      ok: false,
      statusCode: 415,
      code: 'STORY_MUSIC_UNSUPPORTED_FORMAT',
      message: `Unsupported audio format. Please upload ${AUDIO_FORMAT_LABEL}.`,
    };
  }
  const size = Number(file.size ?? file.buffer?.length);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, statusCode: 422, code: 'STORY_MUSIC_UNREADABLE', message: 'Music file could not be read.' };
  }
  if (size > AUDIO_LIMITS.maxBytes) {
    const maxMegabytes = Math.round(AUDIO_LIMITS.maxBytes / (1024 * 1024));
    return {
      ok: false,
      statusCode: 413,
      code: 'STORY_MUSIC_TOO_LARGE',
      message: `Music file is too large. Maximum allowed size is ${maxMegabytes} MB.`,
    };
  }
  if (!hasSupportedAudioSignature(file.buffer)) {
    return { ok: false, statusCode: 415, code: 'STORY_MUSIC_INVALID_SIGNATURE', message: 'The selected file is not a valid audio file.' };
  }
  return { ok: true, mimeType, size, filename: safeMusicFilename(file.originalname) };
};

const validateStoryMusicDuration = (durationSeconds) => {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration < AUDIO_LIMITS.minDurationSec) {
    return { ok: false, statusCode: 422, code: 'STORY_MUSIC_DURATION_INVALID', message: 'Music duration could not be verified. Please choose another audio file.' };
  }
  if (duration > AUDIO_LIMITS.maxDurationSec) {
    const maxMinutes = Math.round(AUDIO_LIMITS.maxDurationSec / 60);
    return { ok: false, statusCode: 422, code: 'STORY_MUSIC_TOO_LONG', message: `Music file is too long. Maximum allowed duration is ${maxMinutes} minutes.` };
  }
  return { ok: true, duration };
};

const finiteNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const resolveStoryMusicTrim = (body = {}, musicDurationSeconds, storyDurationSeconds) => {
  const musicDuration = Math.max(AUDIO_LIMITS.minDurationSec, finiteNumber(musicDurationSeconds, 0));
  const storyDuration = Math.max(1, Math.min(30, finiteNumber(storyDurationSeconds, 30)));
  const segmentDuration = Math.min(musicDuration, storyDuration);
  const maxStart = Math.max(0, musicDuration - segmentDuration);
  const requestedStart = finiteNumber(
    body.musicStartTime ?? body.musicStart ?? body.musicOffset ?? body.startTime,
    0,
  );
  const startTime = Math.max(0, Math.min(maxStart, requestedStart));
  const endTime = startTime + segmentDuration;
  return {
    startTime,
    endTime,
    playbackDuration: segmentDuration,
  };
};

module.exports = {
  STORY_MUSIC_MIME_TYPES,
  STORY_MUSIC_MAX_BYTES: AUDIO_LIMITS.maxBytes,
  hasMp3Signature,
  hasSupportedAudioSignature,
  resolveAudioMimeType,
  resolveStoryMusicTrim,
  safeMusicFilename,
  validateStoryMusicFile,
  validateStoryMusicDuration,
};
