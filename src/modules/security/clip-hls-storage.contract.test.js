const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storage = fs.readFileSync(path.resolve(__dirname, '../../infrastructure/storage/s3.ts'), 'utf8');
const cors = fs.readFileSync(path.resolve(__dirname, '../../../scripts/configure-clip-hls-cors.js'), 'utf8');
const s3Policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../s3policy.json'), 'utf8'));

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
const clipListStatement = s3Policy.Statement.find(statement => (
  statement.Action === 's3:ListBucket'
  || (Array.isArray(statement.Action) && statement.Action.includes('s3:ListBucket'))
));
assert.ok(clipListStatement, 'HLS workers must be able to list the publication prefix before retry cleanup');
assert.equal(clipListStatement.Resource, 'arn:aws:s3:::arc-gaming-media-906446637180');
assert.equal(clipListStatement.Condition?.StringLike?.['s3:prefix'], 'gaming-social/clips/*');

console.log('Clip HLS storage and CORS contracts passed');
