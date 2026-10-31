'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {createHash,randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const context=new AsyncLocalStorage(), records=new Map();
let identity=null, qualified=true;
const digest=x=>createHash('sha256').update(String(x)).digest('hex');
function configure(task){
 if(identity||!/^arn:aws:ecs:us-east-1:906446637180:task\/arc-cluster\/[a-f0-9]{32}$/.test(task?.taskArn)||!task.containerId||task.containerName!=='video-worker')throw Error('WITNESS_TASK_BINDING');
 identity={taskArn:task.taskArn,containerName:task.containerName,containerId:task.containerId,instanceId:randomUUID()};return{...identity};
}
function withJob(job,fn){
 if(!identity||!job.jobId)return fn();
 return context.run({sourceReference:/^[a-f0-9]{24}$/.test(String(job.sessionId||''))?digest(job.sessionId):null,jobReference:digest(job.jobId)},fn);
}
function begin(child){
 if(!identity||!context.getStore())return null;
 try{
  for(const[key,r]of records)if(r.ended&&performance.now()-r.lastMono>30000)records.delete(key);
  if(records.size>=16){const old=[...records].find(([,r])=>r.ended);if(!old)throw Error();records.delete(old[0]);}
  if([...records.values()].some(x=>!x.ended))throw Error();
  const key=randomUUID(),r={...context.getStore(),processReference:key,pid:child.pid||null,startedAt:Date.now(),startedMono:performance.now(),lastMono:performance.now(),ended:false,points:[]};records.set(key,r);
  child.once('close',()=>{r.ended=true;r.lastMono=performance.now();});
  return key;
 }catch{qualified=false;return null;}
}
function progress(key,p){
 if(!key)return;
 try{const r=records.get(key);if(!r||r.ended||!Number.isSafeInteger(p.frame)||p.frame<0||!Number.isFinite(p.encodedSeconds)||p.encodedSeconds<0)throw Error();
  const prior=r.points.at(-1);if(prior&&(p.frame<prior.frame||p.encodedSeconds<prior.encodedSeconds))throw Error();
  const mono=performance.now();r.points.push({sequence:(prior?.sequence||0)+1,at:Date.now(),mono,frame:p.frame,encodedSeconds:p.encodedSeconds});if(r.points.length>16)r.points.shift();r.lastMono=mono;
 }catch{qualified=false;}
}
function snapshot(){return{...identity,qualified,observedAt:Date.now(),monotonicMs:performance.now(),activeFfmpeg:[...records.values()].filter(x=>!x.ended).length,processes:[...records.values()].map(r=>({...r,points:r.points.map(x=>({...x}))}))};}
module.exports={configure,withJob,begin,progress,snapshot,enabled:()=>Boolean(identity&&context.getStore())};
