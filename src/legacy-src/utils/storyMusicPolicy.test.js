const assert = require('node:assert/strict');
const test = require('node:test');
const {
  STORY_MUSIC_MAX_BYTES,
  hasMp3Signature,
  hasSupportedAudioSignature,
  resolveStoryMusicTrim,
  safeMusicFilename,
  validateStoryMusicDuration,
  validateStoryMusicFile,
} = require('./storyMusicPolicy');

const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
const m4aBuffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const aacBuffer = Buffer.from([0xff, 0xf1, 0x50, 0x80]);
const wavBuffer = Buffer.from('RIFF0000WAVEfmt ', 'ascii');
const oggBuffer = Buffer.from('OggS0000', 'ascii');
const flacBuffer = Buffer.from('fLaC0000', 'ascii');

const musicFile = (overrides = {}) => ({
  originalname: 'soundtrack.mp3',
  mimetype: 'audio/mpeg',
  size: mp3Buffer.length,
  buffer: mp3Buffer,
  ...overrides,
});

test('backend accepts supported audio signatures and sanitizes display names', () => {
  assert.equal(hasMp3Signature(mp3Buffer), true);
  for (const buffer of [mp3Buffer, m4aBuffer, aacBuffer, wavBuffer, oggBuffer, flacBuffer]) {
    assert.equal(hasSupportedAudioSignature(buffer), true);
  }
  const result = validateStoryMusicFile(musicFile({ originalname: '../my<script> song.mp3' }));
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.filename, 'myscript song.mp3');
  assert.equal(safeMusicFilename('../../unsafe.mp3'), 'unsafe.mp3');
  assert.equal(validateStoryMusicFile(musicFile({ originalname: 'loop.ogg', mimetype: 'audio/ogg', buffer: oggBuffer, size: oggBuffer.length })).ok, true);
  assert.equal(validateStoryMusicFile(musicFile({ originalname: 'master.flac', mimetype: 'audio/flac', buffer: flacBuffer, size: flacBuffer.length })).ok, true);
});

test('backend rejects spoofed formats, invalid signatures, and oversized audio', () => {
  assert.equal(validateStoryMusicFile(musicFile({ originalname: 'soundtrack.exe', mimetype: 'application/octet-stream' })).code, 'STORY_MUSIC_UNSUPPORTED_FORMAT');
  assert.equal(validateStoryMusicFile(musicFile({ buffer: Buffer.from('not-mp3') })).code, 'STORY_MUSIC_INVALID_SIGNATURE');
  assert.equal(validateStoryMusicFile(musicFile({ size: STORY_MUSIC_MAX_BYTES + 1 })).code, 'STORY_MUSIC_TOO_LARGE');
});

test('backend independently validates verified soundtrack duration', () => {
  assert.equal(validateStoryMusicDuration(1).ok, true);
  assert.equal(validateStoryMusicDuration(600).ok, true);
  assert.equal(validateStoryMusicDuration(0).code, 'STORY_MUSIC_DURATION_INVALID');
  assert.equal(validateStoryMusicDuration(601).code, 'STORY_MUSIC_TOO_LONG');
});

test('backend clamps Story music trim offsets to the media-owned story duration', () => {
  assert.deepEqual(resolveStoryMusicTrim({ musicStartTime: 40 }, 95, 30), {
    startTime: 40,
    endTime: 70,
    playbackDuration: 30,
  });
  assert.deepEqual(resolveStoryMusicTrim({ musicStartTime: 90 }, 95, 30), {
    startTime: 65,
    endTime: 95,
    playbackDuration: 30,
  });
  assert.deepEqual(resolveStoryMusicTrim({ musicStartTime: 10 }, 18, 30), {
    startTime: 0,
    endTime: 18,
    playbackDuration: 18,
  });
  assert.deepEqual(resolveStoryMusicTrim({ musicStartTime: -5 }, 95, 10), {
    startTime: 0,
    endTime: 10,
    playbackDuration: 10,
  });
});
