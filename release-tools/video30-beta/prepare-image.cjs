#!/usr/bin/env node
'use strict';
// Build-only packaging. Deliberately contains no AWS client, image push,
// task registration, migration or deployment operation.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const PIN = Object.freeze({
  archiveSha256: '145becc71228b4ea4eaeb391c2c0f5dad61afc19461d7729cc52fc1b80df63fa',
  contentSha256: 'c69b79a123f508a26fb43f90ce85bf515ed495b4a61cc9ee9143502dd4820ce4',
  baseRevision: 'e46632782682353798c1f8eecf2c07598d82b98d',
  image: 'squadhunt-video30-beta:c69b79a123f5',
});
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const assert = (ok, code) => { if (!ok) throw Error(code); };
function verifyArchive(file) {
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && s.size < 16 * 1024 * 1024, 'PINNED_SOURCE_ARCHIVE_REQUIRED');
  assert(hash(fs.readFileSync(file)) === PIN.archiveSha256, 'FROZEN_ARCHIVE_CHANGED');
}
function verifySource(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, '.source-manifest.json'), 'utf8'));
  assert(m.contentSha256 === PIN.contentSha256 && m.baseRevision === PIN.baseRevision, 'SOURCE_IDENTITY_CHANGED');
  const expected = new Set(['.source-manifest.json']);
  for (const f of m.files) {
    assert(typeof f.path === 'string' && !path.isAbsolute(f.path) && !f.path.includes('\\')
      && f.path.split('/').every(x => x && x !== '.' && x !== '..') && !expected.has(f.path), 'UNSAFE_SOURCE_PATH');
    expected.add(f.path);
    const file = path.join(dir, f.path), s = fs.lstatSync(file);
    assert(s.isFile() && !s.isSymbolicLink() && s.size === f.bytes, 'SOURCE_FILE_SHAPE_CHANGED');
    assert(hash(fs.readFileSync(file)) === f.sha256, 'SOURCE_FILE_CHANGED');
    assert(!/(^|\/)\.env($|\.)/.test(f.path) || f.path.endsWith('.example'), 'SECRET_FILE_IN_SOURCE');
  }
  const walk = (base, prefix = '') => {
    for (const item of fs.readdirSync(base, { withFileTypes: true })) {
      const key = prefix + item.name;
      if (item.isDirectory()) walk(path.join(base, item.name), key + '/');
      else assert(item.isFile() && expected.has(key), 'UNREVIEWED_SOURCE_FILE');
    }
  };
  walk(dir); return m.files.length;
}
function repository(remote) {
  const url = new URL(String(remote).trim().replace(/^git@github\.com:/, 'https://github.com/'));
  assert(url.hostname === 'github.com' && /^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url.pathname), 'GITHUB_SOURCE_REQUIRED');
  return 'https://github.com' + url.pathname.replace(/\.git$/, '');
}
function buildArgs(source, dir) {
  return ['build', '--platform', 'linux/amd64', '--build-arg', 'SOURCE_REVISION=' + PIN.baseRevision,
    '--build-arg', 'SOURCE_REPOSITORY=' + source,
    '--label', 'io.squadhunt.source-kind=frozen-reviewed-candidate',
    '--label', 'io.squadhunt.source-content-sha256=' + PIN.contentSha256,
    '--label', 'io.squadhunt.source-archive-sha256=' + PIN.archiveSha256,
    '--tag', PIN.image, dir];
}
function main(args) {
  assert(args.length === 1 && ['--preview-only', '--build-only'].includes(args[0]), 'USE_PREVIEW_ONLY_OR_BUILD_ONLY');
  const root = path.resolve(__dirname, '../..');
  const archive = path.join(__dirname, 'backend.zip'); verifyArchive(archive);
  const source = repository(execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'squadhunt-beta30-build-'));
  if (process.platform === 'win32') {
    const q = x => "'" + x.replace(/'/g, "''") + "'";
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath ' + q(archive) + ' -DestinationPath ' + q(dir)], { stdio: 'inherit' });
  } else execFileSync('unzip', ['-q', archive, '-d', dir], { stdio: 'inherit' });
  const count = verifySource(dir), command = buildArgs(source, dir);
  const result = { mode: args[0], ...PIN, context: dir, sourceRepository: source,
    filesVerified: count, dockerArguments: command, awsMutations: 0, pushes: 0, deployments: 0 };
  if (args[0] === '--build-only') {
    assert(!execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim(), 'COMMIT_RELEASE_INPUTS_FIRST');
    execFileSync('docker', ['version'], { stdio: 'inherit' });
    execFileSync('docker', command, { stdio: 'inherit' });
    const info = JSON.parse(execFileSync('docker', ['image', 'inspect', PIN.image], { encoding: 'utf8' }))[0];
    assert(info.Os === 'linux' && info.Architecture === 'amd64', 'LINUX_AMD64_IMAGE_REQUIRED');
    assert(info.Config.Labels['io.squadhunt.source-content-sha256'] === PIN.contentSha256, 'BUILT_SOURCE_IDENTITY_CHANGED');
    execFileSync('docker', ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none', PIN.image,
      'node', 'scripts/verify-runtime-imports.js'], { stdio: 'inherit' });
    result.localImageId = info.Id;
    result.registryDigest = null; // Never mislabel a local ID as an ECR digest.
    const file = path.join(dir, 'build-receipt.json');
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    result.receipt = file;
  }
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { PIN, verifyArchive, verifySource, repository, buildArgs };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
