const workerWitness = require('./videoWorkerWitness');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { validateVideoFile } = require('./videoProcessing');

const HLS_SEGMENT_SECONDS = 2;
const MAX_PLAYBACK_FPS = 30;
const FFMPEG_THREADS = String(Math.max(1, Math.min(4, Number(process.env.VIDEO_FFMPEG_THREADS) || 2)));
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

// Pick one source frame per output time bucket. Unlike the fps filter this
// never fills sparse/VFR intervals with duplicate frames. Lower-rate sources
// keep their time grid; high-rate/VFR bursts are bounded to a 30 Hz grid.
// The encoder uses the filter's time base so nominal metadata is capped too.
const playbackFrameRatePolicy = (metadata = {}) => {
  const sourceRate = Number(metadata.nominalFrameRate || metadata.frameRate);
  const frameRate = Number.isFinite(sourceRate) && sourceRate > 0
    ? Math.min(MAX_PLAYBACK_FPS, sourceRate) : MAX_PLAYBACK_FPS;
  const rate = String(Number(frameRate.toFixed(9)));
  return { frameRate, gopFrames: Math.max(1, Math.ceil(frameRate * HLS_SEGMENT_SECONDS)),
    filter: `select='isnan(prev_selected_t)+gt(floor(t*${rate}+0.000001),floor(prev_selected_t*${rate}+0.000001))',settb=expr=1/${rate}` };
};

const assertPlaybackFrameRate = metadata => {
  if (![metadata.frameRate, metadata.nominalFrameRate].every(value => Number.isFinite(value) && value > 0 && value <= MAX_PLAYBACK_FPS + 0.001)) {
    throw new Error('Generated playback exceeds the 30 fps policy or has unverified frame timing');
  }
};

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
  // Experimental, opt-in high-resolution ladder. Keep 360p for slow links,
  // 720p for the common mobile tier, and 1080p for high-detail/gaming sources.
  // The default four-rung ladder remains unchanged until real ABR testing.
  if (process.env.POST_VIDEO_HLS_LADDER_PROFILE === 'optimized-highres'
    && sourceShortSide >= 1080 && Number(bitRate) >= 5_000_000) {
    candidates = candidates.filter(item => item.name !== '540p');
  }
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

const runProcess = (command, args, { timeoutMs = TRANSCODE_TIMEOUT_MS, signal, onProgress } = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason || new Error('Video processing cancelled')); return; }
  const progressEnabled = command === 'ffmpeg' && (typeof onProgress === 'function' || workerWitness.enabled());
  const child = spawn(command, ['-protocol_whitelist', 'file', ...(progressEnabled ? ['-progress', 'pipe:1', '-nostats'] : []), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const processWitness = command === 'ffmpeg' ? workerWitness.begin(child) : null;
  let stdout = '';
  let stderr = '';
  let progressBuffer = '';
  let progressFields = {};
  let settled = false;
  const settle = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    callback(value);
  };
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    const error = new Error(`${command} timed out`);
    error.code = 'CLIP_TRANSCODE_TIMEOUT';
    settle(reject, error);
  }, timeoutMs);
  const abort = () => {
    child.kill('SIGKILL');
    settle(reject, signal.reason || new Error('Video processing cancelled'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', chunk => {
    if (!progressEnabled) {
      if (Buffer.byteLength(stdout) < MAX_PROCESS_STDERR_BYTES) stdout += chunk.toString();
      return;
    }
    progressBuffer += chunk.toString();
    let newline;
    while ((newline = progressBuffer.indexOf('\n')) !== -1) {
      const line = progressBuffer.slice(0, newline).trim();
      progressBuffer = progressBuffer.slice(newline + 1);
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (key === 'progress') {
        const outTimeUs = Number(progressFields.out_time_us ?? progressFields.out_time_ms);
        const frame = Number(progressFields.frame);
        if (Number.isFinite(outTimeUs) && outTimeUs >= 0) {
          if (Number.isSafeInteger(frame) && frame >= 0) workerWitness.progress(processWitness,{encodedSeconds:outTimeUs/1_000_000,frame});
          try { onProgress({ encodedSeconds: outTimeUs / 1_000_000,
            ...(Number.isFinite(frame) && frame >= 0 ? { frame } : {}),
            speed: String(progressFields.speed || '').slice(0, 24) }); } catch { /* Progress is observational. */ }
        }
        progressFields = {};
      } else progressFields[key] = value;
    }
    // FFmpeg emits short key/value lines. Bound malformed output without
    // affecting the child process or retaining an unlimited buffer.
    if (progressBuffer.length > 4096) progressBuffer = '';
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
    '-show_entries', 'format=duration,bit_rate:stream=index,codec_type,codec_name,pix_fmt,width,height,bit_rate,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data=rotation',
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
  const parseRate = value => { const [n, d = 1] = String(value || '0/1').split('/').map(Number); return d > 0 ? n / d : 0; };
  if (!Number.isFinite(width) || width < 2 || !Number.isFinite(height) || height < 2 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Uploaded media metadata is invalid');
  }
  return {
    width,
    height,
    duration,
    frameRate: parseRate(video.avg_frame_rate),
    nominalFrameRate: parseRate(video.r_frame_rate),
    videoCodec: String(video.codec_name || ''),
    pixelFormat: String(video.pix_fmt || ''),
    audioCodec: (parsed.streams || []).find(stream => stream.codec_type === 'audio')?.codec_name || null,
    // Prefer the elementary video bitrate so an audio-heavy source cannot
    // falsely justify a larger top rendition. Some containers omit it, in
    // which case the aggregate bitrate is still a useful conservative cap.
    bitRate: Number(video.bit_rate) || Number(parsed.format?.bit_rate) || undefined,
    hasAudio: (parsed.streams || []).some(stream => stream.codec_type === 'audio'),
  };
};

const buildVariantArgs = ({ inputPath, outputPath, segmentPattern, rendition, hasAudio, metadata }) => {
  const timing = playbackFrameRatePolicy(metadata);
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:v:0',
  ];
  if (hasAudio) args.push('-map', '0:a:0?');
  args.push(
    '-vf', `${timing.filter},scale=${rendition.width}:${rendition.height}:flags=lanczos,setsar=1`,
    '-fps_mode:v', 'vfr', '-enc_time_base:v', 'filter',
    '-c:v', 'libx264',
    '-threads', FFMPEG_THREADS,
    '-preset', String(process.env.CLIP_HLS_X264_PRESET || 'veryfast'),
    '-profile:v', 'main',
    '-pix_fmt', 'yuv420p',
    '-b:v', String(rendition.videoBitrate),
    '-maxrate', String(rendition.maxRate),
    '-bufsize', String(rendition.bufferSize),
    '-sc_threshold', '0',
    '-g', String(timing.gopFrames), '-keyint_min', String(timing.gopFrames),
    '-flags', '+cgop',
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
  assertPlaybackFrameRate(metadata);
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

// Source reuse is deliberately opt-in and restricted to short, compatible
// sources. Container/codec names alone do not prove independently decodable
// HLS: inspect actual packet timing/bitrate, then decode every copied segment
// in isolation before accepting this optimization. Any uncertainty re-encodes.
const sourceReuseEligible = (metadata, rendition) => process.env.POST_VIDEO_SOURCE_REUSE_ENABLED === 'true'
  && metadata.videoCodec === 'h264' && metadata.pixelFormat === 'yuv420p'
  && ['Main', 'High', 'Constrained Baseline', 'Baseline'].includes(metadata.profile)
  && metadata.level > 0 && metadata.level <= 42
  && metadata.width === rendition.width && metadata.height === rendition.height
  && metadata.duration > 0 && metadata.duration <= 60
  && metadata.frameRate > 0 && metadata.frameRate <= MAX_PLAYBACK_FPS
  && metadata.nominalFrameRate > 0 && metadata.nominalFrameRate <= MAX_PLAYBACK_FPS
  && metadata.bitRate > 0 && metadata.bitRate <= rendition.maxRate
  && (!metadata.hasAudio || (metadata.audioCodec === 'aac' && metadata.audioChannels > 0 && metadata.audioChannels <= 2
    && metadata.audioBitRate > 0 && metadata.audioBitRate <= 128_000 && [44100, 48000].includes(metadata.audioSampleRate)))
  && !['smpte2084', 'arib-std-b67'].includes(metadata.colorTransfer);

const verifyReusablePackets = async (inputPath, metadata, rendition, signal) => {
  const { stdout } = await runProcess('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,size,flags', '-of', 'csv=p=0', inputPath], { timeoutMs: 30_000, signal });
  const packets = stdout.trim().split('\n').map(line => {
    const [time, size, flags] = line.trim().split(',');
    return { time: Number(time), size: Number(size), key: String(flags).includes('K') };
  }).sort((a, b) => a.time - b.time);
  if (!packets.length || packets.length > Math.ceil(metadata.duration * MAX_PLAYBACK_FPS) + 2
    || packets.some(packet => !Number.isFinite(packet.time) || !Number.isFinite(packet.size) || packet.size <= 0)) throw new Error('Unverified source packet metadata');
  const origin = packets[0].time;
  if (!packets[0].key || Math.abs(origin) > 0.1) throw new Error('Source does not start with a timed keyframe');
  let start = 0;
  let bytes = 0;
  let keyTime = origin;
  for (let index = 0; index < packets.length; index++) {
    const packet = packets[index];
    if (index && packet.time - packets[index - 1].time < 1 / MAX_PLAYBACK_FPS - 0.00002) throw new Error('Source exceeds playback frame cap');
    bytes += packet.size;
    while (packet.time - packets[start].time >= HLS_SEGMENT_SECONDS) bytes -= packets[start++].size;
    if (bytes * 8 / Math.min(HLS_SEGMENT_SECONDS, metadata.duration) > rendition.maxRate * 1.05) throw new Error('Source peak bitrate exceeds rendition budget');
    if (packet.key) {
      if (packet.time - keyTime > HLS_SEGMENT_SECONDS + 0.1) throw new Error('Source keyframes are too far apart');
      keyTime = packet.time;
    }
  }
  if (metadata.duration - (keyTime - origin) > HLS_SEGMENT_SECONDS + 0.1) throw new Error('Source final GOP is too long');
};

const copyVerifiedSourceVariant = async ({ inputPath, variantDir, metadata, rendition, signal }) => {
  await verifyReusablePackets(inputPath, metadata, rendition, signal);
  await runProcess('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-sn', '-dn', '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS), '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', path.join(variantDir, 'segment_%05d.m4s'),
    '-hls_flags', 'independent_segments+temp_file', path.join(variantDir, 'index.m3u8')], { signal });
  await validateVariant(variantDir, { ...rendition, duration: metadata.duration });
  const playlist = await fs.readFile(path.join(variantDir, 'index.m3u8'), 'utf8');
  const segments = [...playlist.matchAll(/#EXTINF:([\d.]+),[^\n]*\n(segment_\d+\.m4s)/g)];
  if (!segments.length || segments.length > 32) throw new Error('Source packaging has unbounded segment count');
  const verification = path.join(variantDir, 'verify-segment.m3u8');
  let boundary = 0;
  try {
    for (const [, duration, segment] of segments) {
      if (!(Number(duration) > 0 && Number(duration) <= HLS_SEGMENT_SECONDS + 0.1)) throw new Error('Source segment duration exceeds playback policy');
      if (Math.abs(boundary - Math.round(boundary / HLS_SEGMENT_SECONDS) * HLS_SEGMENT_SECONDS) > 1 / metadata.frameRate + 0.001) {
        throw new Error('Source segments are not aligned with generated renditions');
      }
      boundary += Number(duration);
      await fs.writeFile(verification, `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:3\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:${duration},\n${segment}\n#EXT-X-ENDLIST\n`);
      await runProcess('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode',
        '-i', verification, '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'], { signal, timeoutMs: 30_000 });
    }
  } finally { await fs.rm(verification, { force: true }); }
};

const fallbackProfile = (metadata) => {
  const factor = Math.min(1, 720 / Math.min(metadata.width, metadata.height), 1280 / Math.max(metadata.width, metadata.height));
  return {
    width: Math.max(2, Math.floor(metadata.width * factor / 2) * 2),
    height: Math.max(2, Math.floor(metadata.height * factor / 2) * 2),
    videoBitrate: Math.min(2_400_000, Math.max(300_000, Number(metadata.bitRate) || 2_400_000)),
  };
};

// Progressive fallback is a delivery encode, never a stream copy of the source.
const generateFastStartFallback = async ({ inputPath, outputPath, metadata, signal, onProgress }) => {
  const source = metadata || await validateVideoFile(inputPath);
  const profile = fallbackProfile(source);
  const timing = playbackFrameRatePolicy(source);
  await runProcess('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `${timing.filter},scale=${profile.width}:${profile.height}:flags=lanczos,setsar=1`,
    '-fps_mode:v', 'vfr', '-enc_time_base:v', 'filter',
    '-c:v', 'libx264', '-threads', FFMPEG_THREADS,
    '-preset', String(process.env.CLIP_HLS_X264_PRESET || 'veryfast'),
    '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-b:v', String(profile.videoBitrate), '-maxrate', String(profile.videoBitrate),
    '-bufsize', String(profile.videoBitrate * 2),
    '-g', String(timing.gopFrames), '-keyint_min', String(timing.gopFrames), '-sc_threshold', '0', '-flags', '+cgop',
    '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    '-c:a', 'aac', '-b:a', '96000', '-ac', '2',
    '-movflags', '+faststart',
    '-sn', '-dn',
    outputPath,
  ], { signal, onProgress });
  return outputPath;
};

// Reuse an already validated H.264/AAC HLS rendition when it exactly matches
// the established fallback dimensions. This avoids a fifth source decode and
// lossy video encode; unusual aspect ratios still use the bounded encode above.
const fallbackReuseRendition = (renditions, metadata) => {
  const profile = fallbackProfile(metadata);
  return renditions.find(item => item.width === profile.width && item.height === profile.height) || null;
};

const remuxFastStartFallback = async ({ playlistPath, outputPath, signal }) => {
  await runProcess('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', playlistPath, '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy', '-movflags', '+faststart', '-sn', '-dn', outputPath,
  ], { signal });
  return outputPath;
};

// Optional bounded decode-once path for demanding, high-bitrate sources.
// The temporary high-quality H264 intermediate is never published or uploaded.
// Efficient inputs continue through the normal path without another encode.
const needsWorkerIntermediate = metadata => process.env.POST_VIDEO_INTERMEDIATE_ENABLED === 'true'
  && metadata.bitRate >= 8_000_000
  && (metadata.width * metadata.height > 1920 * 1080
    || (/hevc|av1/.test(metadata.videoCodec) && metadata.width * metadata.height >= 1920 * 1080 && metadata.frameRate > 30))
  && !['smpte2084', 'arib-std-b67'].includes(metadata.colorTransfer);

const generateWorkerIntermediate = async (inputPath, outputPath, metadata, signal, onProgress) => {
  const factor = Math.min(1, 1080 / Math.min(metadata.width, metadata.height), 1920 / Math.max(metadata.width, metadata.height));
  const width = Math.max(2, Math.floor(metadata.width * factor / 2) * 2);
  const height = Math.max(2, Math.floor(metadata.height * factor / 2) * 2);
  const timing = playbackFrameRatePolicy(metadata);
  await runProcess('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?', '-vf', `${timing.filter},scale=${width}:${height}:flags=lanczos,setsar=1`,
    '-fps_mode:v', 'vfr', '-enc_time_base:v', 'filter', '-c:v', 'libx264', '-preset', 'veryfast', '-threads', FFMPEG_THREADS,
    '-crf', '16', '-maxrate', '8000000', '-bufsize', '16000000', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-g', String(timing.gopFrames), '-keyint_min', String(timing.gopFrames), '-sc_threshold', '0', '-flags', '+cgop',
    '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    ...(metadata.audioCodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128000', '-ac', '2']),
    '-movflags', '+faststart', '-sn', '-dn', outputPath], { signal, onProgress });
  const result = await validateVideoFile(outputPath, { expectedDuration: metadata.duration, signal });
  assertPlaybackFrameRate(result);
  return result;
};

const generateClipHls = async ({ inputPath, outputDir, signal, onStage = async () => {}, onProgress = () => {}, onSourceMetadata = () => {}, onOptimizationFallback = () => {} }) => {
  signal?.throwIfAborted();
  await onStage({ stage: 'validating' });
  let metadata = await validateVideoFile(inputPath, { signal,
    maxDurationSeconds: Number(process.env.POST_VIDEO_MAX_DURATION_SECONDS) || 3600,
    maxDimension: 8192, maxPixels: 33_554_432,
  });
  onSourceMetadata(metadata);
  const originalMetadata = metadata;
  const originalInputPath = inputPath;
  let intermediateDirectory = null;
  try {
  if (needsWorkerIntermediate(metadata)) {
    intermediateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hls-intermediate-'));
    await onStage({ stage: 'optimizing' });
    const intermediatePath = path.join(intermediateDirectory, 'source.mp4');
    try {
      metadata = await generateWorkerIntermediate(inputPath, intermediatePath, metadata, signal,
        progress => onProgress({ ...progress, stage: 'optimizing', sourceDuration: originalMetadata.duration }));
      inputPath = intermediatePath;
    } catch (error) {
      if (signal?.aborted) throw error;
      await fs.rm(intermediateDirectory, { recursive: true, force: true });
      intermediateDirectory = null;
      metadata = originalMetadata;
      console.warn(JSON.stringify({ event: 'video_intermediate_fallback' }));
    }
  }
  const ladder = buildRenditionLadder(metadata);
  await fs.mkdir(outputDir, { recursive: true });
  const renditions = [];
  // Sequential encoding keeps one job from multiplying CPU and disk pressure.
  for (const rendition of ladder) {
    await onStage({ stage: 'encoding', rendition: rendition.name, completed: renditions.length, total: ladder.length });
    const variantDir = path.join(outputDir, rendition.name);
    await fs.mkdir(variantDir, { recursive: true });
    let sourceReused = false;
    if (sourceReuseEligible(metadata, rendition)) {
      try {
        await copyVerifiedSourceVariant({ inputPath, variantDir, metadata, rendition, signal });
        sourceReused = true;
      } catch (error) {
        if (signal?.aborted) throw error;
        // Internal diagnostics only; callers must not expose encoder errors or
        // source paths to a client. Observers cannot prevent safe re-encoding.
        try { onOptimizationFallback({ optimization: 'source-reuse', rendition: rendition.name, reason: error.message }); } catch {}
        await fs.rm(variantDir, { recursive: true, force: true });
        await fs.mkdir(variantDir, { recursive: true });
      }
    }
    if (!sourceReused) await runProcess('ffmpeg', buildVariantArgs({
      inputPath,
      outputPath: path.join(variantDir, 'index.m3u8'),
      segmentPattern: path.join(variantDir, 'segment_%05d.m4s'),
      rendition,
      hasAudio: metadata.hasAudio,
      metadata,
    }), { signal, onProgress: progress => onProgress({ ...progress, stage: 'encoding', rendition: rendition.name, sourceDuration: metadata.duration }) });
    signal?.throwIfAborted();
    await onStage({ stage: 'verifying', rendition: rendition.name, completed: renditions.length, total: ladder.length });
    await validateVariant(variantDir, {
      width: rendition.width,
      height: rendition.height,
      duration: metadata.duration,
    });
    renditions.push({ ...rendition, hasAudio: metadata.hasAudio, sourceReused });
  }
  await writeMasterPlaylist(outputDir, renditions);
  await onStage({ stage: 'fallback', completed: renditions.length, total: ladder.length });
  const fallbackOutputPath = path.join(outputDir, 'fallback.mp4');
  const reusable = process.env.POST_VIDEO_MP4_REUSE_ENABLED === 'false' ? null : fallbackReuseRendition(renditions, metadata);
  let fallbackPath;
  if (reusable) {
    try {
      fallbackPath = await remuxFastStartFallback({
        playlistPath: path.join(outputDir, reusable.name, 'index.m3u8'), outputPath: fallbackOutputPath, signal,
      });
      await validateVideoFile(fallbackPath, { expectedDuration: metadata.duration, signal });
      assertPlaybackFrameRate(await probeClipVideo(fallbackPath));
    } catch (error) {
      if (signal?.aborted) throw error;
      fallbackPath = null;
      await fs.rm(fallbackOutputPath, { force: true });
    }
  }
  if (!fallbackPath) fallbackPath = await generateFastStartFallback({
    inputPath, outputPath: fallbackOutputPath, metadata, signal,
    onProgress: progress => onProgress({ ...progress, stage: 'fallback', sourceDuration: metadata.duration }),
  });
  await onStage({ stage: 'verifying', rendition: 'fallback', completed: renditions.length, total: ladder.length });
  await validateVideoFile(fallbackPath, { expectedDuration: metadata.duration, signal });
  assertPlaybackFrameRate(await probeClipVideo(fallbackPath));
  await onStage({ stage: 'thumbnail', completed: renditions.length, total: ladder.length });
  const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');
  await runProcess('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', originalInputPath,
    '-frames:v', '1', '-vf', "scale='min(640,iw)':-2,setsar=1", '-q:v', '3',
    '-threads', FFMPEG_THREADS, thumbnailPath,
  ], { signal });
  const fallbackBytes = (await fs.stat(fallbackPath)).size;
  const thumbnailBytes = (await fs.stat(thumbnailPath)).size;
  if (!fallbackBytes || !thumbnailBytes) throw new Error('Required video derivative is empty');
  let totalBytes = 0;
  const sumFiles = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await sumFiles(file);
      else if (entry.isFile()) totalBytes += (await fs.stat(file)).size;
    }
  };
  await sumFiles(outputDir);
  return { metadata: originalMetadata, processingStrategy: intermediateDirectory ? 'bounded-intermediate' : 'direct', renditions, fallbackPath, thumbnailPath,
    outputBytes: { fallback: fallbackBytes, thumbnail: thumbnailBytes,
      hls: totalBytes - fallbackBytes - thumbnailBytes, total: totalBytes } };
  } finally { if (intermediateDirectory) await fs.rm(intermediateDirectory, { recursive: true, force: true }); }
};

module.exports = {
  HLS_SEGMENT_SECONDS,
  MAX_PLAYBACK_FPS,
  playbackFrameRatePolicy,
  sourceReuseEligible,
  needsWorkerIntermediate,
  STANDARD_RENDITIONS,
  fallbackProfile,
  TRANSCODE_TIMEOUT_MS,
  buildRenditionLadder,
  buildVariantArgs,
  writeMasterPlaylist,
  probeClipVideo,
  generateFastStartFallback,
  generateClipHls,
};
