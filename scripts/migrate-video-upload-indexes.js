#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Session = require('../src/legacy-src/models/VideoUploadSession');
const Post = require('../src/legacy-src/models/Post');
const apply = process.argv.includes('--apply'), verify = process.argv.includes('--verify');
if (apply && verify) throw new Error('Use either --apply or --verify');
const expected = () => [
  ...Session.schema.indexes().map(([key, options]) => ({ model: Session, key, options })),
  ...Post.schema.indexes().filter(([, options]) => options.name === 'post_owner_client_unique').map(([key, options]) => ({ model: Post, key, options })),
];
const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, retryWrites: process.env.MONGODB_TLS !== 'true', serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? { tls: true, ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE) ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {}) } : {}),
  });
  const results = [];
  for (const { model, key, options } of expected()) {
    let indexes = await model.collection.indexes().catch(error => { if (error.codeName === 'NamespaceNotFound' || error.code === 26) return []; throw error; });
    const compatible = index => JSON.stringify(index.key) === JSON.stringify(key) && Boolean(index.unique) === Boolean(options.unique) && JSON.stringify(index.partialFilterExpression || {}) === JSON.stringify(options.partialFilterExpression || {});
    if (apply && !indexes.some(compatible)) {
      // Unique-index conflicts fail without deleting or rewriting any record.
      await model.collection.createIndex(key, { ...options, background: true });
      indexes = await model.collection.indexes();
    }
    results.push({ collection: model.collection.name, index: options.name, compliant: indexes.some(compatible) });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : verify ? 'verify' : 'audit-only', results }, null, 2));
  if (verify && results.some(row => !row.compliant)) process.exitCode = 2;
};
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = { expected };
