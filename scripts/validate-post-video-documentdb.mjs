/**
 * MUTATES ONLY AN APPROVED STAGING DATABASE. Run inside the isolated staging
 * VPC/task role after AWS approval, not on production and not in deploy.sh.
 * Keeps its synthetic records/indexes as evidence; performs no drops/deletes.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
const require = createRequire(import.meta.url);
// Use the reviewed compiled modules in the same production image. No tsx or
// dev-only dependency is needed in the staging migration validation task.
const { assertRuntimeIsolation } = require('../dist/config/runtimeIsolation.js');
const { loadSecretsManagerEnv } = require('../dist/config/secrets.js');

if (!process.argv.includes('--run-approved-staging-test')) throw new Error('Approval required: use --run-approved-staging-test only inside the approved isolated staging task.');
if (process.env.DEPLOYMENT_ENVIRONMENT !== 'staging' || process.env.MONGODB_TLS !== 'true') throw new Error('Requires explicit staging environment and TLS');
await loadSecretsManagerEnv();
assertRuntimeIsolation(process.env);
const uri = new URL(process.env.MONGODB_URI);
// A new per-run database prevents test fixtures from colliding with browser
// accounts or a previous run. Never use the application's database for seeding.
const database = `video_staging_migration_${randomUUID().replaceAll('-', '')}`;
uri.pathname = `/${database}`;
const targetUri = uri.toString();
const options = { autoIndex: false, autoCreate: false, retryWrites: false, tls: true,
  ...(process.env.MONGODB_TLS_CA_FILE ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE } : {}), serverSelectionTimeoutMS: 20_000 };
const childEnvironment = { ...process.env, MONGODB_URI: targetUri, STAGING_MONGODB_DATABASE: database };
assertRuntimeIsolation(childEnvironment);
const migrate = mode => {
  const result = spawnSync(process.execPath, [require.resolve('./migrate-video-upload-indexes.js'), mode], {
    env: childEnvironment, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 0, `Migration ${mode} failed (credentials/output deliberately omitted)`);
  return JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
};
try {
  await mongoose.connect(targetUri, options);
  const connection = mongoose.connection;
  const buildInfo = await connection.db.admin().command({ buildInfo: 1 });
  assert.match(String(buildInfo.version), /^5\./, 'Requires the approved DocumentDB 5 compatible server');
  const posts = connection.collection('posts');
  const exposure = connection.collection('contentexposures');
  const owner = new mongoose.Types.ObjectId();
  await posts.insertMany([
    { author: owner, fixture: 'legacy-a' }, { author: owner, fixture: 'legacy-b' },
    { author: owner, clientPostId: null }, { author: owner, clientPostId: null },
    { author: owner, clientPostId: '' }, { author: owner, clientPostId: '' },
    { author: owner, clientPostId: 'valid-staging-fixture' },
  ]);
  await posts.createIndex({ fixture: 1 }, { name: 'staging_preservation_sentinel' });
  await exposure.insertOne({ fixture: 'keep', meaningful: true, postId: new mongoose.Types.ObjectId() });
  const digest = async () => createHash('sha256').update(JSON.stringify([
    await posts.find().sort({ _id: 1 }).toArray(), await exposure.find().sort({ _id: 1 }).toArray(),
  ])).digest('hex');
  const before = await digest();
  const apply = migrate('--apply'); const reapply = migrate('--apply'); const verify = migrate('--verify');
  assert.equal(await digest(), before, 'Migration must preserve all posts and exposure records');
  assert.ok((await posts.indexes()).some(row => row.name === 'staging_preservation_sentinel'));
  assert.equal((await exposure.indexes()).length, 1, 'No exposure indexes changed');
  await assert.rejects(posts.insertOne({ author: owner, clientPostId: 'valid-staging-fixture' }), { code: 11000 });
  await posts.insertOne({ author: new mongoose.Types.ObjectId(), clientPostId: 'valid-staging-fixture' });
  await posts.insertMany([{ author: owner }, { author: owner, clientPostId: null }, { author: owner, clientPostId: '' }]);
  const afterFixtures = await digest();
  await mongoose.disconnect();
  await mongoose.connect(targetUri, options);
  const reconnectVerify = migrate('--verify');
  assert.equal(await digest(), afterFixtures);
  console.log(JSON.stringify({ environment: 'approved isolated staging only', database, serverVersion: buildInfo.version,
    apply, reapply, verify, reconnectVerify, preservedHash: before, tests: [
      'index apply/reapply/verify', 'unique owner/client publication ID', 'missing/null/empty IDs allowed',
      'duplicate rejected', 'different owner allowed', 'posts/exposure preserved', 'unrelated index retained', 'reconnect verify',
    ], evidenceRetained: true, note: 'Reconnect is not a database/ECS restart test; run --verify again after an approved staging restart.' }, null, 2));
} finally { await mongoose.disconnect(); }
