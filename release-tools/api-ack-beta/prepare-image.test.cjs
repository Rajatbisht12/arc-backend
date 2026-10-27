const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { PIN, verifyArchive, verifySource, repository, buildArgs } = require('./prepare-image.cjs');
test('only the exact reviewed archive may enter the build', () => {
  verifyArchive(path.join(__dirname, 'backend.zip'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video30-bad-archive-'));
  const file = path.join(dir, 'backend.zip'); fs.writeFileSync(file, 'unreviewed');
  assert.throws(() => verifyArchive(file), /FROZEN_ARCHIVE_CHANGED/);
});
test('source attribution normalizes SSH and strips remote credentials', () => {
  assert.equal(repository('git@github.com:vortica-labs/arc-backend.git'), 'https://github.com/vortica-labs/arc-backend');
  assert.equal(repository('https://username:token@github.com/vortica-labs/arc-backend.git'), 'https://github.com/vortica-labs/arc-backend');
  assert.throws(() => repository('https://example.invalid/org/repo'), /GITHUB_SOURCE_REQUIRED/);
});
test('build is Linux/amd64 with source fingerprints and contains no AWS or deployment command', () => {
  const args = buildArgs('https://github.com/vortica-labs/arc-backend', '/tmp/reviewed-source');
  assert.deepEqual(args.slice(0, 3), ['build', '--platform', 'linux/amd64']);
  assert(args.includes('io.squadhunt.source-content-sha256=' + PIN.contentSha256));
  assert(!args.some(v => /push|register-task|update-service|AWS_ACCESS|AWS_SECRET/.test(v)));
});
test('extracted source rejects tampering and additional unreviewed files', () => {
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-ack-source-test-'));
  execFileSync('unzip', ['-q', path.join(__dirname, 'backend.zip'), '-d', dir]);
  assert.equal(verifySource(dir), 755);
  fs.writeFileSync(path.join(dir, 'unreviewed-command.sh'), 'no execution');
  assert.throws(() => verifySource(dir), /UNREVIEWED_SOURCE_FILE/);
  fs.unlinkSync(path.join(dir, 'unreviewed-command.sh'));
  fs.appendFileSync(path.join(dir, 'src/modules/notifications/notifications.routes.ts'), '\n// tampered');
  assert.throws(() => verifySource(dir), /SOURCE_FILE_SHAPE_CHANGED|SOURCE_FILE_CHANGED/);
});
test('arbitrary command/deployment pass-through is rejected before any Docker or AWS action', () => {
  const { spawnSync } = require('node:child_process');
  for (const arg of ['--deploy', '--push', '--run', 'aws']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'prepare-image.cjs'), arg], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /USE_PREVIEW_ONLY_OR_BUILD_ONLY/);
  }
});
