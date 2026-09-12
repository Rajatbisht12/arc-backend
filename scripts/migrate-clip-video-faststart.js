#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
if (apply && verify) throw new Error('Use either --apply or --verify, not both');

const required = ['MONGODB_URI', 'AWS_S3_BUCKET', 'AWS_REGION'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucket = process.env.AWS_S3_BUCKET;
const legacyRoot = path.resolve(__dirname, '..', 'src', 'legacy-src');
const Post = require(path.join(legacyRoot, 'models', 'Post.js'));

const connectOptions = {
  autoIndex: false,
  autoCreate: false,
  retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
  serverSelectionTimeoutMS: 15_000,
  ...(process.env.MONGODB_TLS === 'true' ? {
    tls: true,
    ...(process.env.MONGODB_TLS_CA_FILE && fsSync.existsSync(process.env.MONGODB_TLS_CA_FILE)
      ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
      : {}),
  } : {}),
};

const publicUrl = key => process.env.AWS_S3_CDN_URL
  ? `${process.env.AWS_S3_CDN_URL.replace(/\/$/, '')}/${key}`
  : `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

const readAtomOrder = (buffer) => {
  let offset = 0;
  let moovOffset = null;
  let mdatOffset = null;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerSize) break;
    if (type === 'moov' && moovOffset === null) moovOffset = offset;
    if (type === 'mdat' && mdatOffset === null) mdatOffset = offset;
    if (moovOffset !== null || mdatOffset !== null) {
      if (mdatOffset !== null && moovOffset === null) return { fastStart: false, moovOffset, mdatOffset };
      if (moovOffset !== null && mdatOffset !== null) break;
    }
    offset += size;
  }
  return {
    fastStart: moovOffset !== null && (mdatOffset === null || moovOffset < mdatOffset),
    moovOffset,
    mdatOffset,
  };
};

const bodyToBuffer = async body => Buffer.from(await body.transformToByteArray());

const inspectObject = async (key) => {
  const response = await s3.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    Range: 'bytes=0-65535',
  }));
  return readAtomOrder(await bodyToBuffer(response.Body));
};

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error(`${command} timed out`));
  }, 120_000);
  child.stderr.on('data', chunk => {
    if (stderr.length < 16_384) stderr += chunk.toString();
  });
  child.on('error', error => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', code => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(stderr || `${command} exited with code ${code}`));
  });
});

const remuxFastStart = async (inputPath, outputPath) => {
  await run('ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c', 'copy', '-movflags', '+faststart',
    outputPath,
  ]);
};

const migrateMedia = async (postId, media) => {
  const source = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: media.publicId }));
  const sourceBuffer = await bodyToBuffer(source.Body);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-clip-faststart-'));
  const inputPath = path.join(workDir, 'input.mp4');
  const outputPath = path.join(workDir, 'output.mp4');
  const newKey = `${media.publicId.replace(/\.mp4$/i, '')}-${randomUUID()}.faststart.mp4`;
  try {
    await fs.writeFile(inputPath, sourceBuffer);
    await remuxFastStart(inputPath, outputPath);
    const optimized = await fs.readFile(outputPath);
    const atomOrder = readAtomOrder(optimized.subarray(0, 65_536));
    if (!atomOrder.fastStart) throw new Error('Remux output did not place moov before mdat');

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: newKey,
      Body: optimized,
      ContentType: 'video/mp4',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    const update = await Post.collection.updateOne(
      { _id: postId, 'content.media.publicId': media.publicId },
      {
        $set: {
          'content.media.$[item].url': publicUrl(newKey),
          'content.media.$[item].publicId': newKey,
        },
      },
      { arrayFilters: [{ 'item.publicId': media.publicId }] },
    );
    if (update.modifiedCount !== 1) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: newKey }));
      throw new Error('Post changed during migration; discarded the unreferenced optimized object');
    }
    return newKey;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

const main = async () => {
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(process.env.MONGODB_URI, connectOptions);

  const posts = await Post.find({
    content: { $exists: true },
    'content.media': {
      $elemMatch: {
        type: 'video',
        publicId: /^gaming-social\/posts\/.*\.mp4$/i,
      },
    },
  }).select('_id content.media').lean();

  const totals = { posts: posts.length, videos: 0, alreadyFastStart: 0, needsMigration: 0, migrated: 0, failed: 0 };
  for (const post of posts) {
    for (const media of post.content?.media || []) {
      if (media.type !== 'video' || !/^gaming-social\/posts\/.*\.mp4$/i.test(media.publicId || '')) continue;
      totals.videos += 1;
      try {
        const atomOrder = await inspectObject(media.publicId);
        if (atomOrder.fastStart) {
          totals.alreadyFastStart += 1;
          continue;
        }
        totals.needsMigration += 1;
        if (apply) {
          await migrateMedia(post._id, media);
          totals.migrated += 1;
        }
      } catch (error) {
        totals.failed += 1;
        console.error(JSON.stringify({ postId: String(post._id), publicId: media.publicId, error: String(error) }));
      }
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : verify ? 'verify' : 'audit-only', ...totals }, null, 2));
  if (!apply) console.log('No data or S3 objects were changed.');
  if (verify && (totals.needsMigration > 0 || totals.failed > 0)) process.exitCode = 2;
  if (apply && totals.failed > 0) process.exitCode = 2;
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
