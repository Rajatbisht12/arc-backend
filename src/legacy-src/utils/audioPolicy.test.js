const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUDIO_LIMITS,
  isAllowedAudioMime,
  normalizeMime,
  resolveAudioMimeType,
  validateAudioUpload,
} = require('./audioPolicy');

const MB = 1024 * 1024;

test('accepts the supported custom-audio MIME types', () => {
  for (const mime of ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/flac']) {
    assert.equal(isAllowedAudioMime(mime), true, `${mime} should be allowed`);
  }
});

test('MIME check is case- and parameter-insensitive', () => {
  assert.equal(isAllowedAudioMime('AUDIO/MPEG'), true);
  assert.equal(isAllowedAudioMime('audio/mpeg; codecs="mp3"'), true);
  assert.equal(normalizeMime('Audio/WAV ;x=1'), 'audio/wav');
});

test('rejects non-audio and generic types (never trusts extension)', () => {
  for (const mime of ['application/octet-stream', 'video/mp4', 'image/png', '', null, undefined]) {
    assert.equal(isAllowedAudioMime(mime), false, `${mime} must be rejected`);
  }
});

test('resolves supported extension only as generic-MIME recovery before ffprobe validation', () => {
  assert.equal(resolveAudioMimeType('song.flac', 'application/octet-stream'), 'audio/flac');
  assert.equal(resolveAudioMimeType('song.ogg', ''), 'audio/ogg');
  assert.equal(resolveAudioMimeType('song.m4a', 'audio/mp4'), 'audio/mp4');
  assert.equal(resolveAudioMimeType('payload.exe', 'application/octet-stream'), '');
  assert.equal(resolveAudioMimeType('payload.exe', 'application/pdf'), 'application/pdf');
});

test('valid audio within limits passes', () => {
  const r = validateAudioUpload({ mimeType: 'audio/mpeg', size: 4 * MB, durationSec: 42 });
  assert.deepEqual(r, { ok: true });
});

test('duration is optional — absent duration does not fail validation', () => {
  const r = validateAudioUpload({ mimeType: 'audio/mp4', size: 1 * MB });
  assert.equal(r.ok, true);
});

test('unsupported format -> unsupported_format with supported-format guidance', () => {
  const r = validateAudioUpload({ mimeType: 'application/pdf', size: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unsupported_format');
  assert.match(r.message, /MP3, M4A, AAC, WAV, OGG, or FLAC/);
});

test('oversize -> too_large / "File is too large"', () => {
  const r = validateAudioUpload({ mimeType: 'audio/wav', size: AUDIO_LIMITS.maxBytes + 1 });
  assert.equal(r.code, 'too_large');
  assert.equal(r.message, 'File is too large');
});

test('too-long -> too_long / "Audio is too long"', () => {
  const r = validateAudioUpload({ mimeType: 'audio/mpeg', size: 1 * MB, durationSec: AUDIO_LIMITS.maxDurationSec + 1 });
  assert.equal(r.code, 'too_long');
  assert.equal(r.message, 'Audio is too long');
});

test('zero / non-numeric size -> unreadable / "Audio file could not be read"', () => {
  for (const size of [0, -1, NaN, 'abc', null]) {
    const r = validateAudioUpload({ mimeType: 'audio/mpeg', size });
    assert.equal(r.code, 'unreadable', `size=${size}`);
    assert.equal(r.message, 'Audio file could not be read');
  }
});

test('limits are sane defaults (25MB, 1..600s)', () => {
  assert.equal(AUDIO_LIMITS.maxBytes, 25 * MB);
  assert.equal(AUDIO_LIMITS.minDurationSec, 1);
  assert.equal(AUDIO_LIMITS.maxDurationSec, 600);
});
