import assert from 'node:assert/strict';
import test from 'node:test';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { assertRuntimeIsolation, runtimeSecretTarget } from './runtimeIsolation';
import { loadSecretsManagerEnv } from './secrets';
import { VIDEO_COMPATIBILITY_FLAGS } from '../legacy-src/config/videoDeploymentPolicy';

const staged = {
  NODE_ENV: 'production', DEPLOYMENT_ENVIRONMENT: 'staging', BACKEND_SECRET_ID: 'arc/staging/backend',
  STAGING_MONGODB_HOST: 'arc-staging.cluster.example.invalid', STAGING_MONGODB_DATABASE: 'squadhunt_staging',
  STAGING_REDIS_HOST: 'arc-staging.redis.example.invalid', STAGING_S3_BUCKET: 'squadhunt-staging-media',
  MONGODB_URI: 'mongodb://fixture:fixture@arc-staging.cluster.example.invalid/squadhunt_staging',
  REDIS_HOST: 'arc-staging.redis.example.invalid', AWS_S3_BUCKET: 'squadhunt-staging-media',
};
const originalSend = SecretsManagerClient.prototype.send;
let snapshot: NodeJS.ProcessEnv;
let calls: string[];
let secret: Record<string, string>;
let failed: boolean;
test.beforeEach(() => {
  snapshot = { ...process.env }; calls = []; secret = {}; failed = false;
  for (const name of Object.keys(process.env)) if (!['PATH', 'TMPDIR', 'SystemRoot'].includes(name)) delete process.env[name];
  Object.assign(process.env, { NODE_ENV: 'production' });
  SecretsManagerClient.prototype.send = (async (command: { input: { SecretId: string } }) => {
    calls.push(command.input.SecretId);
    if (failed) throw new Error('simulated secret fetch failure');
    return { SecretString: JSON.stringify(secret) };
  }) as unknown as typeof SecretsManagerClient.prototype.send;
});
test.afterEach(() => {
  SecretsManagerClient.prototype.send = originalSend;
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, snapshot);
});

test('production keeps its existing secret and explicit task-env precedence', async () => {
  secret = { MONGODB_URI: 'secret-fixture', REDIS_HOST: 'redis-fixture' };
  process.env.MONGODB_URI = 'explicit-task-fixture';
  await loadSecretsManagerEnv();
  assert.deepEqual(calls, ['arc/prod/backend']);
  assert.equal(process.env.MONGODB_URI, 'explicit-task-fixture');
  assert.equal(process.env.REDIS_HOST, 'redis-fixture');
});
test('legacy production task-env fallback remains available for a secret transport outage', async () => {
  failed = true;
  await loadSecretsManagerEnv();
  assert.deepEqual(calls, ['arc/prod/backend']);
});
test('staging cannot default to or explicitly select the production secret', async () => {
  Object.assign(process.env, staged); delete process.env.BACKEND_SECRET_ID;
  await assert.rejects(loadSecretsManagerEnv(), /BACKEND_SECRET_ID/);
  process.env.BACKEND_SECRET_ID = 'arc/prod/backend';
  await assert.rejects(loadSecretsManagerEnv(), /BACKEND_SECRET_ID/);
  assert.deepEqual(calls, [], 'must reject before fetching production credentials');
});
test('staging must fail closed on fetch failure, even with complete task variables', async () => {
  Object.assign(process.env, staged); failed = true;
  await assert.rejects(loadSecretsManagerEnv(), /startup refused/);
  assert.deepEqual(calls, ['arc/staging/backend']);
});
test('only explicit staging resources and origins may survive secret hydration', async () => {
  Object.assign(process.env, staged);
  process.env.POST_VIDEO_CLOUDFRONT_URL = 'https://staging-media.example.invalid';
  await loadSecretsManagerEnv();
  assert.doesNotThrow(() => assertRuntimeIsolation(process.env));
  for (const [name, value] of [
    ['MONGODB_URI', 'mongodb://fixture:fixture@production.example.invalid/squadhunt'],
    ['MONGODB_URI', 'mongodb://fixture:fixture@arc-staging.cluster.example.invalid/squadhunt'],
    ['REDIS_HOST', 'production.redis.example.invalid'], ['AWS_S3_BUCKET', 'squadhunt-media'],
    ['POST_VIDEO_CLOUDFRONT_URL', 'https://media.squadhunt.com'],
    ['POST_VIDEO_API_ORIGIN', 'https://api.squadhunt.in'], ['CORS_ORIGIN', 'https://squadhunt.com'],
  ]) {
    const candidate = { ...staged, [name]: value };
    assert.throws(() => assertRuntimeIsolation(candidate), /Staging isolation/, name);
  }
});
test('staging cannot obtain bootstrap identities from a copied/mislabelled secret', async () => {
  Object.assign(process.env, staged); delete process.env.STAGING_REDIS_HOST;
  secret = { STAGING_REDIS_HOST: staged.STAGING_REDIS_HOST };
  await assert.rejects(loadSecretsManagerEnv(), /startup refused/);
});
test('generated CloudFront origins require independent task bindings and exact origin matches', async () => {
  const api = 'https://dstagingapi123.cloudfront.net';
  const media = 'https://dstagingmedia456.cloudfront.net';
  const candidate = { ...staged, STAGING_API_ORIGIN: api, STAGING_MEDIA_ORIGIN: media,
    POST_VIDEO_API_ORIGIN: api, POST_VIDEO_CLOUDFRONT_URL: media, AWS_S3_CDN_URL: media };
  assert.doesNotThrow(() => assertRuntimeIsolation(candidate));
  assert.throws(() => assertRuntimeIsolation({ ...candidate, STAGING_MEDIA_ORIGIN: undefined }), /Staging isolation/);
  for (const bad of ['https://dother123.cloudfront.net', api, 'https://media.squadhunt.com', `${media}/path`, `${media}?secret=x`, `https://user:password@dstagingmedia456.cloudfront.net`]) {
    assert.throws(() => assertRuntimeIsolation({ ...candidate, POST_VIDEO_CLOUDFRONT_URL: bad }), /Staging isolation/, bad);
  }
  for (const bad of ['http://dstagingmedia456.cloudfront.net', 'https://media.squadhunt.com', `${media}:444`, `${media}/path`, `${media}#fragment`]) {
    assert.throws(() => assertRuntimeIsolation({ ...candidate, STAGING_MEDIA_ORIGIN: bad }), /Staging isolation/);
  }
  Object.assign(process.env, staged);
  secret = { STAGING_MEDIA_ORIGIN: media };
  await assert.rejects(loadSecretsManagerEnv(), /startup refused/, 'secret cannot invent a trusted origin binding');
});
test('copied production resource values or static AWS credentials fail before application startup', async () => {
  Object.assign(process.env, staged);
  delete process.env.MONGODB_URI;
  secret = { MONGODB_URI: 'mongodb://fixture:fixture@production.example.invalid/squadhunt' };
  await assert.rejects(loadSecretsManagerEnv(), /startup refused/);
  Object.assign(process.env, staged);
  process.env.AWS_ACCESS_KEY_ID = 'fixture-static-key'; calls = [];
  await assert.rejects(loadSecretsManagerEnv(), /task-role/);
  assert.deepEqual(calls, []);
  delete process.env.AWS_ACCESS_KEY_ID;
  secret = { AWS_SECRET_ACCESS_KEY: 'fixture-static-secret' };
  await assert.rejects(loadSecretsManagerEnv(), /startup refused/);
  assert.throws(() => assertRuntimeIsolation({ ...staged, MONGODB_URI: staged.MONGODB_URI.replace('/squadhunt_staging', '/SquadHunt_Staging') }), /Staging isolation/);
});
test('malformed environment selection and production/staging crossover reject before fetch', () => {
  assert.throws(() => runtimeSecretTarget({ NODE_ENV: 'production', DEPLOYMENT_ENVIRONMENT: 'typo' }), /Invalid/);
  assert.throws(() => runtimeSecretTarget({ NODE_ENV: 'production', BACKEND_SECRET_ID: 'arc/staging/backend' }), /Production/);
  assert.throws(() => runtimeSecretTarget({ ...staged, NODE_ENV: 'development' }), /NODE_ENV/);
});
test('compatibility mode refuses conflicting shared worker/upload topology instead of silently switching it', async () => {
  Object.assign(process.env, VIDEO_COMPATIBILITY_FLAGS, { VIDEO_DEPLOYMENT_MODE: 'compatibility' });
  for (const [name, value] of [['POST_VIDEO_UPLOADS_ENABLED', 'true'], ['CLIP_HLS_WORKER_ENABLED', 'false'], ['POST_VIDEO_PRIVATE_DELIVERY_ENABLED', 'true']]) {
    secret = { [name]: value };
    await assert.rejects(loadSecretsManagerEnv(), /startup refused/);
  }
});
test('runtime secret cannot choose or expand the upload canary', async () => {
  process.env.POST_VIDEO_ROLLOUT_MODE = 'canary';
  process.env.POST_VIDEO_CANARY_USER_IDS = 'a'.repeat(24);
  secret = { POST_VIDEO_ROLLOUT_MODE: 'all' };
  await assert.rejects(loadSecretsManagerEnv(), /startup refused/);
  secret = { POST_VIDEO_CANARY_USER_IDS: 'b'.repeat(24) };
  await assert.rejects(loadSecretsManagerEnv(), /startup refused/);
});
