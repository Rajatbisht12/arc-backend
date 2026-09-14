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
