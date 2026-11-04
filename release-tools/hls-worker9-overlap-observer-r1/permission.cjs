'use strict';
const C=require('./protocol.cjs');
function policy(mode){C.check(Object.hasOwn(C.MODES,mode),'EXACT_MODE');const p='protected-worker-control/'+C.MODES[mode]+'/',arn='arn:aws:s3:::'+C.BUCKET;return{Version:'2012-10-17',Statement:[{Sid:'OnlyExactRunCommandPresence',Effect:'Allow',Action:'s3:ListBucket',Resource:arn,Condition:{StringLike:{'s3:prefix':p+'commands/*.json'},NumericLessThanEquals:{'s3:max-keys':1}}},{Sid:'OnlyExactRunCommandRead',Effect:'Allow',Action:'s3:GetObject',Resource:arn+'/'+p+'commands/*.json'},{Sid:'OnlyEncryptedFreshRunRequests',Effect:'Allow',Action:'s3:PutObject',Resource:arn+'/'+p+'requests/*.json',Condition:{StringEquals:{'s3:x-amz-server-side-encryption':'AES256'}}}]};}
module.exports={policy};
