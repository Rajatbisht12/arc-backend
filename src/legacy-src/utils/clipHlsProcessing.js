const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { validateVideoFile } = require('./videoProcessing');

const HLS_SEGMENT_SECONDS = 2;
const MAX_PROCESS_STDERR_BYTES = 128 * 1024;
const TRANSCODE_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.CLIP_HLS_TRANSCODE_TIMEOUT_MS || 30 * 60_000)
);

const STANDARD_RENDITIONS = Object.freeze([
  { name: '360p', shortSide: 360, videoBitrate: 700_000, maxRate: 800_000, bufferSize: 1_400_000 },
  { name: '540p', shortSide: 540, videoBitrate: 1_400_000, maxRate: 1_600_000, bufferSize: 2_800_000 },
  { name: '720p', shortSide: 720, videoBitrate: 2_800_000, maxRate: 3_200_000, bufferSize: 5_600_000 },
  { name: '1080p', shortSide: 1080, videoBitrate: 5_000_000, maxRate: 5_800_000, bufferSize: 10_000_000 },
]);

const even = value => Math.max(2, Math.round(Number(value) / 2) * 2);

const renditionDimensions = (sourceWidth, sourceHeight, targetShortSide) => {
  if (sourceWidth >= sourceHeight) {
    const height = even(Math.min(sourceHeight, targetShortSide));
    return { width: even(sourceWidth * height / sourceHeight), height };
  }
  const width = even(Math.min(sourceWidth, targetShortSide));
  return { width, height: even(sourceHeight * width / sourceWidth) };
};

const buildRenditionLadder = ({ width, height, bitRate }) => {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || sourceWidth < 2 || !Number.isFinite(sourceHeight) || sourceHeight < 2) {
    throw new Error('Source dimensions are invalid');
  }
  const sourceShortSide = Math.min(sourceWidth, sourceHeight);
  let candidates = STANDARD_RENDITIONS.filter(item => item.shortSide <= sourceShortSide);
  if (!candidates.length) {
    const shortSide = even(sourceShortSide);
    candidates = [{
      name: `${shortSide}p`,
      shortSide,
      videoBitrate: 450_000,
      maxRate: 520_000,
      bufferSize: 900_000,
    }];
  }
  const sourceVideoBitRate = Number(bitRate);
  const bitrateCeiling = Number.isFinite(sourceVideoBitRate) && sourceVideoBitRate > 0
    ? Math.max(300_000, Math.floor(sourceVideoBitRate * 0.95))
    : null;
  const renditions = [];
  for (const candidate of candidates) {
    const videoBitrate = bitrateCeiling
      ? Math.min(candidate.videoBitrate, bitrateCeiling)
      : candidate.videoBitrate;
    const previous = renditions[renditions.length - 1];
    // A higher-resolution encode at effectively the same bitrate adds storage
    // and ABR choices without adding useful quality. This is most common for
    // already heavily compressed 1080p uploads.
    if (previous && videoBitrate < previous.videoBitrate * 1.15) continue;
    renditions.push({
      ...candidate,
      ...renditionDimensions(sourceWidth, sourceHeight, candidate.shortSide),
      videoBitrate,
      maxRate: Math.max(videoBitrate, Math.min(candidate.maxRate, Math.round(videoBitrate * 1.15))),
      bufferSize: Math.max(videoBitrate * 2, Math.min(candidate.bufferSize, videoBitrate * 2)),
      audioBitrate: 96_000,
    });
  }
  return renditions;
};

const runProcess = (command, args, { timeoutMs = TRANSCODE_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const settle = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    callback(value);
  };
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    const error = new Error(`${command} timed out`);
    error.code = 'CLIP_TRANSCODE_TIMEOUT';
    settle(reject, error);
  }, timeoutMs);
  child.stdout.on('data', chunk => {
    if (Buffer.byteLength(stdout) < MAX_PROCESS_STDERR_BYTES) stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    if (Buffer.byteLength(stderr) < MAX_PROCESS_STDERR_BYTES) stderr += chunk.toString();
  });
  child.on('error', error => settle(reject, error));
  child.on('close', code => {
    if (code === 0) return settle(resolve, { stdout, stderr });
    const error = new Error(stderr || `${command} exited with code ${code}`);
    error.code = command === 'ffprobe' ? 'CLIP_PROBE_FAILED' : 'CLIP_TRANSCODE_FAILED';
    error.exitCode = code;
    settle(reject, error);
  });
});

const probeClipVideo = async inputPath => {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,bit_rate:stream=index,codec_type,width,height,bit_rate:stream_tags=rotate:stream_side_data=rotation',
    '-of', 'json',
    inputPath,
  ], { timeoutMs: 30_000 });
  const parsed = JSON.parse(stdout);
  const video = (parsed.streams || []).find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Uploaded media has no video stream');
  const sideDataRotation = video.side_data_list?.find(item => Number.isFinite(Number(item?.rotation)))?.rotation;
  const rotation = Number(sideDataRotation ?? video.tags?.rotate ?? 0);
  let width = Number(video.width);
  let height = Number(video.height);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(width) || width < 2 || !Number.isFinite(height) || height < 2 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Uploaded media metadata is invalid');
  }
  return {
    width,
    height,
    duration,
    // Prefer the elementary video bitrate so an audio-heavy source cannot
    // falsely justify a larger top rendition. Some containers omit it, in
    // which case the aggregate bitrate is still a useful conservative cap.
    bitRate: Number(video.bit_rate) || Number(parsed.format?.bit_rate) || undefined,
    hasAudio: (parsed.streams || []).some(stream => stream.codec_type === 'audio'),
  };
};

const buildVariantArgs = ({ inputPath, outputPath, segmentPattern, rendition, hasAudio }) => {
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:v:0',
  ];
  if (hasAudio) args.push('-map', '0:a:0?');
  args.push(
    '-vf', `scale=${rendition.width}:${rendition.height}:flags=lanczos,setsar=1`,
    '-c:v', 'libx264',
    '-preset', String(process.env.CLIP_HLS_X264_PRESET || 'veryfast'),
    '-profile:v', 'main',
    '-pix_fmt', 'yuv420p',
    '-b:v', String(rendition.videoBitrate),
    '-maxrate', String(rendition.maxRate),
    '-bufsize', String(rendition.bufferSize),
    '-sc_threshold', '0',
    '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
  );
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', String(rendition.audioBitrate), '-ac', '2');
  else args.push('-an');
  args.push(
    '-sn', '-dn',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', segmentPattern,
    '-hls_flags', 'independent_segments+temp_file',
    outputPath,
  );
  return args;
};

const writeMasterPlaylist = async (outputDir, renditions) => {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const rendition of renditions) {
    const bandwidth = Math.ceil((rendition.maxRate + (rendition.hasAudio ? rendition.audioBitrate : 0)) * 1.1);
    const averageBandwidth = rendition.videoBitrate + (rendition.hasAudio ? rendition.audioBitrate : 0);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${averageBandwidth},RESOLUTION=${rendition.width}x${rendition.height}`,
      `${rendition.name}/index.m3u8`
    );
  }
  await fs.writeFile(path.join(outputDir, 'master.m3u8'), `${lines.join('\n')}\n`, 'utf8');
};

const validateVariant = async (variantDir, expected) => {
  const playlistPath = path.join(variantDir, 'index.m3u8');
  const playlist = await fs.readFile(playlistPath, 'utf8');
  if (!playlist.includes('#EXT-X-MAP:') || !playlist.includes('#EXT-X-ENDLIST')) {
    throw new Error('Generated CMAF playlist is incomplete');
  }
  const files = await fs.readdir(variantDir);
  if (!files.includes('init.mp4') || !files.some(name => name.endsWith('.m4s'))) {
    throw new Error('Generated CMAF initialization or media segments are missing');
  }
  const metadata = await probeClipVideo(playlistPath);
  const durationTolerance = Math.max(0.5, Math.min(2, Number(expected.duration) * 0.02));
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    throw new Error('Generated CMAF rendition dimensions do not match the requested output');
  }
  if (Math.abs(metadata.duration - Number(expected.duration)) > durationTolerance) {
    throw new Error('Generated CMAF rendition duration does not match the source');
  }
  // Decode representative media at the beginning and tail. FFmpeg already
  // wrote all packets; these checks ensure the init segment and referenced
  // media can actually initialize and decode before publication.
  await runProcess('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror',
    '-i', playlistPath,
    '-t', '1',
    '-map', '0:v:0', '-map', '0:a:0?',
    '-f', 'null', '-',
  ], { timeoutMs: 30_000 });
  if (metadata.duration > 2) {
    await runProcess('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror',
      '-ss', String(Math.max(0, metadata.duration - 1)),
      '-i', playlistPath,
      '-t', '1',
      '-map', '0:v:0', '-map', '0:a:0?',
      '-f', 'null', '-',
    ], { timeoutMs: 30_000 });
  }
};

const generateFastStartFallback = async ({ inputPath, outputPath }) => {
  await runProcess('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-sn', '-dn',
    outputPath,
  ]);
  return outputPath;
};

const generateClipHls = async ({ inputPath, outputDir }) => {
  const metadata = await validateVideoFile(inputPath);
  const ladder = buildRenditionLadder(metadata);
  await fs.mkdir(outputDir, { recursive: true });
  const renditions = [];
  // Sequential encoding keeps one job from multiplying CPU and disk pressure.
  for (const rendition of ladder) {
    const variantDir = path.join(outputDir, rendition.name);
    await fs.mkdir(variantDir, { recursive: true });
    await runProcess('ffmpeg', buildVariantArgs({
      inputPath,
      outputPath: path.join(variantDir, 'index.m3u8'),
      segmentPattern: path.join(variantDir, 'segment_%05d.m4s'),
      rendition,
      hasAudio: metadata.hasAudio,
    }));
    await validateVariant(variantDir, {
      width: rendition.width,
      height: rendition.height,
      duration: metadata.duration,
    });
    renditions.push({ ...rendition, hasAudio: metadata.hasAudio });
  }
  await writeMasterPlaylist(outputDir, renditions);
  let fallbackPath = null;
  try {
    fallbackPath = await generateFastStartFallback({
      inputPath,
      outputPath: path.join(outputDir, 'fallback.mp4'),
    });
    await validateVideoFile(fallbackPath, { expectedDuration: metadata.duration });
  } catch {
    // The original upload remains a valid progressive fallback. A remux
    // failure must not discard otherwise valid adaptive output.
  }
  return { metadata, renditions, fallbackPath };
};

module.exports = {
  HLS_SEGMENT_SECONDS,
  STANDARD_RENDITIONS,
  TRANSCODE_TIMEOUT_MS,
  buildRenditionLadder,
  buildVariantArgs,
  writeMasterPlaylist,
  probeClipVideo,
  generateFastStartFallback,
  generateClipHls,
};
