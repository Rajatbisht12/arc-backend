'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const L = require('./local.cjs'), B = require('./build-once.cjs');
const V = require('../legacy-private-video-release-r1/verify.cjs');
const plan = require('./build-plan.json');
const time = 1793534000000;
const builder = 'Name: desktop-linux\nDriver: docker-container\n\nNodes:\nName: desktop-linux\nEndpoint: desktop-linux\nStatus: running\nBuildKit: v0.25.1\nPlatforms: linux/amd64, linux/arm64\n';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-build-r2-'));
  const priorDirectory = path.join(root, 'worker-format-legacy-r1-consumed'); fs.mkdirSync(priorDirectory);
  const records = {
    'consumed.json': { runId: 'pi-worker-format-legacy-r1-20261101', at: 1793532019638, scopeSha256: 'c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130', sourceRevisionLabel: '863ac0670a9931713405d9531e4e1a616390dbfd' },
    'authority-closed.json': { at: 1793532030805, status: 'CLOSED_HOLD', reads: 2, builds: 0, registryReads: 0, remainingReads: 0, remainingBuilds: 0, remainingPushes: 0, ecsAuthority: 0 },
    'hold.json': { at: 1793532030801, reason: 'BUILD_OR_PUSH_UNKNOWN_NO_RETRY', reads: 2, builds: 0, registryReads: 0 },
    'new-tag-absence.json': { at: 1793532030371, tag: plan.tag, absenceVerified: true },
    'aws-intent-0.json': { service: 'sts', operation: 'get-caller-identity', attempts: 1 },
    'aws-intent-1.json': { service: 'ecr', operation: 'describe-images', repositoryName: 'arc-backend', imageTag: plan.tag, attempts: 1 }
  };
  for (const [name, r] of Object.entries(records)) fs.writeFileSync(path.join(priorDirectory, name), JSON.stringify(r));
  return { root, priorDirectory, directory: path.join(root, 'worker-format-legacy-r2-consumed') };
}
function transport(f, mode = '') {
  const calls = [];
  const raw = JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ platform: { os: 'linux', architecture: 'amd64' }, digest: 'sha256:' + 'b'.repeat(64) }] });
  const command = (exe, args, opts) => {
    calls.push({ exe, args });
    if (exe === 'git') return { status: 0, stdout: args[0] === 'branch' ? 'main' : args[0] === 'rev-parse' ? 'a'.repeat(40) : args[0] === 'remote' ? 'git@github.com:Rajatbisht12/arc-backend.git' : mode === 'dirty' ? ' M x' : '' };
    if (exe === 'aws') {
      assert.equal(opts.env.AWS_MAX_ATTEMPTS, '1');
      assert.equal(opts.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS, 'true');
      if (args[0] === 'sts') return { status: 0, stdout: JSON.stringify({ Account: mode === 'wrong-caller' ? '000000000000' : '906446637180', Arn: 'arn:aws:iam::906446637180:root' }) };
      if (args[1] === 'describe-images') {
        assert.ok(args.includes('imageTag=pi-worker-format-legacy-r1-20261101'));
        return mode === 'collision' ? { status: 0, stdout: '{"imageDetails":[{}]}' } : mode === 'unknown-tag' ? { status: 254, stderr: 'SECRET_PRIVATE_PROVIDER_MESSAGE' } : { status: 254, stderr: '(ImageNotFoundException)' };
      }
      return { status: 0, stdout: 'SYNTHETIC_PASSWORD_NEVER_EXPORT' };
    }
    assert.equal(exe, 'docker');
    if (args.includes('context')) return { status: 0, stdout: '"npipe:////./pipe/dockerDesktopLinuxEngine"' };
    if (args.includes('inspect') && !args.includes('imagetools')) {
      assert.ok(!args.includes('--format'));
      return mode === 'bad-local' ? { status: 125, stderr: 'private local failure' } : { status: 0, stdout: mode === 'remote-node' ? builder.replace('Endpoint: desktop-linux', 'Endpoint: tcp://foreign') : builder };
    }
    if (args.includes('login')) { assert.equal(opts.input, 'SYNTHETIC_PASSWORD_NEVER_EXPORT'); return { status: 0, stdout: '' }; }
    if (args.includes('build')) {
      assert.equal(opts.timeout, 900000);
      assert.ok(fs.existsSync(path.join(f.directory, 'build-push-intent.json')));
      assert.equal(args[args.indexOf('-t') + 1], plan.repository + ':' + plan.tag);
      if (mode === 'build-unknown') return { status: null, error: { code: 'ETIMEDOUT' } };
      fs.writeFileSync(args[args.indexOf('--metadata-file') + 1], JSON.stringify({ 'containerimage.digest': 'sha256:' + V.sha(raw) }));
      return { status: 0, stdout: '' };
    }
    assert.ok(args.includes('imagetools'));
    return { status: 0, stdout: mode === 'bad-index' ? raw + ' ' : raw };
  };
  return { calls, command };
}
const approval = () => ({ decision: 'APPROVE_EXACT_R2_BUILD_PUSH_ONLY', scopeSha256: L.hash(plan), existingLocalDockerContainerDriverAccepted: true, untouchedOriginalTagAccepted: true, cleanMergedHeadLabelOnlyAccepted: true, exclusiveTagAndJournalOwner: true, approvedAt: time });
const options = (f, t) => ({ ...f, ...t, now: () => time, platform: 'win32' });
test('exact unchanged source archive and all controller pins verify', () => { const r = L.loadPlan(); assert.equal(r.archive.sourceFiles, 760); assert.equal(r.archive.records.size, 761); assert.equal(plan.tag, 'pi-worker-format-legacy-r1-20261101'); assert.notEqual(plan.runId, plan.tag); });
test('supported plain inspect parses root separately from node, including CRLF', () => { assert.equal(L.parseBuilder(builder.replace(/\n/g, '\r\n')).driver, 'docker-container'); assert.equal(L.parseBuilder(builder).nodeName, 'desktop-linux'); });
test('duplicate/missing fields and multi-node or incomplete output reject', () => {
  for (const raw of [builder.replace('Driver:', 'Driver: docker\nDriver:'), builder.replace('Nodes:', 'Missing:'), builder + 'Name: foreign\nEndpoint: foreign\n', builder.replace('Platforms:', 'MissingPlatforms:')]) assert.throws(() => L.parseBuilder(raw));
});
test('invalid approval performs no command and creates no journal', () => { const f = fixture(); try { const t = transport(f); assert.throws(() => B.build({}, options(f, t)), /APPROVAL/); assert.equal(t.calls.length, 0); assert.ok(!fs.existsSync(f.directory)); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('local Docker failure, foreign endpoint and dirty Git precede ALL provider calls and consumption', () => {
  for (const mode of ['bad-local', 'remote-node', 'dirty']) { const f = fixture(); try { const t = transport(f, mode); assert.throws(() => B.build(approval(), options(f, t))); assert.ok(!t.calls.some(x => x.exe === 'aws')); assert.ok(!fs.existsSync(f.directory)); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } }
});
test('local-only entry makes no provider request or journal', () => { const f = fixture(); try { const t = transport(f); const r = L.localCheck(options(f, t)); assert.equal(r.providerCalls, 0); assert.ok(!t.calls.some(x => x.exe === 'aws')); assert.ok(!fs.existsSync(f.directory)); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('any prior build intent or changed prior closure forbids tag reuse', () => { const f = fixture(); try { fs.writeFileSync(path.join(f.priorDirectory, 'build-push-intent.json'), '{}'); assert.throws(() => L.priorClosure(f.priorDirectory), /PRIOR_BUILD/); fs.unlinkSync(path.join(f.priorDirectory, 'build-push-intent.json')); fs.writeFileSync(path.join(f.priorDirectory, 'authority-closed.json'), JSON.stringify({ builds: 1 })); assert.throws(() => L.priorClosure(f.priorDirectory), /MISMATCH/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
for (const mode of ['', 'collision', 'unknown-tag', 'wrong-caller', 'build-unknown', 'bad-index']) test('bounded one-use result: ' + (mode || 'published'), () => {
  const f = fixture(); try {
    const t = transport(f, mode), r = B.build(approval(), options(f, t));
    assert.equal(r.status, mode ? 'CLOSED_HOLD' : 'CLOSED_IMAGE_PUBLISHED_NO_DEPLOYMENT');
    assert.equal(r.builds, ['', 'build-unknown', 'bad-index'].includes(mode) ? 1 : 0);
    assert.ok(r.reads <= 3); assert.ok(r.registryReads <= 1);
    const before = t.calls.length;
    assert.throws(() => B.build(approval(), options(f, t)), /ALREADY_CONSUMED/); assert.equal(t.calls.length, before);
    const closed = JSON.parse(fs.readFileSync(path.join(f.directory, 'authority-closed.json')));
    assert.equal(closed.remainingReads + closed.remainingBuilds + closed.remainingPushes + closed.remainingRegistryReads + closed.ecsAuthority, 0);
    const texts = fs.readdirSync(f.directory).filter(x => x.endsWith('.json')).map(x => fs.readFileSync(path.join(f.directory, x), 'utf8')).join();
    assert.ok(!texts.includes('SYNTHETIC_PASSWORD')); assert.ok(!texts.includes('SECRET_PRIVATE_PROVIDER_MESSAGE'));
    assert.ok(!t.calls.some(x => x.args.includes('--bootstrap') || x.args.includes('create') || x.args.includes('rm')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
