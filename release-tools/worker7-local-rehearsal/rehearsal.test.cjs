// Portable LOCAL adaptation of the existing 20-case worker7 service rehearsal.
// Mock storage/stage cases and accelerated fixture leases remain explicitly local.
const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const { spawn, fork } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const mongoose = require('mongoose');
const APP_ROOT = process.env.LOCAL_RELIABILITY_APP_ROOT;
if (!APP_ROOT || !path.isAbsolute(APP_ROOT)) throw Error('VERIFIED_APP_ROOT_REQUIRED');
const app = key => require(path.join(APP_ROOT, 'src/legacy-src', key));
const localUri = process.env.LOCAL_RELIABILITY_EXTERNAL_MONGO_URI;
const localPort = Number(process.env.LOCAL_RELIABILITY_EXTERNAL_REDIS_PORT);
const password = process.env.LOCAL_RELIABILITY_EXTERNAL_REDIS_PASSWORD;
require('./local-guards.cjs').endpoints(localUri, localPort, password);
const MongoMemoryServer = { create: async () => ({ getUri: () => localUri, stop: async () => {} }) };
const { Queue, Worker } = require('bullmq');
const Session = app('models/VideoUploadSession');
const Pending = app('models/PendingVideoPost');
const Post = app('models/Post');
const User = app('models/User');
const Notification = app('models/Notification');
app('controllers/postController');
const upload = app('services/videoUploadService');
const publisher = app('services/pendingVideoPostService');
const { dependencies } = require('./rehearsal-child.cjs');
let mongo, redis, port, queue, root;
const children = new Set(), workers = new Set();
const owner = new mongoose.Types.ObjectId();
const oldEnvironment = { ...process.env };
const connection = connectionPort => ({ host: '127.0.0.1', port: connectionPort, password, maxRetriesPerRequest: null });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await sleep(25); }
  throw Error('LOCAL_RECOVERY_DEADLINE');
};
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => {
  const value = server.address().port; server.close(() => resolve(value));
}); });
const waitMessage = (child, condition) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { cleanup(); reject(Error('LOCAL_CHILD_DEADLINE')); }, 60000);
  const message = value => { if (value.error) { cleanup(); reject(Error(value.error)); }
    else if (condition(value)) { cleanup(); resolve(value); } };
  const exit = code => { cleanup(); reject(Error(`LOCAL_CHILD_EXIT:${code}:${child.fixtureError || ''}`)); };
  const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); };
  child.on('message', message); child.on('exit', exit);
});
const child = (point, extra = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    key === 'PATH' || key === 'NODE_PATH' || key.startsWith('LOCAL_RELIABILITY_') || key.startsWith('POST_VIDEO_') || key.startsWith('CLIP_HLS_') || key === 'PUSH_NOTIFICATION_DISPATCH_MODE' || key === 'AWS_S3_BUCKET'));
  Object.assign(env, { NODE_ENV: 'test', DEPLOYMENT_ENVIRONMENT: 'test', AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PROFILE: 'squadhunt-local-tests-no-cloud', TMPDIR: root,
    // Frozen runtime imports validate configuration before main(). Supply only
    // local fixture values rather than relying on a developer .env file.
    MONGODB_URI: mongo.getUri(), REDIS_HOST: '127.0.0.1', REDIS_PORT: String(port),
    JWT_SECRET: 'local-reliability-placeholder-at-least-thirty-two-characters',
    JWT_REFRESH_SECRET: 'local-refresh-placeholder-at-least-thirty-two-characters',
    LOCAL_RELIABILITY_MONGO_URI: mongo.getUri(), LOCAL_RELIABILITY_REDIS_PORT: String(port),
    LOCAL_RELIABILITY_ARTIFACT_ROOT: root, LOCAL_RELIABILITY_QUEUE: queue.name,
    LOCAL_RELIABILITY_POINT: point, ...extra });
  const value = fork(path.join(__dirname, 'rehearsal-child.cjs'), [], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  value.stderr.on('data', bytes => {
    const line = bytes.toString().split('\n').find(line => /^(?:\w*Error|Error):/.test(line));
    if (line) value.fixtureError = line.slice(0, 300);
  });
  children.add(value); value.once('exit', () => children.delete(value)); return value;
};
const kill = async child => { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited; };
const replacement = (processor = job => upload.processVideoUploadJob(job.data), connectionPort = port) => {
  const worker = new Worker(queue.name, processor, { connection: connection(connectionPort),
    concurrency: 1, lockDuration: 1000, stalledInterval: 500, maxStalledCount: 2 });
  worker.on('error', () => {}); workers.add(worker); return worker;
};
const accepted = async () => {
  const id = new mongoose.Types.ObjectId();
  const row = await Session.create({ _id: id, owner, clientUploadId: randomUUID(), filename: 'local.mp4', mimeType: 'video/mp4',
    size: 100, partSize: 100, partCount: 1, objectKey: `post-video-sources/${owner}/${id}/source.mp4`,
    status: 'QUEUED', uploadVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  const input = { clientPostId: randomUUID(), videoUploadIds: [String(id)], postType: 'general', text: 'Local reliability fixture', visibility: 'private', mentions: [] };
  const intent = await publisher.register(owner, input); assert.equal(intent.status, 'PENDING');
  return { row, input };
};
const enqueue = (id, attempt = '0') => queue.add('process-upload', { sessionId: String(id) }, {
  jobId: `video-upload-${id}-${attempt}`, attempts: 3, backoff: { type: 'exponential', delay: 100 }, removeOnComplete: 2000, removeOnFail: 5000 });

before(async () => {
  root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'squadhunt-video-reliability-'));
  mongo = await MongoMemoryServer.create({ binary: { systemBinary: '/opt/homebrew/bin/mongod', version: '8.3.7' } });
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
  await Promise.all([Session.createIndexes(), Pending.createIndexes(), Post.createIndexes()]);
  Object.assign(process.env, { NODE_ENV: 'test', DEPLOYMENT_ENVIRONMENT: 'test', POST_VIDEO_UPLOADS_ENABLED: 'true',
    POST_VIDEO_BACKGROUND_PUBLISH_ENABLED: 'true', CLIP_HLS_WORKER_ENABLED: 'false', AWS_S3_BUCKET: 'local-fixture-only', PUSH_NOTIFICATION_DISPATCH_MODE: 'outbox_only',
    POST_VIDEO_PRIVATE_DELIVERY_ENABLED: 'true', POST_VIDEO_CLOUDFRONT_URL: 'https://media.example.invalid',
    POST_VIDEO_API_ORIGIN: 'https://api.example.invalid', POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID: 'local-test-key',
    POST_VIDEO_CLOUDFRONT_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    POST_VIDEO_PLAYBACK_TOKEN_SECRET: 'local-fixture-secret-at-least-thirty-two-characters' });
  await User.create({ _id: owner, username: 'reliability_fixture', email: 'reliability@example.invalid', password: 'Fixture!123', userType: 'player', profile: { displayName: 'Fixture' }, isActive: true });
  port = localPort;
  queue = new Queue(`video-reliability-${process.pid}`, { connection: connection(port) });
  await queue.waitUntilReady();
  upload.__setDependenciesForTests({ ...dependencies(root), enqueue });
});
beforeEach(async () => {
  require('./local-guards.cjs').endpoints(mongo.getUri(), port, password);
  assert.equal(workers.size, 0);
  await queue.obliterate({ force: true });
  await Promise.all([Session.deleteMany({}), Pending.deleteMany({}), Post.deleteMany({}), Notification.deleteMany({})]);
  await mongoose.connection.collection('videopostpublications').deleteMany({});
});
after(async () => {
  for (const value of children) value.kill('SIGKILL');
  await Promise.all([...workers].map(worker => worker.close(true)));
  await queue?.close(); redis?.kill('SIGTERM');
  upload.__setDependenciesForTests(); await mongoose.disconnect(); await mongo?.stop();
  if (root) await fs.rm(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in oldEnvironment)) delete process.env[key]; Object.assign(process.env, oldEnvironment);
});

for (const point of ['before-claim', 'after-claim', 'encoding', 'after-upload', 'ready-before-queue-ack']) {
  test(`actual worker SIGKILL at ${point} preserves accepted work and one canonical Post`, async () => {
    const { row, input } = await accepted(); const job = await enqueue(row._id);
    const interrupted = child(point); await waitMessage(interrupted, value => value.point === point);
    await kill(interrupted);
    const before = await Session.findById(row._id).select('+leaseToken +leaseExpiresAt');
    if (!['before-claim', 'ready-before-queue-ack'].includes(point)) {
      assert.equal(before.status, 'PROCESSING'); assert.equal(before.attempts, 1);
      assert.ok(before.leaseExpiresAt > new Date());
    }
    const worker = replacement();
    try {
      await until(async () => await (await queue.getJob(job.id)).getState() === 'completed');
      if (before.status === 'PROCESSING') {
        assert.equal((await Session.findById(row._id)).status, 'PROCESSING', 'early BullMQ redelivery cannot steal the durable lease');
        const early = await queue.getJob(job.id); assert.equal(early.returnvalue.skipped, true);
        // Advance only this local fixture's durable lease; the production ten-minute lease is unchanged.
        await Session.updateOne({ _id: row._id }, { $set: { leaseExpiresAt: new Date(0) } });
        await Promise.all([upload.recoverVideoUploads(), upload.recoverVideoUploads()]);
      }
      await until(async () => (await Session.findById(row._id)).status === 'READY');
      await Promise.all([publisher.recover(), publisher.recover()]);
      const published = await until(async () => {
        const result = await publisher.get(owner, input.clientPostId);
        return result.status === 'PUBLISHED' ? result : null;
      });
      assert.equal(published.status, 'PUBLISHED', JSON.stringify(published.error || {}));
      assert.equal(await Post.countDocuments({ 'content.media.uploadSessionId': row._id }), 1);
      assert.equal(await Pending.countDocuments({ clientPostId: input.clientPostId }), 1);
      assert.equal(await Notification.countDocuments({ recipient: owner, 'data.customData.notificationDedupeKey': `video-post-published:${published.postId}` }), 1);
      const final = await Session.findById(row._id);
      assert.equal(final.attempts, before.status === 'PROCESSING' ? 2 : 1);
      if (point === 'after-upload') assert.ok(final.output.prefix !== before.outputPrefixes[0], 'replacement must not expose partial old derivatives');
    } finally { await worker.close(); workers.delete(worker); }
  });
}

for (const point of ['post-insert-before-source-link', 'post-saved-before-intent-ack']) test(`API SIGKILL at ${point} recovers the canonical Post and owner association under duplicate reconcilers`, async () => {
  const { row, input } = await accepted();
  const prefix = `post-video-playback/${owner}/${row._id}/ready-version`;
  await Session.updateOne({ _id: row._id }, { $set: { status: 'READY', metadata: { duration: 2, width: 640, height: 360 },
    output: { prefix, hlsKey: `${prefix}/master.m3u8`, fallbackKey: `${prefix}/fallback.mp4`, thumbnailKey: `${prefix}/thumbnail.jpg`, renditions: [] } } });
  const interrupted = child(point, { LOCAL_RELIABILITY_MODE: 'publish', LOCAL_RELIABILITY_SESSION: String(row._id) });
  await waitMessage(interrupted, value => value.point === point);
  await kill(interrupted);
  const pending = await Pending.findOne({ clientPostId: input.clientPostId });
  assert.equal(pending.status, 'PUBLISHING'); assert.equal(await Post.countDocuments({ _id: pending._id }), 1);
  await Pending.updateOne({ _id: pending._id }, { $set: { leaseExpiresAt: new Date(0) } });
  const restarts = [child('', { LOCAL_RELIABILITY_MODE: 'recover-publication' }), child('', { LOCAL_RELIABILITY_MODE: 'recover-publication' })];
  await Promise.all(restarts.map(value => waitMessage(value, message => message.done)));
  const recovered = await publisher.get(owner, input.clientPostId);
  assert.equal(recovered.status, 'PUBLISHED'); assert.equal(recovered.postId, String(pending._id));
  assert.equal(await Post.countDocuments({ _id: pending._id }), 1);
  const author = await User.findById(owner).select('posts');
  assert.equal(author.posts.filter(id => String(id) === String(pending._id)).length, 1, 'recovery must also repair the durable owner-to-Post link');
});

test('exhausted crashed leases surface a durable failure instead of disappearing or publishing broken media', async () => {
  const { row, input } = await accepted();
  await Session.updateOne({ _id: row._id }, { $set: { status: 'PROCESSING', attempts: 3, leaseToken: 'dead-local-worker', leaseExpiresAt: new Date(0) } });
  await upload.recoverVideoUploads();
  const final = await Session.findById(row._id).select('+objectKey');
  assert.equal(final.status, 'FAILED'); assert.equal(final.error.code, 'PROCESSING_RETRIES_EXHAUSTED');
  assert.equal((await publisher.get(owner, input.clientPostId)).status, 'FAILED');
  assert.equal(await Post.countDocuments({ 'content.media.uploadSessionId': row._id }), 0);
  assert.equal(final.objectKey, row.objectKey, 'verified source reference remains recoverable/observable');
});

test('graceful Worker.close drains its active job without claiming the next accepted job', async () => {
  const first = await accepted(), second = await accepted();
  let release, active;
  const started = new Promise(resolve => { active = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const worker = replacement(async job => { active(); await gate; return upload.processVideoUploadJob(job.data); });
  await enqueue(first.row._id); await started; await enqueue(second.row._id);
  let closed = false; const closing = worker.close().then(() => { closed = true; });
  await sleep(50); assert.equal(closed, false);
  assert.equal((await Session.findById(second.row._id)).status, 'QUEUED');
  release(); await closing; workers.delete(worker);
  assert.equal((await Session.findById(first.row._id)).status, 'READY');
  const fresh = replacement();
  try { await until(async () => (await Session.findById(second.row._id)).status === 'READY'); }
  finally { await fresh.close(); workers.delete(fresh); }
});

test('temporary Redis connection loss reconnects without losing an accepted job or duplicating its Post', async () => {
  const sockets = new Set();
  const proxyPort = await freePort();
  const proxy = net.createServer(downstream => {
    const upstream = net.connect(port, '127.0.0.1');
    sockets.add(downstream); sockets.add(upstream);
    const close = () => { sockets.delete(downstream); sockets.delete(upstream); downstream.destroy(); upstream.destroy(); };
    downstream.on('error', close); upstream.on('error', close);
    downstream.on('close', close); upstream.on('close', close);
    downstream.pipe(upstream).pipe(downstream);
  });
  const listen = () => new Promise(resolve => proxy.listen(proxyPort, '127.0.0.1', resolve));
  const disconnect = async () => {
    for (const socket of [...sockets]) socket.destroy();
    if (proxy.listening) await new Promise(resolve => proxy.close(resolve));
  };
  await listen();
  let release, signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const worker = replacement(async job => { signalStarted(); await gate; return upload.processVideoUploadJob(job.data); }, proxyPort);
  try {
    const { row, input } = await accepted(); const job = await enqueue(row._id); await started;
    const client = await worker.client;
    await disconnect();
    await until(() => client.status !== 'ready');
    await sleep(100); await listen();
    await until(() => client.status === 'ready');
    release();
    await until(async () => (await queue.getJob(job.id)).getState().then(state => state === 'completed'));
    assert.equal((await publisher.get(owner, input.clientPostId)).status, 'PUBLISHED');
    assert.equal(await Post.countDocuments({ 'content.media.uploadSessionId': row._id }), 1);
  } finally {
    release(); await worker.close(); workers.delete(worker); await disconnect();
  }
});

for (const count of [3, 5]) test(`${count} local simultaneous accepted intents publish once each with one active processor`, async () => {
  const rows = await Promise.all(Array.from({ length: count }, () => accepted()));
  let active = 0, peak = 0;
  const worker = replacement(async job => {
    active++; peak = Math.max(peak, active);
    try { return await upload.processVideoUploadJob(job.data); } finally { active--; }
  });
  try {
    await Promise.all(rows.map(({ row }) => enqueue(row._id)));
    await until(async () => await Post.countDocuments({ 'content.media.uploadSessionId': { $in: rows.map(({ row }) => row._id) } }) === count);
    await worker.close(); workers.delete(worker);
    for (const { row, input } of rows) {
      const published = await publisher.get(owner, input.clientPostId);
      assert.equal(published.status, 'PUBLISHED');
      assert.equal(await Post.countDocuments({ 'content.media.uploadSessionId': row._id }), 1);
    }
    assert.equal(peak, 1);
    assert.equal((await queue.getJobCounts('waiting', 'active', 'failed')).failed, 0);
  } finally { if (workers.has(worker)) { await worker.close(); workers.delete(worker); } }
});

// Appended to the frozen deployed worker's existing isolated test harness.
// Real MongoDB/Redis and service code; only storage/provider boundaries are local.

test('J: lost successful READY acknowledgement must preserve committed playback files', async () => {
  const {row,input}=await accepted();
  const original=Session.updateOne.bind(Session); let injected=false;
  Session.updateOne=async (filter,update,...args)=>{
    const result=await original(filter,update,...args);
    if(!injected&&update.$set?.status==='READY'){
      injected=true;throw Object.assign(Error('LOCAL_COMMITTED_READY_RESPONSE_LOST'),{code:'ETIMEDOUT'});
    }
    return result;
  };
  try { await upload.processVideoUploadJob({sessionId:String(row._id)}).catch(error=>assert.equal(error.code,'ETIMEDOUT')); }
  finally {Session.updateOne=original;}
  assert.equal(injected,true);
  const final=await Session.findById(row._id);
  assert.equal(final.status,'READY');
  const key=final.output.hlsKey;
  await assert.doesNotReject(fs.access(path.join(root,key)),'committed READY media must never be deleted on an ambiguous database response');
  await Promise.all([publisher.recover(),publisher.recover()]);
  const post=await publisher.get(owner,input.clientPostId);
  assert.equal(post.status,'PUBLISHED');
  for(let i=0;i<3;i++)await upload.processVideoUploadJob({sessionId:String(row._id)});
  assert.equal(await Post.countDocuments({_id:post.postId}),1);
  assert.equal((await Session.findById(row._id)).attempts,1);
});

test('G: failed READY write before commit retries boundedly without publishing partial outputs',async()=>{
 const {row,input}=await accepted(); const original=Session.updateOne.bind(Session);let failed=false;
 Session.updateOne=(filter,update,...args)=>{
  if(!failed&&update.$set?.status==='READY'){failed=true;return Promise.reject(Object.assign(Error('LOCAL_DB_WRITE_FAILED'),{code:'ETIMEDOUT'}));}
  return original(filter,update,...args);
 };
 try{await assert.rejects(upload.processVideoUploadJob({sessionId:String(row._id)}),{code:'ETIMEDOUT'});}
 finally{Session.updateOne=original;}
 let current=await Session.findById(row._id);assert.equal(current.status,'FAILED');assert.equal(current.attempts,1);
 assert.equal(await Post.countDocuments({}),0);
 await upload.retrySession(owner,row._id);const worker=replacement();
 try{const published=await until(async()=>{const x=await publisher.get(owner,input.clientPostId);return x.status==='PUBLISHED'?x:null;});
  assert.equal(await Post.countDocuments({_id:published.postId}),1);assert.equal((await Session.findById(row._id)).attempts,2);
 }finally{await worker.close();workers.delete(worker);}
});

test('E: two processors racing the same expired database lease produce one output and Post',async()=>{
 const {row,input}=await accepted();await Session.updateOne({_id:row._id},{$set:{status:'PROCESSING',attempts:1,leaseToken:'expired-local',leaseExpiresAt:new Date(0)}});
 const results=await Promise.all([upload.processVideoUploadJob({sessionId:String(row._id)}),upload.processVideoUploadJob({sessionId:String(row._id)})]);
 assert.equal(results.filter(x=>x.skipped).length,1);
 const current=await Session.findById(row._id);assert.equal(current.status,'READY');assert.equal(current.attempts,2);assert.equal(current.outputPrefixes.length,1);
 await Promise.all([publisher.recover(),publisher.recover()]);const post=await publisher.get(owner,input.clientPostId);assert.equal(post.status,'PUBLISHED');
 assert.equal(await Post.countDocuments({_id:post.postId}),1);assert.equal((await Post.findById(post.postId)).visibility,'private');
});

test('I: cancellation wins while recovered processing is paused, never publishes its partial output',async()=>{
 const {row,input}=await accepted();let release,signal;const started=new Promise(r=>signal=r),gate=new Promise(r=>release=r);
 upload.__setDependenciesForTests({...dependencies(root,async at=>{if(at==='encoding'){signal();await gate;}}),enqueue});
 const processing=upload.processVideoUploadJob({sessionId:String(row._id)});await started;
 assert.equal((await publisher.cancel(owner,input.clientPostId)).status,'CANCELLED');release();
 await processing.catch(error=>assert.ok(['PROCESSING_CANCELLED'].includes(error.code)));
 await Promise.all([publisher.recover(),publisher.recover()]);assert.equal((await publisher.get(owner,input.clientPostId)).status,'CANCELLED');
 assert.equal(await Post.countDocuments({}),0);assert.ok((await Session.findById(row._id).select('+objectKey')).objectKey);
 upload.__setDependenciesForTests({...dependencies(root),enqueue});
});

test('I/J: committed canonical publication wins late cancellation and repeated recovery stays private',async()=>{
 const {row,input}=await accepted();await upload.processVideoUploadJob({sessionId:String(row._id)});
 const post=await publisher.get(owner,input.clientPostId);assert.equal(post.status,'PUBLISHED');
 await assert.rejects(publisher.cancel(owner,input.clientPostId),error=>Boolean(error.code));
 for(let i=0;i<3;i++)await Promise.all([publisher.recover(),upload.processVideoUploadJob({sessionId:String(row._id)})]);
 assert.equal(await Post.countDocuments({_id:post.postId}),1);assert.equal((await Post.findById(post.postId)).visibility,'private');
});

test('B: SIGKILL a real FFmpeg encoder and its isolated worker, then recover exactly one publication',async()=>{
 const {row,input}=await accepted();const job=await enqueue(row._id);
 const interrupted=child('actual-ffmpeg');let pid;
 try{
  const message=await waitMessage(interrupted,x=>x.point==='actual-ffmpeg');pid=message.ffmpegPid;
  assert.ok(Number.isSafeInteger(pid)&&pid>1);process.kill(pid,0);
  await kill(interrupted);try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  const current=await Session.findById(row._id);assert.equal(current.status,'PROCESSING');assert.equal(current.attempts,1);
  await Session.updateOne({_id:row._id},{$set:{leaseExpiresAt:new Date(0)}}); // isolated fixture clock only
  await Promise.all([upload.recoverVideoUploads(),upload.recoverVideoUploads()]);
  const worker=replacement();try{
   const published=await until(async()=>{const x=await publisher.get(owner,input.clientPostId);return x.status==='PUBLISHED'?x:null;});
   assert.equal(await Post.countDocuments({_id:published.postId}),1);assert.equal((await Session.findById(row._id)).attempts,2);
  }finally{await worker.close();workers.delete(worker);}
 }finally{if(interrupted.exitCode===null&&interrupted.signalCode===null)await kill(interrupted);if(pid)try{process.kill(pid,'SIGKILL');}catch{}}
});

test('G/J: unknown failure-write outcome preserves output and an expired claim remains recoverable',async()=>{
 const {row,input}=await accepted();const original=Session.updateOne.bind(Session);let failReady=true,failFailure=true;
 Session.updateOne=(filter,update,...args)=>{
  if(failReady&&update.$set?.status==='READY'){failReady=false;return Promise.reject(Object.assign(Error('LOCAL_READY_TIMEOUT'),{code:'ETIMEDOUT'}));}
  if(failFailure&&update.$set?.status==='FAILED'){failFailure=false;return Promise.reject(Object.assign(Error('LOCAL_FAILURE_TIMEOUT'),{code:'ETIMEDOUT'}));}
  return original(filter,update,...args);
 };
 try{await assert.rejects(upload.processVideoUploadJob({sessionId:String(row._id)}),{code:'ETIMEDOUT'});}finally{Session.updateOne=original;}
 const current=await Session.findById(row._id);assert.equal(current.status,'PROCESSING');
 assert.equal(current.outputPrefixes.length,1);await fs.access(path.join(root,current.outputPrefixes[0],'master.m3u8'));
 assert.equal(await Post.countDocuments({}),0);
 await Session.updateOne({_id:row._id},{$set:{leaseExpiresAt:new Date(0)}});
 await Promise.all([upload.recoverVideoUploads(),upload.recoverVideoUploads()]);const worker=replacement();
 try{const post=await until(async()=>{const x=await publisher.get(owner,input.clientPostId);return x.status==='PUBLISHED'?x:null;});
  assert.equal(await Post.countDocuments({_id:post.postId}),1);assert.equal((await Post.findById(post.postId)).visibility,'private');
 }finally{await worker.close();workers.delete(worker);}
});

test('G/J: failure write committed before response loss retains prefix until successful retry cleanup',async()=>{
 const {row,input}=await accepted();const original=Session.updateOne.bind(Session);let ready=true,failed=true;
 Session.updateOne=async(filter,update,...args)=>{
  if(ready&&update.$set?.status==='READY'){ready=false;throw Object.assign(Error('LOCAL_READY_NOT_COMMITTED'),{code:'ETIMEDOUT'});}
  const value=await original(filter,update,...args);
  if(failed&&update.$set?.status==='FAILED'){failed=false;throw Object.assign(Error('LOCAL_FAILURE_ACK_LOST'),{code:'ETIMEDOUT'});}return value;
 };
 try{await assert.rejects(upload.processVideoUploadJob({sessionId:String(row._id)}),{code:'ETIMEDOUT'});}finally{Session.updateOne=original;}
 const before=await Session.findById(row._id);assert.equal(before.status,'FAILED');await fs.access(path.join(root,before.outputPrefixes[0],'master.m3u8'));
 await upload.retrySession(owner,row._id);const worker=replacement();
 try{const post=await until(async()=>{const x=await publisher.get(owner,input.clientPostId);return x.status==='PUBLISHED'?x:null;});
  await until(async()=>(await Session.findById(row._id)).outputPrefixes.length===1);const final=await Session.findById(row._id);
  assert.notEqual(final.output.prefix,before.outputPrefixes[0]);await fs.access(path.join(root,final.output.hlsKey));assert.equal(await Post.countDocuments({_id:post.postId}),1);
 }finally{await worker.close();workers.delete(worker);}
});


// Real source/FFmpeg end-to-end local media case, separate from mocked boundary cases.
test('approved portrait: actual frozen encoder, HLS/MP4 files, READY and canonical publication', async () => {
  const fixture = process.env.LOCAL_RELIABILITY_FIXTURE;
  const { row, input } = await accepted();
  await Session.updateOne({ _id: row._id }, { $set: { size: 5939073, partSize: 5939073 } });
  const storage = dependencies(root).storage;
  storage.downloadFile = async (_key, target) => fs.copyFile(fixture, target);
  upload.__setDependenciesForTests({ storage, enqueue }); // real generateClipHls, no generate override
  const started = performance.now();
  try {
    await upload.processVideoUploadJob({ sessionId: String(row._id) });
    const final = await Session.findById(row._id);
    assert.equal(final.status, 'READY');
    assert.equal(final.attempts, 1);
    for (const key of [final.output.hlsKey, final.output.fallbackKey, final.output.thumbnailKey])
      assert.ok((await fs.stat(path.join(root, key))).size > 0);
    const fallback = path.join(root, final.output.fallbackKey);
    const { execFileSync } = require('node:child_process');
    const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-select_streams','v:0',
      '-show_entries','stream=codec_name,avg_frame_rate','-of','json',fallback], { encoding:'utf8' }));
    assert.equal(probe.streams[0].codec_name, 'h264');
    const [n,d] = probe.streams[0].avg_frame_rate.split('/').map(Number); assert.ok(n/d <= 30.001);
    execFileSync('ffmpeg', ['-nostdin','-v','error','-i',fallback,'-f','null','-'], { stdio:'pipe' });
    execFileSync('ffmpeg', ['-nostdin','-v','error','-i',path.join(root,final.output.hlsKey),'-map','0:v:0','-f','null','-'], { stdio:'pipe' });
    await Promise.all([publisher.recover(), publisher.recover()]);
    const post = await publisher.get(owner, input.clientPostId);
    assert.equal(post.status, 'PUBLISHED');
    assert.equal(await Post.countDocuments({ _id: post.postId }), 1);
    assert.equal((await Post.findById(post.postId)).visibility, 'private');
    console.log(JSON.stringify({ event:'local_real_encoder_result', seconds:(performance.now()-started)/1000,
      fallbackCodec:'h264', maxObservedFallbackFps:n/d, canonicalCount:1, cloud:false }));
  } finally { upload.__setDependenciesForTests({ ...dependencies(root), enqueue }); }
});
