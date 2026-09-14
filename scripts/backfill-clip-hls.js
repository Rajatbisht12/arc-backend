#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { Queue } = require('bullmq');

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
const retryFailed = process.argv.includes('--retry-failed');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = Math.max(1, Math.min(100_000, Number(limitArg?.split('=')[1] || 10_000)));
if (apply && verify) throw new Error('Use either --apply or --verify, not both');
if (apply && process.env.CLIP_HLS_ENABLED === 'false') throw new Error('CLIP_HLS_ENABLED=false prevents backfill');

const required = ['MONGODB_URI', 'REDIS_HOST'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);

const legacyRoot = path.resolve(__dirname, '..', 'src', 'legacy-src');
const Post = require(path.join(legacyRoot, 'models', 'Post.js'));
const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT || 6379),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {})
};
const queue = new Queue('clip-video', { connection });
const connectOptions = {
  autoIndex: false,
  autoCreate: false,
  retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
  serverSelectionTimeoutMS: 15_000,
  ...(process.env.MONGODB_TLS === 'true' ? {
    tls: true,
    ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
      ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
      : {})
  } : {})
};

const jobId = (postId, mediaId, version) =>
  `clip-hls-${postId}-${mediaId}-${version}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 220);

const queueMedia = async (postId, media) => {
  const failed = media.playback?.status === 'failed';
  const version = failed && retryFailed ? randomUUID() : (media.playback?.version || randomUUID());
  const needsInitialization = !media.playback?.version || failed;
  if (needsInitialization) {
    const update = await Post.collection.updateOne(
      { _id: postId },
      {
        $set: {
          'content.media.$[media].playback.status': 'processing',
          'content.media.$[media].playback.version': version,
          'content.media.$[media].playback.fallbackMp4Url': media.url,
          'content.media.$[media].playback.fallbackPublicId': media.publicId,
          'content.media.$[media].playback.attempts': 0,
          ...(media.width ? { 'content.media.$[media].playback.width': media.width } : {}),
          ...(media.height ? { 'content.media.$[media].playback.height': media.height } : {}),
          ...(media.duration ? { 'content.media.$[media].playback.duration': media.duration } : {})
        },
        $unset: {
          'content.media.$[media].playback.failedAt': 1,
          'content.media.$[media].playback.failureCode': 1,
          'content.media.$[media].playback.leaseToken': 1,
          'content.media.$[media].playback.leaseExpiresAt': 1
        }
      },
      { arrayFilters: [{ 'media._id': media._id }] }
    );
    if (update.modifiedCount !== 1) throw new Error('Media changed while preparing backfill');
  }
  await queue.add(
    'transcode-hls',
    { postId: String(postId), mediaId: String(media._id), version },
    {
      jobId: jobId(postId, media._id, version),
      attempts: Math.max(1, Number(process.env.CLIP_HLS_JOB_ATTEMPTS || 3)),
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 2000,
      removeOnFail: 5000
    }
  );
};

const main = async () => {
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(process.env.MONGODB_URI, connectOptions);
  const posts = await Post.find({
    isActive: { $ne: false },
    'content.media': { $elemMatch: { type: 'video', publicId: { $type: 'string', $ne: '' } } }
  }).select('_id content.media').limit(limit).lean();
  const totals = { posts: posts.length, videos: 0, ready: 0, processing: 0, failed: 0, missing: 0, queued: 0, queueFailures: 0 };
  for (const post of posts) {
    for (const media of post.content?.media || []) {
      if (media.type !== 'video' || !media.publicId) continue;
      totals.videos += 1;
      const status = media.playback?.status;
      if (status === 'ready' && media.playback?.hlsUrl) {
        totals.ready += 1;
        continue;
      }
      if (status === 'failed') totals.failed += 1;
      else if (status === 'processing') totals.processing += 1;
      else totals.missing += 1;
      if (!apply || (status === 'failed' && !retryFailed)) continue;
      try {
        await queueMedia(post._id, media);
        totals.queued += 1;
      } catch (error) {
        totals.queueFailures += 1;
        console.error(JSON.stringify({ postId: String(post._id), mediaId: String(media._id), error: String(error) }));
      }
    }
  }
  console.log(JSON.stringify({
    mode: apply ? 'apply' : verify ? 'verify' : 'audit-only',
    retryFailed,
    limit,
    ...totals
  }, null, 2));
  if (!apply) console.log('No documents, jobs, or storage objects were changed.');
  if (verify && (totals.processing || totals.failed || totals.missing || totals.queueFailures)) process.exitCode = 2;
  if (apply && totals.queueFailures) process.exitCode = 2;
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queue.close().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
