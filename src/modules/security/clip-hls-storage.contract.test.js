const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storage = fs.readFileSync(path.resolve(__dirname, '../../infrastructure/storage/s3.ts'), 'utf8');
const cors = fs.readFileSync(path.resolve(__dirname, '../../../scripts/configure-clip-hls-cors.js'), 'utf8');

assert.match(storage, /extension === "m3u8".*application\/vnd\.apple\.mpegurl/);
assert.match(storage, /extension === "m4s".*video\/iso\.segment/);
assert.match(storage, /max-age=31536000, immutable/);
assert.match(storage, /AWS_S3_CDN_URL/);
assert.match(storage, /createReadStream\(sourcePath\)/);
assert.match(storage, /pipeline\(response\.Body as Readable/);
assert.match(cors, /AllowedMethods: \['GET', 'HEAD'\]/);
assert.match(cors, /'Content-Range'/);
assert.match(cors, /'https:\/\/squadhunt\.com'/);
assert.match(cors, /'https:\/\/www\.squadhunt\.com'/);
assert.match(cors, /rules\.filter\(rule => rule\.ID !== ruleId\)/);

console.log('Clip HLS storage and CORS contracts passed');
