const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FFMPEG_TIMEOUT_MS, STORY_MAX_SECONDS } = require('./videoProcessing');

const source = fs.readFileSync(path.join(__dirname, 'videoProcessing.js'), 'utf8');
assert.equal(STORY_MAX_SECONDS, 30);
assert.ok(FFMPEG_TIMEOUT_MS > 0 && FFMPEG_TIMEOUT_MS <= 120_000);
assert.match(source, /MAX_FFMPEG_STDERR_BYTES/);
assert.match(source, /child\.kill\('SIGKILL'\)/);
assert.match(source, /'-nostdin'/);
assert.match(source, /'-threads', '2'/);

console.log('Video processing resource-bound contracts passed');
