#!/usr/bin/env node
const fs = require('node:fs');
const mongoose = require('mongoose');
const { Queue } = require('bullmq');
const { assertVideoCompatibilityEnvironment } = require('../src/legacy-src/config/videoDeploymentPolicy');
const Session = require('../src/legacy-src/models/VideoUploadSession');

const assertNoNewVideoWork = async (sessions, queue) => {
  // Never re-enable a legacy-only consumer or turn off private delivery while
  // new uploads, publication claims or published derivatives still exist.
  if (await sessions.exists({ $or: [
    { status: { $in: ['CREATED', 'UPLOADING', 'UPLOADED', 'QUEUED', 'PROCESSING', 'READY'] } },
    { postId: { $ne: null } }, { claimedPostId: { $ne: null } },
  ] })) throw new Error('New video sessions/content exist; retain the compatible dedicated worker and delivery until an approved drain');
  const states = ['wait', 'active', 'delayed', 'prioritized', 'waiting-children'];
  for (let offset = 0; offset < 10000; offset += 100) {
    const jobs = await queue.getJobs(states, offset, offset + 99);
    if (jobs.some(job => job?.name === 'process-upload')) throw new Error('New video jobs remain on clip-video; compatibility deployment refused');
    if (jobs.length < 100) return;
  }
  throw new Error('Video queue audit limit reached; inspect/drain the queue before compatibility deployment');
};

const run = async () => {
  assertVideoCompatibilityEnvironment();
  if (!process.env.MONGODB_URI || !process.env.REDIS_HOST) throw new Error('Secret-hydrated database/Redis configuration is required');
  let queue;
  try {
    await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 15000,
      retryWrites: process.env.MONGODB_TLS !== 'true',
      ...(process.env.MONGODB_TLS === 'true' ? { tls: true, ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE) ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {}) } : {}),
    });
    queue = new Queue('clip-video', { connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379),
      username: process.env.REDIS_USERNAME, password: process.env.REDIS_PASSWORD,
      connectTimeout: 10000, maxRetriesPerRequest: 1, retryStrategy: () => null,
      ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
    } });
    queue.on('error', () => {}); // propagate through awaited operations, not a detached EventEmitter throw
    await assertNoNewVideoWork(Session, queue);
    console.log('Video compatibility release passed: new sessions disabled, legacy consumer retained, no dedicated-pipeline work stranded.');
  } finally { if (queue) await queue.close(); await mongoose.disconnect(); }
};
module.exports = { assertNoNewVideoWork };
if (require.main === module) run().catch(error => { console.error(String(error.message)); process.exitCode = 1; });
