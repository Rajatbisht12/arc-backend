#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  MAX_AUTOMATIC_REPAIR_ROWS,
  auditDuplicateEvents,
  repairDuplicateEvents
} = require('./lib/broadcast-event-index-repair');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}
const auditOnly = process.argv.includes('--audit-only');
const verifyOnly = process.argv.includes('--verify');
const allowEventRepair = process.argv.includes('--allow-event-repair');
const repairEvents = process.argv.includes('--repair-events');
if ((auditOnly && verifyOnly) || (repairEvents && (auditOnly || verifyOnly))) {
  console.error('Use only one of --audit-only, --verify, or --repair-events');
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
  const BroadcastEvent = models.find((model) => model.modelName === 'BroadcastEvent');
  const eventAudit = await auditDuplicateEvents(BroadcastEvent.collection);
  console.log(`BroadcastEvent duplicate-key audit: ${JSON.stringify(eventAudit)}`);
  if (eventAudit.invalidGroups) {
    throw new Error('BroadcastEvent has duplicate rows with invalid/missing keys; manual review required');
  }
  if (eventAudit.redundantRows > MAX_AUTOMATIC_REPAIR_ROWS) {
    throw new Error(`BroadcastEvent has ${eventAudit.redundantRows} redundant rows, above the ${MAX_AUTOMATIC_REPAIR_ROWS} automatic-repair limit; manual review required`);
  }
  if (eventAudit.groups && !(auditOnly ? allowEventRepair : repairEvents)) {
    throw new Error('BroadcastEvent duplicate keys block its unique index. Archive/reconcile them only after a database snapshot, using ALLOW_BROADCAST_EVENT_REPAIR=1 bash deploy.sh');
  }
  if (auditOnly) {
    console.log('Verified reserved SquadHunt username has no conflicting owner');
    await mongoose.disconnect();
    return;
  }
  if (repairEvents && eventAudit.groups) {
    const repaired = await repairDuplicateEvents(mongoose.connection.db, BroadcastEvent.collection);
    console.log(`BroadcastEvent archived ${repaired.archivedRows} redundant row(s) in broadcasteventduplicatearchives`);
  }
  if (!verifyOnly) {
    for (const Model of models) {
      if (Model.modelName === 'BroadcastEvent' && repairEvents) {
        // Older service tasks may still be writing while this additive
        // preflight runs. A bounded retry repairs a duplicate created during
        // the first index build; all other index errors still fail closed.
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await Model.createIndexes();
            break;
          } catch (error) {
            const duplicateEventIndex = /(?:unique index|duplicate key)/i.test(String(error?.message)) &&
              String(error?.message).includes('broadcastRecipient_1_eventType_1');
            if (!duplicateEventIndex || attempt === 3) throw error;
            const retried = await repairDuplicateEvents(mongoose.connection.db, BroadcastEvent.collection);
            if (!retried.archivedRows) throw error;
            console.log(`BroadcastEvent archived ${retried.archivedRows} newly duplicated row(s) before index retry ${attempt + 1}`);
          }
        }
      } else {
        await Model.createIndexes();
      }
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
