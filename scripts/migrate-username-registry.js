#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const User = require('../src/legacy-src/models/User');
const UsernameRegistry = require('../src/legacy-src/models/UsernameRegistry');
const { canonicalUsername } = require('../src/legacy-src/utils/usernamePolicy');

const uri = process.env.MONGODB_URI;
const auditOnly = process.argv.includes('--audit-only');
const verifyOnly = process.argv.includes('--verify');
if (!uri || (auditOnly && verifyOnly)) {
  console.error('MONGODB_URI is required; choose at most one of --audit-only or --verify');
  process.exit(1);
}

async function inspectAndBackfill(apply) {
  const seen = new Map();
  let checked = 0;
  let created = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const names = batch.map(row => row.normalizedUsername);
    const existing = await UsernameRegistry.find({ normalizedUsername: { $in: names } })
      .select('normalizedUsername kind ownerId').lean();
    const byName = new Map(existing.map(row => [row.normalizedUsername, row]));
    const missing = [];
    for (const row of batch) {
      const claim = byName.get(row.normalizedUsername);
      if (claim) {
        const officialReservation = row.isOfficialSystem && claim.kind === 'reservation' && row.normalizedUsername === 'squadhunt';
        if (!officialReservation && (claim.kind !== 'user' || String(claim.ownerId) !== String(row.ownerId))) {
          throw new Error(`Username registry conflict for ${row.normalizedUsername}; manual review required`);
        }
      } else if (verifyOnly) {
        throw new Error(`Missing username registry claim for ${row.normalizedUsername}`);
      } else {
        missing.push(row);
      }
    }
    if (apply && missing.length) {
      await UsernameRegistry.bulkWrite(missing.map(({ isOfficialSystem, ...row }) => ({ insertOne: { document: row } })), { ordered: false });
      created += missing.length;
    }
    batch = [];
  };
  const cursor = User.find({}).select('_id username isSystemAccount userType').lean().cursor();
  for await (const user of cursor) {
    const normalizedUsername = canonicalUsername(user.username);
    if (!normalizedUsername) throw new Error(`User ${user._id} has an empty username`);
    const prior = seen.get(normalizedUsername);
    if (prior && prior !== String(user._id)) {
      throw new Error(`Existing case-insensitive username collision for ${normalizedUsername}; manual review required`);
    }
    seen.set(normalizedUsername, String(user._id));
    batch.push({ username: user.username, normalizedUsername, kind: 'user', ownerId: user._id,
      isOfficialSystem: user.isSystemAccount === true && user.userType === 'system' });
    checked += 1;
    if (batch.length >= 500) await flush();
  }
  await flush();
  console.log(JSON.stringify({ mode: auditOnly ? 'audit' : verifyOnly ? 'verify' : 'apply', usersChecked: checked, claimsCreated: created }));
}

async function main() {
  await mongoose.connect(uri, {
    autoIndex: false, autoCreate: false,
    retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
    serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? {
      tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
        ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {})
    } : {})
  });
  if (!auditOnly && !verifyOnly) {
    await UsernameRegistry.createCollection();
    await UsernameRegistry.createIndexes();
  }
  if (verifyOnly) {
    const indexes = await UsernameRegistry.collection.indexes();
    if (!indexes.some(index => index.key?.normalizedUsername === 1 && index.unique === true)) {
      throw new Error('Missing unique normalizedUsername registry index');
    }
  }
  await inspectAndBackfill(!auditOnly && !verifyOnly);
  await mongoose.disconnect();
}
main().catch(async error => {
  console.error(error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
