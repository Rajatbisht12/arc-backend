#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}
const auditOnly = process.argv.includes('--audit-only');
const verifyOnly = process.argv.includes('--verify');
if (auditOnly && verifyOnly) {
  console.error('Use only one of --audit-only or --verify');
  process.exit(1);
}

const modelNames = [
  'Broadcast',
  'BroadcastOccurrence',
  'BroadcastRecipient',
  'BroadcastChunk',
  'BroadcastPushReceipt',
  'BroadcastEvent',
  'BroadcastTemplate',
  'NotificationFailure',
  'AdminAuditLog',
  'Notification',
  'User'
];

const loadModels = () => modelNames.map((name) =>
  require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', `${name}.js`))
).concat(require('../src/legacy-src/models/Message').Message);

const normalizeKey = (key) => JSON.stringify(Object.entries(key || {}));

const verifyModelIndexes = async (Model) => {
  const expected = Model.schema.indexes();
  const actual = await Model.collection.indexes();
  const missing = expected.filter(([expectedKey, expectedOptions]) => !actual.some((index) =>
    normalizeKey(index.key) === normalizeKey(expectedKey) &&
    Boolean(index.unique) === Boolean(expectedOptions.unique) &&
    Boolean(index.sparse) === Boolean(expectedOptions.sparse)
  ));
  if (missing.length) {
    throw new Error(`${Model.modelName} is missing indexes: ${missing.map(([key]) => normalizeKey(key)).join(', ')}`);
  }
  console.log(`verified ${Model.modelName}: ${expected.length} declared indexes`);
};

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
        : {})
    } : {})
  });
  const models = loadModels();
  const User = models.find((model) => model.modelName === 'User');
  const reservedOwners = await User.find({ username: /^squadhunt$/i })
    .select('_id username userType isSystemAccount').lean();
  if (reservedOwners.length > 1 || reservedOwners.some((owner) =>
    owner.username !== 'SquadHunt' || owner.userType !== 'system' || owner.isSystemAccount !== true)) {
    throw new Error('Reserved SquadHunt username conflicts with an existing account; manual review required');
  }
  if (auditOnly) {
    console.log('Verified reserved SquadHunt username has no conflicting owner');
    await mongoose.disconnect();
    return;
  }
  if (!verifyOnly) {
    for (const Model of models) {
      await Model.createIndexes();
      console.log(`created/confirmed indexes for ${Model.modelName}`);
    }
  }
  for (const Model of models) await verifyModelIndexes(Model);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
