#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const User = require('../src/legacy-src/models/User');

const name = 'oauth_google_subject_unique';
const key = { googleId: 1 };
const partialFilterExpression = { googleId: { $type: 'string' } };
const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
const audit = process.argv.includes('--audit');

if (!process.env.MONGODB_URI || Number(apply) + Number(verify) + Number(audit) !== 1) {
  console.error('MONGODB_URI and exactly one of --audit, --apply, or --verify are required');
  process.exit(1);
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
    serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? {
      tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
        ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {})
    } : {})
  });

  const duplicates = await User.aggregate([
    { $match: { googleId: { $type: 'string' } } },
    { $group: { _id: '$googleId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 }
  ]);
  if (duplicates.length) {
    throw new Error('Duplicate Google subjects exist; resolve them manually before installing the unique index');
  }

  const indexes = await User.collection.indexes();
  const existing = indexes.find(index => index.name === name);
  const compatible = existing && same(existing.key, key) && existing.unique === true
    && same(existing.partialFilterExpression, partialFilterExpression);
  if (existing && !compatible) throw new Error(`Existing ${name} index has incompatible options`);
  if (indexes.some(index => index.name !== name && same(index.key, key) && index.unique !== true)) {
    throw new Error('A non-unique googleId index exists; review it manually before applying the unique index');
  }

  if (apply && !compatible) {
    await User.collection.createIndex(key, { name, unique: true, partialFilterExpression });
  }
  if ((apply || verify) && !compatible) {
    const installed = (await User.collection.indexes()).find(index => index.name === name);
    if (!installed || !same(installed.key, key) || installed.unique !== true
      || !same(installed.partialFilterExpression, partialFilterExpression)) {
      throw new Error(`Missing or incompatible ${name} index`);
    }
  }
  console.log(`${audit ? 'Audited' : apply ? 'Installed' : 'Verified'} ${name}; no duplicate Google subjects`);
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
