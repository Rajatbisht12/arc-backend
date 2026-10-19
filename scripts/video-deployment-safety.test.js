const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { prepareCompatibilityTaskDefinition, sourceRepository } = require('./lib/video-release');
const { assertNoNewVideoWork } = require('./verify-video-compatibility-release');
const { VIDEO_COMPATIBILITY_FLAGS, assertVideoCompatibilityEnvironment } = require('../src/legacy-src/config/videoDeploymentPolicy');
const image = `example.invalid/backend@sha256:${'a'.repeat(64)}`;
const definition = () => ({ taskDefinitionArn: 'fixture', revision: 1, cpu: '512', memory: '1024',
  taskRoleArn: 'fixture-role', containerDefinitions: [{ name: 'api', image: 'previous:tag',
    environment: [{ name: 'UNRELATED_SETTING', value: 'retain' }],
    secrets: [{ name: 'MONGODB_URI', valueFrom: 'fixture-secret' }, { name: 'POST_VIDEO_UPLOADS_ENABLED', valueFrom: 'fixture-flag-secret' }],
  }] });

test('task preparation pins immutable image and exact compatibility flags without altering unrelated runtime settings', () => {
  const original = definition();
  const td = prepareCompatibilityTaskDefinition(original, image);
  const c = td.containerDefinitions[0];
  const env = Object.fromEntries(c.environment.map(row => [row.name, row.value]));
  assertVideoCompatibilityEnvironment(env);
  assert.equal(env.VIDEO_DEPLOYMENT_MODE, 'compatibility');
  assert.equal(c.image, image); assert.equal(td.taskRoleArn, original.taskRoleArn);
  assert.equal(env.UNRELATED_SETTING, 'retain');
  assert.deepEqual(c.secrets.map(row => row.name), ['MONGODB_URI']);
  assert.equal(td.revision, undefined); assert.equal(original.revision, 1);
  assert.deepEqual(prepareCompatibilityTaskDefinition(td, image), td);
});
test('mutable image tags and active dedicated topologies fail closed', () => {
  assert.throws(() => prepareCompatibilityTaskDefinition(definition(), 'image:tag'), /immutable/);
  for (const [name, value] of [['POST_VIDEO_UPLOADS_ENABLED', 'true'], ['POST_VIDEO_PRIVATE_DELIVERY_ENABLED', 'true'], ['CLIP_HLS_WORKER_ENABLED', 'false'], ['CLIP_HLS_ENABLED', 'false']]) {
    const td = definition(); td.containerDefinitions[0].environment.push({ name, value });
    assert.throws(() => prepareCompatibilityTaskDefinition(td, image));
  }
  for (const name of Object.keys(VIDEO_COMPATIBILITY_FLAGS)) assert.throws(() => assertVideoCompatibilityEnvironment({ ...VIDEO_COMPATIBILITY_FLAGS, [name]: 'wrong' }));
});
test('image source labels normalize SSH and strip remote credentials', () => {
  assert.equal(sourceRepository('git@github.com:Rajatbisht12/arc-backend.git'), 'https://github.com/Rajatbisht12/arc-backend.git');
  assert.equal(sourceRepository('https://credential@github.com/org/repo.git'), 'https://github.com/org/repo.git');
  assert.throws(() => sourceRepository('https://example.invalid/org/repo.git'));
});
test('preflight refuses active/new-content sessions and incompatible queued work', async () => {
  const empty = { getJobs: async () => [] };
  await assertNoNewVideoWork({ exists: async () => null }, empty);
  await assert.rejects(assertNoNewVideoWork({ exists: async () => ({ _id: 'fixture' }) }, empty), /sessions\/content exist/);
  await assert.rejects(assertNoNewVideoWork({ exists: async () => null }, { getJobs: async () => [{ name: 'process-upload' }] }), /jobs remain/);
  await assertNoNewVideoWork({ exists: async () => null }, { getJobs: async () => [{ name: 'transcode-hls' }] });
});
test('queue audit is paginated and refuses an unbounded backlog rather than guessing', async () => {
  const pages = [];
  await assertNoNewVideoWork({ exists: async () => null }, { getJobs: async (_states, from, to) => {
    pages.push([from, to]); return from === 0 ? Array(100).fill({ name: 'transcode-hls' }) : [];
  } });
  assert.deepEqual(pages, [[0, 99], [100, 199]]);
  await assert.rejects(assertNoNewVideoWork({ exists: async () => null }, { getJobs: async () => Array(100).fill({ name: 'transcode-hls' }) }), /audit limit/);
});
test('release pins flags before startup; no video-index migration is coupled to disabled deployment', () => {
  const deploy = fs.readFileSync(`${__dirname}/../deploy.sh`, 'utf8');
  const preflight = fs.readFileSync(`${__dirname}/preflight-push-release.js`, 'utf8');
  assert.match(deploy, /prepareCompatibilityTaskDefinition/);
  assert.match(deploy, /DEPLOY_IMAGE="\$REPO@\$EXPECTED_DIGEST"/);
  assert.match(deploy, /SOURCE_REVISION=\$\(git rev-parse --verify HEAD\)/);
  assert.match(deploy, /git status --porcelain --untracked-files=all/);
  assert.match(preflight, /VIDEO_DEPLOYMENT_MODE === 'compatibility'/);
  assert.ok(preflight.indexOf("run('verify-video-compatibility-release.js')") < preflight.indexOf("run('migrate-bank-details.js'"));
  assert.doesNotMatch(deploy + preflight, /migrate-video-upload-indexes/);
});
