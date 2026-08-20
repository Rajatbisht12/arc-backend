#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
if (apply && verify) {
  console.error('Use either --apply or --verify, not both');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const legacyRoot = path.resolve(__dirname, '..', 'src', 'legacy-src');
const Notification = require(path.join(legacyRoot, 'models', 'Notification.js'));
const { repairNotificationHistory } = require(path.join(
  legacyRoot,
  'services',
  'notificationHistoryService.js'
));

const connectOptions = {
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
};

const createDeclaredIndexes = async () => {
  const created = [];
  for (const [keys, options] of Notification.schema.indexes()) {
    created.push(await Notification.collection.createIndex(keys, options));
  }
  return created;
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI, connectOptions);
  const recipients = await Notification.distinct('recipient');
  const totals = {
    recipients: recipients.length,
    scanned: 0,
    orphanNotifications: 0,
    duplicateLikes: 0,
    deleted: 0
  };

  for (const recipientId of recipients) {
    const result = await repairNotificationHistory({ recipientId, dryRun: !apply });
    totals.scanned += result.scanned;
    totals.orphanNotifications += result.orphanIds.length;
    totals.duplicateLikes += result.duplicateLikeIds.length;
    totals.deleted += result.deleted;
  }

  let indexesCreated = [];
  if (apply) indexesCreated = await createDeclaredIndexes();
  const uniqueLikeIndexPresent = await Notification.collection.indexExists(
    'unique_like_notification_per_actor_target'
  );
  console.log(JSON.stringify({
    mode: apply ? 'apply' : verify ? 'verify' : 'audit-only',
    ...totals,
    uniqueLikeIndexPresent,
    indexesCreated: apply ? indexesCreated.length : 0
  }, null, 2));

  if (!apply) {
    console.log('No data changed. Take a database snapshot, then run with --apply to remove only verified orphans/duplicate likes and create indexes.');
  }
  if (verify && (totals.orphanNotifications || totals.duplicateLikes || !uniqueLikeIndexPresent)) {
    process.exitCode = 2;
  }
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
