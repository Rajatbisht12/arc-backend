#!/usr/bin/env node
// Local encoded test patterns only. No padding/free atoms, personal recordings,
// AWS requests or guarantee of an exact byte count. Always report actual bytes.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const path = require('node:path'), os = require('node:os');
const specs = [
  { nominalMiB: 10, width: 1080, height: 1920, seconds: 30, bitrate: 2_500_000 },
  { nominalMiB: 50, width: 1920, height: 1080, seconds: 30, bitrate: 13_700_000 },
  { nominalMiB: 100, width: 1080, height: 1080, seconds: 60, bitrate: 13_700_000 },
  { nominalMiB: 200, width: 1920, height: 1080, seconds: 120, bitrate: 13_700_000 },
  { nominalMiB: 300, width: 1080, height: 1920, seconds: 120, bitrate: 20_700_000 },
  { nominalMiB: 500, width: 1920, height: 1080, seconds: 180, bitrate: 23_100_000 },
];
(async () => {
  if (!process.argv.includes('--run')) throw Error('Use --run for a local synthetic fixture set (~1.3 GiB); no upload is performed');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squadhunt-staging-fixtures-'));
  const result = { root, kind: 'Synthetic encoded motion/noise + AAC; not gaming or camera footage; nominal size classes, actual bytes authoritative', files: [] };
  console.log(JSON.stringify({ root }));
  const selected = process.argv.includes('--class') ? Number(process.argv[process.argv.indexOf('--class') + 1]) : null;
  if (selected !== null && !specs.some(row => row.nominalMiB === selected)) throw Error('Unknown nominal size class');
  for (const spec of specs.filter(row => selected === null || row.nominalMiB === selected)) {
    const file = path.join(root, `staging-${spec.nominalMiB}mib-class.mp4`);
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${spec.width}x${spec.height}:rate=30`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(spec.seconds), '-vf', 'noise=alls=12:allf=t',
      '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-b:v', String(spec.bitrate), '-maxrate', String(Math.round(spec.bitrate * 1.1)), '-bufsize', String(spec.bitrate * 2),
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', file], { maxBuffer: 1024 * 1024 });
    const bytes = (await fs.stat(file)).size;
    if (bytes > 524288000) throw Error(`Encoded fixture exceeds policy; do not upload it (${bytes} bytes)`);
    const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
    const row = { ...spec, file, bytes, actualMiB: bytes / 1048576, sha256: hash.digest('hex') };
    result.files.push(row); await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(row));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
