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

const requiredIndexes = [
  {
    name: 'message_history_direct_cursor',
    key: { messageType: 1, recipient: 1, sender: 1, createdAt: 1, _id: 1 },
  },
  {
    name: 'message_history_group_cursor',
    key: { messageType: 1, chatRoom: 1, createdAt: 1, _id: 1 },
  },
];

const sameKey = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
    retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
    serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? {
      tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
        ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
        : {}),
    } : {}),
  });

  if (!process.argv.includes('--verify')) {
    for (const index of requiredIndexes) {
      await Message.collection.createIndex(index.key, { name: index.name, background: true });
      console.log(`created/confirmed ${index.name}`);
    }
  }

  const actual = await Message.collection.indexes();
  for (const expected of requiredIndexes) {
    if (!actual.some(index => index.name === expected.name && sameKey(index.key, expected.key))) {
      throw new Error(`Message is missing ${expected.name}`);
    }
    console.log(`verified ${expected.name}`);
  }
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
