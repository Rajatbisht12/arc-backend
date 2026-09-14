const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  HLS_SEGMENT_SECONDS,
  buildRenditionLadder,
  buildVariantArgs,
  writeMasterPlaylist,
} = require('./clipHlsProcessing');

test('rendition ladder never upscales landscape or portrait sources', () => {
  const landscape = buildRenditionLadder({ width: 1920, height: 1080 });
  assert.deepEqual(landscape.map(item => item.name), ['360p', '540p', '720p', '1080p']);
  assert.deepEqual(landscape.map(item => [item.width, item.height]), [
    [640, 360], [960, 540], [1280, 720], [1920, 1080]
  ]);

  const portrait = buildRenditionLadder({ width: 720, height: 1280 });
  assert.deepEqual(portrait.map(item => item.name), ['360p', '540p', '720p']);
  assert.deepEqual(portrait.map(item => [item.width, item.height]), [
    [360, 640], [540, 960], [720, 1280]
  ]);

  const small = buildRenditionLadder({ width: 240, height: 426 });
  assert.equal(small.length, 1);
  assert.deepEqual([small[0].width, small[0].height], [240, 426]);
});

test('a low-bitrate source does not create redundant high-resolution renditions', () => {
  const compressed1080 = buildRenditionLadder({ width: 1920, height: 1080, bitRate: 1_600_000 });
  assert.deepEqual(compressed1080.map(item => item.name), ['360p', '540p']);
  assert.ok(compressed1080.every(item => item.videoBitrate <= 1_520_000));

  const healthy720 = buildRenditionLadder({ width: 1280, height: 720, bitRate: 2_400_000 });
  assert.deepEqual(healthy720.map(item => item.name), ['360p', '540p', '720p']);
  assert.ok(healthy720[2].videoBitrate <= 2_280_000);
});

test('variant command produces two-second fMP4 HLS with aligned forced keyframes', () => {
  const [rendition] = buildRenditionLadder({ width: 640, height: 360 });
  const args = buildVariantArgs({
    inputPath: '/tmp/input.mp4',
    outputPath: '/tmp/360p/index.m3u8',
    segmentPattern: '/tmp/360p/segment_%05d.m4s',
    rendition,
    hasAudio: true,
  });
  const command = args.join(' ');
  assert.match(command, /-c:v libx264/);
  assert.match(command, /-c:a aac/);
  assert.match(command, /-hls_segment_type fmp4/);
  assert.match(command, /-hls_time 2/);
  assert.match(command, /-force_key_frames expr:gte\(t,n_forced\*2\)/);
  assert.match(command, /segment_%05d\.m4s/);
  assert.equal(HLS_SEGMENT_SECONDS, 2);
});

test('master playlist exposes every variant with bandwidth and resolution', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-master-test-'));
  try {
    const renditions = buildRenditionLadder({ width: 1280, height: 720 }).map(item => ({ ...item, hasAudio: true }));
    await writeMasterPlaylist(directory, renditions);
    const master = await fs.readFile(path.join(directory, 'master.m3u8'), 'utf8');
    assert.match(master, /^#EXTM3U/m);
    assert.match(master, /#EXT-X-INDEPENDENT-SEGMENTS/);
    assert.match(master, /RESOLUTION=640x360/);
    assert.match(master, /RESOLUTION=960x540/);
    assert.match(master, /RESOLUTION=1280x720/);
    assert.match(master, /360p\/index\.m3u8/);
    assert.match(master, /720p\/index\.m3u8/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
