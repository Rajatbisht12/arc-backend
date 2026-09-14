#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Post = require('../src/legacy-src/models/Post');

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
if (apply && verify) throw new Error('Use either --apply or --verify, not both');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');

const expectedKey = {
  'content.media.playback.status': 1,
  'content.media.playback.leaseExpiresAt': 1,
};
const sameKey = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
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
  });

  let indexes = await Post.collection.indexes();
  let existing = indexes.find(index => sameKey(index.key, expectedKey));
  if (apply && !existing) {
    const name = await Post.collection.createIndex(expectedKey, { background: true });
    indexes = await Post.collection.indexes();
    existing = indexes.find(index => sameKey(index.key, expectedKey));
    if (!existing) throw new Error('Clip HLS recovery index was not created');
    console.log(`created ${name}`);
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : verify ? 'verify' : 'audit-only',
    compliant: Boolean(existing),
    indexName: existing?.name || null,
    key: expectedKey,
  }, null, 2));
  if (!apply) console.log('No index was changed.');
  if (verify && !existing) process.exitCode = 2;
};

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => undefined));
