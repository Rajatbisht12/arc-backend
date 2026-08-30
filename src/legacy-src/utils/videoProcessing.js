const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const log = require('./logger');

const STORY_MAX_SECONDS = 30;
const FFMPEG_TIMEOUT_MS = 90_000;
const MAX_FFMPEG_STDERR_BYTES = 64 * 1024;

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
    settle(reject, new Error(stderr || `ffmpeg exited with code ${code}`));
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
    await runFfmpeg([
      '-nostdin',
      '-loglevel', 'error',
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

    const [buffer, duration] = await Promise.all([
      fs.readFile(outputPath),
      runFfprobe(outputPath),
    ]);
    return {
      ...file,
      buffer,
      mimetype: 'video/mp4',
      originalname: `${path.parse(file.originalname || 'story').name}.mp4`,
      size: buffer.length,
      optimized: true,
      duration,
    };
  } catch (err) {
    if (String(file.mimetype || '').toLowerCase() === 'video/mp4') {
      log.warn('Story video optimization failed; uploading original MP4 video', { error: String(err) });
      return file;
    }
    const error = new Error('Could not process this video. Please upload an MP4 video or try a shorter clip.');
    error.statusCode = 422;
    error.cause = err;
    throw error;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = {
  STORY_MAX_SECONDS,
  FFMPEG_TIMEOUT_MS,
  processStoryVideo,
  probeMediaDuration,
};
