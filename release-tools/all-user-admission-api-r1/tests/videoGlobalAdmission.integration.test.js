'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server'),{randomUUID}=require('crypto');
const G=require('./videoGlobalAdmission');let mongo,col,ctl,now=1800000000000;const owner='a'.repeat(24),other='b'.repeat(24),input=(ownerId=owner,bytes=50*1024**2)=>({owner:ownerId,sessionId:String(new mongoose.Types.ObjectId()),clientUploadId:randomUUID(),bytes});
before(async()=>{mongo=await MongoMemoryServer.create({binary:{systemBinary:'/opt/homebrew/bin/mongod',version:'8.3.7'}});await mongoose.connect(mongo.getUri());col=mongoose.connection.collection('videoglobaladmission');ctl=G.create({collection:col,now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true',POST_VIDEO_FAIR_SCHEDULING_ENABLED:'false'}});});
after(async()=>{await mongoose.disconnect();await mongo.stop();});
beforeEach(async()=>{ctl=G.create({collection:col,now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true',POST_VIDEO_FAIR_SCHEDULING_ENABLED:'false'}});await col.deleteMany({});const d=G.initialDocument({reviewReference:'a'.repeat(64),costUntil:now+3600000,now});Object.assign(d,{admissionOpen:true,costOpen:true,telemetryValid:true,telemetryAt:new Date(now),oldestQueuedAgeSeconds:0,queueOutstanding:0});await col.insertOne(d);});
test('two distinct accounts reserve concurrently even with fairness disabled; identity replay changes no counters',async()=>{
 const a=input(),b=input(other);await Promise.all([ctl.reserve(a),ctl.reserve(b)]);const d=await col.findOne({_id:G.KEY});assert.equal(d.count,2);assert.equal(d.bytes,a.bytes+b.bytes);assert.equal(d.owners[owner].count,1);assert.equal(d.owners[other].count,1);await ctl.reserve(a);assert.equal((await col.findOne({_id:G.KEY})).count,2);await assert.rejects(ctl.reserve({...a,owner:other}),/identity/);
});
test('simultaneous sources cannot exceed global work budget; rejected source leaks no reservation',async()=>{
 const inputs=Array.from({length:15},(_,n)=>input(n%2?owner:other));const outcomes=await Promise.allSettled(inputs.map(x=>ctl.reserve(x)));assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,8);const d=await col.findOne({_id:G.KEY});assert.equal(d.workSeconds,14400);assert.equal(d.count,8);assert.equal(d.reservations.length,8);
});
test('per-owner five sessions and1GiB remain atomic across simultaneous requests',async()=>{
 const outcomes=await Promise.allSettled(Array.from({length:6},()=>ctl.reserve(input())));assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,5);assert.equal((await col.findOne({_id:G.KEY})).count,5);
 await col.deleteMany({});const d=G.initialDocument({reviewReference:'a'.repeat(64),costUntil:now+3600000,now});Object.assign(d,{admissionOpen:true,costOpen:true,telemetryValid:true,telemetryAt:new Date(now),oldestQueuedAgeSeconds:0,queueOutstanding:0});await col.insertOne(d);
 await ctl.reserve(input(owner,500*1024**2));await ctl.reserve(input(owner,500*1024**2));await assert.rejects(ctl.reserve(input(owner,50*1024**2)),/capacity/);assert.equal((await col.findOne({_id:G.KEY})).bytes,1000*1024**2);
});
for(const[field,value]of [['admissionOpen',false],['costOpen',false],['telemetryValid',false],['telemetryAt',new Date(now-20001)],['costUntil',new Date(now-1)],['queueOutstanding',40],['oldestQueuedAgeSeconds',300]])test(field+' closes fresh admission without cancelling accepted work',async()=>{
 const first=input();await ctl.reserve(first);await col.updateOne({_id:G.KEY},{$set:{[field]:value}});await assert.rejects(ctl.reserve(input(other)));const d=await col.findOne({_id:G.KEY});assert.equal(d.count,1);assert.equal(d.reservations[0].sessionId,first.sessionId);
});
test('no ledger bootstrap, no metrics or disabled global service cannot silently accept sources',async()=>{
 await col.deleteMany({});await assert.rejects(ctl.reserve(input()),/temporarily/);await assert.rejects(G.create({collection:col,env:{}}).reserve(input()),/temporarily/);assert.equal(await col.countDocuments({}),0);
});
test('corrupt ledger totals cannot allocate or release budget',async()=>{await col.updateOne({_id:G.KEY},{$set:{count:-1}});await assert.rejects(ctl.reserve(input()));await assert.rejects(ctl.reconcile({}));assert.equal((await col.findOne({_id:G.KEY})).count,-1);});
test('lost database acknowledgement holds one durable reservation; exact replay does not double spend',async()=>{
 let first=true;const wrapped={findOne:(...x)=>col.findOne(...x),findOneAndUpdate:async(...x)=>{const r=await col.findOneAndUpdate(...x);if(first){first=false;throw Error('ACK_LOST');}return r;}};const x=input(),lost=G.create({collection:wrapped,now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true'}});await assert.rejects(lost.reserve(x));assert.equal((await col.findOne({_id:G.KEY})).count,1);assert((await ctl.reserve(x)).reused);assert.equal((await col.findOne({_id:G.KEY})).count,1);
});
test('Redis telemetry failure invalidates gate instead of fabricating a zero backlog',async()=>{
 await assert.rejects(ctl.telemetry({client:Promise.resolve({})}));assert.equal((await col.findOne({_id:G.KEY})).telemetryValid,false);await assert.rejects(ctl.reserve(input()));const measured=G.create({collection:col,now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true'},readMetrics:async()=>({checkedAt:new Date(now).toISOString(),collectorHealthy:1,queuePaused:0,oldestQueuedAgeSeconds:61,outstandingJobs:1})});await measured.telemetry({client:Promise.resolve({})});const d=await col.findOne({_id:G.KEY});assert.equal(d.oldestQueuedAgeSeconds,61);assert.equal(d.queueOutstanding,1);
});
test('missing, paused, future or stale native telemetry fails closed',async()=>{
 for(const delta of [{outstandingJobs:undefined},{queuePaused:1},{checkedAt:new Date(now+1).toISOString()},{checkedAt:new Date(now-20001).toISOString()}]){const gate=G.create({collection:col,now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true'},readMetrics:async()=>({checkedAt:new Date(now).toISOString(),collectorHealthy:1,queuePaused:0,oldestQueuedAgeSeconds:0,outstandingJobs:0,...delta})});await assert.rejects(gate.telemetry({client:Promise.resolve({})}));assert.equal((await col.findOne({_id:G.KEY})).telemetryValid,false);}
});
test('a lost create response with no positively terminal source never expires or releases its global reservation',async()=>{
 const x=input();await ctl.reserve(x);const result=await ctl.reconcile({sessions:{findOne:()=>({read(){return this;},lean:async()=>null})},posts:{},intents:{},queue:{}});assert.equal(result.released,0);assert.equal((await col.findOne({_id:G.KEY})).count,1);
});
test('exact private canonical source releases once, foreign canonical and live jobs preserve the reservation',async()=>{
 const x=input();await ctl.reserve(x);let canonical=false,active=true;const row={_id:new mongoose.Types.ObjectId(x.sessionId),owner:x.owner,clientUploadId:x.clientUploadId,size:x.bytes,status:'READY',postId:new mongoose.Types.ObjectId()},deps={sessions:{findOne:()=>({read(){return this;},lean:async()=>row})},posts:{exists:async q=>{assert.equal(q.author,x.owner);return canonical;}},intents:{exists:async()=>false},queue:{getJob:async()=>active?{getState:async()=> 'active'}:null}};
 assert.equal((await ctl.reconcile(deps)).released,0);canonical=true;assert.equal((await ctl.reconcile(deps)).released,0);active=false;const leases=mongoose.connection.collection('videopostpublications');await leases.insertOne({_id:row.postId,owner:x.owner,expiresAt:new Date(now+60000)});assert.equal((await ctl.reconcile(deps)).released,0);await leases.deleteOne({_id:row.postId});assert.equal((await ctl.reconcile(deps)).released,1);assert.equal((await ctl.reconcile(deps)).released,0);assert.equal((await col.findOne({_id:G.KEY})).count,0);
});

test('concurrent retries of one exact reservation consume one slot and one work charge',async()=>{
 const x=input();const results=await Promise.all(Array.from({length:20},()=>ctl.reserve(x)));
 const d=await col.findOne({_id:G.KEY});assert.equal(results.filter(r=>!r.reused).length,1);
 assert.equal(d.count,1);assert.equal(d.bytes,x.bytes);assert.equal(d.workSeconds,1800);assert.equal(d.reservations.length,1);
});
test('database read or reservation write failure never reports admission or releases existing budget',async()=>{
 const first=input();await ctl.reserve(first);
 for(const mode of ['read','write']){
  const failed=G.create({collection:{findOne:(...args)=>mode==='read'?Promise.reject(Error('LOCAL_DB_UNAVAILABLE')):col.findOne(...args),findOneAndUpdate:async()=>{throw Error('LOCAL_DB_UNAVAILABLE');}},now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true'}});
  await assert.rejects(failed.reserve(input(other)));assert.equal((await col.findOne({_id:G.KEY})).count,1);
 }
});
test('same owner/client retry with a different generated source ID cannot double allocate',async()=>{
 const x=input();await ctl.reserve(x);await assert.rejects(ctl.reserve({...x,sessionId:String(new mongoose.Types.ObjectId())}));
 const d=await col.findOne({_id:G.KEY});assert.equal(d.count,1);assert.equal(d.reservations[0].sessionId,x.sessionId);
});
test('queue read failure during terminal reconciliation retains the full accepted reservation',async()=>{
 const x=input();await ctl.reserve(x);const row={_id:new mongoose.Types.ObjectId(x.sessionId),size:x.bytes,status:'READY',postId:new mongoose.Types.ObjectId()};
 await assert.rejects(ctl.reconcile({sessions:{findOne:()=>({read(){return this;},lean:async()=>row})},posts:{exists:async()=>true},intents:{exists:async()=>false},queue:{getJob:async()=>{throw Error('LOCAL_REDIS_UNAVAILABLE');}}}));
 assert.equal((await col.findOne({_id:G.KEY})).workSeconds,1800);
});
test('known Redis failure blocks new admission even when the failure flag cannot be written to the ledger',async()=>{
 const failed=G.create({collection:{findOne:(...x)=>col.findOne(...x),findOneAndUpdate:(...x)=>col.findOneAndUpdate(...x),updateOne:async()=>{throw Error('LOCAL_INVALIDATION_WRITE_UNAVAILABLE');}},now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true'},readMetrics:async()=>{throw Error('LOCAL_REDIS_UNAVAILABLE');}});
 await assert.rejects(failed.telemetry({client:Promise.resolve({})}));assert.equal((await col.findOne({_id:G.KEY})).telemetryValid,true,'failed persistence leaves the old heartbeat apparently fresh');
 await assert.rejects(failed.reserve(input(other)));assert.equal((await col.findOne({_id:G.KEY})).count,0);
});
test('only a positively matched healthy telemetry write clears the process hold; exact accepted replay still works while held',async()=>{
 let mode='failure';const gate=G.create({collection:{findOne:(...x)=>col.findOne(...x),findOneAndUpdate:(...x)=>col.findOneAndUpdate(...x),updateOne:async(...x)=>{if(mode==='failure')throw Error('LOCAL_INVALIDATION_WRITE_UNAVAILABLE');if(mode==='no-match')return{matchedCount:0,modifiedCount:0};return col.updateOne(...x);}},now:()=>now,env:{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true'},readMetrics:async()=>{if(mode==='failure')throw Error('LOCAL_REDIS_UNAVAILABLE');return{collectorHealthy:1,queuePaused:0,outstandingJobs:0,oldestQueuedAgeSeconds:0,checkedAt:new Date(now).toISOString()};}});
 await assert.rejects(gate.telemetry({client:Promise.resolve({})}));mode='no-match';await assert.rejects(gate.telemetry({client:Promise.resolve({})}));await assert.rejects(gate.reserve(input()));
 mode='healthy';await gate.telemetry({client:Promise.resolve({})});const accepted=input(other);await gate.reserve(accepted);mode='failure';await assert.rejects(gate.telemetry({client:Promise.resolve({})}));assert.equal((await gate.reserve(accepted)).reused,true);await assert.rejects(gate.reserve(input()));assert.equal((await col.findOne({_id:G.KEY})).count,1);
});


test('an imported manual hold cannot be automatically released even if source and Post look terminal',async()=>{
 const x=input();await ctl.reserve(x);await col.updateOne({_id:G.KEY,'reservations.sessionId':x.sessionId},{$set:{'reservations.$.manualHold':true}});
 let queries=0;const row={_id:new mongoose.Types.ObjectId(x.sessionId),size:x.bytes,status:'READY',postId:new mongoose.Types.ObjectId()};
 const deps={sessions:{findOne:()=>{queries++;return{read(){return this;},lean:async()=>row};}},posts:{exists:async()=>true},intents:{exists:async()=>false},queue:{getJob:async()=>null}};
 assert.equal((await ctl.reconcile(deps)).released,0);assert.equal(queries,0);const d=await col.findOne({_id:G.KEY});assert.equal(d.count,1);assert.equal(d.workSeconds,1800);assert.equal(d.reservations[0].manualHold,true);assert.equal((await ctl.reserve(x)).reused,true);
});
test('malformed manual-hold metadata closes allocation and reconciliation without changing reservations',async()=>{
 const x=input();await ctl.reserve(x);await col.updateOne({_id:G.KEY,'reservations.sessionId':x.sessionId},{$set:{'reservations.$.manualHold':'true'}});await assert.rejects(ctl.reserve(input(other)));await assert.rejects(ctl.reconcile({}));assert.equal((await col.findOne({_id:G.KEY})).count,1);
});
