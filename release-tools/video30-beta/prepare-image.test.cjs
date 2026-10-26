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
