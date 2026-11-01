'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const V = require('./verify.cjs');
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
  if (plan.sourceContentSha256 !== '4b4889ee48b8aa650b48cb44edda18ad0512d8acd061cc8c84693fd82e375d96' ||
      plan.sourceArchiveSha256 !== 'fcc9124ca33abe28b6153d72ea5375816ad99f71fcfdd78bde7af8284d1d1a82' ||
      plan.tag !== 'pi-all-user-session-api-r1-20261101' || plan.runId !== 'pi-all-user-session-api-r1-20261101') fail('EXACT_SOURCE_AND_TAG_REQUIRED');
  const archive = V.verify();
  return { plan, archive };
}
function localCheck({ command = spawnSync, platform = process.platform, now = Date.now } = {}) {
  if (platform !== 'win32') fail('WINDOWS_CARRIER_REQUIRED');
  const { plan, archive } = loadPlan();
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
  if (builder.name !== 'desktop-linux' || !['docker', 'docker-container'].includes(builder.driver) || !plan.allowedDrivers?.includes(builder.driver) || builder.nodeName !== plan.nodeName || builder.endpoint !== plan.nodeEndpoint || builder.status !== 'running' || !builder.linuxAmd64) fail('EXACT_EXISTING_LOCAL_BUILDER_REQUIRED');
  return { plan, archive, revision, builder, at: now(), scopeSha256: hash(plan), providerCalls: 0, builds: 0 };
}
module.exports = { ROOT, hash, parseBuilder, loadPlan, localCheck };
if (require.main === module) {
  try {
    const r = localCheck();
    console.log(JSON.stringify({ kind: 'API_IMAGE_LOCAL_CHECK_NOT_APPROVAL', scopeSha256: r.scopeSha256, sourceFiles: r.archive.sourceFiles, revision: r.revision, builder: r.builder, providerCalls: 0, builds: 0 }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
