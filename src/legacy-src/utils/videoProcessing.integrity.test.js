const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { processPostVideo, processStoryVideo, validateVideoFile } = require('./videoProcessing');

let fixtureDir;
let mp4WithAudio;
let mp4WithoutAudio;
let webm;

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `${command} failed`)));
});

const ffmpeg = output => [
  '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
  '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast',
  '-c:a', 'aac', '-movflags', '+faststart', output,
];

test.before(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-video-integrity-test-'));
  mp4WithAudio = path.join(fixtureDir, 'audio.mp4');
  mp4WithoutAudio = path.join(fixtureDir, 'silent.mp4');
  webm = path.join(fixtureDir, 'source.webm');
  await run('ffmpeg', ffmpeg(mp4WithAudio));
  await run('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-an', '-movflags', '+faststart', mp4WithoutAudio,
  ]);
  await run('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-t', '2', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
    '-an', webm,
  ]);
});

test.after(async () => {
  if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
});

const uploadFile = async (filePath, mimetype) => {
  const buffer = await fs.readFile(filePath);
  return { buffer, size: buffer.length, mimetype, originalname: path.basename(filePath) };
};

test('valid MP4 with audio is remuxed, validated and retains its duration', async () => {
  const result = await processPostVideo(await uploadFile(mp4WithAudio, 'video/mp4'));
  assert.equal(result.optimized, true);
  assert.equal(result.mimetype, 'video/mp4');
  assert.equal(result.hasAudio, true);
  assert.ok(Math.abs(result.duration - 8) < 0.1);
  assert.equal(result.integrity.outputBytes, result.buffer.length);
  assert.equal(result.integrity.sourceSha256.length, 64);
  assert.equal(result.integrity.outputSha256.length, 64);
});

test('valid video without audio and portrait dimensions remains valid', async () => {
  const result = await processPostVideo(await uploadFile(mp4WithoutAudio, 'video/mp4'));
  assert.equal(result.hasAudio, false);
  assert.equal(result.width, 360);
  assert.equal(result.height, 640);
  assert.ok(Math.abs(result.duration - 2) < 0.1);
});

test('validated non-MP4 media keeps its real container and MIME type', async () => {
  const source = await uploadFile(webm, 'video/webm');
  const result = await processPostVideo(source);
  assert.equal(result.mimetype, 'video/webm');
  assert.equal(result.originalname, 'source.webm');
  assert.equal(result.integrity.processingMode, 'validated-original');
  assert.equal(result.buffer, source.buffer);
});

test('repeated and concurrent processing uses isolated files and produces valid output every time', async () => {
  const source = await uploadFile(mp4WithoutAudio, 'video/mp4');
  const results = await Promise.all(Array.from({ length: 4 }, () => processPostVideo(source)));
  assert.equal(results.length, 4);
  assert.ok(results.every(result => result.optimized && result.duration > 0 && result.buffer.length > 0));
  assert.equal(new Set(results.map(result => result.integrity.outputSha256)).size, 1);
});

test('truncated fast-start MP4 is rejected even though ffprobe duration metadata survives', async () => {
  const source = await uploadFile(mp4WithAudio, 'video/mp4');
  const truncated = source.buffer.subarray(0, Math.floor(source.buffer.length * 0.62));
  await assert.rejects(
    processPostVideo({ ...source, buffer: truncated, size: truncated.length }),
    error => error?.code === 'INVALID_VIDEO_MEDIA' && error?.statusCode === 422,
  );
});

test('declared byte mismatch and malformed media are never returned as fallback uploads', async () => {
  const valid = await uploadFile(mp4WithoutAudio, 'video/mp4');
  await assert.rejects(
    processPostVideo({ ...valid, size: valid.buffer.length + 1 }),
    error => error?.code === 'INVALID_VIDEO_MEDIA',
  );
  const malformed = Buffer.from('not a video');
  await assert.rejects(
    processPostVideo({ buffer: malformed, size: malformed.length, mimetype: 'video/mp4', originalname: 'bad.mp4' }),
    error => error?.code === 'INVALID_VIDEO_MEDIA',
  );
});

test('duration comparison rejects a finalized output that lost content', async () => {
  await assert.rejects(
    validateVideoFile(mp4WithoutAudio, { expectedDuration: 8 }),
    /duration changed/,
  );
});

test('story processing validates both source and finalized output instead of falling back', async () => {
  const source = await uploadFile(mp4WithAudio, 'video/mp4');
  const valid = await processStoryVideo(source);
  assert.equal(valid.optimized, true);
  assert.ok(valid.duration > 0 && valid.duration <= 8.1);
  const truncated = source.buffer.subarray(0, Math.floor(source.buffer.length * 0.62));
  await assert.rejects(
    processStoryVideo({ ...source, buffer: truncated, size: truncated.length }),
    error => error?.code === 'INVALID_VIDEO_MEDIA' && error?.statusCode === 422,
  );
});
