#!/usr/bin/env node

require('dotenv').config();
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const auditOnly = process.argv.includes('--audit-only');
const verifyOnly = process.argv.includes('--verify-only');
if (auditOnly && verifyOnly) {
  console.error('Use only one of --audit-only or --verify-only');
  process.exit(1);
}

const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: backendRoot,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};

const main = async () => {
  // Refuse to activate an image whose generated worker, canonical policy, or
  // social producers can reach email outside the exact transactional catalog.
  run('verify-email-policy-release.js');

  // ECS stores production credentials in Secrets Manager rather than directly
  // in the task definition. Load them before spawning any verifier/migration,
  // then inherit the hydrated environment into each child process.
  const { loadSecretsManagerEnv } = require('../dist/config/secrets.js');
  await loadSecretsManagerEnv();

  // Financial data must be decryptable and indexed before production traffic
  // reaches the new revision. This also blocks a keyless ECS deployment.
  run('verify-bank-details-config.js', ['--release']);
  // Additive collection/index preparation happens outside transactions because
  // DocumentDB cannot create a collection inside a transaction.
  run('migrate-bank-details.js', ['--prepare']);
  // Read-only, primary-only audit must pass before any migration writes occur.
  run('migrate-bank-details.js');
  run('migrate-monetization-admin.js');
  run('verify-push-provider-config.js', ['--release']);
  if (auditOnly) return;
  if (!verifyOnly) {
    run('migrate-bank-details.js', ['--apply']);
    run('migrate-monetization-admin.js', ['--apply']);
  }
  run('migrate-bank-details.js', ['--verify']);
  run('migrate-monetization-admin.js', ['--verify']);

  run('migrate-push-infrastructure.js');
  run('migrate-push-infrastructure.js', ['--verify']);
  // Admission correctness depends on unique user/day indexes. Install and
  // verify them before the new task revision receives production traffic.
  run('migrate-random-connect-indexes.js');
  run('migrate-random-connect-indexes.js', ['--verify']);
};

main().catch((error) => {
  console.error(`Push release preflight failed: ${String(error?.message || error)}`);
  process.exit(1);
});
