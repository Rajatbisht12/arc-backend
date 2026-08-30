const path = require('path');
const { AUDIO_LIMITS, normalizeMime } = require('./audioPolicy');

const STORY_MUSIC_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3']);

const hasMp3Signature = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  // MPEG audio frame sync: eleven leading 1 bits.
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
};

const safeMusicFilename = (value) => {
  const basename = path.basename(String(value || 'story-music.mp3'));
  const stem = basename.replace(/\.mp3$/i, '').replace(/[^a-zA-Z0-9._ -]/g, '').trim();
  return `${(stem || 'story-music').slice(0, 120)}.mp3`;
};

const validateStoryMusicFile = (file) => {
  if (!file) return { ok: true };
  const mimeType = normalizeMime(file.mimetype);
  if (!STORY_MUSIC_MIME_TYPES.has(mimeType) || !/\.mp3$/i.test(String(file.originalname || ''))) {
    return { ok: false, statusCode: 415, code: 'STORY_MUSIC_MP3_REQUIRED', message: 'Story music must be an MP3 file.' };
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
  if (!hasMp3Signature(file.buffer)) {
    return { ok: false, statusCode: 415, code: 'STORY_MUSIC_INVALID_SIGNATURE', message: 'The selected file is not a valid MP3.' };
  }
  return { ok: true, mimeType: 'audio/mpeg', size, filename: safeMusicFilename(file.originalname) };
};

const validateStoryMusicDuration = (durationSeconds) => {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration < AUDIO_LIMITS.minDurationSec) {
    return { ok: false, statusCode: 422, code: 'STORY_MUSIC_DURATION_INVALID', message: 'Music duration could not be verified. Please choose another MP3.' };
  }
  if (duration > AUDIO_LIMITS.maxDurationSec) {
    const maxMinutes = Math.round(AUDIO_LIMITS.maxDurationSec / 60);
    return { ok: false, statusCode: 422, code: 'STORY_MUSIC_TOO_LONG', message: `Music file is too long. Maximum allowed duration is ${maxMinutes} minutes.` };
  }
  return { ok: true, duration };
};

module.exports = {
  STORY_MUSIC_MIME_TYPES,
  STORY_MUSIC_MAX_BYTES: AUDIO_LIMITS.maxBytes,
  hasMp3Signature,
  safeMusicFilename,
  validateStoryMusicFile,
  validateStoryMusicDuration,
};
