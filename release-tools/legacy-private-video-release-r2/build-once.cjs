'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const L = require('./local.cjs');
const V = require('../legacy-private-video-release-r1/verify.cjs');
function build(a, { directory, priorDirectory, command = spawnSync, now = Date.now, platform = process.platform } = {}) {
  const { plan } = L.loadPlan();
  const fresh = () => {
    if (!Number.isSafeInteger(a?.approvedAt) || now() < a.approvedAt || now() - a.approvedAt >= 1800000) throw Error('APPROVAL_CLOCK_INVALID');
  };
  if (a?.decision !== 'APPROVE_EXACT_R2_BUILD_PUSH_ONLY' || a.scopeSha256 !== L.hash(plan) ||
      a.existingLocalDockerContainerDriverAccepted !== true || a.untouchedOriginalTagAccepted !== true ||
      a.cleanMergedHeadLabelOnlyAccepted !== true || a.exclusiveTagAndJournalOwner !== true) throw Error('EXACT_R2_APPROVAL_REQUIRED');
  fresh();
  if (!directory || !path.isAbsolute(directory) || path.resolve(directory) === L.ROOT || path.resolve(directory).startsWith(L.ROOT + path.sep) || path.basename(directory) !== 'worker-format-legacy-r2-consumed') throw Error('EXTERNAL_R2_JOURNAL_REQUIRED');
  if (fs.existsSync(directory)) throw Error('R2_ALREADY_CONSUMED_NO_RETRY');
  // All platform/source/Git/prior-zero-build/builder checks precede the new journal and AWS.
  const ready = L.localCheck({ command, platform, priorDirectory, now });
  fresh();
  fs.mkdirSync(directory, { mode: 0o700 });
  const save = (name, value) => {
    const filename = path.join(directory, name), bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!fs.readFileSync(filename).equals(bytes)) throw Error('EVIDENCE_WRITE_UNKNOWN');
  };
  let reads = 0, builds = 0, registryReads = 0, status = 'CLOSED_HOLD', stage = 'RECEIPT', reason = null;
  const allowedReasons = new Set(['CALLER_CHANGED', 'TAG_NOT_POSITIVELY_ABSENT', 'TAG_EVIDENCE_STALE', 'COMMAND_FAILED_OR_UNKNOWN', 'IMAGE_ACK_UNKNOWN', 'REGISTRY_BINDING_INVALID', 'APPROVAL_CLOCK_INVALID', 'EVIDENCE_WRITE_UNKNOWN']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_')));
  Object.assign(env, { AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' });
  const invoke = (exe, args, extra = {}) => {
    fresh();
    const r = command(exe, args, { cwd: L.ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 1048576, ...extra });
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string' || Buffer.byteLength(r.stdout) > 1048576) throw Error('COMMAND_FAILED_OR_UNKNOWN');
    return r.stdout;
  };
  const aws = (service, operation) => {
    fresh();
    if (reads >= 3) throw Error('COMMAND_BOUND');
    save('aws-intent-' + reads + '.json', { at: now(), service, operation, attempts: 1 }); reads++;
    return invoke('aws', [service, operation, '--profile', 'default', '--region', 'us-east-1'], { env });
  };
  const docker = (args, extra) => invoke('docker', ['--context', 'desktop-linux', ...args], extra);
  try {
    save('consumed.json', { runId: plan.runId, at: now(), scopeSha256: L.hash(plan), sourceRevisionLabel: ready.revision, priorClosure: ready.previous, builder: ready.builder, journalMode: 'EXCLUSIVE_FILE_FSYNC_READBACK', windowsDirectoryPowerLossDurabilityNotClaimed: true });
    stage = 'CONTEXT';
    const context = path.join(directory, 'context'); fs.mkdirSync(context);
    for (const [name, bytes] of ready.archive.records) {
      const target = path.join(context, name); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: 'wx' });
      if (!fs.readFileSync(target).equals(bytes)) throw Error('CONTEXT_WRITE_UNKNOWN');
    }
    stage = 'IDENTITY';
    const who = JSON.parse(aws('sts', 'get-caller-identity'));
    if (who.Account !== '906446637180' || who.Arn !== 'arn:aws:iam::906446637180:root') throw Error('CALLER_CHANGED');
    stage = 'TAG_ABSENCE'; fresh();
    save('aws-intent-' + reads + '.json', { at: now(), service: 'ecr', operation: 'describe-images', repositoryName: 'arc-backend', imageTag: plan.tag, attempts: 1 }); reads++;
    const collision = command('aws', ['ecr', 'describe-images', '--repository-name', 'arc-backend', '--image-ids', 'imageTag=' + plan.tag, '--profile', 'default', '--region', 'us-east-1', '--no-paginate', '--output', 'json'], { cwd: L.ROOT, env, encoding: 'utf8', timeout: 30000, maxBuffer: 1048576 });
    // Exact requested tag must return AWS's explicit ImageNotFoundException; empty/unknown output is insufficient.
    if (collision.error || collision.status === 0 || !/\(ImageNotFoundException\)/.test(String(collision.stderr || ''))) throw Error('TAG_NOT_POSITIVELY_ABSENT');
    const absenceAt = now(); save('new-tag-absence.json', { at: absenceAt, tag: plan.tag, absenceVerified: true });
    stage = 'AUTHENTICATION';
    const password = aws('ecr', 'get-login-password');
    docker(['login', '--username', 'AWS', '--password-stdin', plan.repository.split('/')[0]], { input: password });
    stage = 'BUILD_PUSH'; fresh();
    if (now() - absenceAt >= 300000) throw Error('TAG_EVIDENCE_STALE');
    const metadata = path.join(directory, 'metadata.json');
    save('build-push-intent.json', { at: now(), image: plan.repository + ':' + plan.tag, archiveSha256: plan.sourceArchiveSha256, builder: ready.builder, attempts: 1 }); builds++;
    docker(['buildx', 'build', '--builder', 'desktop-linux', '--platform', 'linux/amd64', '--provenance=mode=min', '--output=type=registry,oci-mediatypes=true', '--metadata-file', metadata, '--build-arg', 'SOURCE_REVISION=' + ready.revision, '--build-arg', 'SOURCE_REPOSITORY=https://github.com/Rajatbisht12/arc-backend', '--label', 'com.squadhunt.worker.source-content=' + plan.sourceContentSha256, '-t', plan.repository + ':' + plan.tag, context], { timeout: 900000 });
    stage = 'BUILD_ACK';
    const stat = fs.lstatSync(metadata); if (!stat.isFile() || stat.size > 1048576) throw Error('IMAGE_ACK_UNKNOWN');
    const native = JSON.parse(fs.readFileSync(metadata));
    if (!/^sha256:[a-f0-9]{64}$/.test(native['containerimage.digest'] || '')) throw Error('IMAGE_ACK_UNKNOWN');
    stage = 'REGISTRY_INDEX'; fresh();
    save('registry-intent.json', { at: now(), indexDigest: native['containerimage.digest'], attempts: 1 }); registryReads++;
    const raw = Buffer.from(docker(['buildx', 'imagetools', 'inspect', '--raw', plan.repository + '@' + native['containerimage.digest']]));
    const index = JSON.parse(raw), children = index.manifests?.filter(x => x.platform?.os === 'linux' && x.platform?.architecture === 'amd64');
    if (index.mediaType !== 'application/vnd.oci.image.index.v1+json' || children?.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(children[0].digest) || !['sha256:' + V.sha(raw), 'sha256:' + V.sha(raw.at(-1) === 10 ? raw.subarray(0, -1) : raw)].includes(native['containerimage.digest'])) throw Error('REGISTRY_BINDING_INVALID');
    stage = 'RECEIPT'; fresh();
    save('artifact-receipt.json', { at: now(), runId: plan.runId, tag: plan.tag, indexDigest: native['containerimage.digest'], amd64ChildDigest: children[0].digest, sourceContentSha256: plan.sourceContentSha256, sourceRevisionLabel: ready.revision, workerOnly: true, ecsAuthority: 0 });
    status = 'CLOSED_IMAGE_PUBLISHED_NO_DEPLOYMENT';
  } catch (error) {
    reason = allowedReasons.has(error.message) ? error.message : 'UNKNOWN_LOCAL_OR_PROVIDER_RESULT';
    save('hold.json', { at: now(), stage, reason, reads, builds, registryReads });
  } finally {
    save('authority-closed.json', { at: now(), status, stage, reason, reads, builds, registryReads, remainingReads: 0, remainingBuilds: 0, remainingPushes: 0, remainingRegistryReads: 0, ecsAuthority: 0 });
  }
  return { status, stage, reason, reads, builds, registryReads };
}
module.exports = { build };
if (require.main === module) {
  try {
    const a = JSON.parse(fs.readFileSync(process.env.WORKER_FORMAT_BUILD_R2_APPROVAL || ''));
    console.log(JSON.stringify(build(a, { directory: process.env.WORKER_FORMAT_BUILD_R2_JOURNAL, priorDirectory: path.join(process.env.LOCALAPPDATA || '', 'SquadHuntRelease', 'worker-format-legacy-r1-consumed') })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
