const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FFMPEG_TIMEOUT_MS, STORY_MAX_SECONDS } = require('./videoProcessing');

const source = fs.readFileSync(path.join(__dirname, 'videoProcessing.js'), 'utf8');
const postController = fs.readFileSync(path.join(__dirname, '../controllers/postController.js'), 'utf8');
assert.equal(STORY_MAX_SECONDS, 30);
assert.ok(FFMPEG_TIMEOUT_MS > 0 && FFMPEG_TIMEOUT_MS <= 120_000);
assert.match(source, /MAX_FFMPEG_STDERR_BYTES/);
assert.match(source, /child\.kill\('SIGKILL'\)/);
assert.match(source, /'-nostdin'/);
assert.match(source, /'-threads', '2'/);
const postFastStart = source.slice(source.indexOf('const processPostVideo'), source.indexOf('module.exports'));
assert.match(postFastStart, /'-c', 'copy'/);
assert.match(postFastStart, /'-movflags', '\+faststart'/);
assert.match(postFastStart, /mimetype[^\n]+!== 'video\/mp4'/);
assert.match(postController, /processPostVideo\(file\)/);
assert.match(postController, /uploadMultipleFiles\(startupOptimizedMedia, 'gaming-social\/posts'\)/);

console.log('Video processing resource-bound contracts passed');
