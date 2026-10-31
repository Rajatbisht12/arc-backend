'use strict';
// Runs the EXACT candidate worker entry point against local Redis and an HTTP
// ECS-agent fixture. Database and processing service persistence are injected.
const fs=require('fs'),path=require('path'),http=require('http'),Module=require('module'),ts=require('typescript'),crypto=require('crypto');
const context=process.env.LOCAL_CONTEXT,sockPort=Number(process.env.LOCAL_REDIS_PORT),n=process.env.LOCAL_TASK_NUMBER,taskArn='arn:aws:ecs:us-east-1:906446637180:task/arc-cluster/'+n.repeat(32),containerId='local-worker-'+n;
const env={CLIP_HLS_ENABLED:true,CLIP_HLS_WORKER_CONCURRENCY:1,REDIS_HOST:'127.0.0.1',REDIS_PORT:sockPort,REDIS_TLS:false,VIDEO_WORKER_HEALTH_PORT:0};
Object.assign(process.env,{POST_VIDEO_FAIR_SCHEDULING_ENABLED:'false',POST_VIDEO_PRIVATE_DELIVERY_ENABLED:'true',VIDEO_WORKER_R4_CONTROL_ENABLED:'true',VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED:'true',VIDEO_WORKER_EXPECTED_SERVICE:'local-service',VIDEO_WORKER_EXPECTED_FAMILY:'local-family',VIDEO_WORKER_CONTROL_OWNER:'pi-r5-local-owner',VIDEO_WORKER_CONTROL_RUN_ID:'pi-r5-local-run',VIDEO_WORKER_CONTROL_PUBLIC_KEY_PEM:process.env.LOCAL_PUBLIC_KEY,VIDEO_WORKER_RESOURCE_METRICS_ENABLED:'false'});
let protectedState=false,puts=0,clears=0,health;
const agent=http.createServer(async(req,res)=>{if(req.url==='/metadata/task'){res.end(JSON.stringify({TaskARN:taskArn,ServiceName:'local-service',Family:'local-family',Containers:[{Name:'video-worker',DockerId:containerId}]}));return;}if(req.method==='PUT'){let body='';for await(const b of req)body+=b;protectedState=JSON.parse(body).ProtectionEnabled;puts++;if(!protectedState)clears++;}res.end(JSON.stringify({protection:{TaskArn:taskArn,ProtectionEnabled:protectedState,ExpirationDate:new Date(Date.now()+2880*60000).toISOString()}}));});
const original=Module._load,originalHttp=http.createServer;
const loadTs=(file,parent)=>{const m=new Module(file,parent);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;};
http.createServer=function(handler){health=originalHttp(handler);health.on('listening',()=>process.send({ready:true,origin:'http://127.0.0.1:'+health.address().port,taskArn,containerId}));return health;};
Module._load=function(id,parent,isMain){
 if(parent?.filename?.startsWith(context)&&id==='mongoose')return{disconnect:async()=>{}};
 if(parent?.filename===context+'/src/clip-worker.ts'){
  if(id==='./config/env')return{env};if(id==='./config/logger')return{logger:{info(){},warn(){},error(){}}};
  if(id==='./infrastructure/database/mongodb')return{connectMongo:async()=>{}};
  if(id==='./modules/legacy/legacy.paths')return{backendRootPath:context+'/src/legacy-src'};
  if(id==='./infrastructure/jobs/videoWorkerResourceSample')return{startVideoWorkerObservation:async()=>async()=>{}};
  if(id==='./infrastructure/jobs/videoTaskProtection'||id==='./infrastructure/jobs/videoWorkerIntake')return loadTs(context+'/src/'+id.slice(2)+'.ts',parent);
 }
 if(id===context+'/src/legacy-src/services/videoUploadService.js')return{processVideoUploadJob:async()=>{
  const file=context+'/src/legacy-src/utils/clipHlsProcessing.js',m=new Module(file,parent);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.localRun=runProcess;',file);
  return m.exports.localRun('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=160x90:rate=25','-t','10','-c:v','libx264','-threads','1','-f','null','-'],{onProgress:()=>{}});
 }};
 return original.call(this,id,parent,isMain);
};
agent.listen(0,'127.0.0.1',()=>{const base='http://127.0.0.1:'+agent.address().port;process.env.ECS_AGENT_URI=base;process.env.ECS_CONTAINER_METADATA_URI_V4=base+'/metadata';loadTs(context+'/src/clip-worker.ts',module);});
process.on('message',m=>{if(m==='AGENT_STATS')process.send({agent:{puts,clears,protected:protectedState}});});
