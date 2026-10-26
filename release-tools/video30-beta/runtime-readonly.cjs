'use strict';
// Read-only preflight for the existing API task. Never imports app/server,
// workers or models; never creates collections/indexes/jobs or prints secrets.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const main = async () => {
  await require('/app/dist/config/secrets.js').loadSecretsManagerEnv();
  const { MongoClient } = require('/app/node_modules/mongodb');
  const { Queue } = require('/app/node_modules/bullmq');
  if (!process.env.MONGODB_URI || !process.env.REDIS_HOST) throw Error('RUNTIME_CONFIGURATION_MISSING');
  const client = new MongoClient(process.env.MONGODB_URI, {
    retryWrites: false, serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? { tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
        ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {}) } : {}),
  });
  const queue = new Queue('clip-video', { connection: {
    host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME, password: process.env.REDIS_PASSWORD,
    connectTimeout: 10000, maxRetriesPerRequest: 1, retryStrategy: () => null,
    ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
  } });
  queue.on('error', () => {});
  try {
    await client.connect(); const db = client.db();
    const collections = [];
    for (const name of ['videouploadsessions', 'pendingvideoposts', 'videoprocessingtickets', 'posts']) {
      let indexes;
      try { indexes = await db.collection(name).listIndexes().toArray(); }
      catch (e) { if (e.code !== 26) throw e; indexes = []; }
      collections.push({ name, indexes: indexes.map(({ name, key, unique, partialFilterExpression }) =>
        ({ name, key, unique: Boolean(unique), ...(partialFilterExpression ? { partialFilterExpression } : {}) })) });
    }
    const sessions = await db.collection('videouploadsessions').aggregate([
      { $match: { status: { $in: ['CREATED', 'UPLOADING', 'UPLOADED', 'QUEUED', 'PROCESSING'] } } },
      { $group: { _id: '$status', count: { $sum: 1 }, oldest: { $min: '$createdAt' } } },
    ], { maxTimeMS: 15000 }).toArray();
    const pending = await db.collection('pendingvideoposts').aggregate([
      { $match: { status: { $in: ['PENDING', 'PUBLISHING', 'FAILED'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ], { maxTimeMS: 15000 }).toArray();
    const counts = await queue.getJobCounts('wait', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children', 'failed', 'completed');
    const active = (await queue.getJobs(['active'], 0, 9)).map(j => ({
      idSha256: createHash('sha256').update(String(j.id)).digest('hex'), name: j.name,
      attemptsMade: j.attemptsMade, processedOn: j.processedOn,
    }));
    const flags = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
      /^(POST_VIDEO_UPLOADS_ENABLED|POST_VIDEO_ROLLOUT_MODE|POST_VIDEO_BACKGROUND_PUBLISH_ENABLED|POST_VIDEO_FAIR_SCHEDULING_ENABLED|POST_VIDEO_PRIVATE_DELIVERY_ENABLED|POST_VIDEO_SOURCE_RETENTION_DAYS|POST_VIDEO_MP4_REUSE_ENABLED|POST_VIDEO_INTERMEDIATE_ENABLED|POST_VIDEO_SOURCE_REUSE_ENABLED|CLIP_HLS_ENABLED|CLIP_HLS_WORKER_ENABLED|CLIP_HLS_WORKER_CONCURRENCY|VIDEO_FFMPEG_THREADS)$/.test(k)));
    const hasStaticAwsCredentials = Boolean(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SESSION_TOKEN);
    const privateDeliveryReady = require('/app/src/legacy-src/utils/postVideoDelivery.js').privateDeliveryReady();
    console.log('BETA30_READ_ONLY_RESULT=' + JSON.stringify({ checkedAt: new Date().toISOString(),
      databaseConnection: 'connected', redisConnection: 'connected', collections, sessionCounts: sessions,
      pendingPublicationCounts: pending, queueCounts: counts, activeJobs: active, queuePaused: await queue.isPaused(),
      flags, privateDeliveryReady, hasStaticAwsCredentials,
      taskRoleCredentialsConfigured: Boolean(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI),
      writesPerformed: 0 }));
  } finally { await queue.close(); await client.close(); }
};
main().catch(e => { console.error('BETA30_READ_ONLY_FAILED=' + JSON.stringify({ code: String(e.code || e.name || 'READ_FAILED') })); process.exitCode = 1; });
