const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('username registry migration audits collisions, backfills, verifies, and reruns safely', async () => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  const script = path.join(__dirname, 'migrate-username-registry.js');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, MONGODB_URI: uri, MONGODB_TLS: 'false' }, encoding: 'utf8'
  });
  try {
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
    const users = mongoose.connection.db.collection('users');
    const first = await users.insertOne({ username: 'LegacyName' });
    const collision = await users.insertOne({ username: 'legacyname' });
    assert.notEqual(run('--audit-only').status, 0);
    await users.deleteOne({ _id: collision.insertedId });
    assert.equal(run('--audit-only').status, 0);
    assert.equal(run().status, 0);
    assert.equal(run('--verify').status, 0);
    assert.equal(run().status, 0);
    const claim = await mongoose.connection.db.collection('usernameregistries').findOne({ normalizedUsername: 'legacyname' });
    assert.equal(String(claim.ownerId), String(first.insertedId));
    assert.equal(claim.kind, 'user');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
