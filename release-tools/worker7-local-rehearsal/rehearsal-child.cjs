'use strict';
// Local fault-injection fixture only. Never accepts cloud endpoints/credentials.
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const APP_ROOT = process.env.LOCAL_RELIABILITY_APP_ROOT;
if (!APP_ROOT || !path.isAbsolute(APP_ROOT)) throw Error('VERIFIED_APP_ROOT_REQUIRED');
const app = key => require(path.join(APP_ROOT, 'src/legacy-src', key));
const Session = app('models/VideoUploadSession');
const Pending = app('models/PendingVideoPost');
const Post = app('models/Post');
app('controllers/postController');
const upload = app('services/videoUploadService');

function dependencies(root, boundary = async () => {}) {
  const location = key => {
    if (!/^post-video-playback\/[a-f0-9]{24}\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+\//.test(key)) throw Error('LOCAL_FIXTURE_PATH_REJECTED');
    const target = path.resolve(root, key);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('LOCAL_FIXTURE_PATH_REJECTED');
    return target;
  };
  return {
    storage: {
      headVideoSource: async key => {
        const row = await Session.findOne({ objectKey: key }).select('_id size');
        if (!row) throw Error('LOCAL_SOURCE_MISSING');
        await boundary('after-claim');
        return { size: row.size, sessionId: String(row._id) };
      },
      downloadFile: async (_key, target) => fs.writeFile(target, 'local stage-boundary fixture'),
      uploadMediaFile: async (source, key) => {
        const target = location(key); await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        // B pauses immediately before READY below, after every derivative upload.
      },
      deletePrefix: async key => fs.rm(location(key), { recursive: true, force: true }),
    },
    generate: async ({ outputDir, onStage, onProgress, onSourceMetadata }) => {
      // Encoding/media correctness is covered by the existing FFmpeg suites.
      // This fixture freezes the actual service at deterministic I/O stages.
      await onStage({ stage: 'validating' });
      onSourceMetadata({ duration: 2, width: 640, height: 360, frameRate: 30, videoCodec: 'h264' });
      await onStage({ stage: 'encoding', rendition: '360p' });
      onProgress({ encodedSeconds: 1, frame: 30, sourceDuration: 2, speed: 1 });
      if(process.env.LOCAL_RELIABILITY_POINT==='actual-ffmpeg'){
        const encoder=require('node:child_process').spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=320x240:rate=30','-t','60','-c:v','libx264','-threads','1','-progress','pipe:1','-f','null','-'],{stdio:['ignore','pipe','ignore']});
        await new Promise((resolve,reject)=>{encoder.stdout.once('data',resolve);encoder.once('error',reject);encoder.once('exit',()=>reject(Error('ENCODER_EXITED_EARLY')));});
        process.send?.({point:'actual-ffmpeg',ffmpegPid:encoder.pid});await new Promise(()=>{});
      }
      await boundary('encoding');
      await fs.mkdir(outputDir, { recursive: true });
      for (const file of ['master.m3u8', 'fallback.mp4', 'thumbnail.jpg']) await fs.writeFile(path.join(outputDir, file), 'local fixture');
      return { metadata: { duration: 2, width: 640, height: 360 },
        outputBytes: { fallback: 13, thumbnail: 13, hls: 13, total: 39 }, renditions: [] };
    },
  };
}

async function main() {
  const uri = process.env.LOCAL_RELIABILITY_MONGO_URI;
  const redisPort = Number(process.env.LOCAL_RELIABILITY_REDIS_PORT);
  const root = process.env.LOCAL_RELIABILITY_ARTIFACT_ROOT;
  require('./local-guards.cjs').endpoints(uri, redisPort, process.env.LOCAL_RELIABILITY_EXTERNAL_REDIS_PASSWORD);
  if (!root || !/^squadhunt-video-reliability-[A-Za-z0-9]+$/.test(path.basename(root))) throw Error('LOCAL_ONLY_FIXTURE');
  await mongoose.connect(uri, { autoIndex: false });
  const point = process.env.LOCAL_RELIABILITY_POINT;
  const boundary = async at => {
    if (point !== at) return;
    process.send?.({ point: at });
    await new Promise(() => {});
  };
  upload.__setDependenciesForTests(dependencies(root, boundary));
  const updateOne = Session.updateOne.bind(Session);
  Session.updateOne = async (filter, update, ...args) => {
    if (update.$set?.status === 'READY') await boundary('after-upload');
    return updateOne(filter, update, ...args);
  };
  const mode = process.env.LOCAL_RELIABILITY_MODE;
  if (mode === 'recover-publication') {
    await app('services/pendingVideoPostService').recover();
    await mongoose.disconnect(); process.send?.({ done: true }); process.disconnect?.(); return;
  }
  if (mode === 'publish') {
    const createPost = Post.create.bind(Post);
    Post.create = async (...args) => {
      const row = await createPost(...args);
      await boundary('post-insert-before-source-link');
      return row;
    };
    const original = Pending.findOneAndUpdate.bind(Pending);
    Pending.findOneAndUpdate = async (filter, update, ...args) => {
      if (update.$set?.status === 'PUBLISHED') await boundary('post-saved-before-intent-ack');
      return original(filter, update, ...args);
    };
    await app('services/pendingVideoPostService').processForSession(process.env.LOCAL_RELIABILITY_SESSION);
    await mongoose.disconnect(); process.send?.({ done: true }); process.disconnect?.(); return;
  }
  await boundary('before-claim');
  const worker = new Worker(process.env.LOCAL_RELIABILITY_QUEUE, async job => {
    const result = await upload.processVideoUploadJob(job.data);
    await boundary('ready-before-queue-ack');
    return result;
  }, { connection: { host: '127.0.0.1', port: redisPort, password: process.env.LOCAL_RELIABILITY_EXTERNAL_REDIS_PASSWORD, maxRetriesPerRequest: null },
    concurrency: 1, lockDuration: 1000, stalledInterval: 500, maxStalledCount: 2 });
  worker.on('error', error => process.send?.({ error: error.code || error.name }));
  worker.on('failed', (_job, error) => process.send?.({ error: error.code || error.name }));
}

module.exports = { dependencies };
if (require.main === module) main().catch(error => { process.send?.({ error: String(error.code || error.name) }); process.exit(1); });
