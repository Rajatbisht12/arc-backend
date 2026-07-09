#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const {
  TEAM_INVITE_TTL_MS,
  buildPendingInviteKey
} = require('../src/legacy-src/utils/teamInvitationPolicy');

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
if (apply && verify) {
  console.error('Use either --apply or --verify, not both');
  process.exit(1);
}

const loadModels = () => ([
  ['roster', require(path.resolve(__dirname, '../src/legacy-src/models/RosterInvite.js'))],
  ['staff', require(path.resolve(__dirname, '../src/legacy-src/models/StaffInvite.js'))]
]);

const normalizeKey = (key) => JSON.stringify(Object.entries(key || {}));
const normalizeIndexOptions = (options = {}) => ({
  unique: options.unique === true,
  sparse: options.sparse === true,
  expireAfterSeconds: Object.prototype.hasOwnProperty.call(options, 'expireAfterSeconds')
    ? Number(options.expireAfterSeconds)
    : null
});

const indexesMatch = (expectedKey, expectedOptions, actual) => (
  normalizeKey(expectedKey) === normalizeKey(actual.key)
  && JSON.stringify(normalizeIndexOptions(expectedOptions))
    === JSON.stringify(normalizeIndexOptions(actual))
);

const missingIndexes = async (Model) => {
  let actual = [];
  try {
    actual = await Model.collection.indexes();
  } catch (error) {
    if (error?.codeName !== 'NamespaceNotFound' && error?.code !== 26) throw error;
  }
  return Model.schema.indexes().filter(([key, options]) => (
    !actual.some((index) => indexesMatch(key, options, index))
  ));
};

const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

const derivedExpiry = (invite) => (
  asDate(invite.expiresAt)
  || new Date((asDate(invite.createdAt)?.getTime() || 0) + TEAM_INVITE_TTL_MS)
);

const planModelMigration = async (type, Model, now) => {
  const pending = await Model.find({ status: 'pending' })
    .select('+pendingKey team player game status expiresAt createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const terminalWithKeys = await Model.find({ status: { $ne: 'pending' }, pendingKey: { $exists: true } })
    .select('+pendingKey status')
    .lean();

  const activeByKey = new Map();
  const expired = [];
  const duplicates = [];
  const activeBackfills = [];

  for (const invite of pending) {
    const expiresAt = derivedExpiry(invite);
    if (expiresAt <= now) {
      expired.push({ invite, expiresAt });
      continue;
    }
    const pendingKey = buildPendingInviteKey({
      type,
      team: invite.team,
      player: invite.player,
      game: invite.game
    });
    if (activeByKey.has(pendingKey)) {
      duplicates.push({ invite, expiresAt, pendingKey });
      continue;
    }
    activeByKey.set(pendingKey, invite._id);
    if (invite.pendingKey !== pendingKey || !asDate(invite.expiresAt)) {
      activeBackfills.push({ invite, expiresAt, pendingKey });
    }
  }

  return {
    type,
    Model,
    pendingCount: pending.length,
    expired,
    duplicates,
    activeBackfills,
    terminalWithKeys
  };
};

const applyPlan = async (plan, now) => {
  const terminalWrites = [
    ...plan.expired.map(({ invite, expiresAt }) => ({
      updateOne: {
        filter: { _id: invite._id, status: 'pending' },
        update: {
          $set: { status: 'expired', respondedAt: now, expiresAt },
          $unset: { pendingKey: 1 }
        }
      }
    })),
    ...plan.duplicates.map(({ invite, expiresAt }) => ({
      updateOne: {
        filter: { _id: invite._id, status: 'pending' },
        update: {
          $set: { status: 'cancelled', respondedAt: now, expiresAt },
          $unset: { pendingKey: 1 }
        }
      }
    })),
    ...plan.terminalWithKeys.map((invite) => ({
      updateOne: {
        filter: { _id: invite._id, status: { $ne: 'pending' } },
        update: { $unset: { pendingKey: 1 } }
      }
    }))
  ];
  if (terminalWrites.length) await plan.Model.bulkWrite(terminalWrites, { ordered: true });

  const activeWrites = plan.activeBackfills.map(({ invite, expiresAt, pendingKey }) => ({
    updateOne: {
      filter: { _id: invite._id, status: 'pending' },
      update: { $set: { pendingKey, expiresAt } }
    }
  }));
  if (activeWrites.length) await plan.Model.bulkWrite(activeWrites, { ordered: true });
};

const verifyTransactionSupport = async (RosterInviteModel) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await RosterInviteModel.findOne({}, { _id: 1 }, { session }).lean();
    }, {
      readPreference: 'primary',
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' }
    });
  } finally {
    await session.endSession().catch(() => {});
  }
};

const main = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
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

  const now = new Date();
  const models = loadModels();
  const plans = [];
  for (const [type, Model] of models) plans.push(await planModelMigration(type, Model, now));

  for (const plan of plans) {
    console.log(JSON.stringify({
      model: plan.Model.modelName,
      pending: plan.pendingCount,
      expiredToClose: plan.expired.length,
      duplicatePendingToCancel: plan.duplicates.length,
      activeToBackfill: plan.activeBackfills.length,
      terminalKeysToRemove: plan.terminalWithKeys.length
    }));
  }

  const mutationCount = plans.reduce((sum, plan) => (
    sum + plan.expired.length + plan.duplicates.length
      + plan.activeBackfills.length + plan.terminalWithKeys.length
  ), 0);
  if (verify && mutationCount > 0) {
    throw new Error(`Team invite data requires migration (${mutationCount} pending changes)`);
  }

  if (apply) {
    for (const plan of plans) await applyPlan(plan, now);
    for (const [, Model] of models) {
      await Model.createIndexes();
      console.log(`created/confirmed indexes for ${Model.modelName}`);
    }
  }

  let missingCount = 0;
  for (const [, Model] of models) {
    const missing = await missingIndexes(Model);
    missingCount += missing.length;
    console.log(JSON.stringify({
      model: Model.modelName,
      missingIndexes: missing.map(([key, options]) => ({
        key,
        options: normalizeIndexOptions(options)
      }))
    }));
  }
  if ((apply || verify) && missingCount > 0) {
    throw new Error(`Team invite collections are missing ${missingCount} required indexes`);
  }

  if (verify) {
    await verifyTransactionSupport(models[0][1]);
    console.log('verified MongoDB transaction support for team invitation acceptance');
  }
  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  applyPlan,
  derivedExpiry,
  missingIndexes,
  planModelMigration,
  verifyTransactionSupport
};
