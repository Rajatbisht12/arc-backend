const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const preflight = fs.readFileSync(path.join(__dirname, 'preflight-push-release.js'), 'utf8');

async function runPreflight(args, failure, environment = {}) {
  const calls = [];
  const exits = [];
  let hydrated = false;
  const stop = new Error('simulated process exit');
  const result = vm.runInNewContext(preflight, {
    __dirname,
    process: {
      argv: ['node', 'preflight-push-release.js', ...args],
      execPath: process.execPath,
      env: environment,
      exit(code) { exits.push(code); throw stop; }
    },
    console: { error() {} },
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === 'node:path') return path;
      if (name === '../dist/config/secrets.js') {
        return { async loadSecretsManagerEnv() { hydrated = true; } };
      }
      if (name === 'node:child_process') {
        return {
          spawnSync(command, argv, options) {
            const script = path.basename(argv[0]);
            const args = Array.from(argv.slice(1));
            calls.push({ script, args, hydrated });
            assert.equal(command, process.execPath);
            assert.equal(options.cwd, root);
            const status = failure?.script === script && (failure.arg == null || args.includes(failure.arg)) ? 2 : 0;
            return { status };
          }
        };
      }
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  try { await result; } catch (error) { if (error !== stop) throw error; }
  return { calls, exits };
}

const discoveryCalls = result => result.calls
  .filter(call => call.script === 'migrate-discovery-exposure.js');

test('compatibility release checks read-only video state before database preparation and fails closed', async () => {
  const env = { VIDEO_DEPLOYMENT_MODE: 'compatibility' };
  const passed = await runPreflight(['--audit-only'], undefined, env);
  const gate = passed.calls.findIndex(call => call.script === 'verify-video-compatibility-release.js');
  assert.ok(gate >= 0 && passed.calls[gate].hydrated);
  assert.ok(gate < passed.calls.findIndex(call => call.script === 'migrate-bank-details.js'));
  const failed = await runPreflight(['--audit-only'], { script: 'verify-video-compatibility-release.js' }, env);
  assert.equal(failed.exits[0], 2);
  assert.equal(failed.calls.at(-1).script, 'verify-video-compatibility-release.js');
});

test('first-rollout audit inspects discovery without applying it', async () => {
  const result = await runPreflight(['--audit-only', '--migrate-discovery-exposure']);
  assert.deepEqual(discoveryCalls(result).map(call => call.args), [[]]);
  assert.ok(discoveryCalls(result).every(call => call.hydrated));
  assert.deepEqual(result.exits, []);
});

test('first rollout backfills and verifies in secret-hydrated ECS, in either release mode', async () => {
  for (const mode of [[], ['--verify-only']]) {
    const result = await runPreflight([...mode, '--migrate-discovery-exposure']);
    assert.deepEqual(discoveryCalls(result).map(call => call.args), [['--apply'], ['--verify']]);
    assert.ok(discoveryCalls(result).every(call => call.hydrated));
    assert.deepEqual(result.exits, []);
    if (mode.length) {
      assert.ok(!result.calls.some(call => call.script === 'migrate-bank-details.js' && call.args.includes('--apply')));
    }
  }
});

test('routine deployments verify discovery indexes without rescanning historical signals', async () => {
  const audit = await runPreflight(['--audit-only']);
  assert.deepEqual(discoveryCalls(audit), []);
  for (const mode of [[], ['--verify-only']]) {
    const result = await runPreflight(mode);
    assert.deepEqual(discoveryCalls(result).map(call => call.args), [['--verify']]);
    assert.deepEqual(result.exits, []);
  }
});

test('failed backfill or verification stops preflight instead of continuing the release', async () => {
  for (const arg of ['--apply', '--verify']) {
    const result = await runPreflight(['--verify-only', '--migrate-discovery-exposure'], {
      script: 'migrate-discovery-exposure.js', arg
    });
    assert.equal(result.exits[0], 2);
    assert.equal(result.calls.at(-1).script, 'migrate-discovery-exposure.js');
    assert.deepEqual(result.calls.at(-1).args, [arg]);
  }
  const routine = await runPreflight(['--verify-only'], {
    script: 'migrate-discovery-exposure.js', arg: '--verify'
  });
  assert.equal(routine.exits[0], 2);
  assert.equal(routine.calls.at(-1).script, 'migrate-discovery-exposure.js');
});

test('deployment backfill decision handles first rollout, routine deployment and explicit retries', () => {
  const deploy = fs.readFileSync(path.join(root, 'deploy.sh'), 'utf8');
  const decision = deploy.slice(deploy.indexOf('REQUIRES_DISCOVERY_MIGRATION=0'), deploy.indexOf('REQUIRES_FINANCIAL_QUIESCE=0'));
  for (const [original, target, force, expected] of [
    ['None', '2', '0', '1'],
    ['', '2', '0', '1'],
    ['2', '2', '0', '0'],
    ['1', '2', '0', '1'],
    ['2', '2', '1', '1']
  ]) {
    const result = spawnSync('bash', ['-c', `${decision}\nprintf '%s' "$REQUIRES_DISCOVERY_MIGRATION"`], {
      env: {
        ...process.env,
        ORIGINAL_DISCOVERY_EXPOSURE_VERSION: original,
        TARGET_DISCOVERY_EXPOSURE_VERSION: target,
        FORCE_DISCOVERY_EXPOSURE_MIGRATION: force
      },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test('ECS deployment versions the backfill and gates traffic on successful preflight', () => {
  const deploy = fs.readFileSync(path.join(root, 'deploy.sh'), 'utf8');
  assert.match(deploy, /TARGET_DISCOVERY_EXPOSURE_VERSION="2"/);
  assert.match(deploy, /ORIGINAL_DISCOVERY_EXPOSURE_VERSION.*\$\(aws ecs describe-task-definition/);
  assert.match(deploy, /"\$ORIGINAL_DISCOVERY_EXPOSURE_VERSION" != "\$TARGET_DISCOVERY_EXPOSURE_VERSION" \|\| "\$\{FORCE_DISCOVERY_EXPOSURE_MIGRATION:-0\}" == "1"/);
  assert.match(deploy, /discoveryMarker\.value = process\.argv\[4\]/);
  assert.match(deploy, /"\$NEW_DISCOVERY_EXPOSURE_VERSION" != "\$TARGET_DISCOVERY_EXPOSURE_VERSION"/);
  const overrides = deploy.split('\n').filter(line => line.includes('overrides=$(node') && line.includes('scripts/preflight-push-release.js'));
  assert.equal(overrides.length, 3, 'audit, verify and apply modes must receive the same migration decision');
  for (const override of overrides) {
    assert.ok(override.includes("process.argv[3]==='1'?['--migrate-discovery-exposure']:[]"));
    assert.ok(override.includes('"$REQUIRES_DISCOVERY_MIGRATION"'));
  }
  const update = deploy.indexOf('# 7. Deploy');
  assert.ok(deploy.indexOf('run_preflight audit\n') < update);
  assert.ok(deploy.indexOf('run_preflight apply\n') < update);
  assert.ok(deploy.indexOf('run_preflight verify\n') < update);
  assert.ok(deploy.includes('set -euo pipefail'));
});
