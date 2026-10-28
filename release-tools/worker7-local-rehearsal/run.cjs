'use strict';
// Runs only against isolated local loopback MongoDB/Redis; no AWS client or transport.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const G = require('./local-guards.cjs');
async function main() {
  G.check(process.argv.length === 3 && ['--verify-only', '--run-local'].includes(process.argv[2]), 'EXPLICIT_LOCAL_MODE_REQUIRED');
  G.credentials(process.env);
  const root = process.env.LOCAL_RELIABILITY_APP_ROOT || '/app';
  const fixture = process.env.LOCAL_RELIABILITY_FIXTURE || '/qa/portrait-24-silent.mp4';
  const verified = G.verify(root, fixture);
  const uri = 'mongodb://worker7_local:worker7-local-mongo-not-a-cloud-secret@127.0.0.1:27018/' + G.DB + '?authSource=admin';
  G.endpoints(uri, 16379, 'worker7-local-redis-not-a-cloud-secret');
  if (process.argv[2] === '--verify-only') { console.log(JSON.stringify({ mode:'verify-only', ...verified })); return; }
  const env = { PATH:process.env.PATH, HOME:'/tmp', NODE_PATH:path.join(root,'node_modules'),
    NODE_ENV:'test', DEPLOYMENT_ENVIRONMENT:'test', AWS_EC2_METADATA_DISABLED:'true',
    MONGODB_URI:uri, REDIS_HOST:'127.0.0.1', REDIS_PORT:'16379',
    JWT_SECRET:'local-fixture-placeholder-at-least-thirty-two-characters',
    JWT_REFRESH_SECRET:'local-refresh-placeholder-at-least-thirty-two-characters',
    LOCAL_RELIABILITY_APP_ROOT:root, LOCAL_RELIABILITY_FIXTURE:fixture,
    LOCAL_RELIABILITY_EXTERNAL_MONGO_URI:uri, LOCAL_RELIABILITY_EXTERNAL_REDIS_PORT:'16379',
    LOCAL_RELIABILITY_EXTERNAL_REDIS_PASSWORD:'worker7-local-redis-not-a-cloud-secret' };
  // Sidecars start after this network-namespace owner. Readiness is explicit and bounded.
  const MongoClient = require('mongodb').MongoClient, Redis = require('ioredis');
  const deadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < deadline) {
    const mongo = new MongoClient(uri, { serverSelectionTimeoutMS:500, connectTimeoutMS:500 });
    const redis = new Redis({ host:'127.0.0.1', port:16379, password:env.LOCAL_RELIABILITY_EXTERNAL_REDIS_PASSWORD,
      lazyConnect:true, retryStrategy:() => null, connectTimeout:500, maxRetriesPerRequest:0 });
    redis.on('error', () => {});
    try { await mongo.connect(); await mongo.db().command({ ping:1 }); await redis.connect();
      G.check(await redis.ping() === 'PONG', 'LOCAL_REDIS_PING'); ready = true;
    } catch {} finally { await mongo.close(); redis.disconnect(); }
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }
  G.check(ready, 'LOCAL_SIDECAR_READINESS_TIMEOUT');
  const started = new Date().toISOString();
  const result = cp.spawnSync(process.execPath, ['--test','--test-concurrency=1',path.join(__dirname,'rehearsal.test.cjs')],
    { env, encoding:'utf8', timeout:600000, maxBuffer:16*1024*1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  const receipt = { scope:'LOCAL_ONLY_NOT_AWS_RECOVERY', startedAt:started, finishedAt:new Date().toISOString(),
    platform:process.platform, architecture:process.arch, ...verified, testsExpected:21,
    exitCode:result.status, signal:result.signal, timedOut:result.error?.code === 'ETIMEDOUT',
    passed:result.status === 0 && /# pass 21\b/.test(output) && /# fail 0\b/.test(output),
    mockStorageBoundaryCases:true, acceleratedLocalLeases:true, realApprovedFixtureEncode:true,
    documentDb5WritesVerified:false, s3Verified:false, awsMutations:0,
    logSha256:G.hash(output), limitations:['MongoDB8 is not DocumentDB5','local storage is not S3',
      'accelerated fixture leases do not prove natural AWS lease recovery','not an ECS replacement test'] };
  const results = process.env.LOCAL_RELIABILITY_RESULTS || '/results';
  fs.writeFileSync(path.join(results,'rehearsal.log'), output);
  fs.writeFileSync(path.join(results,'receipt.json'), JSON.stringify(receipt,null,2)+'\n');
  console.log(output); console.log(JSON.stringify(receipt,null,2));
  process.exitCode = receipt.passed ? 0 : 1;
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode=1; });
