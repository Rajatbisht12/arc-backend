#!/usr/bin/env node
'use strict';
// No AWS/database clients. Uses the existing production encoder, not a second
// pipeline. Synthetic motion/HEVC/VFR inputs are not real phone/gaming footage.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const fixtures = [
  { name: 'portrait-1080-audio', size: '1080x1920', seconds: 30 },
  { name: 'landscape-1080-motion', size: '1920x1080', seconds: 30, noise: true, crf: 22 },
  { name: 'square-audio', size: '1080x1080', seconds: 30 },
  { name: '4k-silent', size: '3840x2160', seconds: 10, silent: true },
  { name: 'hevc-mov', size: '1920x1080', seconds: 20, hevc: true },
  { name: '720-silent', size: '1280x720', seconds: 60, silent: true },
  { name: 'long-360-audio', size: '640x360', seconds: 300 },
  { name: 'vfr-720-audio', size: '1280x720', seconds: 30, vfr: true },
];
async function bytes(directory) {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? await bytes(file) : (await fs.stat(file)).size;
  }
  return total;
}
async function hasFastStart(file) {
  const fd = await fs.open(file, 'r');
  try {
    const { size } = await fd.stat();
    const header = Buffer.alloc(16); let offset = 0, moov = false;
    // Walk top-level atoms by seeking. Long videos can have a moov larger
    // than a small fixed header buffer; this never reads the mdat payload.
    for (let count = 0; count < 128 && offset + 8 <= size; count++) {
      const read = await fd.read(header, 0, 16, offset);
      if (read.bytesRead < 8) return false;
      let length = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      if (type === 'mdat') return moov;
      if (type === 'moov') moov = true;
      if (length === 1) {
        if (read.bytesRead < 16 || header.readBigUInt64BE(8) > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        length = Number(header.readBigUInt64BE(8));
      } else if (length === 0) length = size - offset;
      if (length < 8 || offset + length > size) return false;
      offset += length;
    }
    return false;
  } finally { await fd.close(); }
}
async function generate(spec, target) {
  const args = ['-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${spec.size}:rate=30`];
  if (!spec.silent) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  args.push('-t', String(spec.seconds));
  if (spec.noise) args.push('-vf', 'noise=alls=12:allf=t');
  if (spec.vfr) args.push('-vf', "select='if(lt(mod(t,4),2),1,not(mod(n,2)))'", '-fps_mode', 'vfr');
  if (spec.hevc) args.push('-c:v', 'libx265', '-x265-params', 'pools=1:frame-threads=1:log-level=error', '-preset', 'ultrafast', '-tag:v', 'hvc1');
  else args.push('-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-crf', String(spec.crf ?? 18));
  if (!spec.silent) args.push('-c:a', 'aac', '-b:a', '128k');
  await run('ffmpeg', [...args, target], { maxBuffer: 1024 * 1024 });
}
async function encode(input, output) {
  const { generateClipHls } = require('../src/legacy-src/utils/clipHlsProcessing');
  const result = await generateClipHls({ inputPath: input, outputDir: output });
  const details = [];
  for (const rendition of result.renditions) {
    assert.ok(rendition.width <= result.metadata.width && rendition.height <= result.metadata.height, 'no upscale');
    const playlist = path.join(output, rendition.name, 'index.m3u8');
    // Decode the entire output, not just head/tail checks used at runtime.
    await run('ffmpeg', ['-v', 'error', '-i', playlist, '-threads', '2', '-f', 'null', '-'], { maxBuffer: 1024 * 1024 });
    details.push({ name: rendition.name, width: rendition.width, height: rendition.height, bytes: await bytes(path.dirname(playlist)) });
  }
  await run('ffmpeg', ['-v', 'error', '-i', result.fallbackPath, '-threads', '2', '-f', 'null', '-'], { maxBuffer: 1024 * 1024 });
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,duration:format=duration', '-of', 'json', result.fallbackPath]);
  const fallback = JSON.parse(stdout);
  assert.equal(fallback.streams[0].codec_name, 'h264');
  assert.equal(fallback.streams.some(s => s.codec_name === 'aac'), result.metadata.hasAudio);
  const ratio = fallback.streams[0].width / fallback.streams[0].height;
  assert.ok(Math.abs(ratio - result.metadata.width / result.metadata.height) < 0.01, 'aspect ratio');
  assert.ok(await hasFastStart(result.fallbackPath), 'fast-start moov before mdat');
  console.log(JSON.stringify({ metadata: result.metadata, variants: details, outputBytes: result.outputBytes, fallback, integrity: 'full decode passed' }));
}
async function measuredEncode(input, output) {
  const started = performance.now();
  const child = spawn(process.execPath, [__filename, '--encode', input, output], { env: { ...process.env, VIDEO_FFMPEG_THREADS: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', sampling = false;
  const metrics = { peakSampledProcessTreeRssBytes: 0, peakSampledProcessTreeCpuPercent: 0, peakSampledDiskBytes: 0, samples: 0 };
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { if (stderr.length < 16384) stderr += chunk; });
  const sample = async () => {
    if (sampling) return; sampling = true;
    try {
      const { stdout: listing } = await run('ps', ['-axo', 'pid=,ppid=,rss=,%cpu=']);
      const rows = listing.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      const pids = new Set([child.pid]);
      let previous; do { previous = pids.size; for (const [pid, parent] of rows) if (pids.has(parent)) pids.add(pid); } while (previous !== pids.size);
      const tree = rows.filter(([pid]) => pids.has(pid));
      metrics.peakSampledProcessTreeRssBytes = Math.max(metrics.peakSampledProcessTreeRssBytes, tree.reduce((n, row) => n + row[2] * 1024, 0));
      metrics.peakSampledProcessTreeCpuPercent = Math.max(metrics.peakSampledProcessTreeCpuPercent, tree.reduce((n, row) => n + row[3], 0));
      metrics.peakSampledDiskBytes = Math.max(metrics.peakSampledDiskBytes, (await fs.stat(input)).size + await bytes(output));
      metrics.samples++;
    } catch { /* ps/files may disappear at child exit; don't invent a sample */ }
    finally { sampling = false; }
  };
  const timer = setInterval(sample, 500);
  try {
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || `encode exit ${code}`))); });
    return { ...JSON.parse(stdout), wallSeconds: Math.round((performance.now() - started) / 10) / 100, ...metrics };
  } finally { clearInterval(timer); }
}
async function main() {
  if (process.argv[2] === '--encode') return encode(process.argv[3], process.argv[4]);
  if (!process.argv.includes('--run')) throw new Error('Local synthetic benchmark only. Run with --run [--fixture NAME]. No AWS/network upload is performed.');
  const selected = process.argv.includes('--fixture') ? process.argv[process.argv.indexOf('--fixture') + 1] : undefined;
  const specs = selected ? fixtures.filter(f => f.name === selected) : fixtures;
  if (!specs.length) throw new Error('Unknown fixture');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squadhunt-video-benchmark-'));
  const report = { environment: `${os.platform()}/${os.arch()} local (not ECS/Fargate)`, fixtureKind: 'synthetic encoded motion, not camera/gaming footage; no padding atoms', sampling: '500 ms ps process-tree RSS/CPU; sampled peaks, not cgroup high-water marks; wall includes integrity verification', createdAt: new Date().toISOString(), root, results: [] };
  console.log(JSON.stringify({ root, selected: specs.map(s => s.name) }));
  for (const spec of specs) {
    const input = path.join(root, `${spec.name}.${spec.hevc ? 'mov' : 'mp4'}`);
    const output = path.join(root, `${spec.name}-outputs`);
    console.log(`Generating ${spec.name} (${spec.seconds}s)`);
    await generate(spec, input);
    const result = { name: spec.name, sourceBytes: (await fs.stat(input)).size, ...await measuredEncode(input, output) };
    report.results.push(result);
    await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(result));
  }
  console.log(`Evidence retained locally: ${path.join(root, 'results.json')}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { fixtures, hasFastStart };
