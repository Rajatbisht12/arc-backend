#!/usr/bin/env node
/**
 * Read-only diagnosis for "recruitment created (201) but never appears in any tab".
 *
 * The listing endpoints are aggregations. Any document whose OWNER row fails
 * `buildValidOwnerMatchStage` is dropped silently — the API still answers 200
 * with an empty list. This script replays the real pipeline one stage at a time
 * and reports where rows disappear, plus which owner predicate rejected them.
 *
 * Performs NO writes. Usage:
 *   MONGODB_URI='...' node scripts/diagnose-recruitment-visibility.js
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const legacy = (p) => path.resolve(__dirname, '..', 'src', 'legacy-src', p);
const { addTeamRecruitmentIntegrityFilters } = require(legacy('services/recruitmentPolicy.js'));

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Set MONGODB_URI (read-only credentials are sufficient).');
  process.exit(1);
}

// Mirror src/infrastructure/database/mongodb.ts: DocumentDB needs TLS with the
// Amazon CA bundle and rejects retryWrites.
const useTls = process.env.MONGODB_TLS === 'true';
const caFile = process.env.MONGODB_TLS_CA_FILE;
const connectOptions = {
  serverSelectionTimeoutMS: 15000,
  retryWrites: useTls ? false : true,
  ...(useTls && {
    tls: true,
    ...(caFile && fs.existsSync(caFile) && { tlsCAFile: caFile })
  })
};

const hasNonBlank = (field) => ({
  $gt: [{ $strLenCP: { $trim: { input: { $convert: { input: `$${field}`, to: 'string', onError: '', onNull: '' } } } } }, 0]
});

const addLiveFilters = (query, now = new Date()) => {
  query.status = 'active';
  query.isActive = true;
  query.$or = [{ expiresAt: { $gt: now } }, { expiresAt: null }, { expiresAt: { $exists: false } }];
  return query;
};

// Each owner predicate in isolation, so we learn WHICH one rejects.
const OWNER_PREDICATES = [
  ['userType === "team"', { '__owner.userType': 'team' }],
  ['isActive === true (boolean)', { '__owner.isActive': true }],
  ['needsProfileCompletion !== true', { '__owner.needsProfileCompletion': { $ne: true } }],
  ['username is a string', { '__owner.username': { $type: 'string' } }],
  ['username is non-blank', { $expr: hasNonBlank('__owner.username') }]
];

(async () => {
  await mongoose.connect(uri, connectOptions);
  const db = mongoose.connection.db;
  const recs = db.collection('teamrecruitments');

  const total = await recs.countDocuments({});
  console.log(`teamrecruitments total: ${total}`);
  if (total === 0) {
    console.log('No recruitment documents exist at all — the POST is not persisting.');
    return mongoose.disconnect();
  }

  const query = addTeamRecruitmentIntegrityFilters(addLiveFilters({}));
  const afterQuery = await recs.countDocuments(query);
  console.log(`survive $match (status/isActive/expiresAt/game/role): ${afterQuery}`);

  const joined = [
    { $match: query },
    { $lookup: { from: 'users', localField: 'team', foreignField: '_id', as: '__owner' } },
    { $unwind: '$__owner' }
  ];
  const afterJoin = (await recs.aggregate([...joined, { $count: 'n' }]).toArray())[0]?.n || 0;
  console.log(`survive owner $lookup + $unwind:                     ${afterJoin}`);
  if (afterJoin === 0 && afterQuery > 0) {
    console.log('  -> `team` does not resolve to a users._id (type mismatch or deleted owner).');
  }

  console.log('\nowner predicates (each applied alone, after the join):');
  for (const [label, cond] of OWNER_PREDICATES) {
    let n = 0;
    let note = '';
    try {
      n = (await recs.aggregate([...joined, { $match: cond }, { $count: 'n' }]).toArray())[0]?.n || 0;
    } catch (error) {
      note = `  <-- ENGINE ERROR: ${error.message}`;
    }
    const verdict = note || (n === 0 ? '  <-- REJECTS EVERYTHING' : '');
    console.log(`  ${String(n).padStart(4)} / ${afterJoin}  ${label}${verdict}`);
  }

  // Show the offending owners without leaking anything sensitive.
  const owners = await recs.aggregate([
    ...joined,
    {
      $group: {
        _id: '$__owner._id',
        username: { $first: '$__owner.username' },
        usernameType: { $first: { $type: '$__owner.username' } },
        userType: { $first: '$__owner.userType' },
        isActive: { $first: '$__owner.isActive' },
        isActiveType: { $first: { $type: '$__owner.isActive' } },
        needsProfileCompletion: { $first: '$__owner.needsProfileCompletion' },
        posts: { $sum: 1 }
      }
    },
    { $limit: 20 }
  ]).toArray();

  console.log('\nowners of live recruitments:');
  for (const o of owners) {
    const ok = o.userType === 'team' && o.isActive === true
      && o.needsProfileCompletion !== true
      && typeof o.username === 'string' && o.username.trim();
    console.log(`  ${ok ? 'VALID  ' : 'INVALID'} _id=${o._id} posts=${o.posts}`);
    console.log(`          username=${JSON.stringify(o.username)} (${o.usernameType})`);
    console.log(`          userType=${JSON.stringify(o.userType)} isActive=${JSON.stringify(o.isActive)} (${o.isActiveType}) needsProfileCompletion=${JSON.stringify(o.needsProfileCompletion)}`);
  }

  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
