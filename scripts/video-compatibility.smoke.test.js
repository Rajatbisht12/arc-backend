// Real compiled launcher + loopback MongoDB/Redis/HTTP + FFmpeg. S3 and secret
// transport alone are substituted. Never reads .env or calls production AWS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes, generateKeyPairSync } = require('node:crypto');
const { Readable } = require('node:stream');
const root = path.resolve(__dirname, '..');

if (process.argv.includes('--server')) {
  require('dotenv').config = () => ({ parsed: {} });
  // Deny accidental external connections, even if a new startup task is added.
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = typeof args[0] === 'object' ? args[0] : { host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (options.host && !['127.0.0.1', 'localhost', '::1'].includes(options.host)) throw new Error('Smoke test forbids external network');
    return connect.apply(this, args);
  };
  require('@aws-sdk/client-secrets-manager').SecretsManagerClient.prototype.send = async () => ({ SecretString: '{}' });
  const objects = new Map();
  require('@aws-sdk/client-s3').S3Client.prototype.send = async function (command) {
    const { Key, Body, ContentType, Metadata, ChecksumSHA256, Prefix } = command.input;
    const type = command.constructor.name;
    if (type === 'PutObjectCommand') {
      const bytes = Buffer.isBuffer(Body) ? Body : Buffer.concat(await Array.fromAsync(Body));
      objects.set(Key, { bytes, ContentType, Metadata, ChecksumSHA256 });
      return { ETag: '"local-fixture-etag"', ChecksumSHA256 };
    }
    if (type === 'HeadObjectCommand' || type === 'GetObjectCommand') {
      const object = objects.get(Key);
      if (!object) throw Object.assign(new Error('Fixture not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return { ...object, ETag: '"local-fixture-etag"', ContentLength: object.bytes.length,
        ...(type === 'GetObjectCommand' ? { Body: Readable.from(object.bytes) } : {}) };
    }
    if (type === 'ListObjectsV2Command') return { Contents: [...objects.keys()].filter(key => key.startsWith(Prefix)).map(Key => ({ Key })), IsTruncated: false };
    if (type === 'DeleteObjectCommand') { objects.delete(Key); return {}; }
    if (type === 'DeleteObjectsCommand') { for (const { Key } of command.input.Delete.Objects) objects.delete(Key); return {}; }
    throw new Error(`Unexpected AWS operation in disabled-feature backend: ${type}`);
  };
  process.on('message', async message => {
    if (message !== 'verify-workers') return;
    try {
      const queue = require('../dist/infrastructure/jobs/queue');
      assert.equal(queue.clipVideoWorker.isRunning(), true);
      await assert.rejects(queue.enqueueVideoUpload('disabled-fixture'), /dedicated video worker/);
      assert.equal((await queue.clipVideoQueue.getJobs(['wait', 'active', 'delayed'])).some(job => job.name === 'process-upload'), false);
      process.send({ workersVerified: true, objectKeys: [...objects.keys()] });
    } catch (error) { process.send({ error: error.message }); }
  });
  require('../dist/launcher');
} else {
  const test = require('node:test');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongoose = require('mongoose');
  const systemBinary = process.env.MONGOMS_SYSTEM_BINARY || '/opt/homebrew/bin/mongod';
  const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const until = async (predicate, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await predicate().catch(() => null); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Local compatibility smoke timed out');
  };
  test('production-mode backend boots without video indexes/signing secrets; legacy login, posts and embedded HLS still work', {
    skip: !fs.existsSync(systemBinary), timeout: 90000,
  }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'squadhunt-compat-smoke-'));
    let mongo, redis, server, logs = '';
    const stop = async child => {
      if (!child || child.exitCode !== null) return;
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
      });
    };
    try {
      mongo = await MongoMemoryServer.create({ binary: { systemBinary, version: '8.3.7' }, instance: { storageEngine: 'wiredTiger' } });
      await mongoose.connect(mongo.getUri(), { autoCreate: false, autoIndex: false });
      const id = new mongoose.Types.ObjectId();
      await mongoose.connection.collection('users').insertOne({ _id: id, username: 'local_compat', email: 'local-compat@example.invalid',
        password: await require('bcryptjs').hash('abc123', 10), userType: 'player', isActive: true, needsProfileCompletion: false,
        profile: { displayName: 'Local compatibility fixture' }, createdAt: new Date(), updatedAt: new Date() });
      const redisPort = await freePort(), httpPort = await freePort();
      redis = spawn('redis-server', ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: 'ignore' });
      await until(() => new Promise((resolve, reject) => {
        const socket = net.connect(redisPort, '127.0.0.1', () => { socket.end(); resolve(true); }); socket.on('error', reject);
      }));
      const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      const flags = require('../src/legacy-src/config/videoDeploymentPolicy').VIDEO_COMPATIBILITY_FLAGS;
      server = spawn(process.execPath, [__filename, '--server'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
        PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        NODE_ENV: 'production', VIDEO_DEPLOYMENT_MODE: 'compatibility', ...flags,
        MONGODB_URI: mongo.getUri(), REDIS_HOST: '127.0.0.1', REDIS_PORT: String(redisPort), PORT: String(httpPort),
        JWT_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
        ADMIN_JWT_SECRET: randomBytes(32).toString('hex'), BANK_DETAILS_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'local-fixture', GOOGLE_CALLBACK_URL: 'https://example.invalid/callback',
        APNS_TEAM_ID: 'LOCALTEAM1', APNS_KEY_ID: 'LOCALKEY01', APNS_PRIVATE_KEY: key, APNS_BUNDLE_ID: 'com.squadhunt.fixture',
        AWS_S3_BUCKET: 'local-compat-fixture', AWS_REGION: 'us-east-1', AWS_EC2_METADATA_DISABLED: 'true',
        AWS_ACCESS_KEY_ID: 'local-fixture', AWS_SECRET_ACCESS_KEY: 'local-fixture',
      } });
      server.stdout.on('data', bytes => { logs += bytes; }); server.stderr.on('data', bytes => { logs += bytes; });
      const base = `http://127.0.0.1:${httpPort}`;
      const request = async (url, options) => {
        const response = await fetch(base + url, options); const body = await response.json();
        return { status: response.status, body };
      };
      await until(async () => { if (server.exitCode !== null) throw new Error('server exited'); return (await request('/health')).body.success; });
      const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'local-compat@example.invalid', password: 'abc123' }) });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const token = login.body.data.token; assert.ok(token);
      const headers = { Authorization: `Bearer ${token}` };
      const policy = await request('/api/posts/video-uploads/policy', { headers });
      assert.equal(policy.status, 200); assert.equal(policy.body.data.enabled, false);
      const disabled = await request('/api/posts/video-uploads', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(disabled.status, 503); assert.equal(disabled.body.code, 'VIDEO_UPLOADS_UNAVAILABLE');
      const publish = async (type, buffer) => {
        const form = new FormData(); form.set('text', `Local ${type} compatibility fixture`);
        if (buffer) form.set('media', new Blob([buffer], { type: type === 'video' ? 'video/mp4' : 'image/png' }), `fixture.${type === 'video' ? 'mp4' : 'png'}`);
        const result = await request('/api/posts', { method: 'POST', headers, body: form });
        assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.data.post;
      };
      await publish('text');
      const image = await require('sharp')({ create: { width: 48, height: 48, channels: 3, background: '#7c3aed' } }).png().toBuffer();
      await publish('image', image);
      const source = path.join(dir, 'fixture.mp4');
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source]);
      const video = await publish('video', await fsp.readFile(source));
      const postId = String(video._id || video.id); assert.ok(mongoose.isValidObjectId(postId));
      const ready = await until(async () => {
        const post = await mongoose.connection.collection('posts').findOne({ _id: new mongoose.Types.ObjectId(postId) });
        return post?.content?.media?.[0]?.playback?.status === 'ready' ? post : null;
      }, 45000);
      assert.match(ready.content.media[0].playback.hlsUrl, /master\.m3u8$/);
      assert.match(ready.content.media[0].playback.fallbackMp4Url, /fallback\.mp4$/);
      for (const endpoint of [`/api/posts/${postId}`, '/api/posts', '/api/posts/clips']) {
        const response = await request(endpoint, { headers }); assert.equal(response.status, 200, `${endpoint}: ${JSON.stringify(response.body)}`);
      }
      const worker = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker assertion timed out')), 5000);
        server.once('message', value => { clearTimeout(timer); value.error ? reject(new Error(value.error)) : resolve(value); });
        server.send('verify-workers');
      });
      assert.equal(worker.workersVerified, true);
      assert.ok(worker.objectKeys.some(key => key.endsWith('/master.m3u8')));
      const collections = await mongoose.connection.db.listCollections().toArray();
      assert.equal(collections.some(row => ['videouploadsessions', 'videouploadownerlocks', 'videopublicationlocks'].includes(row.name)), false,
        'Feature-disabled startup must not require/create upload-session collections or indexes');
      const indexes = await mongoose.connection.collection('posts').indexes();
      assert.equal(indexes.some(row => /client/.test(row.name)), false, 'No publication migration was run');
      console.log('Executed: production-mode startup; 6-character legacy login; text/image/video HTTP publication; actual FFmpeg HLS+MP4 through embedded BullMQ; feed/Clips/detail responses; disabled session rejection; no video migration or signing configuration.');
    } catch (error) { console.error(logs.slice(-14000)); throw error; }
    finally { await stop(server); await stop(redis); await mongoose.disconnect(); if (mongo) await mongo.stop(); await fsp.rm(dir, { recursive: true, force: true }); }
  });
}
