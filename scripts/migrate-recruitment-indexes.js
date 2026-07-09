#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const modelPath = (name) => path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', `${name}.js`);
const TeamRecruitment = require(modelPath('TeamRecruitment'));
const PlayerProfile = require(modelPath('PlayerProfile'));
const RecruitmentApplication = require(modelPath('RecruitmentApplication'));
const RecruitmentPostingQuota = require(modelPath('RecruitmentPostingQuota'));

const MODELS = [TeamRecruitment, PlayerProfile, RecruitmentApplication, RecruitmentPostingQuota];
const apply = process.argv.includes('--apply');
const strict = process.argv.includes('--strict');

const indexKeySignature = (key) => JSON.stringify(key);
const comparableOptions = (options = {}) => ({
  unique: options.unique === true,
  sparse: options.sparse === true,
  expireAfterSeconds: options.expireAfterSeconds ?? null,
  partialFilterExpression: options.partialFilterExpression || null
});

const indexSignature = (key, options = {}) => JSON.stringify({
  key,
  ...comparableOptions(options)
});

const isNamespaceNotFound = (error) => error?.code === 26 || error?.codeName === 'NamespaceNotFound';

const inspectIndexes = async (models = MODELS) => {
  const missing = [];
  const conflicts = [];
  const missingCollections = [];
  for (const Model of models) {
    let actual;
    try {
      actual = await Model.collection.indexes();
    } catch (error) {
      if (!isNamespaceNotFound(error)) throw error;
      actual = [];
      missingCollections.push({ Model, model: Model.modelName });
    }
    const actualByKey = new Map(actual.map((index) => [indexKeySignature(index.key), index]));
    const actualSignatures = new Set(actual.map((index) => indexSignature(index.key, index)));
    Model.schema.indexes().forEach(([key, options]) => {
      if (actualSignatures.has(indexSignature(key, options))) return;
      const sameKey = actualByKey.get(indexKeySignature(key));
      if (sameKey) {
        conflicts.push({
          model: Model.modelName,
          key,
          declared: comparableOptions(options),
          actual: comparableOptions(sameKey),
          actualName: sameKey.name
        });
      } else {
        missing.push({ Model, model: Model.modelName, key, options });
      }
    });
  }
  return { missing, conflicts, missingCollections };
};

const findDuplicateQuotas = async () => {
  try {
    return await RecruitmentPostingQuota.aggregate([
  {
    $group: {
      _id: { player: '$player', dayKey: '$dayKey' },
      count: { $sum: 1 },
      reservedCount: { $sum: { $ifNull: ['$count', 0] } },
      expiresAt: { $max: '$expiresAt' },
      records: { $push: '$_id' }
    }
  },
  { $match: { count: { $gt: 1 } } }
    ]);
  } catch (error) {
    if (isNamespaceNotFound(error)) return [];
    throw error;
  }
};

const createMissingCollections = async (entries) => {
  for (const entry of entries) {
    try {
      await entry.Model.createCollection();
    } catch (error) {
      if (error?.code !== 48 && error?.codeName !== 'NamespaceExists') throw error;
    }
  }
};

const repairDuplicateQuotas = async (duplicates) => {
  for (const duplicate of duplicates) {
    const [keeper, ...redundant] = duplicate.records;
    await RecruitmentPostingQuota.updateOne(
      { _id: keeper },
      {
        $set: {
          count: Math.min(2, Math.max(0, Number(duplicate.reservedCount) || 0)),
          expiresAt: duplicate.expiresAt || new Date(Date.now() + 48 * 60 * 60 * 1000)
        }
      }
    );
    if (redundant.length) {
      await RecruitmentPostingQuota.deleteMany({ _id: { $in: redundant } });
    }
  }
};

const createMissingIndexes = async (missing) => {
  const created = [];
  for (const entry of missing) {
    const options = { ...entry.options };
    delete options.background;
    const name = await entry.Model.collection.createIndex(entry.key, options);
    created.push({ model: entry.model, name, key: entry.key });
  }
  return created;
};

const connectOptions = () => ({
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

const main = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, connectOptions());

  const before = await inspectIndexes();
  const duplicateQuotas = await findDuplicateQuotas();
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'audit-only',
    missingIndexes: before.missing.map(({ model, key, options }) => ({ model, key, options })),
    conflictingIndexes: before.conflicts,
    missingCollections: before.missingCollections.map((entry) => entry.model),
    duplicateQuotaKeys: duplicateQuotas.length
  }, null, 2));

  if (!apply) {
    console.log('No indexes changed. Stop writers, take a snapshot, then re-run with --apply.');
    if (strict && (before.missing.length || before.conflicts.length || before.missingCollections.length || duplicateQuotas.length)) process.exitCode = 2;
    return;
  }

  if (before.conflicts.length) {
    throw new Error('Conflicting index definitions require manual review; this migration never drops indexes automatically.');
  }

  await createMissingCollections(before.missingCollections);

  // The unique player/day index is the concurrency boundary for the posting
  // quota. Duplicate rows must be merged before any missing index is created.
  await repairDuplicateQuotas(duplicateQuotas);
  const duplicatesAfterRepair = await findDuplicateQuotas();
  if (duplicatesAfterRepair.length) throw new Error('Duplicate posting quotas remain after repair');

  const created = await createMissingIndexes(before.missing);
  const after = await inspectIndexes();
  console.log(JSON.stringify({ created, remainingMissing: after.missing.length, remainingConflicts: after.conflicts.length }, null, 2));
  if (after.missing.length || after.conflicts.length) throw new Error('Recruitment index verification failed');
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = {
  indexSignature,
  inspectIndexes,
  isNamespaceNotFound,
  findDuplicateQuotas,
  repairDuplicateQuotas,
  createMissingCollections,
  createMissingIndexes,
  connectOptions
};
