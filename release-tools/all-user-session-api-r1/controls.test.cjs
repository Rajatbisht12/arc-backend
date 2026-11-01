'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const L = require('./local.cjs'), B = require('./build-once.cjs');
const V = require('./verify.cjs');
const plan = require('./build-plan.json');
const time = 1793534000000;
const builder = 'Name: desktop-linux\nDriver: docker-container\n\nNodes:\nName: desktop-linux\nEndpoint: desktop-linux\nStatus: running\nBuildKit: v0.25.1\nPlatforms: linux/amd64, linux/arm64\n';
function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arc-api-build-'));
 return {root,directory:path.join(root,'all-user-session-api-r1-consumed')};
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
        assert.ok(args.includes('imageTag=pi-all-user-session-api-r1-20261101'));
        return mode === 'collision' ? { status: 0, stdout: '{"imageDetails":[{}]}' } : mode === 'unknown-tag' ? { status: 254, stderr: 'SECRET_PRIVATE_PROVIDER_MESSAGE' } : { status: 254, stderr: '(ImageNotFoundException)' };
      }
      return { status: 0, stdout: 'SYNTHETIC_PASSWORD_NEVER_EXPORT' };
    }
    assert.equal(exe, 'docker');
    if (args.includes('context')) return { status: 0, stdout: '"npipe:////./pipe/dockerDesktopLinuxEngine"' };
    if (args.includes('inspect') && !args.includes('imagetools')) {
      assert.ok(!args.includes('--format'));
      const output = mode === 'docker-driver' ? builder.replace('Driver: docker-container', 'Driver: docker') : mode === 'foreign-driver' ? builder.replace('Driver: docker-container', 'Driver: remote') : mode === 'stopped' ? builder.replace('Status: running', 'Status: stopped') : mode === 'arm-only' ? builder.replace('linux/amd64, ', '') : mode === 'nested-name' ? builder + 'Devices:\n  Name: nested-device\n' : mode === 'remote-node' ? builder.replace('Endpoint: desktop-linux', 'Endpoint: tcp://foreign') : builder;
      return mode === 'bad-local' ? { status: 125, stderr: 'private local failure' } : { status: 0, stdout: output };
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
const approval = () => ({ decision: 'APPROVE_EXACT_SESSION_API_IMAGE_BUILD_PUSH_ONLY', scopeSha256: L.hash(plan), existingLocalDriverAllowlistAccepted: true, exclusiveNewApiTagAccepted: true, cleanMergedHeadLabelOnlyAccepted: true, exclusiveTagAndJournalOwner: true, approvedAt: time });
const options = (f, t) => ({ ...f, ...t, now: () => time, platform: 'win32' });
test('exact unchanged source archive and all controller pins verify', () => { const r = L.loadPlan(); assert.equal(r.archive.sourceFiles, 757); assert.equal(r.archive.records.size, 758); assert.equal(plan.tag, 'pi-all-user-session-api-r1-20261101'); assert.equal(plan.runId, plan.tag); });
test('supported plain inspect parses root separately from node, including CRLF', () => { assert.equal(L.parseBuilder(builder.replace(/\n/g, '\r\n')).driver, 'docker-container'); assert.equal(L.parseBuilder(builder).nodeName, 'desktop-linux'); });
test('duplicate/missing fields and multi-node or incomplete output reject', () => {
  for (const raw of [builder.replace('Driver:', 'Driver: docker\nDriver:'), builder.replace('Nodes:', 'Missing:'), builder + 'Name: foreign\nEndpoint: foreign\n', builder.replace('Platforms:', 'MissingPlatforms:')]) assert.throws(() => L.parseBuilder(raw));
});
test('invalid approval performs no command and creates no journal', () => { const f = fixture(); try { const t = transport(f); assert.throws(() => B.build({}, options(f, t)), /APPROVAL/); assert.equal(t.calls.length, 0); assert.ok(!fs.existsSync(f.directory)); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('local Docker failure, foreign endpoint and dirty Git precede ALL provider calls and consumption', () => {
  for (const mode of ['bad-local', 'remote-node', 'dirty', 'foreign-driver', 'stopped', 'arm-only']) { const f = fixture(); try { const t = transport(f, mode); assert.throws(() => B.build(approval(), options(f, t))); assert.ok(!t.calls.some(x => x.exe === 'aws')); assert.ok(!fs.existsSync(f.directory)); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } }
});
test('local-only entry makes no provider request or journal', () => { const f = fixture(); try { const t = transport(f); const r = L.localCheck(options(f, t)); assert.equal(r.providerCalls, 0); assert.ok(!t.calls.some(x => x.exe === 'aws')); assert.ok(!fs.existsSync(f.directory)); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
for (const mode of ['', 'docker-driver', 'nested-name', 'collision', 'unknown-tag', 'wrong-caller', 'build-unknown', 'bad-index']) test('bounded one-use result: ' + (mode || 'published'), () => {
  const f = fixture(); try {
    const t = transport(f, mode), r = B.build(approval(), options(f, t));
    assert.equal(r.status, ['', 'docker-driver', 'nested-name'].includes(mode) ? 'CLOSED_API_IMAGE_PUBLISHED_NO_DEPLOYMENT' : 'CLOSED_HOLD');
    assert.equal(r.builds, ['', 'docker-driver', 'nested-name', 'build-unknown', 'bad-index'].includes(mode) ? 1 : 0);
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
