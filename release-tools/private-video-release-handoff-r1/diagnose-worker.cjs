'use strict';
// Read-only local diagnostics: no provider, build or checkout mutation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = path.resolve(__dirname, '../legacy-private-video-release-r1');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
try {
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'build-plan.json')));
  if (sha(JSON.stringify(plan)) !== 'c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130') throw Error('PLAN_CHANGED');
  const controls = plan.controls.map(pin => {
    const bytes = fs.readFileSync(path.join(dir, pin.path));
    return { path: pin.path, bytesMatch: sha(bytes) === pin.sha256,
      lfMatches: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) === pin.sha256 };
  });
  const zipMatches = sha(fs.readFileSync(path.join(dir, 'release/worker-format-r1/source.zip'))) === '95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee';
  const verdict = !zipMatches || controls.some(p => !p.lfMatches) ? 'CONTENT_CHANGED_STOP' : controls.every(p => p.bytesMatch) ? 'EXACT_BYTES_MATCH' : 'CRLF_ONLY_CONFIRMED_NO_BUILD';
  console.log(JSON.stringify({ verdict, planMatches: true, controls, zipMatches, providerCalls: 0, builds: 0 }, null, 2));
} catch { console.error('LOCAL_DIAGNOSTIC_INPUT_CHANGED_STOP'); process.exitCode = 1; }
