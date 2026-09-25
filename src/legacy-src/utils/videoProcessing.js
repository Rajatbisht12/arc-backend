const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const log = require('./logger');

const STORY_MAX_SECONDS = 30;
const FFMPEG_TIMEOUT_MS = 90_000;
const MAX_FFMPEG_STDERR_BYTES = 64 * 1024;
const VIDEO_DECODE_SAMPLE_SECONDS = 3;

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
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
    const error = new Error('Video processing timed out');
    error.code = 'FFMPEG_TIMEOUT';
    settle(reject, error);
  }, FFMPEG_TIMEOUT_MS);

  child.stderr.on('data', (chunk) => {
    if (Buffer.byteLength(stderr) >= MAX_FFMPEG_STDERR_BYTES) return;
    const remaining = MAX_FFMPEG_STDERR_BYTES - Buffer.byteLength(stderr);
    stderr += chunk.toString().slice(0, remaining);
  });

  child.on('error', error => settle(reject, error));
  child.on('close', (code) => {
    if (code === 0) {
      settle(resolve);
      return;
    }
    const error = new Error(stderr || `ffmpeg exited with code ${code}`);
    error.code = 'FFMPEG_EXIT';
    error.exitCode = code;
    settle(reject, error);
  });
});

const runFfprobe = (inputPath) => new Promise((resolve, reject) => {
  const child = spawn('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    if (!settled) {
      settled = true;
      reject(new Error('Media duration probe timed out'));
    }
  }, 20_000);
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', (error) => {
    clearTimeout(timeout);
    if (!settled) { settled = true; reject(error); }
  });
  child.on('close', (code) => {
    clearTimeout(timeout);
    if (settled) return;
    settled = true;
    const duration = Number.parseFloat(stdout.trim());
    if (code !== 0 || !Number.isFinite(duration) || duration <= 0) {
      reject(new Error(stderr || 'Media duration could not be verified'));
      return;
    }
    resolve(duration);
  });
});

const runVideoMetadataProbe = (inputPath) => new Promise((resolve, reject) => {
  const child = spawn('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,duration,bit_rate:stream_tags=rotate:stream_side_data=rotation',
    '-of', 'json',
    inputPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    if (!settled) {
      settled = true;
      reject(new Error('Video metadata probe timed out'));
    }
  }, 20_000);
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', (error) => {
    clearTimeout(timeout);
    if (!settled) { settled = true; reject(error); }
  });
  child.on('close', (code) => {
    clearTimeout(timeout);
    if (settled) return;
    settled = true;
    try {
      const parsed = JSON.parse(stdout);
      const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
      const stream = streams.find(item => item?.codec_type === 'video') || {};
      const audioStream = streams.find(item => item?.codec_type === 'audio');
      const sideDataRotation = stream?.side_data_list?.find(item => Number.isFinite(Number(item?.rotation)))?.rotation;
      const rotation = Number(sideDataRotation ?? stream?.tags?.rotate ?? 0);
      let width = Number(stream.width);
      let height = Number(stream.height);
      if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
      const duration = Number(parsed?.format?.duration);
      if (code !== 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        reject(new Error(stderr || 'Video dimensions could not be read'));
        return;
      }
      resolve({
        width,
        height,
        formatName: String(parsed?.format?.format_name || ''),
        videoCodec: String(stream.codec_name || ''),
        audioCodec: audioStream ? String(audioStream.codec_name || '') : null,
        hasAudio: Boolean(audioStream),
        bitRate: Number(stream.bit_rate) || Number(parsed?.format?.bit_rate) || undefined,
        ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
      });
    } catch (error) {
      reject(new Error(stderr || `Video metadata could not be parsed: ${String(error)}`));
    }
  });
});

const sha256Hex = buffer => createHash('sha256').update(buffer).digest('hex');

const mediaIntegrityError = (message, cause) => {
  const error = new Error(message);
  error.statusCode = 422;
  error.code = 'INVALID_VIDEO_MEDIA';
  error.cause = cause;
  return error;
};

const runPacketIntegrityScan = inputPath => runFfmpeg([
  '-nostdin',
  '-hide_banner',
  '-loglevel', 'error',
  '-xerror',
  '-i', inputPath,
  '-map', '0:v:0',
  '-map', '0:a:0?',
  '-c', 'copy',
  '-sn',
  '-dn',
  '-f', 'null',
  '-',
]);

const runDecodeSample = (inputPath, startSeconds = 0) => runFfmpeg([
  '-nostdin',
  '-hide_banner',
  '-loglevel', 'error',
  '-xerror',
  ...(startSeconds > 0 ? ['-ss', String(startSeconds)] : []),
  '-i', inputPath,
  '-t', String(VIDEO_DECODE_SAMPLE_SECONDS),
  '-map', '0:v:0',
  '-map', '0:a:0?',
  '-sn',
  '-dn',
  '-f', 'null',
  '-',
]);

/**
 * ffprobe alone cannot detect a fast-start MP4 whose mdat payload was cut off:
 * the intact moov atom still advertises the original duration. Scan every
 * packet and decode samples at both ends so truncated tails and invalid codecs
 * are rejected before any object becomes public.
 */
const validateVideoFile = async (inputPath, { expectedDuration } = {}) => {
  const metadata = await runVideoMetadataProbe(inputPath);
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || !metadata.videoCodec) {
    throw new Error('Video stream metadata is incomplete');
  }
  await runPacketIntegrityScan(inputPath);
  await runDecodeSample(inputPath, 0);
  if (metadata.duration > VIDEO_DECODE_SAMPLE_SECONDS * 2) {
    await runDecodeSample(inputPath, Math.max(0, metadata.duration - VIDEO_DECODE_SAMPLE_SECONDS));
  }
  if (Number.isFinite(expectedDuration) && expectedDuration > 0) {
    const tolerance = Math.max(0.5, Math.min(2, expectedDuration * 0.02));
    if (Math.abs(metadata.duration - expectedDuration) > tolerance) {
      throw new Error(`Processed video duration changed from ${expectedDuration} to ${metadata.duration} seconds`);
    }
  }
  return metadata;
};

const probeMediaDuration = async (file) => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-media-probe-'));
  const extension = path.extname(file.originalname || '') || '.bin';
  const inputPath = path.join(workDir, `${randomUUID()}${extension}`);
  try {
    await fs.writeFile(inputPath, file.buffer);
    return await runFfprobe(inputPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

const processStoryVideo = async (file) => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-story-'));
  const inputPath = path.join(workDir, `${randomUUID()}.input`);
  const outputPath = path.join(workDir, `${randomUUID()}.mp4`);

  try {
    await fs.writeFile(inputPath, file.buffer);
    const sourceMetadata = await validateVideoFile(inputPath);
    await runFfmpeg([
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-xerror',
      '-y',
      '-i', inputPath,
      '-t', String(STORY_MAX_SECONDS),
      '-vf', "scale='if(gt(iw,720),720,trunc(iw/2)*2)':-2",
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-threads', '2',
      '-profile:v', 'main',
      '-level', '4.0',
      '-pix_fmt', 'yuv420p',
      '-b:v', '1500k',
      '-maxrate', '1800k',
      '-bufsize', '3000k',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ]);

    const metadata = await validateVideoFile(outputPath, {
      expectedDuration: Math.min(sourceMetadata.duration, STORY_MAX_SECONDS),
    });
    const buffer = await fs.readFile(outputPath);
    return {
      ...file,
      buffer,
      mimetype: 'video/mp4',
      originalname: `${path.parse(file.originalname || 'story').name}.mp4`,
      size: buffer.length,
      optimized: true,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (err) {
    const error = new Error('Could not validate and process this video. Please choose the original file and try again.');
    error.statusCode = 422;
    error.code = 'INVALID_VIDEO_MEDIA';
    error.cause = err;
    throw error;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

// Post videos are already encoded by the client. Re-mux MP4 uploads without
// re-encoding so the moov/index atom is written before mdat. Browsers and
// ExoPlayer can then start from the first range request instead of fetching the
// beginning, seeking to the tail for metadata, and returning to the beginning.
const processPostVideo = async (file) => {
  if (!String(file?.mimetype || '').toLowerCase().startsWith('video/')) return file;
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
    throw mediaIntegrityError('The uploaded video is empty or unreadable');
  }
  if (Number.isFinite(Number(file.size)) && Number(file.size) !== file.buffer.length) {
    throw mediaIntegrityError('The uploaded video byte count does not match the received file');
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-post-video-'));
  const originalExtension = path.extname(file.originalname || '').toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(originalExtension) ? originalExtension : '.video';
  const inputPath = path.join(workDir, `${randomUUID()}${safeExtension}`);
  const outputPath = path.join(workDir, `${randomUUID()}.mp4`);
  const integrityContext = file.integrityContext || {};
  const jobId = String(integrityContext.uploadId || randomUUID());
  const sourceBytes = file.buffer.length;
  const sourceSha256 = sha256Hex(file.buffer);
  const startedAt = Date.now();

  try {
    log.info('Post video integrity validation started', {
      jobId,
      userId: integrityContext.userId,
      mediaIndex: integrityContext.mediaIndex,
      sourceBytes,
      sourceMimeType: String(file.mimetype || ''),
    });
    await fs.writeFile(inputPath, file.buffer);
    const sourceStat = await fs.stat(inputPath);
    if (sourceStat.size !== sourceBytes) throw new Error('Temporary source video was not written completely');
    const sourceMetadata = await validateVideoFile(inputPath);

    // Preserve validated non-MP4 containers and their real MIME type. The old
    // storage path renamed every video/* payload to .mp4, even WebM/MOV bytes.
    // HLS processing can still consume these files by content detection.
    const isMp4Container = sourceMetadata.formatName.split(',').some(name => name === 'mp4');
    if (!isMp4Container) {
      log.info('Post video integrity validation completed', {
        jobId,
        userId: integrityContext.userId,
        mediaIndex: integrityContext.mediaIndex,
        sourceBytes,
        outputBytes: sourceBytes,
        durationSeconds: sourceMetadata.duration,
        videoCodec: sourceMetadata.videoCodec,
        audioCodec: sourceMetadata.audioCodec,
        container: sourceMetadata.formatName,
        processingMode: 'validated-original',
        durationMs: Date.now() - startedAt,
      });
      return {
        ...file,
        size: sourceBytes,
        width: sourceMetadata.width,
        height: sourceMetadata.height,
        duration: sourceMetadata.duration,
        integrity: {
          jobId,
          sourceBytes,
          outputBytes: sourceBytes,
          sourceSha256,
          outputSha256: sourceSha256,
          processingMode: 'validated-original',
        },
      };
    }

    await runFfmpeg([
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-xerror',
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c', 'copy',
      '-movflags', '+faststart',
      '-sn',
      '-dn',
      outputPath,
    ]);
    const metadata = await validateVideoFile(outputPath, { expectedDuration: sourceMetadata.duration });
    const buffer = await fs.readFile(outputPath);
    const outputStat = await fs.stat(outputPath);
    if (!buffer.length || outputStat.size !== buffer.length) {
      throw new Error('Processed video output was not finalized completely');
    }
    const outputSha256 = sha256Hex(buffer);
    log.info('Post video integrity validation completed', {
      jobId,
      userId: integrityContext.userId,
      mediaIndex: integrityContext.mediaIndex,
      sourceBytes,
      outputBytes: buffer.length,
      durationSeconds: metadata.duration,
      videoCodec: metadata.videoCodec,
      audioCodec: metadata.audioCodec,
      container: metadata.formatName,
      processingMode: 'faststart-remux',
      durationMs: Date.now() - startedAt,
    });
    return {
      ...file,
      buffer,
      mimetype: 'video/mp4',
      originalname: `${path.parse(file.originalname || 'post-video').name}.mp4`,
      size: buffer.length,
      optimized: true,
      ...metadata,
      integrity: {
        jobId,
        sourceBytes,
        outputBytes: buffer.length,
        sourceSha256,
        outputSha256,
        processingMode: 'faststart-remux',
      },
    };
  } catch (err) {
    log.error('Post video integrity validation failed', {
      jobId,
      userId: integrityContext.userId,
      mediaIndex: integrityContext.mediaIndex,
      sourceBytes,
      durationMs: Date.now() - startedAt,
      ffmpegExitCode: err?.exitCode,
      error: String(err),
    });
    throw mediaIntegrityError('The uploaded video is incomplete or could not be validated', err);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = {
  STORY_MAX_SECONDS,
  FFMPEG_TIMEOUT_MS,
  processStoryVideo,
  processPostVideo,
  probeMediaDuration,
  validateVideoFile,
};
