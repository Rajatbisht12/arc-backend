const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.resolve(__dirname, '../../../scripts/configure-clip-cloudfront.js'), 'utf8');
const dto = fs.readFileSync(path.resolve(__dirname, '../../legacy-src/utils/dto.js'), 'utf8');
const delivery = fs.readFileSync(path.resolve(__dirname, '../../legacy-src/utils/mediaDelivery.js'), 'utf8');

assert.match(script, /Use only one of --apply, --verify, or --activate-ecs/);
assert.match(script, /658327ea-f89d-4fab-a63d-7e88639e58f6/);
assert.match(script, /88a5eaf4-2fd4-4709-b370-b4c650ea3fcf/);
assert.match(script, /no query strings\/cookies\/headers in the key/);
assert.match(script, /OriginAccessControlOriginType: 's3'/);
assert.match(script, /SigningBehavior: 'always'/);
assert.match(script, /ViewerProtocolPolicy: 'redirect-to-https'/);
assert.match(script, /Items: \['GET', 'HEAD', 'OPTIONS'\]/);
assert.match(script, /Accept-Ranges, Content-Length, Content-Range/);
assert.match(script, /result\.status !== 206/);
assert.match(script, /Disallowed origin received CORS access/);
assert.match(script, /CloudFront CORS preflight failed/);
assert.match(script, /AllowSquadHuntClipCloudFrontRead/);
assert.match(script, /publicBucketCompatibilityRetained: true/);
assert.match(script, /update-distribution/);
assert.match(script, /originHeaderInCacheKey: false/);
assert.match(script, /cloudfront-js-2\.0/);
assert.match(script, /EventType: 'viewer-response'/);
assert.match(script, /allowedOrigins/);
assert.match(script, /delete response\.headers\['access-control-allow-origin'\]/);
assert.match(script, /response\.headers\['accept-ranges'\] = \{ value: 'bytes' \}/);
assert.match(script, /state\.distribution\.Status !== 'Deployed'/);
assert.match(script, /activateEcsService/);
assert.match(dto, /rewritePostMediaDeliveryUrls\(dto\)/);
assert.match(delivery, /parsed\.search \|\| parsed\.hash/);
assert.match(delivery, /PUBLIC_CLIP_MEDIA_PREFIXES/);

console.log('Clip CloudFront infrastructure contracts passed');
