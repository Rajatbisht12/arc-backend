'use strict';
const check=(v,c)=>{if(!v)throw Error(c);};
function qualify(envelopes,bindings){
 check(bindings?.length===2&&new Set(bindings.map(x=>x.taskArn)).size===2&&new Set(bindings.map(x=>x.sourceReference)).size===2,'TWO_DISTINCT_BINDINGS');
 const groups=new Map();
 for(const e of envelopes){
  check(Number.isFinite(e.sentAt)&&Number.isFinite(e.receivedAt)&&e.receivedAt>=e.sentAt&&e.receivedAt-e.sentAt<=1000,'OBSERVER_RTT_BOUND');
  const s=e.body,w=s.witness,b=bindings.find(x=>x.taskArn===s.taskArn);
  check(b&&s.containerId===b.containerId&&s.instanceId===b.instanceId&&s.state==='OPEN'&&s.intake.activeJobs===1&&s.claim.owned===true&&s.claim.lockTtlMs>0&&s.protection.protected===true&&!s.protection.unsafe&&s.protection.taskArn===s.taskArn,'EXACT_OWNED_ACTIVE_PROTECTED_TASK');
  check(w.qualified&&w.taskArn===s.taskArn&&w.containerId===s.containerId&&w.instanceId===s.instanceId&&w.activeFfmpeg===1,'EXACT_WITNESS_PROVENANCE');
  const live=w.processes.filter(x=>!x.ended);check(live.length===1,'ONE_FFMPEG_PER_TASK');const r=live[0];
  check(r.sourceReference===b.sourceReference&&r.jobReference===b.jobReference&&r.sourceReference===s.claim.sourceReference&&r.jobReference===s.claim.jobReference&&Number.isSafeInteger(r.pid)&&r.pid>0,'PROCESS_SOURCE_CLAIM_BINDING');
  const key=s.taskArn+'|'+r.processReference,g=groups.get(key)||{taskArn:s.taskArn,sourceReference:r.sourceReference,pid:r.pid,instanceId:s.instanceId,points:new Map()};
  check(g.pid===r.pid&&g.instanceId===s.instanceId,'PROCESS_REPLACEMENT');
  for(const p of r.points){const age=w.monotonicMs-p.mono;if(!Number.isFinite(age)||age<0||age>2000)continue;
   check(Number.isSafeInteger(p.sequence)&&Number.isSafeInteger(p.frame)&&p.frame>=0&&Number.isFinite(p.encodedSeconds)&&p.encodedSeconds>=0,'TYPED_PROGRESS');
   const x={...p,lower:e.sentAt-age,upper:e.receivedAt-age};const old=g.points.get(p.sequence);if(old)check(old.frame===p.frame&&old.encodedSeconds===p.encodedSeconds&&old.mono===p.mono,'ALTERED_WITNESS');else g.points.set(p.sequence,x);
  }groups.set(key,g);
 }
 const intervals=[];for(const g of groups.values()){
  const p=[...g.points.values()].sort((a,b)=>a.sequence-b.sequence);for(let i=1;i<p.length;i++)check(p[i].mono>p[i-1].mono&&p[i].frame>=p[i-1].frame&&p[i].encodedSeconds>=p[i-1].encodedSeconds&&(p[i].frame>p[i-1].frame||p[i].encodedSeconds>p[i-1].encodedSeconds),'PROGRESS_REGRESSION');
  const first=p.find(x=>x.frame>0||x.encodedSeconds>0),last=p.at(-1);if(!first||!last||last.sequence===first.sequence)continue;
  if(last.frame<=first.frame&&last.encodedSeconds<=first.encodedSeconds)continue;
  intervals.push({taskArn:g.taskArn,sourceReference:g.sourceReference,start:first.upper,end:last.lower});
 }
 let overlap=-Infinity;for(const a of intervals)for(const b of intervals)if(a.taskArn!==b.taskArn)overlap=Math.max(overlap,Math.min(a.end,b.end)-Math.max(a.start,b.start));
 check(overlap>2000,'NO_STRICT_TWO_SECOND_CONSERVATIVE_PROGRESS_OVERLAP');
 return{qualified:true,conservativeOverlapMs:overlap,intervals,scope:'bounded progress witnesses of the same live owned child; not CPU scheduling simultaneity or HLS output proof'};
}
module.exports={qualify};
