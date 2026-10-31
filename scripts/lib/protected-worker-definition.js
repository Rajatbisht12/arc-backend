'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const check=(x,c)=>{if(!x)throw Error(c);};
const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'../../release/worker-r4/baseline-worker7.json')));
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(sort(x))).digest('hex');
function prepare(actual,image,binding){
 check(sha(actual)===sha(baseline),'EXACT_WORKER7_BASELINE_REQUIRED');
 check(image?.startsWith('906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend@sha256:')&&/sha256:[a-f0-9]{64}$/.test(image),'OBSERVED_IMMUTABLE_IMAGE_REQUIRED');
 check(/^[a-z0-9-]{8,80}$/.test(binding?.owner||'')&&/^[a-z0-9-]{8,80}$/.test(binding?.runId||''),'OWNED_WORKER_REVIEW_REQUIRED');
 check(crypto.createPublicKey(binding.publicKeyPem).asymmetricKeyType==='ed25519','REVIEWED_PUBLIC_CONTROL_KEY_REQUIRED');
 const td=JSON.parse(JSON.stringify(actual));check(td.containerDefinitions.length===1&&td.containerDefinitions[0].name==='video-worker','WORKER_CONTAINER_REQUIRED');const c=td.containerDefinitions[0];
 const names=[...(c.environment||[]).map(x=>x.name),...(c.secrets||[]).map(x=>x.name)];check(new Set(names).size===names.length,'DUPLICATE_CONFIG');
 check(!c.secrets.some(x=>x.valueFrom.includes('play-integrity-verifier')),'NO_WORKER_VERIFIER_SECRET');
 const env=Object.fromEntries(c.environment.map(x=>[x.name,x.value]));check(env.CLIP_HLS_ENABLED==='true'&&env.CLIP_HLS_WORKER_CONCURRENCY==='1'&&env.POST_VIDEO_PRIVATE_DELIVERY_ENABLED==='true'&&env.POST_VIDEO_FAIR_SCHEDULING_ENABLED==='false','DEDICATED_PRIVATE_SINGLE_JOB_TOPOLOGY_REQUIRED');
 const changes={VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED:'true',VIDEO_WORKER_R4_CONTROL_ENABLED:'true',VIDEO_WORKER_EXPECTED_SERVICE:'squadhunt-prod-video-worker-Service-5bK8EbU7Uwmj',VIDEO_WORKER_EXPECTED_FAMILY:td.family,VIDEO_WORKER_CONTROL_OWNER:binding.owner,VIDEO_WORKER_CONTROL_RUN_ID:binding.runId,VIDEO_WORKER_CONTROL_PUBLIC_KEY_PEM:binding.publicKeyPem};
 check(!c.secrets.some(x=>Object.hasOwn(changes,x.name)),'CONTROL_SECRET_SHADOW');
 for(const[name,value]of Object.entries(changes)){const row=c.environment.find(x=>x.name===name);if(row)row.value=value;else c.environment.push({name,value});}c.image=image;
 for(const k of ['taskDefinitionArn','revision','status','requiresAttributes','compatibilities','registeredAt','registeredBy'])delete td[k];
 return td;
}
module.exports={prepare};
