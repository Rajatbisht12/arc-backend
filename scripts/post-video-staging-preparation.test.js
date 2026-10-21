const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('worker stack isolates metrics and task identity and pins health port', () => {
  const worker = read('infra/post-video-worker.yaml');
  assert.equal((worker.match(/!Sub 'SquadHunt\/Video\/\$\{AWS::StackName\}'/g) || []).length, 10);
  assert.match(worker, /Family: !Sub '\$\{AWS::StackName\}-worker'/);
  for (const name of ['STAGING_API_ORIGIN', 'STAGING_MEDIA_ORIGIN']) assert.match(worker, new RegExp(`Name: ${name}, Value: !Ref`));
  assert.match(worker, /Name: VIDEO_WORKER_HEALTH_PORT, Value: '5002'/);
  assert.match(worker, /CLIP_HLS_WORKER_CONCURRENCY, Value: '1'/);
  assert.match(worker, /VIDEO_FFMPEG_THREADS, Value: '2'/);
  assert.match(worker, /POST_VIDEO_UPLOADS_ENABLED, Value: 'false'/);
  assert.match(worker, /VIDEO_WORKER_RESOURCE_METRICS_ENABLED, Value: !Ref EnableResourceMetrics/);
  for (const metric of ['PeakSampledMemoryBytes', 'PeakSampledScratchBytes', 'JobWallSeconds']) assert.match(worker, new RegExp(`MetricName: ${metric}`));
  assert.match(worker, /QueueAlarm:[\s\S]*?Threshold: 2\n\s+ComparisonOperator: GreaterThanThreshold/);
  assert.match(worker, /AssignPublicIp: DISABLED/);
  const launcher = read('src/clip-worker.ts');
  assert.match(launcher, /VIDEO_WORKER_RESOURCE_METRICS_ENABLED === 'true'/);
  assert.match(launcher, /return await service\.processVideoUploadJob/);
  assert.match(launcher, /return await service\.processClipTranscodeJob/);
  assert.match(launcher, /await stopObservation\(\)\.catch\(\(\) => \{\}\)/);
});
test('production worker proposal includes private AWS egress and separate least-change roles', () => {
  const network = read('infra/post-video-production-worker-network.yaml');
  for (const endpoint of ['s3', 'ecr.api', 'ecr.dkr', 'logs', 'secretsmanager']) {
    assert.match(network, new RegExp(`com\\.amazonaws\\.\\$\\{AWS::Region\\}\\.${endpoint.replace(/\./g, '\\.')}`));
  }
  assert.match(network, /SourceSecurityGroupId: !Ref WorkerSecurityGroup/);
  assert.match(network, /FromPort: 27017/);
  assert.match(network, /FromPort: 6379/);
  const roles = read('infra/post-video-production-worker-roles.yaml');
  assert.match(roles, /WorkerExecutionRole:/);
  assert.match(roles, /WorkerTaskRole:/);
  assert.match(roles, /Resource: !Ref BackendSecretArn/);
  assert.match(roles, /post-video-playback\/\*/);
  const apiPolicy = read('infra/post-video-iam.yaml');
  assert.match(apiPolicy, /Roles: \[!Ref ApiRoleName\]/);
  assert.doesNotMatch(apiPolicy, /WorkerRoleName/);
});
test('DocumentDB validation cannot be invoked by ordinary deployment or against production', () => {
  const validation = read('scripts/validate-post-video-documentdb.mjs');
  assert.match(validation, /--run-approved-staging-test/);
  assert.match(validation, /DEPLOYMENT_ENVIRONMENT !== 'staging'/);
  assert.match(validation, /assertRuntimeIsolation\(childEnvironment\)/);
  assert.match(validation, /video_staging_migration_/);
  assert.doesNotMatch(validation, /\.(dropDatabase|dropIndex|syncIndexes|deleteMany|deleteOne)\(/);
  assert.doesNotMatch(read('deploy.sh'), /validate-post-video-documentdb/);
});
test('local benchmark uses the production encoder and no padded fixtures or AWS clients', () => {
  const benchmark = read('scripts/benchmark-post-video-local.js');
  assert.match(benchmark, /require\('\.\.\/src\/legacy-src\/utils\/clipHlsProcessing'\)/);
  assert.doesNotMatch(benchmark, /@aws-sdk|writeUInt32BE|createVideoMultipart|fetch\(/);
  const { fixtures } = require('./benchmark-post-video-local');
  assert.equal(fixtures.length, 8);
  assert.ok(fixtures.some(f => f.seconds >= 300));
  assert.ok(fixtures.some(f => f.hevc));
  assert.ok(fixtures.some(f => f.vfr));
});
test('new staging media stack blocks public sources and has no unrestricted CloudFront fallback', () => {
  const media = read('infra/post-video-staging-media.yaml');
  for (const name of ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']) assert.match(media, new RegExp(`${name}: true`));
  assert.match(media, /TrustedKeyGroups: \[!Ref KeyGroup\]/);
  assert.doesNotMatch(media, /CacheBehaviors:|CustomErrorResponses:|ExpirationInDays:|squadhunt\.com/);
  assert.match(media, /Resource: !Sub '\$\{Bucket.Arn\}\/post-video-playback\/\*'/);
  assert.match(media, /NeverDeliverSourcesThroughCloudFront[\s\S]*Effect: Deny/);
  assert.match(media, /DeletionPolicy: Retain/);
  assert.match(media, /DaysAfterInitiation: 2/);
});
test('repeat staging rounds isolate secret names without restoring first-run recovery markers', () => {
  for (const template of ['infra/post-video-staging-data.yaml', 'infra/post-video-staging-api.yaml']) {
    const source = read(template);
    assert.match(source, /SecretNamespace:/);
    assert.match(source, /\^arc\/staging\/post-video\(-r\[0-9\]\+\)\?\$/);
    assert.doesNotMatch(source, /Name: arc\/staging\/post-video\//);
  }
});
test('benchmark fast-start inspection supports large moov atoms without reading media payload', async () => {
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const { hasFastStart } = require('./benchmark-post-video-local');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'squadhunt-atom-test-'));
  try {
    const atom = (type, length) => { const b = Buffer.alloc(length); b.writeUInt32BE(length); b.write(type, 4); return b; };
    const file = path.join(directory, 'fixture.mp4');
    await fsp.writeFile(file, Buffer.concat([atom('ftyp', 24), atom('moov', 300_000), atom('mdat', 8)]));
    assert.equal(await hasFastStart(file), true);
    await fsp.writeFile(file, Buffer.concat([atom('ftyp', 24), atom('mdat', 8), atom('moov', 20)]));
    assert.equal(await hasFastStart(file), false);
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
});
