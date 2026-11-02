'use strict';
// Local Unix-socket Redis only. No application/production credentials or clients.
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),Redis=require('ioredis');
const {readVideoQueueMetrics}=require('./release/overrides/src/infrastructure/jobs/videoQueueMetrics.js');
test('actual isolated Redis telemetry uses readonly commands and fails on pause, unknown state and outage',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'api-admission-redis-')),socket=path.join(dir,'redis.sock');
 const server=spawn('/opt/homebrew/bin/redis-server',['--port','0','--unixsocket',socket,'--unixsocketperm','700','--save','','--appendonly','no'],{stdio:['ignore','pipe','ignore']});let admin,reader;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('LOCAL_REDIS_START_TIMEOUT')),5000);server.once('error',reject);server.stdout.on('data',b=>{if(b.toString().includes('Ready to accept connections')){clearTimeout(timer);resolve();}});});
  const options={path:socket,lazyConnect:true,enableOfflineQueue:false,enableReadyCheck:false,disableClientInfo:true,maxRetriesPerRequest:0,retryStrategy:null,commandTimeout:2000};
  admin=new Redis(options);await admin.connect();await admin.acl('SETUSER','local-admission-readonly','on','>local-fixture-only','~bull:clip-video:*','+multi','+exec','+type','+lrange','+zrange','+hget');
  reader=new Redis({...options,username:'local-admission-readonly',password:'local-fixture-only'});await reader.connect();
  const now=1800000000000;await admin.rpush('bull:clip-video:wait','local-queued');await admin.hset('bull:clip-video:local-queued','timestamp',String(now-61000));
  const m=await readVideoQueueMetrics(reader,{now:()=>now});a.equal(m.outstandingJobs,1);a.equal(m.oldestQueuedAgeSeconds,61);a.equal(m.collectorHealthy,1);a.ok(!JSON.stringify(m).includes('local-queued'));
  await a.rejects(reader.hset('bull:clip-video:meta','paused','1'),/NOPERM/);
  await admin.del('bull:clip-video:wait');await admin.rpush('bull:clip-video:paused','local-queued');await admin.hset('bull:clip-video:meta','paused','1');
  const paused=await readVideoQueueMetrics(reader,{now:()=>now});a.equal(paused.queuePaused,1);a.equal(paused.outstandingJobs,1);a.equal(paused.scaleOutOutstandingJobs,undefined);
  await admin.hset('bull:clip-video:meta','paused','unexpected');await a.rejects(readVideoQueueMetrics(reader,{now:()=>now}),/METRICS_PAUSE_STATE/);
  await admin.del('bull:clip-video:meta','bull:clip-video:paused');await admin.set('bull:clip-video:active','wrong-key-type');await a.rejects(readVideoQueueMetrics(reader,{now:()=>now}),/METRICS_READ_FAILED/);
  reader.disconnect();await a.rejects(readVideoQueueMetrics(reader,{now:()=>now}));
 }finally{reader?.disconnect();admin?.disconnect();const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;fs.rmSync(dir,{recursive:true,force:true});}
});
