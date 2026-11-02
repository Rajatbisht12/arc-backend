'use strict';
// Local source materialization only. No Docker, AWS, credentials or deployment.
const fs = require('node:fs');
const path = require('node:path');
const { verify, sha } = require('../release-tools/background-post-image-r1/verify.cjs');
const root = path.resolve(__dirname, '..');
const pins = require('./story-overlays-api-source.json');

function prepare(output) {
  if (!output) throw Error('OUTPUT_DIRECTORY_REQUIRED');
  const target = path.resolve(output);
  if (fs.existsSync(target)) throw Error('OUTPUT_ALREADY_EXISTS');
  const { records } = verify({ sourceArchiveSha256: pins.parentArchiveSha256, sourceContentSha256: pins.parentSourceSha256 });
  const parent = JSON.parse(records.get('.source-manifest.json'));
  records.delete('.source-manifest.json');
  for (const file of pins.changes) {
    const original = records.get(file.path);
    const updated = fs.readFileSync(path.join(root, file.path));
    if (!original || sha(original) !== file.beforeSha256 || sha(updated) !== file.afterSha256) throw Error('STORY_SOURCE_PIN_MISMATCH: ' + file.path);
    records.set(file.path, updated);
  }
  const files = [...records].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => ({ path: name, sha256: sha(bytes), bytes: bytes.length }));
  const changed = files.filter(file => parent.files.find(old => old.path === file.path)?.sha256 !== file.sha256).map(file => file.path).sort();
  if (files.length !== parent.files.length || JSON.stringify(changed) !== JSON.stringify(pins.changes.map(f => f.path).sort())) throw Error('UNRELATED_SOURCE_CHANGE');
  const manifest = { kind: 'STORY_OVERLAYS_V2_API_SOURCE_NOT_PUBLISHED', parentSourceSha256: pins.parentSourceSha256, sourceContentSha256: sha(JSON.stringify(files)), files, changedPaths: changed };
  if (manifest.sourceContentSha256 !== pins.sourceContentSha256) throw Error('SOURCE_MANIFEST_MISMATCH');
  records.set('.source-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  // All input bytes are validated before creating any output directory.
  fs.mkdirSync(target, { recursive: false });
  for (const [name, bytes] of records) {
    const dest = path.join(target, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes, { flag: 'wx' });
  }
  return { output: target, sourceContentSha256: manifest.sourceContentSha256, changedPaths: changed, providerCalls: 0, builds: 0 };
}
module.exports = { prepare };
if (require.main === module) console.log(JSON.stringify(prepare(process.argv[2]), null, 2));
