const assert = require('node:assert/strict');
const { execFile, spawnSync } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { promisify } = require('util');
const { generateClipHls } = require('./clipHlsProcessing');

const run = promisify(execFile);
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('FFmpeg generates playable aligned H.264/AAC CMAF variants', { skip: !hasFfmpeg }, async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hls-integration-'));
  const input = path.join(workDir, 'source.mp4');
  const output = path.join(workDir, 'hls');
  try {
    await run('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
      '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', input,
    ]);
    const result = await generateClipHls({ inputPath: input, outputDir: output });
    assert.deepEqual(result.renditions.map(item => item.name), ['360p', '540p', '720p']);
    assert.equal(result.fallbackPath, path.join(output, 'fallback.mp4'));
    assert.equal(result.thumbnailPath, path.join(output, 'thumbnail.jpg'));
    assert.ok(result.outputBytes.fallback > 0);
    assert.ok(result.outputBytes.thumbnail > 0);
    assert.ok(result.outputBytes.hls > 0);
    assert.ok(result.outputBytes.fallback < (await fs.stat(input)).size);
    const { stdout: fallbackJson } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', result.fallbackPath,
    ]);
    const fallbackStreams = JSON.parse(fallbackJson).streams;
    assert.equal(fallbackStreams[0].codec_name, 'h264');
    assert.ok(fallbackStreams[0].width <= 720 && fallbackStreams[0].height <= 1280);
    assert.ok(fallbackStreams.some(stream => stream.codec_name === 'aac'));
    const fallback = await fs.readFile(result.fallbackPath);
    assert.ok(fallback.indexOf(Buffer.from('moov')) < fallback.indexOf(Buffer.from('mdat')));
    const master = await fs.readFile(path.join(output, 'master.m3u8'), 'utf8');
    assert.equal((master.match(/#EXT-X-STREAM-INF/g) || []).length, 3);

    const keyframeTimelines = [];
    for (const rendition of result.renditions) {
      const playlist = path.join(output, rendition.name, 'index.m3u8');
      const text = await fs.readFile(playlist, 'utf8');
      assert.match(text, /#EXT-X-MAP:URI="init\.mp4"/);
      assert.equal((text.match(/\.m4s/g) || []).length, 3);
      const { stdout: streamJson } = await run('ffprobe', [
        '-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', playlist,
      ]);
      const streams = JSON.parse(streamJson).streams;
      assert.equal(streams[0].codec_name, 'h264');
      assert.ok(streams.some(stream => stream.codec_name === 'aac'));
      const { stdout: packets } = await run('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', playlist,
      ]);
      keyframeTimelines.push(packets.trim().split('\n')
        .filter(line => line.split(',')[1]?.includes('K'))
        .map(line => Number(line.split(',')[0]).toFixed(3)));
    }
    assert.deepEqual(keyframeTimelines[1], keyframeTimelines[0]);
    assert.deepEqual(keyframeTimelines[2], keyframeTimelines[0]);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

for (const [label, size] of [['360p-landscape', '640x360'], ['square', '540x540'], ['1080p', '1920x1080'], ['4k', '3840x2160']]) {
  test(`silent ${label} produces capped MP4 and verified HLS without upscaling`, { skip: !hasFfmpeg }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-video-shape-'));
    try {
      const input = path.join(root, 'input.mp4');
      await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24`,
        '-t', '0.5', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-qp', '0', input]);
      const result = await generateClipHls({ inputPath: input, outputDir: path.join(root, 'out') });
      assert.ok(result.renditions.every(row => row.width <= result.metadata.width && row.height <= result.metadata.height));
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', result.fallbackPath]);
      const video = JSON.parse(stdout).streams[0];
      assert.equal(video.codec_name, 'h264');
      assert.ok(Math.max(video.width, video.height) <= 1280);
      assert.ok(Math.min(video.width, video.height) <= 720);
      assert.equal(JSON.parse(stdout).streams.length, 1);
      assert.ok(result.outputBytes.thumbnail < 512 * 1024);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}

test('corrupt input and pre-cancelled jobs cannot publish playback', { skip: !hasFfmpeg }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-invalid-video-'));
  try {
    const input = path.join(root, 'fake.mp4');
    await fs.writeFile(input, Buffer.from('not a video'));
    await assert.rejects(generateClipHls({ inputPath: input, outputDir: path.join(root, 'out') }));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(generateClipHls({ inputPath: input, outputDir: path.join(root, 'out'), signal: controller.signal }));
    await assert.rejects(fs.access(path.join(root, 'out', 'master.m3u8')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('rotation metadata becomes correctly oriented playback and cover', { skip: !hasFfmpeg }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-video-rotation-'));
  try {
    const base = path.join(root, 'base.mp4'); const input = path.join(root, 'rotated.mp4');
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x360:rate=24', '-t', '0.5', '-c:v', 'libx264', '-threads', '2', base]);
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-display_rotation', '90', '-i', base, '-c', 'copy', input]);
    const result = await generateClipHls({ inputPath: input, outputDir: path.join(root, 'out') });
    assert.equal(result.metadata.rotation, 90);
    assert.equal(result.metadata.width, 360); assert.equal(result.metadata.height, 720);
    for (const output of [result.fallbackPath, result.thumbnailPath]) {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', output]);
      const dimensions = JSON.parse(stdout).streams[0];
      assert.equal(dimensions.height / dimensions.width, 2);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

const hasHevcEncoder = hasFfmpeg && String(spawnSync('ffmpeg', ['-encoders'], { encoding: 'utf8' }).stdout).includes('libx265');
test('MOV HEVC input becomes H264 playback', { skip: !hasHevcEncoder }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-video-hevc-'));
  try {
    const input = path.join(root, 'iphone.mov');
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24', '-t', '0.5',
      '-c:v', 'libx265', '-x265-params', 'pools=1:frame-threads=1:log-level=error', '-tag:v', 'hvc1', input]);
    const result = await generateClipHls({ inputPath: input, outputDir: path.join(root, 'out') });
    assert.equal(result.metadata.videoCodec, 'hevc');
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'json', result.fallbackPath]);
    assert.equal(JSON.parse(stdout).streams[0].codec_name, 'h264');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
