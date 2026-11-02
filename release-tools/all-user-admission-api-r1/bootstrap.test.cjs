'use strict';
const test=require('node:test'),a=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript');
const P=require('./source.cjs'),V=require('../all-user-session-api-r1/verify.cjs');
const stage=require('./staged-controls.PROPOSAL_ONLY.json'),base={...stage.environment,NODE_ENV:'production'};
function runtime({candidate=true,env=base,secret={},failed=false}={}){
 const records=candidate?P.candidate().records:V.verify().records,environment={...env},calls=[];
 const load=name=>{const module={exports:{}},source=records.get(name);a.ok(source,name);
  const js=ts.transpileModule(source.toString(),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const requireLocal=name=>{
   if(name==='@aws-sdk/client-secrets-manager')return{SecretsManagerClient:class{async send(command){calls.push(command.input.SecretId);if(failed)throw Error('LOCAL_SECRET_TRANSPORT_FAILURE');return{SecretString:JSON.stringify(secret)};}},GetSecretValueCommand:class{constructor(input){this.input=input;}}};
   if(name==='./runtimeIsolation')return load('src/config/runtimeIsolation.ts');
   if(name==='../legacy-src/config/videoDeploymentPolicy')return {VIDEO_COMPATIBILITY_FLAGS:{}};
   throw Error('UNEXPECTED_IMPORT');
  };
  vm.runInNewContext(js,{module,exports:module.exports,require:requireLocal,process:{env:environment},console:{log(){},error(){}},URL},{timeout:1000});return module.exports;
 };
 return{environment,calls,run:()=>load('src/config/secrets.ts').loadSecretsManagerEnv()};
}
test('published loader reproduces all/empty-canary conflict without an actual secret read',async()=>{
 const env={...base};delete env.POST_VIDEO_ADMISSION_BOOTSTRAP_MODE;
 const r=runtime({candidate:false,env,secret:{POST_VIDEO_ROLLOUT_MODE:'canary',POST_VIDEO_CANARY_USER_IDS:'a'.repeat(24)}});await a.rejects(r.run(),/startup refused/);
});
test('explicit new API policy keeps all/empty-canary and hydrates other configuration without changing shared secret',async()=>{
 const secret={POST_VIDEO_ROLLOUT_MODE:'canary',POST_VIDEO_CANARY_USER_IDS:'a'.repeat(24),POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'false',POST_VIDEO_FAIR_SCHEDULING_ENABLED:'true',CLIP_HLS_WORKER_ENABLED:'true',POST_VIDEO_PRIVATE_DELIVERY_ENABLED:'false',REDIS_HOST:'unchanged-local-fixture',MONGODB_URI:'unchanged-local-fixture',POST_VIDEO_UPLOADS_ENABLED:'true',POST_VIDEO_BACKGROUND_PUBLISH_ENABLED:'true',POST_VIDEO_PRIVATE_LEGACY_ENABLED:'true'},before=JSON.stringify(secret);
 a.equal(stage.environment.POST_VIDEO_UPLOADS_ENABLED,'false');a.equal(stage.openingAuthority,0);a.equal(stage.registrationAuthority,0);a.equal(stage.serviceUpdateAuthority,0);a.equal(stage.image,null);for(const intake of ['false','true']){const r=runtime({env:{...base,POST_VIDEO_UPLOADS_ENABLED:intake},secret});await r.run();a.equal(r.environment.POST_VIDEO_ROLLOUT_MODE,'all');a.equal(r.environment.POST_VIDEO_CANARY_USER_IDS,'');a.equal(r.environment.POST_VIDEO_UPLOADS_ENABLED,intake);a.equal(r.environment.POST_VIDEO_BACKGROUND_PUBLISH_ENABLED,'false');a.equal(r.environment.POST_VIDEO_PRIVATE_LEGACY_ENABLED,'false');a.equal(r.environment.POST_VIDEO_GLOBAL_ADMISSION_ENABLED,'true');a.equal(r.environment.POST_VIDEO_FAIR_SCHEDULING_ENABLED,'false');a.equal(r.environment.CLIP_HLS_WORKER_ENABLED,'false');a.equal(r.environment.POST_VIDEO_PRIVATE_DELIVERY_ENABLED,'true');a.equal(r.environment.REDIS_HOST,secret.REDIS_HOST);a.deepEqual(r.calls,['arc/prod/backend']);}a.equal(JSON.stringify(secret),before);
});
test('task-bound opt-in fails before fetch for worker/staging/compatibility or unsafe/missing policy values',async()=>{
 for(const delta of [{CLIP_HLS_WORKER_ENABLED:'true'},{DEPLOYMENT_ENVIRONMENT:'staging',BACKEND_SECRET_ID:'arc/staging/backend'},{VIDEO_DEPLOYMENT_MODE:'compatibility'},{POST_VIDEO_GLOBAL_ADMISSION_ENABLED:'false'},{POST_VIDEO_FAIR_SCHEDULING_ENABLED:'true'},{POST_VIDEO_PRIVATE_DELIVERY_ENABLED:'false'},{POST_VIDEO_CANARY_USER_IDS:undefined},{POST_VIDEO_CANARY_USER_IDS:'a'.repeat(24)},{POST_VIDEO_ROLLOUT_MODE:'canary'},{POST_VIDEO_BACKGROUND_PUBLISH_ENABLED:'true'},{POST_VIDEO_PRIVATE_LEGACY_ENABLED:'true'},{POST_VIDEO_UPLOADS_ENABLED:undefined},{POST_VIDEO_ADMISSION_BOOTSTRAP_MODE:'OTHER'}]){const r=runtime({env:{...base,...delta}});await a.rejects(r.run());a.equal(r.calls.length,0);}
});
test('a secret cannot opt a legacy API/worker into the new policy',async()=>{
 const env={NODE_ENV:'production',CLIP_HLS_WORKER_ENABLED:'true',POST_VIDEO_ROLLOUT_MODE:'canary',POST_VIDEO_CANARY_USER_IDS:'a'.repeat(24)};
 const r=runtime({env,secret:{POST_VIDEO_ADMISSION_BOOTSTRAP_MODE:'task-bound-api-v1'}});await a.rejects(r.run(),/startup refused/);a.equal(r.environment.POST_VIDEO_ADMISSION_BOOTSTRAP_MODE,undefined);
});
test('other isolation controls still reject mismatch and secret transport failure closes the opted-in API',async()=>{
 const r=runtime({secret:{DEPLOYMENT_ENVIRONMENT:'staging'}});await a.rejects(r.run(),/startup refused/);
 await a.rejects(runtime({failed:true}).run(),/startup refused/);
});
test('no opt-in preserves worker/legacy environment and original production fallback',async()=>{
 const env={NODE_ENV:'production',CLIP_HLS_WORKER_ENABLED:'true',POST_VIDEO_ROLLOUT_MODE:'canary',POST_VIDEO_CANARY_USER_IDS:'a'.repeat(24)};
 const r=runtime({env,secret:{POST_VIDEO_ROLLOUT_MODE:'canary',POST_VIDEO_CANARY_USER_IDS:'a'.repeat(24),REDIS_HOST:'unchanged'}});await r.run();a.equal(r.environment.CLIP_HLS_WORKER_ENABLED,'true');a.equal(r.environment.POST_VIDEO_ROLLOUT_MODE,'canary');a.equal(r.environment.POST_VIDEO_CANARY_USER_IDS,env.POST_VIDEO_CANARY_USER_IDS);
 await runtime({env,failed:true}).run();
 const conflict=runtime({env,secret:{POST_VIDEO_ROLLOUT_MODE:'all'}});await a.rejects(conflict.run(),/startup refused/);
});
