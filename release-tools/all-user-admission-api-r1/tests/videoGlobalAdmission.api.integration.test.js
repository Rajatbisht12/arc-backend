'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server'),{randomUUID,generateKeyPairSync}=require('crypto');
const G=require('./videoGlobalAdmission'),S=require('./videoUploadService'),Controller=require('../controllers/videoUploadController'),Session=require('../models/VideoUploadSession');let mongo,server,origin,col,mpus=0;const old={...process.env};
const owners=['a'.repeat(24),'b'.repeat(24)],tokens=new Map();
const User=require('../models/User'),auth=require('../middleware/auth'),jwt=require('../utils/jwt');
before(async()=>{mongo=await MongoMemoryServer.create({binary:{systemBinary:'/opt/homebrew/bin/mongod',version:'8.3.7'}});await mongoose.connect(mongo.getUri());await Session.createIndexes();col=mongoose.connection.collection('videoglobaladmission');Object.assign(process.env,{NODE_ENV:'test',JWT_SECRET:'local-global-admission-at-least-thirty-two-characters',JWT_REFRESH_SECRET:'local-global-refresh-at-least-thirty-two-characters',POST_VIDEO_UPLOADS_ENABLED:'true',POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'true',POST_VIDEO_FAIR_SCHEDULING_ENABLED:'false',CLIP_HLS_WORKER_ENABLED:'false',AWS_S3_BUCKET:'local-test',POST_VIDEO_PRIVATE_DELIVERY_ENABLED:'true',POST_VIDEO_CLOUDFRONT_URL:'https://media.example.com',POST_VIDEO_API_ORIGIN:'https://api.example.com',POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID:'local',POST_VIDEO_CLOUDFRONT_PRIVATE_KEY:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}),POST_VIDEO_PLAYBACK_TOKEN_SECRET:'local-placeholder-more-than-thirty-two-characters'});S.__setDependenciesForTests({storage:{createVideoMultipart:async()=>{mpus++;return'LOCAL_MPU';}}});for(let n=0;n<owners.length;n++){await User.create({_id:owners[n],username:'global_local_'+n,email:'global'+n+'@example.invalid',password:'Localfixture123!',userType:'player',isActive:true,profile:{displayName:'Local fixture'}});tokens.set(owners[n],jwt.generateToken({id:owners[n],username:'global_local_'+n,userType:'player'}));}const app=express();app.use(express.json());app.use(auth.protect);app.post('/api/posts/video-uploads',Controller.create);app.post('/local-legacy-video',(req,res,next)=>{req.files=[{mimetype:'video/mp4'}];next();},require('../controllers/postController').createPost);app.get('/api/posts/video-uploads/:id',Controller.get);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));S.__setDependenciesForTests();await mongoose.disconnect();await mongo.stop();for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);});
beforeEach(async()=>{mpus=0;await Session.deleteMany({});await col.deleteMany({});const d=G.initialDocument({reviewReference:'a'.repeat(64),costUntil:Date.now()+3600000});Object.assign(d,{admissionOpen:true,costOpen:true,telemetryValid:true,telemetryAt:new Date(),oldestQueuedAgeSeconds:0,queueOutstanding:0});await col.insertOne(d);});
const create=async(owner,key=randomUUID())=>{const r=await fetch(origin+'/api/posts/video-uploads',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.get(owner)},body:JSON.stringify({clientUploadId:key,filename:'fixture.mp4',mimeType:'video/mp4',size:1048576})});return{status:r.status,body:await r.json()};};
test('two owner contexts share real atomic global reservations and cannot read each others source',async()=>{const [a,b]=await Promise.all(owners.map(x=>create(x)));assert.equal(a.status,200);assert.equal(b.status,200);assert.equal((await col.findOne({_id:G.KEY})).count,2);assert.equal(mpus,2);const wrong=await fetch(origin+'/api/posts/video-uploads/'+a.body.data.session.id,{headers:{Authorization:'Bearer '+tokens.get(owners[1])}});assert.equal(wrong.status,404);});
test('emergency admission stop preserves existing sources and repeated exact create but rejects new source before any quota/S3 allocation',async()=>{const key=randomUUID(),a=await create(owners[0],key);assert.equal(a.status,200);await col.updateOne({_id:G.KEY},{$set:{admissionOpen:false,costOpen:false}});const failed=await create(owners[1]);assert.equal(failed.status,503);assert.equal(await Session.countDocuments({}),1);assert.equal((await col.findOne({_id:G.KEY})).count,1);assert.equal(mpus,1);const replay=await create(owners[0],key);assert.equal(replay.body.data.session.id,a.body.data.session.id);assert.equal(mpus,1);});

test('legacy multipart video cannot bypass the global reservation path for either authenticated account',async()=>{for(const owner of owners){const r=await fetch(origin+'/local-legacy-video',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.get(owner)},body:'{}'});assert.equal(r.status,409);assert.equal((await r.json()).code,'VIDEO_UPLOAD_PATH_REQUIRED');}assert.equal(mpus,0);assert.equal(await Session.countDocuments({}),0);assert.equal((await col.findOne({_id:G.KEY})).count,0);});

test('explicit production all-mode with empty canary admits concurrent authenticated non-xyz accounts',async()=>{
 const saved=Object.fromEntries(['NODE_ENV','POST_VIDEO_ROLLOUT_MODE','POST_VIDEO_CANARY_USER_IDS'].map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,{NODE_ENV:'production',POST_VIDEO_ROLLOUT_MODE:'all',POST_VIDEO_CANARY_USER_IDS:''});
  const results=await Promise.all(owners.map(x=>create(x)));assert.deepEqual(results.map(x=>x.status),[200,200]);assert.equal((await col.findOne({_id:G.KEY})).count,2);
 }finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('anonymous and inactive accounts cannot allocate a source or reservation',async()=>{
 const r=await fetch(origin+'/api/posts/video-uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientUploadId:randomUUID(),filename:'fixture.mp4',mimeType:'video/mp4',size:1048576})});assert.equal(r.status,401);
 await User.updateOne({_id:owners[1]},{$set:{isActive:false}});try{assert.equal((await create(owners[1])).status,401);}finally{await User.updateOne({_id:owners[1]},{$set:{isActive:true}});}
 assert.equal(await Session.countDocuments({}),0);assert.equal((await col.findOne({_id:G.KEY})).count,0);assert.equal(mpus,0);
});
test('large Android source without proof and small source with invalid explicit proof are rejected before allocation',async()=>{
 for(const extra of [{size:51*1024**2},{size:1048576,androidIntegrityToken:'invalid'}]){
  const r=await fetch(origin+'/api/posts/video-uploads',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.get(owners[0])},body:JSON.stringify({clientUploadId:randomUUID(),filename:'fixture.mp4',mimeType:'video/mp4',...extra})});
  assert.equal(r.status,403);assert.equal((await r.json()).code,'ANDROID_UPLOAD_PROOF_REQUIRED');
 }
 assert.equal(mpus,0);assert.equal(await Session.countDocuments({}),0);assert.equal((await col.findOne({_id:G.KEY})).count,0);
});
test('failed Session insert reports failure and retains the unknown reserved work without S3 allocation',async()=>{
 const original=Session.create;Session.create=async()=>{throw Error('LOCAL_INSERT_ACK_UNKNOWN');};
 try{assert.equal((await create(owners[0])).status,503);}finally{Session.create=original;}
 assert.equal(mpus,0);assert.equal(await Session.countDocuments({}),0);const d=await col.findOne({_id:G.KEY});assert.equal(d.count,1);assert.equal(d.workSeconds,1800);
});
test('missing durable ledger fails HTTP admission without an upload success or S3 request',async()=>{
 await col.deleteMany({});assert.equal((await create(owners[0])).status,503);assert.equal(mpus,0);assert.equal(await Session.countDocuments({}),0);assert.equal(await col.countDocuments({}),0);
});
test('closing new upload intake preserves accepted source replay, status, signing and completion',async()=>{
 const key=randomUUID(),accepted=await create(owners[0],key);assert.equal(accepted.status,200);const id=accepted.body.data.session.id;
 const previous=process.env.POST_VIDEO_UPLOADS_ENABLED;let signed=0,enqueued=0;
 S.__setDependenciesForTests({storage:{createVideoMultipart:async()=>{throw Error('UNEXPECTED_SECOND_MULTIPART');},presignVideoPart:async()=>{signed++;return 'https://local.invalid/fixture';},headVideoSource:async()=>({size:1048576,sessionId:id,contentType:'video/mp4'})},enqueue:async source=>{assert.equal(String(source),id);enqueued++;}});
 try{process.env.POST_VIDEO_UPLOADS_ENABLED='false';
  assert.equal((await create(owners[1])).status,503);assert.equal((await create(owners[0],key)).body.data.session.id,id);
  const r=await fetch(origin+'/api/posts/video-uploads/'+id,{headers:{Authorization:'Bearer '+tokens.get(owners[0])}});assert.equal(r.status,200);
  assert.equal((await S.signParts(owners[0],id,[1])).length,1);assert.equal(signed,1);
  assert.equal((await S.completeSession(owners[0],id)).status,'QUEUED');assert.equal(enqueued,1);assert.equal((await col.findOne({_id:G.KEY})).count,1);
 }finally{process.env.POST_VIDEO_UPLOADS_ENABLED=previous;S.__setDependenciesForTests({storage:{createVideoMultipart:async()=>{mpus++;return'LOCAL_MPU';}}});}
});
