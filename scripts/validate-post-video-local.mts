/**
 * LOCAL ONLY: real loopback transfers using the production Web upload engine,
 * isolated MongoDB, the production session service and real FFmpeg. S3 is a
 * disk-backed emulator: this does not certify AWS/browser/device readiness.
 * Fixtures are a playable H.264 movie padded with an MP4 free atom to exact
 * transfer sizes. This measures transfer/recovery, not worst-case encode cost.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import * as fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID, generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { UploadEntry, UploadTransport } from '../../frontend/src/features/post-upload/videoUploads.ts';

const require = createRequire(import.meta.url);
const { uploadVideo, sourceFingerprint } = require('../../frontend/src/features/post-upload/videoUploads.ts');
const service = require('../src/legacy-src/services/videoUploadService.js');
const Session = require('../src/legacy-src/models/VideoUploadSession.js');
const run = promisify(execFile);
const root = await fs.mkdtemp(path.join(tmpdir(), 'squadhunt-local-video-'));
const db = await MongoMemoryServer.create({ binary: { systemBinary: '/opt/homebrew/bin/mongod', version: '8.3.7' }, instance: { storageEngine: 'wiredTiger' } });
const owner = new mongoose.Types.ObjectId();
const objectPath = (key: string) => path.join(root, createHash('sha256').update(key).digest('hex'));
type Parts = { key: string; type: string; session: string; parts: Map<number, { path: string; size: number; etag: string }> };
const uploads = new Map<string, Parts>();
const objects = new Map<string, { path: string; size: number; sessionId: string; contentType: string }>();
let loseNextAcknowledgement = true;
let origin = '';
const http = createServer(async (req, res) => {
  try {
    const [id, partText] = (req.url || '').slice(1).split('/');
    const upload = uploads.get(id); const part = Number(partText);
    if (req.method !== 'PUT' || !upload || !Number.isInteger(part)) { res.writeHead(404).end(); return; }
    const target = path.join(root, `part-${id}-${part}`);
    await pipeline(req, createWriteStream(target));
    const size = (await fs.stat(target)).size;
    upload.parts.set(part, { path: target, size, etag: `fixture-${part}-${size}` });
    if (loseNextAcknowledgement) { loseNextAcknowledgement = false; res.destroy(); return; }
    res.writeHead(200, { ETag: `fixture-${part}-${size}` }).end();
  } catch { res.writeHead(500).end(); }
});
await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;

try {
  await mongoose.connect(db.getUri());
  await Session.createIndexes();
  Object.assign(process.env, {
    POST_VIDEO_UPLOADS_ENABLED: 'true', CLIP_HLS_WORKER_ENABLED: 'false',
    POST_VIDEO_PRIVATE_DELIVERY_ENABLED: 'true', AWS_S3_BUCKET: 'isolated-fixture-bucket',
    POST_VIDEO_CLOUDFRONT_URL: 'https://fixture.invalid', POST_VIDEO_API_ORIGIN: 'https://api.fixture.invalid',
    POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID: 'fixture-only', POST_VIDEO_PLAYBACK_TOKEN_SECRET: 'local-fixture-secret-with-at-least-32-characters',
    POST_VIDEO_CLOUDFRONT_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  service.__setDependenciesForTests({
    enqueue: async () => {},
    storage: {
      createVideoMultipart: async (key: string, type: string, session: string) => {
        const id = randomUUID(); uploads.set(id, { key, type, session, parts: new Map() }); return id;
      },
      presignVideoPart: async (_key: string, id: string, number: number) => `${origin}/${id}/${number}`,
      listVideoParts: async (_key: string, id: string) => [...uploads.get(id)!.parts].map(([partNumber, part]) => ({ partNumber, size: part.size, etag: part.etag })),
      completeVideoMultipart: async (key: string, id: string, parts: { partNumber: number }[]) => {
        const upload = uploads.get(id)!; const target = objectPath(key);
        for (const part of parts) await pipeline(createReadStream(upload.parts.get(part.partNumber)!.path), createWriteStream(target, { flags: 'a' }));
        objects.set(key, { path: target, size: (await fs.stat(target)).size, sessionId: upload.session, contentType: upload.type });
        uploads.delete(id);
      },
      headVideoSource: async (key: string) => {
        if (!objects.has(key)) throw Object.assign(new Error('missing'), { name: 'NotFound' });
        return objects.get(key);
      },
      downloadFile: async (key: string, target: string) => pipeline(createReadStream(objects.get(key)!.path), createWriteStream(target)),
      uploadMediaFile: async (source: string, key: string) => {
        const target = objectPath(key); await fs.copyFile(source, target);
        const size = (await fs.stat(target)).size;
        objects.set(key, { path: target, size, sessionId: '', contentType: '' });
        return { publicId: key, url: key, bytes: size };
      },
      abortVideoMultipart: async (_key: string, id: string) => { uploads.delete(id); },
      deletePrefix: async (prefix: string) => {
        for (const [key, row] of objects) if (key.startsWith(prefix)) { await fs.rm(row.path, { force: true }); objects.delete(key); }
      },
    },
  });
  const base = path.join(root, 'base.mp4');
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-c:a', 'aac', base]);
  const baseSize = (await fs.stat(base)).size;
  const results: unknown[] = [];
  for (const mib of [10, 50, 100, 200, 300, 500]) {
    const source = path.join(root, `source-${mib}.mp4`); await fs.copyFile(base, source);
    const size = mib * 1024 * 1024;
    const fd = await fs.open(source, 'a');
    const paddingSize = size - baseSize;
    const free = Buffer.alloc(8); free.writeUInt32BE(paddingSize); free.write('free', 4);
    await fd.write(free);
    const zero = Buffer.alloc(1024 * 1024);
    for (let remaining = paddingSize - 8; remaining > 0; remaining -= zero.length) await fd.write(zero.subarray(0, Math.min(zero.length, remaining)));
    await fd.close();
    assert.equal((await fs.stat(source)).size, size);
    const file = new File([await openAsBlob(source, { type: 'video/mp4' })], `source-${mib}.mp4`, { type: 'video/mp4', lastModified: 1 });
    let entry: UploadEntry = { fingerprint: sourceFingerprint(file), filename: file.name, clientUploadId: randomUUID(), uploadedBytes: 0 };
    let processingMs = 0; let processingDone = false;
    const transport: UploadTransport = {
      create: async (file, key) => service.createSession(owner, { clientUploadId: key, filename: file.name, mimeType: file.type, size: file.size }),
      getSession: async id => service.getSession(owner, id),
      parts: async id => service.listParts(owner, id),
      sign: async (id, parts) => service.signParts(owner, id, parts),
      complete: async id => service.completeSession(owner, id),
      retry: async id => service.retrySession(owner, id),
      put: async (url, body, signal, changed) => {
        assert.ok(url.startsWith(origin));
        const response = await fetch(url, { method: 'PUT', body, signal });
        if (!response.ok) throw new Error(`PUT ${response.status}`);
        changed(body.size);
      },
      wait: async () => {
        if (!processingDone) {
          const start = performance.now();
          await service.processVideoUploadJob({ sessionId: entry.session!.id });
          processingMs = performance.now() - start; processingDone = true;
        }
      },
    };
    const start = performance.now();
    loseNextAcknowledgement = true;
    await assert.rejects(uploadVideo(file, entry, new AbortController().signal, next => { entry = next; }, transport));
    const acceptedParts = await service.listParts(owner, entry.session!.id);
    assert.ok(acceptedParts.length > 0, 'S3 accepted parts survive a lost acknowledgement');
    const accepted = new Set(acceptedParts.map((part: { partNumber: number }) => part.partNumber));
    const originalSign = transport.sign;
    transport.sign = async (id, parts, signal) => {
      assert.ok(parts.every(number => !accepted.has(number)), 'resume must reuse accepted parts');
      return originalSign(id, parts, signal);
    };
    await uploadVideo(file, entry, new AbortController().signal, next => { entry = next; }, transport);
    assert.equal(entry.session!.status, 'READY');
    assert.equal(entry.uploadedBytes, size);
    const session = await Session.findById(entry.session!.id);
    assert.ok(session.output.outputBytes.fallback > 0 && session.output.outputBytes.fallback < size);
    assert.ok(session.output.outputBytes.thumbnail > 0);
    results.push({ platform: 'local-production-web-engine', sourceBytes: size, parts: entry.session!.partCount,
      resumedAcceptedParts: accepted.size, elapsedMs: Math.round(performance.now() - start), processingMs: Math.round(processingMs),
      mp4Bytes: session.output.outputBytes.fallback, status: entry.session!.status });
    // Only fixture objects and records are removed; this script has no AWS client.
    await Session.deleteOne({ _id: session._id });
    for (const row of objects.values()) await fs.rm(row.path, { force: true }); objects.clear();
    for (const name of await fs.readdir(root)) if (name.startsWith('part-')) await fs.rm(path.join(root, name));
    await fs.rm(source);
  }
  console.log(JSON.stringify({ environment: 'isolated Mongo + loopback disk S3 emulator', fixture: '2-second H264/AAC MP4 plus free-atom padding; not representative encode workload', results }, null, 2));
} finally {
  service.__setDependenciesForTests();
  await new Promise<void>(resolve => http.close(() => resolve()));
  await mongoose.disconnect(); await db.stop();
  await fs.rm(root, { recursive: true, force: true });
}
