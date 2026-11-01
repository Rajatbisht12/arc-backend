'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const V = require('../legacy-private-video-release-r1/verify.cjs');
const ROOT = path.resolve(__dirname, '../..');
const hash = value => V.sha(JSON.stringify(value));
const fail = code => { throw Error(code); };
function parseBuilder(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1048576 || raw.includes('\0')) fail('BUILDER_OUTPUT_INVALID');
  const parts = raw.replace(/\r\n/g, '\n').split(/^\s*Nodes:\s*$/m);
  if (parts.length !== 2) fail('BUILDER_NODES_INCOMPLETE');
  const field = (section, key) => {
    const values = [...section.matchAll(new RegExp('^' + key + ':[ \\t]*(.*)$', 'gm'))];
    if (values.length !== 1 || !values[0][1].trim()) fail('BUILDER_FIELD_AMBIGUOUS');
    return values[0][1].trim();
  };
  const nodes = parts[1].split(/(?=^Name:)/m).filter(x => /^Name:/m.test(x));
  if (nodes.length !== 1) fail('SINGLE_LOCAL_NODE_REQUIRED');
  return {
    name: field(parts[0], 'Name'), driver: field(parts[0], 'Driver'),
    nodeName: field(nodes[0], 'Name'), endpoint: field(nodes[0], 'Endpoint'),
    status: field(nodes[0], 'Status'),
    linuxAmd64: /(?:^|,\s*)linux\/amd64(?:\*|,|$)/.test(field(nodes[0], 'Platforms'))
  };
}
function loadPlan() {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-plan.json')));
  for (const pin of plan.controls) {
    if (V.sha(fs.readFileSync(path.resolve(__dirname, pin.path))) !== pin.sha256) fail('CONTROL_BYTES_CHANGED');
  }
  if (plan.sourceContentSha256 !== '8987e09a78724bd6152464ed59a444e860aeb6cc0d8b6c30f09e7e76f171bae2' ||
      plan.sourceArchiveSha256 !== '95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee' ||
      plan.tag !== 'pi-worker-format-legacy-r1-20261101' || plan.runId !== 'pi-worker-format-legacy-r2-20261101') fail('EXACT_SOURCE_AND_TAG_REQUIRED');
  const archive = V.verify();
  return { plan, archive };
}
function priorClosure(directory) {
  if (!directory || !path.isAbsolute(directory) || path.basename(directory) !== 'worker-format-legacy-r1-consumed' || fs.lstatSync(directory).isSymbolicLink()) fail('EXACT_PRIOR_JOURNAL_REQUIRED');
  const expected = ['authority-closed.json', 'aws-intent-0.json', 'aws-intent-1.json', 'consumed.json', 'hold.json', 'new-tag-absence.json'];
  if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(expected)) fail('PRIOR_BUILD_ATTEMPT_OR_UNEXPECTED_FILE');
  const read = name => {
    const p = path.join(directory, name), stat = fs.lstatSync(p);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) fail('PRIOR_JOURNAL_SHAPE');
    return JSON.parse(fs.readFileSync(p));
  };
  const consumed = read('consumed.json'), closed = read('authority-closed.json'), hold = read('hold.json');
  const absent = read('new-tag-absence.json'), first = read('aws-intent-0.json'), second = read('aws-intent-1.json');
  if (consumed.runId !== 'pi-worker-format-legacy-r1-20261101' || consumed.scopeSha256 !== 'c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130' ||
      consumed.sourceRevisionLabel !== '863ac0670a9931713405d9531e4e1a616390dbfd' || consumed.at !== 1793532019638 ||
      closed.status !== 'CLOSED_HOLD' || closed.at !== 1793532030805 || closed.reads !== 2 || closed.builds !== 0 || closed.registryReads !== 0 ||
      ['remainingReads', 'remainingBuilds', 'remainingPushes', 'ecsAuthority'].some(k => closed[k] !== 0) ||
      hold.reason !== 'BUILD_OR_PUSH_UNKNOWN_NO_RETRY' || hold.reads !== 2 || hold.builds !== 0 || hold.registryReads !== 0 || hold.at !== 1793532030801 ||
      absent.tag !== consumed.runId || absent.absenceVerified !== true || absent.at !== 1793532030371 ||
      first.service !== 'sts' || first.operation !== 'get-caller-identity' || first.attempts !== 1 ||
      second.service !== 'ecr' || second.operation !== 'describe-images' || second.repositoryName !== 'arc-backend' || second.imageTag !== consumed.runId || second.attempts !== 1) fail('PRIOR_ZERO_BUILD_CLOSURE_MISMATCH');
  return { scopeSha256: consumed.scopeSha256, closedAt: closed.at, reads: 2, builds: 0, registryReads: 0, evidenceSha256: hash({ consumed, closed, hold, absent, first, second }) };
}
function localCheck({ command = spawnSync, platform = process.platform, priorDirectory, now = Date.now } = {}) {
  if (platform !== 'win32') fail('WINDOWS_CARRIER_REQUIRED');
  const { plan, archive } = loadPlan();
  const previous = priorClosure(priorDirectory);
  const run = (exe, args) => {
    const r = command(exe, args, { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 1048576 });
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string' || Buffer.byteLength(r.stdout) > 1048576) fail(exe === 'docker' ? 'LOCAL_DOCKER_CHECK_FAILED' : 'LOCAL_GIT_CHECK_FAILED');
    return r.stdout;
  };
  const revision = run('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(revision) || run('git', ['branch', '--show-current']).trim() !== 'main' || run('git', ['rev-parse', 'origin/main']).trim() !== revision || run('git', ['status', '--porcelain', '--untracked-files=all']).trim()) fail('CLEAN_MERGED_MAIN_REQUIRED');
  if (!['https://github.com/Rajatbisht12/arc-backend', 'https://github.com/Rajatbisht12/arc-backend.git', 'git@github.com:Rajatbisht12/arc-backend.git'].includes(run('git', ['remote', 'get-url', 'origin']).trim())) fail('REVIEWED_REPOSITORY_REQUIRED');
  const endpoint = JSON.parse(run('docker', ['--context', 'desktop-linux', 'context', 'inspect', 'desktop-linux', '--format', '{{json .Endpoints.docker.Host}}']));
  if (typeof endpoint !== 'string' || !endpoint.startsWith('npipe:')) fail('LOCAL_NAMED_PIPE_REQUIRED');
  const builder = parseBuilder(run('docker', ['--context', 'desktop-linux', 'buildx', 'inspect', 'desktop-linux']));
  if (builder.name !== 'desktop-linux' || builder.driver !== 'docker-container' || builder.nodeName !== plan.nodeName || builder.endpoint !== plan.nodeEndpoint || builder.status !== 'running' || !builder.linuxAmd64) fail('EXACT_EXISTING_LOCAL_BUILDER_REQUIRED');
  return { plan, archive, revision, previous, builder, at: now(), scopeSha256: hash(plan), providerCalls: 0, builds: 0 };
}
module.exports = { ROOT, hash, parseBuilder, loadPlan, priorClosure, localCheck };
if (require.main === module) {
  try {
    const r = localCheck({ priorDirectory: path.join(process.env.LOCALAPPDATA || '', 'SquadHuntRelease', 'worker-format-legacy-r1-consumed') });
    console.log(JSON.stringify({ kind: 'R2_LOCAL_CHECK_NOT_APPROVAL', scopeSha256: r.scopeSha256, sourceFiles: r.archive.sourceFiles, revision: r.revision, previous: r.previous, builder: r.builder, providerCalls: 0, builds: 0 }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
