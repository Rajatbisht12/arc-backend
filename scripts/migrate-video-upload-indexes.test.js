const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { expected } = require('./migrate-video-upload-indexes');
const systemBinary = process.env.MONGOMS_SYSTEM_BINARY || '/opt/homebrew/bin/mongod';

test('new publication index uses only supported DocumentDB 5 partial-filter operators', () => {
  const post = expected().find(row => row.model.collection.name === 'posts');
  assert.equal(post.options.name, 'post_owner_client_nonempty_unique_v2');
  assert.deepEqual(post.options.partialFilterExpression, { clientPostId: { $gt: '' } });
  assert.equal(post.options.unique, true);
});

test('migration is additive/idempotent, preserves legacy/null records and exposure, and retains an existing index', { skip: !fs.existsSync(systemBinary) }, async () => {
  const db = await MongoMemoryServer.create({ binary: { systemBinary, version: '8.3.7' }, instance: { storageEngine: 'wiredTiger' } });
  try {
    await mongoose.connect(db.getUri(), { autoIndex: false, autoCreate: false });
    const posts = mongoose.connection.collection('posts');
    const exposure = mongoose.connection.collection('contentexposures');
    const owner = new mongoose.Types.ObjectId();
    await posts.insertMany([{ author: owner }, { author: owner }, { author: owner, clientPostId: null }, { author: owner, clientPostId: null }, { author: owner, clientPostId: 'valid-fixture' }]);
    await exposure.insertOne({ sentinel: 'keep', meaningful: true });
    await posts.createIndex({ author: 1, clientPostId: 1 }, { name: 'post_owner_client_unique', unique: true, partialFilterExpression: { clientPostId: { $type: 'string' } } });
    const digest = async () => createHash('sha256').update(JSON.stringify([await posts.find().sort({ _id: 1 }).toArray(), await exposure.find().toArray()])).digest('hex');
    const before = await digest();
    const run = args => spawnSync(process.execPath, [__filename.replace('.test.js', '.js'), ...args], {
      encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: db.getUri(), MONGODB_TLS: 'false' },
    });
    assert.equal(run(['--verify']).status, 2);
    for (const args of [['--apply'], ['--apply'], ['--verify']]) { const r = run(args); assert.equal(r.status, 0, r.stderr); }
    assert.equal(await digest(), before);
    const indexes = await posts.indexes();
    assert.ok(indexes.some(row => row.name === 'post_owner_client_unique'));
    assert.ok(indexes.some(row => row.name === 'post_owner_client_nonempty_unique_v2'));
    await assert.rejects(posts.insertOne({ author: owner, clientPostId: 'valid-fixture' }), { code: 11000 });
    // Different owners may legitimately use the same idempotency key.
    await posts.insertOne({ author: new mongoose.Types.ObjectId(), clientPostId: 'valid-fixture' });
    assert.equal((await exposure.indexes()).length, 1);
  } finally { await mongoose.disconnect(); await db.stop(); }
});
