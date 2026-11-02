'use strict';
const fs = require('node:fs');
const path = require('node:path');
const V = require('../all-user-admission-api-r1/verify.cjs');
const CHANGED = 'src/config/secrets.ts';
const BEFORE = "process.env.POST_VIDEO_BACKGROUND_PUBLISH_ENABLED !== 'false'";
const AFTER = "!['true', 'false'].includes(process.env.POST_VIDEO_BACKGROUND_PUBLISH_ENABLED || '')";
function candidate() {
  const original = V.verify();
  const records = new Map(original.records);
  const parent = JSON.parse(records.get('.source-manifest.json'));
  records.delete('.source-manifest.json');
  const before = records.get(CHANGED);
  const expected = before.toString('utf8').replace(BEFORE, AFTER);
  const after = fs.readFileSync(path.join(__dirname, 'overrides', CHANGED));
  if (before.toString('utf8').split(BEFORE).length !== 2 || !after.equals(Buffer.from(expected))) {
    throw Error('EXACT_SINGLE_BOOTSTRAP_CORRECTION_REQUIRED');
  }
  records.set(CHANGED, after);
  const files = [...records].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => ({ path: name, sha256: V.sha(bytes), bytes: bytes.length }));
  const changed = files.filter(file => parent.files.find(old => old.path === file.path)?.sha256 !== file.sha256);
  if (files.length !== 759 || changed.length !== 1 || changed[0].path !== CHANGED) throw Error('UNRELATED_SOURCE_CHANGE');
  const manifest = {
    kind: 'BACKGROUND_POST_BOOTSTRAP_SOURCE_NOT_BUILT',
    parentPublishedSource: parent.sourceContentSha256,
    sourceContentSha256: V.sha(JSON.stringify(files)),
    files
  };
  records.set('.source-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  return { records, manifest, change: { path: CHANGED, beforeSha256: V.sha(before), afterSha256: V.sha(after), onlyExplicitTaskBooleanAdded: true } };
}
module.exports = { candidate };
if (require.main === module) {
  const c = candidate();
  console.log(JSON.stringify({ sourceContentSha256: c.manifest.sourceContentSha256, sourceFiles: c.manifest.files.length, change: c.change, builds: 0, providerCalls: 0 }));
}
