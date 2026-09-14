const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const Post = require('../models/Post');
const log = require('../utils/logger');
const { generateClipHls } = require('../utils/clipHlsProcessing');

const LEASE_MS = Math.max(10 * 60_000, Number(process.env.CLIP_HLS_LEASE_MS || 60 * 60_000));
const OUTPUT_ROOT = 'gaming-social/clips';

let PostModel = Post;
let generateClipHlsImpl = generateClipHls;
let storageOverride = null;
const loadStorage = () => storageOverride || require(path.join(__dirname, '../../../dist/infrastructure/storage/s3'));

const safePart = value => {
  const part = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(part)) throw new Error('Invalid clip processing identifier');
  return part;
};

const listFiles = async root => {
  const files = [];
  const visit = async directory => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && !entry.name.endsWith('.tmp')) files.push(absolute);
    }
  };
  await visit(root);
  return files;
};

const failureCodeFor = error => {
  const code = String(error?.code || '').toUpperCase();
  if (code.includes('TIMEOUT')) return 'TRANSCODE_TIMEOUT';
  if (code.includes('PROBE')) return 'INVALID_VIDEO';
  if (code.includes('S3') || code.includes('STORAGE')) return 'STORAGE_FAILED';
  return 'TRANSCODE_FAILED';
};

const findMedia = (post, mediaId) => post?.content?.media?.find(media => String(media?._id) === String(mediaId));

const claimJob = async ({ postId, mediaId, version, leaseToken }) => {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  return PostModel.findOneAndUpdate(
    {
      _id: postId,
      'content.media': {
        $elemMatch: {
          _id: mediaId,
          'playback.version': version,
          'playback.status': { $ne: 'ready' },
          $or: [
            { 'playback.leaseExpiresAt': { $exists: false } },
            { 'playback.leaseExpiresAt': null },
            { 'playback.leaseExpiresAt': { $lte: now } }
          ]
        }
      }
    },
    {
      $set: {
        'content.media.$[media].playback.status': 'processing',
        'content.media.$[media].playback.processingStartedAt': now,
        'content.media.$[media].playback.leaseToken': leaseToken,
        'content.media.$[media].playback.leaseExpiresAt': leaseExpiresAt
      },
      $inc: { 'content.media.$[media].playback.attempts': 1 },
      $unset: {
        'content.media.$[media].playback.failedAt': 1,
        'content.media.$[media].playback.failureCode': 1
      }
    },
    {
      new: true,
      arrayFilters: [{ 'media._id': mediaId, 'media.playback.version': version }]
    }
  ).select('content.media');
};

const uploadGeneratedHls = async ({ outputDir, prefix, renditions }) => {
  const storage = loadStorage();
  const files = await listFiles(outputDir);
  // A manifest is the publication boundary. Upload init/segments first, media
  // playlists next, and the master manifest only after all referenced objects.
  files.sort((left, right) => {
    const rank = file => file.endsWith('.m3u8') ? 1 : 0;
    return rank(left) - rank(right) || left.localeCompare(right);
  });
  const masterFile = files.find(file => file.endsWith('master.m3u8'));
  if (!masterFile) throw new Error('Generated HLS master manifest is missing');
  const publicationFiles = files.filter(file => file !== masterFile);
  const urls = new Map();
  for (let index = 0; index < publicationFiles.length; index += 3) {
    const batch = publicationFiles.slice(index, index + 3);
    const uploaded = await Promise.all(batch.map(async file => {
      const relative = path.relative(outputDir, file).split(path.sep).join('/');
      const publicId = `${prefix}/${relative}`;
      const result = await storage.uploadMediaFile(file, publicId);
      return [relative, result];
    }));
    uploaded.forEach(([relative, result]) => urls.set(relative, result));
  }
  const masterPublicId = `${prefix}/master.m3u8`;
  const master = await storage.uploadMediaFile(masterFile, masterPublicId);
  urls.set('master.m3u8', master);
  return {
    master: urls.get('master.m3u8'),
    fallback: urls.get('fallback.mp4'),
    renditions: renditions.map(rendition => {
      const relative = `${rendition.name}/index.m3u8`;
      const playlist = urls.get(relative);
      const audio = rendition.hasAudio ? rendition.audioBitrate : 0;
      return {
        name: rendition.name,
        width: rendition.width,
        height: rendition.height,
        bandwidth: Math.ceil((rendition.maxRate + audio) * 1.1),
        averageBandwidth: rendition.videoBitrate + audio,
        playlistUrl: playlist?.url,
        playlistPublicId: playlist?.publicId
      };
    })
  };
};

const processClipTranscodeJob = async jobData => {
  const postId = safePart(jobData?.postId);
  const mediaId = safePart(jobData?.mediaId);
  const version = safePart(jobData?.version);
  const leaseToken = randomUUID();
  const startedAt = Date.now();
  const claimedPost = await claimJob({ postId, mediaId, version, leaseToken });
  if (!claimedPost) {
    const current = await PostModel.findById(postId).select('content.media').lean();
    const currentMedia = findMedia(current, mediaId);
    return {
      skipped: true,
      reason: currentMedia?.playback?.status === 'ready' ? 'already_ready' : 'not_claimable'
    };
  }

  const media = findMedia(claimedPost, mediaId);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-clip-hls-'));
  const inputPath = path.join(workDir, 'source.mp4');
  const outputDir = path.join(workDir, 'hls');
  const prefix = `${OUTPUT_ROOT}/${postId}/${mediaId}/${version}`;
  let storage;
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    PostModel.updateOne(
      { _id: postId },
      { $set: { 'content.media.$[media].playback.leaseExpiresAt': new Date(Date.now() + LEASE_MS) } },
      { arrayFilters: [{
        'media._id': mediaId,
        'media.playback.version': version,
        'media.playback.leaseToken': leaseToken
      }] }
    ).catch(error => log.warn('Clip HLS lease heartbeat failed', {
      postId, mediaId, version, error: String(error)
    })).finally(() => { heartbeatInFlight = false; });
  }, Math.min(60_000, Math.floor(LEASE_MS / 3)));
  heartbeat.unref();

  try {
    if (!media?.publicId) throw new Error('Clip fallback object is unavailable');
    storage = loadStorage();
    await storage.deletePrefix(`${prefix}/`);
    await storage.downloadFile(media.publicId, inputPath);
    const generated = await generateClipHlsImpl({ inputPath, outputDir });
    const uploaded = await uploadGeneratedHls({ outputDir, prefix, renditions: generated.renditions });
    if (!uploaded.master?.url) throw new Error('HLS master manifest was not published');
    const completedAt = new Date();
    const result = await PostModel.updateOne(
      { _id: postId },
      {
        $set: {
          'content.media.$[media].width': generated.metadata.width,
          'content.media.$[media].height': generated.metadata.height,
          'content.media.$[media].aspectRatio': generated.metadata.width / generated.metadata.height,
          'content.media.$[media].duration': generated.metadata.duration,
          'content.media.$[media].playback.status': 'ready',
          'content.media.$[media].playback.hlsUrl': uploaded.master.url,
          'content.media.$[media].playback.hlsPublicId': uploaded.master.publicId,
          'content.media.$[media].playback.fallbackMp4Url': uploaded.fallback?.url || media.url,
          'content.media.$[media].playback.fallbackPublicId': uploaded.fallback?.publicId || media.publicId,
          'content.media.$[media].playback.width': generated.metadata.width,
          'content.media.$[media].playback.height': generated.metadata.height,
          'content.media.$[media].playback.duration': generated.metadata.duration,
          'content.media.$[media].playback.renditions': uploaded.renditions,
          'content.media.$[media].playback.completedAt': completedAt
        },
        $unset: {
          'content.media.$[media].playback.failedAt': 1,
          'content.media.$[media].playback.failureCode': 1,
          'content.media.$[media].playback.leaseToken': 1,
          'content.media.$[media].playback.leaseExpiresAt': 1
        }
      },
      { arrayFilters: [{
        'media._id': mediaId,
        'media.playback.version': version,
        'media.playback.leaseToken': leaseToken
      }] }
    );
    if (result.modifiedCount !== 1) {
      await storage.deletePrefix(`${prefix}/`).catch(() => {});
      throw new Error('Clip processing lease was lost before publication');
    }
    log.info('Clip HLS processing completed', {
      postId,
      mediaId,
      version,
      durationMs: Date.now() - startedAt,
      sourceDurationSeconds: generated.metadata.duration,
      fastStartFallback: Boolean(uploaded.fallback?.url),
      renditions: uploaded.renditions.map(item => item.name)
    });
    return { ready: true, durationMs: Date.now() - startedAt, renditions: uploaded.renditions.length };
  } catch (error) {
    if (storage) await storage.deletePrefix(`${prefix}/`).catch(() => {});
    const failureCode = failureCodeFor(error);
    await PostModel.updateOne(
      { _id: postId },
      {
        $set: {
          'content.media.$[media].playback.status': 'failed',
          'content.media.$[media].playback.failedAt': new Date(),
          'content.media.$[media].playback.failureCode': failureCode
        },
        $unset: {
          'content.media.$[media].playback.hlsUrl': 1,
          'content.media.$[media].playback.hlsPublicId': 1,
          'content.media.$[media].playback.renditions': 1,
          'content.media.$[media].playback.leaseToken': 1,
          'content.media.$[media].playback.leaseExpiresAt': 1
        }
      },
      { arrayFilters: [{
        'media._id': mediaId,
        'media.playback.version': version,
        'media.playback.leaseToken': leaseToken
      }] }
    ).catch(() => {});
    log.error('Clip HLS processing failed', {
      postId,
      mediaId,
      version,
      durationMs: Date.now() - startedAt,
      failureCode,
      error: String(error)
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

const setClipTranscodingDependenciesForTests = overrides => {
  PostModel = overrides?.Post || Post;
  generateClipHlsImpl = overrides?.generateClipHls || generateClipHls;
  storageOverride = overrides?.storage || null;
};

module.exports = {
  processClipTranscodeJob,
  failureCodeFor,
  safePart,
  OUTPUT_ROOT,
  setClipTranscodingDependenciesForTests
};
