'use strict';
const crypto=require('crypto');
const RUN='hls-worker9-overlap-precheck-r1-20261105';
const check=(v,c)=>{if(!v)throw Error(c);};
const canon=v=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const LIMITS={pending:40,bytes:10737418240,workSeconds:14400,unknownWorkSeconds:1800,ownerSessions:5,ownerBytes:1073741824,queueDepth:40,queueAgeSeconds:300,telemetryMs:20000};
const TARGET={taskArn:'arn:aws:ecs:us-east-1:906446637180:task/arc-cluster/4fd72ef9ca7443fd8fd2e287a3ff7462',containerId:'4fd72ef9ca7443fd8fd2e287a3ff7462-0704215929',instanceId:'8090ffbe-a256-4347-8314-d3ba1eef1624',owner:'squadhunt-worker-rollout-r2',runId:'pi-worker-rollout-r2-20261101'};
const ORIGIN_SHA='b8129c7e48b8372c3499eaedce9d52feaec0dbad511ef325681b008c1f291c12';
function ledger(d,at){
 check(d&&Buffer.byteLength(JSON.stringify(d))<=65536,'LEDGER_BOUND');
 check(Object.keys(d).sort().join()===['_id','version','limits','revision','reservations','owners','count','bytes','workSeconds','admissionOpen','costOpen','costUntil','reviewReference','telemetryValid','telemetryAt','oldestQueuedAgeSeconds','queueOutstanding'].sort().join(),'LEDGER_SCHEMA_DRIFT');
 check(d._id==='video-global-admission:v1'&&d.version===1&&hash(d.limits)===hash(LIMITS)&&Number.isSafeInteger(d.revision)&&d.revision>=0&&Array.isArray(d.reservations)&&d.reservations.length<=40&&d.owners&&typeof d.owners==='object'&&!Array.isArray(d.owners),'LEDGER_CONFIGURATION_DRIFT');
 const owners={},ids=new Set(),clients=new Set();let bytes=0,work=0;
 for(const r of d.reservations){
  check(Object.keys(r).every(k=>['owner','sessionId','clientUploadId','bytes','workSeconds','reservedAt','manualHold'].includes(k))&&/^[a-f0-9]{24}$/.test(r.owner)&&/^[a-f0-9]{24}$/.test(r.sessionId)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(r.clientUploadId||'')&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=524288000&&r.workSeconds===1800&&(r.manualHold===undefined||r.manualHold===true)&&Number.isFinite(new Date(r.reservedAt).getTime()),'RESERVATION_SCHEMA_DRIFT');
  const client=r.owner+':'+r.clientUploadId;check(!ids.has(r.sessionId)&&!clients.has(client),'RESERVATION_DUPLICATE');ids.add(r.sessionId);clients.add(client);bytes+=r.bytes;work+=r.workSeconds;const o=owners[r.owner]||={count:0,bytes:0};o.count++;o.bytes+=r.bytes;
 }
 check(d.count===ids.size&&d.bytes===bytes&&d.workSeconds===work&&bytes<=LIMITS.bytes&&work<=14400,'LEDGER_COUNTER_DRIFT');
 for(const[k,o]of Object.entries(d.owners)){check(/^[a-f0-9]{24}$/.test(k)&&o&&Object.keys(o).sort().join()==='bytes,count'&&Number.isSafeInteger(o.count)&&o.count>=0&&o.count<=5&&Number.isSafeInteger(o.bytes)&&o.bytes>=0&&o.bytes<=LIMITS.ownerBytes&&(owners[k]?hash(owners[k])===hash(o):o.count===0&&o.bytes===0),'OWNER_COUNTER_DRIFT');}
 check(Object.keys(owners).every(k=>hash(owners[k])===hash(d.owners[k])),'OWNER_COUNTER_DRIFT');
 const holds=d.reservations.filter(r=>r.manualHold===true);check(holds.length===1&&hash(['source',holds[0].sessionId])==='05f7ae3167804f9155bbfd4fb68b3672b797e5989deb2dc2e84f2c15e1193104'&&holds[0].bytes===28834951&&holds[0].workSeconds===1800&&new Date(holds[0].reservedAt).getTime()===0,'HISTORICAL_MANUAL_HOLD_DRIFT');
 const telemetryAt=new Date(d.telemetryAt).getTime(),costUntil=new Date(d.costUntil).getTime();
 check(['admissionOpen','costOpen','telemetryValid'].every(k=>typeof d[k]==='boolean')&&Number.isFinite(telemetryAt)&&Number.isFinite(costUntil)&&/^[a-f0-9]{64}$/.test(d.reviewReference||'')&&(d.queueOutstanding===null||Number.isSafeInteger(d.queueOutstanding)&&d.queueOutstanding>=0)&&(d.oldestQueuedAgeSeconds===null||Number.isFinite(d.oldestQueuedAgeSeconds)&&d.oldestQueuedAgeSeconds>=0),'LEDGER_GATE_SCHEMA');
 const fresh=d.telemetryValid&&telemetryAt<=at&&at-telemetryAt<=20000;
 return{observedAt:at,documentSha256:hash(d),limitsSha256:hash(d.limits),revision:d.revision,count:d.count,bytes,workSeconds:work,manualHoldCount:1,manualHoldWorkSeconds:1800,manualHoldPreserved:true,admissionOpen:d.admissionOpen,costOpen:d.costOpen,costUntil,telemetryAt,telemetryAgeMs:at-telemetryAt,telemetryValid:d.telemetryValid,telemetryFresh:fresh,queueOutstanding:d.queueOutstanding,oldestQueuedAgeSeconds:d.oldestQueuedAgeSeconds,twoGlobalReservationSlotsAvailable:d.count+2<=40&&work+3600<=14400,admissionCurrentlyOpen:d.admissionOpen&&d.costOpen&&costUntil>at&&fresh&&d.queueOutstanding!==null&&d.queueOutstanding<40&&d.oldestQueuedAgeSeconds!==null&&d.oldestQueuedAgeSeconds<300,ownerCapacity:'UNBOUND_NO_OWNER_SELECTED',nativeWrites:0};
}
module.exports={ledger,LIMITS};
