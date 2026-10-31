'use strict';
const {randomBytes}=require('node:crypto');
const {canonical}=require('./overlay/src/legacy-src/utils/videoWorkerControl');
const {qualify}=require('./progress-proof.cjs');
const check=(x,c)=>{if(!x)throw Error(c);};
async function rawSample(target,{sign,request=fetch,now=Date.now}={}){
 const u=new URL(target.origin);check(require('node:net').isIP(u.hostname)===4&&/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.0\.0\.1$)/.test(u.hostname)&&['http:','https:'].includes(u.protocol)&&u.origin===target.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&target.networkIdentityQualified===true,'BOUND_PRIVATE_TASK_TRANSPORT_REQUIRED');
 check(target.taskArn&&target.containerId&&target.instanceId&&target.owner&&target.runId,'TARGET_BINDING_REQUIRED');
 const at=now(),body={version:1,owner:target.owner,runId:target.runId,taskArn:target.taskArn,containerId:target.containerId,instanceId:target.instanceId,action:'OBSERVE',issuedAt:at,expiresAt:at+5000,nonce:randomBytes(16).toString('hex')};body.signature=await sign(Buffer.from(canonical(body)));
 const sentAt=now(),response=await request(target.origin+'/control',{method:'POST',redirect:'error',signal:AbortSignal.timeout(1000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 check(response.status===200&&response.url!==undefined,'OBSERVER_RESPONSE');
 const reader=response.body.getReader();let bytes=0;const chunks=[];
 try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;check(bytes<=32768,'OBSERVER_RESPONSE_BOUND');chunks.push(Buffer.from(r.value));}}catch{await reader.cancel().catch(()=>{});throw Error('OBSERVER_RESPONSE_HELD');}
 const receivedAt=now();check(receivedAt-sentAt<=1000,'OBSERVER_DEADLINE');const value=JSON.parse(Buffer.concat(chunks).toString());
 const allowed=new Set(['taskArn','containerName','containerId','instanceId','owner','runId','state','intake','consumerClosed','releaseAttempted','protection','witness','claim']);check(Object.keys(value).every(k=>allowed.has(k))&&value.taskArn===target.taskArn&&value.containerId===target.containerId&&value.instanceId===target.instanceId&&value.owner===target.owner&&value.runId===target.runId,'OBSERVER_IDENTITY_OR_FIELDS');
 validate(value);return{sentAt,receivedAt,body:value};
}
function validate(v){
 const keys=(x,names)=>check(x&&Object.keys(x).every(k=>names.includes(k)),'OBSERVER_PRIVATE_OR_UNKNOWN_FIELD');
 keys(v.intake,['started','running','closing','fatal','held','redisReady','reason','activeJobs','live','ready']);
 keys(v.protection,['taskArn','protected','expiresAt','checkedAt','unsafe','code','released','releasing']);
 keys(v.claim,['owned','observedAt','jobReference','sourceReference','lockTtlMs']);
 keys(v.witness,['taskArn','containerName','containerId','instanceId','qualified','observedAt','monotonicMs','activeFfmpeg','processes']);
 check(['BOOTSTRAPPING','REDIS_UNAVAILABLE','WORKER_PROCESS_FAILED','DRAINING','INTAKE_OR_PROTECTION_NOT_CURRENT','INTAKE_PROBE_EXCEPTION','SHUTDOWN_PROTECTION_UNRESOLVED','OWNED_DRAIN_UNRESOLVED','PROTECTION_NEAR_EXPIRY_HOLD_SCALE_IN','PROTECTION_RENEWAL_UNKNOWN_HOLD_SCALE_IN','PROTECTION_RENEWAL_EXCEPTION'].includes(v.intake.reason),'OBSERVER_REASON_UNKNOWN');
 check(['VERIFIED','INITIAL_PROTECTION_UNVERIFIED','PROTECTION_NEAR_EXPIRY_HOLD_SCALE_IN','PROTECTION_RENEWAL_UNKNOWN_HOLD_SCALE_IN','PROTECTION_RENEWAL_EXCEPTION','PROTECTION_RELEASE_UNRESOLVED'].includes(v.protection.code),'OBSERVER_PROTECTION_CODE_UNKNOWN');
 check(Array.isArray(v.witness.processes)&&v.witness.processes.length<=16,'OBSERVER_PROCESS_BOUND');
 for(const r of v.witness.processes){keys(r,['sourceReference','jobReference','processReference','pid','startedAt','startedMono','lastMono','ended','points']);check(r.sourceReference===null||/^[a-f0-9]{64}$/.test(r.sourceReference),'SOURCE_HASH_ONLY');check(/^[a-f0-9]{64}$/.test(r.jobReference)&&/^[a-f0-9-]{36}$/.test(r.processReference),'PROCESS_BINDING_SHAPE');check(Array.isArray(r.points)&&r.points.length<=16,'POINT_BOUND');for(const p of r.points)keys(p,['sequence','at','mono','frame','encodedSeconds']);}
}
async function sample(...args){try{return await rawSample(...args);}catch{throw Error('OBSERVER_READ_HELD');}}
async function collect(targets,options){
 check(targets?.length===2&&Number.isInteger(options.maximumPolls)&&options.maximumPolls>=2&&options.maximumPolls<=20,'OBSERVER_POLL_BOUND');const samples=[];
 const started=Date.now();for(let i=0;i<options.maximumPolls;i++){check(Date.now()-started<30000,'OBSERVER_TOTAL_DEADLINE');samples.push(...await Promise.all(targets.map(t=>sample(t,options))));if(i+1<options.maximumPolls)await new Promise(r=>setTimeout(r,500));}
 return qualify(samples,targets);
}
module.exports={sample,collect,validate};
