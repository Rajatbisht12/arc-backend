'use strict';
// Dedicated read-only collector. Do not import BullMQ Queue/Worker or scheduler.
const { createHash } = require('node:crypto');
const PREFIX='bull:clip-video:',STATES=Object.freeze({wait:'list',paused:'list',active:'list',delayed:'zset',prioritized:'zset','waiting-children':'zset'});
const check=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code});};
const signature=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function response(rows){check(Array.isArray(rows)&&rows.every(r=>Array.isArray(r)&&r.length===2&&!r[0]),'METRICS_READ_FAILED');return rows.map(r=>r[1]);}
async function membership(redis,limit){
 const batch=redis.multi();for(const[state,type]of Object.entries(STATES)){batch.type(PREFIX+state);if(type==='list')batch.lrange(PREFIX+state,0,limit);else batch.zrange(PREFIX+state,0,limit);}batch.type(PREFIX+'meta');batch.hget(PREFIX+'meta','paused');
 const r=response(await batch.exec()),out={};let n=0;for(const[state,type]of Object.entries(STATES)){const observedType=r[n++],ids=r[n++];check(observedType==='none'||observedType===type,'METRICS_QUEUE_KEY_TYPE');check(Array.isArray(ids)&&ids.length<=limit&&ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=512),'METRICS_INVENTORY_BOUND');out[state]=ids;}
 check(['none','hash'].includes(r[n++]),'METRICS_META_KEY_TYPE');const flag=r[n];check(flag===null||flag==='1','METRICS_PAUSE_STATE');out.queuePaused=flag==='1';check(out.queuePaused?out.wait.length===0:out.paused.length===0,'METRICS_PAUSE_MEMBERSHIP_INCONSISTENT');
 const all=Object.keys(STATES).flatMap(k=>out[k]);check(new Set(all).size===all.length,'METRICS_DUPLICATE_MEMBERSHIP');return out;
}
async function readVideoQueueMetrics(redis,{now=Date.now,maximumJobsPerState=1000,maximumReadMs=2000}={}){
 check(Number.isInteger(maximumJobsPerState)&&maximumJobsPerState>=1&&maximumJobsPerState<=1000,'METRICS_READER_BOUND');const started=now(),first=await membership(redis,maximumJobsPerState);
 const waiting=['wait','paused','delayed','prioritized','waiting-children'].flatMap(k=>first[k]);let times=[];
 if(waiting.length){const batch=redis.multi();for(const id of waiting){batch.type(PREFIX+id);batch.hget(PREFIX+id,'timestamp');}const rows=response(await batch.exec());for(let i=0;i<rows.length;i+=2){check(rows[i]==='hash','METRICS_JOB_HASH_MISSING');const t=Number(rows[i+1]);check(rows[i+1]!==null&&Number.isFinite(t)&&t>0&&t<=now()+1000,'METRICS_JOB_TIMESTAMP_INVALID');times.push(t);}}
 const last=await membership(redis,maximumJobsPerState),checkedAt=now();check(checkedAt>=started&&checkedAt-started<=maximumReadMs,'METRICS_READ_TOO_SLOW');check(signature(first)===signature(last),'METRICS_MEMBERSHIP_CHANGED');
 const waitingJobs=waiting.length,activeJobs=last.active.length,oldestQueuedAgeSeconds=times.length?Math.floor(Math.max(0,checkedAt-Math.min(...times))/1000):0;return{event:'video_queue_metrics_v1',checkedAt:new Date(checkedAt).toISOString(),readDurationMs:checkedAt-started,queue:'clip-video',waitingJobs,activeJobs,delayedRetryJobs:last.delayed.length,prioritizedJobs:last.prioritized.length,waitingChildrenJobs:last['waiting-children'].length,outstandingJobs:waitingJobs+activeJobs,oldestQueuedAgeSeconds,queuePaused:last.queuePaused?1:0,collectorHealthy:1,...(!last.queuePaused?{scaleOutOutstandingJobs:waitingJobs+activeJobs,scaleOutOldestQueuedAgeSeconds:oldestQueuedAgeSeconds}:{}),source:'DIRECT_REDIS_READONLY_NO_QUEUE_CONSTRUCTOR',nativeReadOnly:true,applicationWrites:0,queueWrites:0};
}
module.exports={readVideoQueueMetrics};
