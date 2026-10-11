#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const { Message } = require('../src/legacy-src/models/Message');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const name = 'message_client_idempotency';
const key = { sender: 1, clientMessageId: 1 };
const partialFilterExpression = { clientMessageId: { $type: 'string' } };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
    retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
    serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? {
      tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
        ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {}),
    } : {}),
  });
  if (!process.argv.includes('--verify')) {
    await Message.collection.createIndex(key, { name, unique: true, partialFilterExpression, background: true });
    console.log(`created/confirmed ${name}`);
  }
  const actual = (await Message.collection.indexes()).find(index => index.name === name);
  if (!actual || !same(actual.key, key) || actual.unique !== true
    || !same(actual.partialFilterExpression, partialFilterExpression)) {
    throw new Error(`Message is missing or has an incompatible ${name} index`);
  }
  console.log(`verified ${name}`);
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
