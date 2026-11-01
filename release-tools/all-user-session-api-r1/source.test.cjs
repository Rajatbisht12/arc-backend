'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const V=require('./verify.cjs'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'../..');let temp,records,service,policy,queue,lock,oldLock,oldDelete;
const owner='b'.repeat(24),sessionId='c'.repeat(24),uuid='10101010-1010-4010-8010-101010101010';
const query=value=>({select:async()=>value,then:(resolve,reject)=>Promise.resolve(value).then(resolve,reject)});
test.before(()=>{
 records=V.verify().records;temp=fs.mkdtempSync(path.join(os.tmpdir(),'arc-session-api-source-'));
 for(const[name,b]of records){const p=path.join(temp,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);}
 fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(temp,'node_modules'),'dir');
 const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
 Object.assign(process.env,{NODE_ENV:'production',DEPLOYMENT_ENVIRONMENT:'production',POST_VIDEO_ROLLOUT_MODE:'all',POST_VIDEO_CANARY_USER_IDS:'',POST_VIDEO_UPLOADS_ENABLED:'true',CLIP_HLS_WORKER_ENABLED:'false',POST_VIDEO_PRIVATE_DELIVERY_ENABLED:'true',AWS_S3_BUCKET:'local-fixture-only',POST_VIDEO_CLOUDFRONT_URL:'https://media.example.invalid',POST_VIDEO_API_ORIGIN:'https://api.example.invalid',POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID:'local-fixture',POST_VIDEO_CLOUDFRONT_PRIVATE_KEY:key,POST_VIDEO_PLAYBACK_TOKEN_SECRET:'local-fixture-not-a-production-token-secret',POST_VIDEO_ANDROID_INTEGRITY_ENABLED:'false',POST_VIDEO_PRIVATE_LEGACY_ENABLED:'false',POST_VIDEO_FAIR_SCHEDULING_ENABLED:'true'});
 service=require(path.join(temp,'src/legacy-src/services/videoUploadService.js'));policy=require(path.join(temp,'src/legacy-src/config/postVideoRolloutPolicy.js'));queue=require(path.join(temp,'src/legacy-src/utils/jobQueue.js'));lock=require('mongoose').models.VideoUploadOwnerLock;oldLock=lock.findOneAndUpdate;oldDelete=lock.deleteOne;
});
test.after(()=>{if(lock){lock.findOneAndUpdate=oldLock;lock.deleteOne=oldDelete;}if(temp)fs.rmSync(temp,{recursive:true,force:true});});
test('exact candidate has eight source deltas and preserves dependencies, admission hook, model/index and session privacy code',()=>{
 const c=JSON.parse(fs.readFileSync(path.join(__dirname,'release/candidate.json')));assert.equal(c.changes.length,8);assert.equal(c.indexChanges,0);assert.equal(c.ledgerOrAdmissionHookChanges,0);
 const source=records.get('src/legacy-src/services/videoUploadService.js').toString();assert.match(source,/await require\('\.\.\/utils\/jobQueue'\)\.assertVideoProcessingAdmission\(owner, _id\)/);assert.ok(!source.includes('globalAdmissionOverride'));
 assert.equal(policy.isPostVideoOwnerAllowed(owner),true);
});
test('larger unproved source rejects before owner lock, reservation, insert or S3',async()=>{
 let writes=0;lock.findOneAndUpdate=async()=>{writes++;throw Error('NO_WRITE_ALLOWED');};queue.setQueueFunctions({assertVideoProcessingAdmission:async()=>{writes++;throw Error('NO_RESERVATION_ALLOWED');}});
 service.__setDependenciesForTests({Session:{findOne:()=>query(null)},storage:{createVideoMultipart:async()=>{writes++;throw Error('NO_SOURCE_ALLOWED');}}});
 await assert.rejects(service.createSession(owner,{clientUploadId:uuid,filename:'source.mov',mimeType:'video/quicktime',size:51*1024*1024}),e=>e.code==='ANDROID_UPLOAD_PROOF_REQUIRED');assert.equal(writes,0);
});
test('non-canary owner small session retains the exact prior native admission hook before source acceptance',async()=>{
 const events=[];let row;lock.findOneAndUpdate=async()=>({token:'local'});lock.deleteOne=async()=>({deletedCount:1});
 queue.setQueueFunctions({assertVideoProcessingAdmission:async(id,sid)=>{assert.equal(id,owner);assert.ok(sid);events.push('admission');}});
 const model={findOne:()=>query(null),find:()=>({limit:()=>({select:async()=>[]})}),create:async data=>{events.push('session');row={...data,status:'CREATED'};return row;},findOneAndUpdate:(_filter,update)=>{if(update.$set?.multipartUploadId)Object.assign(row,update.$set);return query(row);}};
 service.__setDependenciesForTests({Session:model,storage:{createVideoMultipart:async()=>{events.push('source');return'local-only-upload';}}});
 const result=await service.createSession(owner,{clientUploadId:uuid,filename:'source.mov',mimeType:'video/quicktime',size:1024});assert.equal(result.status,'UPLOADING');assert.deepEqual(events,['admission','session','source']);assert.equal(service.policy(owner).maxVideoBytes,50*1024*1024);
});
test('an exact previously accepted larger session resumes without requiring a new proof or reservation',async()=>{
 const prior=process.env.POST_VIDEO_UPLOADS_ENABLED;process.env.POST_VIDEO_UPLOADS_ENABLED='false';
 const row={_id:sessionId,owner,clientUploadId:uuid,filename:'source.mov',mimeType:'video/quicktime',size:100*1024*1024,status:'UPLOADING',multipartUploadId:'retained-upload',partSize:8*1024*1024,partCount:13,expiresAt:new Date(Date.now()+60000)};let writes=0;
 lock.findOneAndUpdate=async()=>{writes++;throw Error('NO_NEW_LOCK');};queue.setQueueFunctions({assertVideoProcessingAdmission:async()=>{writes++;throw Error('NO_NEW_ADMISSION');}});
 service.__setDependenciesForTests({Session:{findOne:()=>query(row)},storage:{createVideoMultipart:async()=>{writes++;throw Error('NO_NEW_SOURCE');}}});
 try{const result=await service.createSession(owner,{clientUploadId:uuid,filename:row.filename,mimeType:row.mimeType,size:row.size});assert.equal(result.id,sessionId);assert.equal(result.status,'UPLOADING');assert.equal(writes,0);}finally{process.env.POST_VIDEO_UPLOADS_ENABLED=prior;}
});
test('closed new intake rejects a new non-canary session before reservation or source write',async()=>{
 const prior=process.env.POST_VIDEO_UPLOADS_ENABLED;process.env.POST_VIDEO_UPLOADS_ENABLED='false';let writes=0;
 lock.findOneAndUpdate=async()=>{writes++;throw Error('NO_NEW_LOCK');};service.__setDependenciesForTests({Session:{findOne:()=>query(null)},storage:{createVideoMultipart:async()=>{writes++;throw Error('NO_NEW_SOURCE');}}});
 try{await assert.rejects(service.createSession(owner,{clientUploadId:uuid,filename:'source.mov',mimeType:'video/quicktime',size:1024}),e=>e.code==='VIDEO_UPLOADS_UNAVAILABLE');assert.equal(writes,0);}finally{process.env.POST_VIDEO_UPLOADS_ENABLED=prior;}
});
function controllerContext(existing){
 const source=records.get('src/legacy-src/controllers/postController.js').toString(),ast=ts.createSourceFile('controller.js',source,ts.ScriptTarget.Latest,true);let handler;
 const walk=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='createPost')handler=n.initializer.getText(ast);ts.forEachChild(n,walk);};walk(ast);assert.ok(handler);
 let sideEffects=0;const context={module:{exports:{}},console:{error(){}},process:{env:process.env},completionSpan:async(_name,fn)=>fn(),finishPublication:async lease=>assert.equal(lease,undefined),log:{error:()=>assert.fail('unexpected publication cleanup error')},parseIds:()=>[],...policy,postIdentity:()=>sessionId,Post:{findOne:async()=>existing},finalizeVideoPost:async()=>{},formatPostDTO:x=>({id:x._id}),resolveClientMediaPayload:async x=>x,acquirePublication:async()=>{sideEffects++;throw Error('MUST_NOT_ACQUIRE');},releasePublication:async()=>{}};
 vm.runInNewContext('module.exports='+handler,context);return{handler:context.module.exports,effects:()=>sideEffects};
}
test('actual candidate controller rejects new raw legacy video before lease/storage, including when a legacy flag is true',async()=>{
 for(const enabled of ['false','true']){process.env.POST_VIDEO_PRIVATE_LEGACY_ENABLED=enabled;const c=controllerContext(null),res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};await c.handler({user:{_id:owner},body:{text:'fixture',postType:'general'},files:[{mimetype:'video/quicktime'}]},res);assert.equal(res.statusCode,409);assert.equal(res.body.code,'VIDEO_UPLOAD_PATH_REQUIRED');assert.equal(c.effects(),0);}
});
test('already committed owner/client Post is returned before the new legacy rejection',async()=>{
 const c=controllerContext({_id:sessionId,content:{media:[]},populate:async()=>{}}),res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 await c.handler({user:{_id:owner},body:{clientPostId:uuid},files:[{mimetype:'video/mp4'}]},res);assert.equal(res.statusCode,200);assert.equal(res.body.success,true);assert.equal(c.effects(),0);
});
