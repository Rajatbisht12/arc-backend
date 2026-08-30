const assert = require('node:assert/strict');
const test = require('node:test');
const {
  STORY_MUSIC_MAX_BYTES,
  hasMp3Signature,
  safeMusicFilename,
  validateStoryMusicDuration,
  validateStoryMusicFile,
} = require('./storyMusicPolicy');

const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);

const musicFile = (overrides = {}) => ({
  originalname: 'soundtrack.mp3',
  mimetype: 'audio/mpeg',
  size: mp3Buffer.length,
  buffer: mp3Buffer,
  ...overrides,
});

test('backend accepts an MP3 with an MP3 signature and sanitizes its display name', () => {
  assert.equal(hasMp3Signature(mp3Buffer), true);
  const result = validateStoryMusicFile(musicFile({ originalname: '../my<script> song.mp3' }));
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.filename, 'myscript song.mp3');
  assert.equal(safeMusicFilename('../../unsafe.mp3'), 'unsafe.mp3');
});

test('backend rejects spoofed formats, invalid signatures, and oversized audio', () => {
  assert.equal(validateStoryMusicFile(musicFile({ originalname: 'soundtrack.wav' })).code, 'STORY_MUSIC_MP3_REQUIRED');
  assert.equal(validateStoryMusicFile(musicFile({ mimetype: 'audio/wav' })).code, 'STORY_MUSIC_MP3_REQUIRED');
  assert.equal(validateStoryMusicFile(musicFile({ buffer: Buffer.from('not-mp3') })).code, 'STORY_MUSIC_INVALID_SIGNATURE');
  assert.equal(validateStoryMusicFile(musicFile({ size: STORY_MUSIC_MAX_BYTES + 1 })).code, 'STORY_MUSIC_TOO_LARGE');
});

test('backend independently validates verified soundtrack duration', () => {
  assert.equal(validateStoryMusicDuration(1).ok, true);
  assert.equal(validateStoryMusicDuration(600).ok, true);
  assert.equal(validateStoryMusicDuration(0).code, 'STORY_MUSIC_DURATION_INVALID');
  assert.equal(validateStoryMusicDuration(601).code, 'STORY_MUSIC_TOO_LONG');
});
