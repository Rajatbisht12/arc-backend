'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>sha(JSON.stringify(canonical(v)));
const ROOT=__dirname, RUN='pi-worker-witness-image-r2-20261105', TAG='pi-worker-witness-image-r1-20261104';
const ARCHIVE='ea7e42a18aabfb4a7a593dc42bd949c8fe7b1fbfabf9cd6e5b39d158432729a9';
const SOURCE='b218854cef02d1a23cde91b79dee8801eaad3a79c5e06e5cd130e0758d876856';
const FILES='8ea9ae7dbf7f6bdacb4d8a4b659ce00dcc23cb53fa24479efa66471295916a33';
const REPO='906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend';
function check(ok,code){if(!ok)throw Error(code);}
function unpack(raw){
  check(sha(raw)===ARCHIVE,'ARCHIVE_CHANGED');
  const data=JSON.parse(zlib.gunzipSync(raw,{maxOutputLength:40000000}));
  check(sha(JSON.stringify(data.sha256))===FILES,'MANIFEST_CHANGED');
  check(Object.keys(data.files).length===761&&Object.keys(data.sha256).length===761,'FILE_SET_CHANGED');
  const rows=[];
  for(const [name,digest] of Object.entries(data.sha256)){
    check(/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').some(x=>!x||x==='.'||x==='..'),'ARCHIVE_PATH_REJECTED');
    check(typeof data.files[name]==='string','ARCHIVE_RECORD_REJECTED');
    const bytes=Buffer.from(data.files[name],'base64');
    check(sha(bytes)===digest,'SOURCE_BYTES_CHANGED');rows.push([name,bytes]);
  }
  const manifest=JSON.parse(rows.find(([name])=>name==='.source-manifest.json')[1]);
  const records=Object.fromEntries(rows.filter(([name])=>name!=='.source-manifest.json').map(([name,bytes])=>[name,{sha256:sha(bytes),bytes:bytes.length}]));
  check(hash(records)===SOURCE&&hash(manifest.files)===SOURCE&&manifest.sourceContentSha256===SOURCE&&manifest.parentRelease==='WORKER8'&&manifest.parentImageIndex==='sha256:60c9b9deeaeec4c46c9847fdfef437901c109a871feb3f295821e963ca4b7fe6','SOURCE_CONTENT_CHANGED');
  const plan=JSON.parse(fs.readFileSync(path.join(ROOT,'build-plan.json')));parentDelta(records,plan.parentFiles);
  return rows;
}
function parentDelta(records,parent){
 check(hash(parent)==='3cab7c55b0bd6e6421435633aa801c1166c2e17dee05e8cce0d63d7aebc7f134','PARENT_FILE_RECORDS_CHANGED');
 check(Object.keys(records).length===760&&Object.keys(parent).length===760&&hash(Object.keys(records).sort())===hash(Object.keys(parent).sort()),'PARENT_FILE_SET_CHANGED');
 const changed=Object.keys(records).filter(k=>hash(records[k])!==hash(parent[k]));
 check(changed.length===1&&changed[0]==='src/legacy-src/utils/clipHlsProcessing.js'&&parent[changed[0]].sha256==='38616e86a550cd9d1bba5a72f2b89b22421a11e7fd69102a920925cbd042c06f'&&records[changed[0]].sha256==='768e257d19e7d68e916a387f8b0c13ee3135c0538a7542e631187c32127f2a6a','ONLY_WITNESS_RUNNER_CHANGE_REQUIRED');
 return {changedFiles:changed,unchangedFiles:759,encodingFlagsOrDependenciesChanged:false};
}
function parseBuilder(raw){
  const p=raw.replace(/\r\n/g,'\n').split(/^\s*Nodes:\s*$/m);
  check(p.length===2,'BUILDER_NODES_INVALID');
  const get=(s,k)=>{const a=[...s.matchAll(new RegExp('^'+k+':[ \\t]*(.*)$','gm'))];check(a.length===1,'BUILDER_FIELD_INVALID');return a[0][1].trim();};
  const b={name:get(p[0],'Name'),driver:get(p[0],'Driver'),node:get(p[1],'Name'),endpoint:get(p[1],'Endpoint'),status:get(p[1],'Status'),platforms:get(p[1],'Platforms')};
  check(b.name==='desktop-linux'&&['docker','docker-container'].includes(b.driver)&&b.node==='desktop-linux'&&b.endpoint==='desktop-linux'&&b.status==='running'&&/(?:^|,\s*)linux\/amd64(?:\*|,|$)/.test(b.platforms),'EXISTING_LOCAL_BUILDER_REQUIRED');return b;
}
function registry(raw,digest){
  const index=JSON.parse(raw),a=index.manifests?.filter(m=>m.platform?.os==='linux'&&m.platform?.architecture==='amd64');
  check(['sha256:'+sha(raw),'sha256:'+sha(raw.at(-1)===10?raw.subarray(0,-1):raw)].includes(digest),'INDEX_DIGEST_MISMATCH');
  check(index.mediaType==='application/vnd.oci.image.index.v1+json'&&a?.length===1&&/^sha256:[a-f0-9]{64}$/.test(a[0].digest),'AMD64_MANIFEST_INVALID');return a[0].digest;
}
function validateApproval(a,plan,now=Date.now()){
 check(a?.decision==='APPROVE_EXACT_WITNESS_R2_SAME_TAG_NEW_JOURNAL_BUILD_PUSH_ONLY'&&a.scopeSha256===hash(plan)&&a.exclusiveNewTagBuilderAndJournal===true&&a.sealedArchiveCarrierLabelOnly===true&&a.priorInvocationFinished===true&&a.priorArtifactsPreserved===true&&a.sameTagNewJournalOnly===true,'EXACT_APPROVAL_REQUIRED');
 check(Number.isSafeInteger(a.approvedAt)&&now>=a.approvedAt&&now-a.approvedAt<1800000,'APPROVAL_EXPIRED');
 for(const p of plan.controls)check(sha(fs.readFileSync(path.resolve(ROOT,p.path)))===p.sha256,'CONTROL_CHANGED');return a;
}
function priorState(base){
 const old='pi-worker-witness-image-r1-20261104',root=path.join(base,'SquadHuntRelease'),journal=path.join(root,old+'-consumed');
 const read=f=>{const s=fs.lstatSync(f);check(s.isFile()&&!s.isSymbolicLink()&&s.size<=65536,'PRIOR_FILE_SHAPE');const b=fs.readFileSync(f);check(b.length<=65536,'PRIOR_FILE_BOUND');return{sha256:sha(b),v:JSON.parse(b)};};
 const js=fs.lstatSync(journal);check(js.isDirectory()&&!js.isSymbolicLink(),'PRIOR_JOURNAL_REQUIRED');check(JSON.stringify(fs.readdirSync(journal).sort())===JSON.stringify(['approval.json','consumed.json','context','identity-intent.json'].sort()),'PRIOR_JOURNAL_STATE_CHANGED');const cs=fs.lstatSync(path.join(journal,'context'));check(cs.isDirectory()&&!cs.isSymbolicLink(),'PRIOR_CONTEXT_SHAPE');
 const external=read(path.join(root,old+'-approval.json')),inside=read(path.join(journal,'approval.json'));check(external.sha256==='70224f50e312d1126087e40171ab081bfccb8f890b5e0efdbd694e2a6c1cb6ba'&&inside.sha256===external.sha256,'PRIOR_APPROVAL_CHANGED');
 const consumed=read(path.join(journal,'consumed.json')),identity=read(path.join(journal,'identity-intent.json'));check(consumed.v.runId===old&&consumed.v.sourceContentSha256===SOURCE&&consumed.v.archiveSha256===ARCHIVE&&consumed.v.ecsAuthority===0&&Number.isSafeInteger(consumed.v.at)&&consumed.v.at>=1793816447480,'PRIOR_CONSUMED_CHANGED');check(identity.v.at>=consumed.v.at&&Number.isSafeInteger(identity.v.at)&&identity.v.at<=Date.now()&&identity.v.attempt===1&&JSON.stringify(identity.v.operation)===JSON.stringify(['sts','get-caller-identity']),'PRIOR_IDENTITY_INTENT_CHANGED');
 return{priorRunId:old,externalApprovalSha256:external.sha256,journalApprovalSha256:inside.sha256,consumedSha256:consumed.sha256,identityIntentSha256:identity.sha256,priorBuildIntentPresent:false,priorClosurePresent:false,priorOutcome:'UNRESOLVED_IDENTITY_READ',terminalFinishedEvidence:'OWNER_REPORTED',priorFilesWritten:0};
}
function execute(){
  check(process.platform==='win32'&&process.env.LOCALAPPDATA,'WINDOWS_DOCKER_LAPTOP_REQUIRED');
  const plan=JSON.parse(fs.readFileSync(path.join(ROOT,'build-plan.json')));
  check(plan.runId===RUN&&plan.tag===TAG&&plan.repository===REPO&&plan.sourceContentSha256===SOURCE&&plan.archiveSha256===ARCHIVE,'PLAN_CHANGED');
  check(process.argv.length===3,'APPROVAL_FILE_REQUIRED');const approval=validateApproval(JSON.parse(fs.readFileSync(process.argv[2])),plan);
  const rows=unpack(fs.readFileSync(path.join(ROOT,'source.json.gz')));
  const prior=priorState(process.env.LOCALAPPDATA);
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AWS_')));
  Object.assign(env,{AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off'});
  const invoke=(exe,args,options={})=>{const r=spawnSync(exe,args,{cwd:ROOT,env,encoding:'utf8',timeout:30000,maxBuffer:1048576,...options});check(!r.error&&!r.signal&&r.status===0,'COMMAND_FAILED_OR_UNKNOWN');return r.stdout;};
  const docker=(args,options)=>invoke('docker',['--context','desktop-linux',...args],options);
  const revision=invoke('git',['rev-parse','HEAD']).trim();check(/^[a-f0-9]{40}$/.test(revision)&&invoke('git',['status','--porcelain']).trim()==='','CARRIER_REVISION_OR_TREE_CHANGED');
  const host=JSON.parse(docker(['context','inspect','desktop-linux','--format','{{json .Endpoints.docker.Host}}']));
  check(typeof host==='string'&&host.startsWith('npipe:'),'LOCAL_NAMED_PIPE_REQUIRED');
  const builder=parseBuilder(docker(['buildx','inspect','desktop-linux']));
  const journal=path.join(process.env.LOCALAPPDATA,'SquadHuntRelease',RUN+'-consumed');
  check(!fs.existsSync(journal),'ALREADY_CONSUMED_NO_RETRY');fs.mkdirSync(path.dirname(journal),{recursive:true});fs.mkdirSync(journal);
  const save=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),f=path.join(journal,name+'.json'),fd=fs.openSync(f,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}check(fs.readFileSync(f).equals(bytes),'JOURNAL_WRITE_UNKNOWN');};
  const awsArgs=args=>[...args,'--profile','default','--region','us-east-1','--no-paginate','--cli-connect-timeout','10','--cli-read-timeout','25'];
  let stage='RECEIPT',status='CLOSED_HOLD',reason=null,awsAttempts=0,builds=0,registryReads=0,artifact=null;
  const aws=(name,args)=>{save(name+'-intent',{at:Date.now(),attempt:1,operation:args.slice(0,2)});awsAttempts++;return invoke('aws',awsArgs(args));};
  try{
    save('approval',approval);save('prior-state',prior);
    save('consumed',{at:Date.now(),request:'approved exact witness-only worker image publication',runId:RUN,sourceContentSha256:SOURCE,archiveSha256:ARCHIVE,builder,ecsAuthority:0});
    const context=path.join(journal,'context');fs.mkdirSync(context);
    for(const [name,bytes] of rows){const f=path.join(context,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,bytes,{flag:'wx'});check(sha(fs.readFileSync(f))===sha(bytes),'CONTEXT_WRITE_UNKNOWN');}
    validateApproval(approval,plan);check(hash(priorState(process.env.LOCALAPPDATA))===hash(prior),'PRIOR_STATE_DRIFT');
    stage='IDENTITY';const who=JSON.parse(aws('identity',['sts','get-caller-identity','--output','json']));
    check(who.Account==='906446637180'&&who.Arn==='arn:aws:iam::906446637180:root','CALLER_CHANGED');
    stage='TAG_ABSENCE';save('tag-absence-intent',{at:Date.now(),tag:TAG,attempt:1});awsAttempts++;
    const r=spawnSync('aws',awsArgs(['ecr','describe-images','--registry-id','906446637180','--repository-name','arc-backend','--image-ids','imageTag='+TAG,'--output','json']),{env,encoding:'utf8',timeout:30000,maxBuffer:1048576});
    check(!r.error&&!r.signal&&r.status!==null&&r.status!==0&&/\(ImageNotFoundException\)/.test(r.stderr||''),'TAG_NOT_POSITIVELY_ABSENT');const absenceAt=Date.now();
    stage='LOGIN';const password=aws('authentication',['ecr','get-login-password']);save('login-intent',{at:Date.now(),passwordStdin:true});docker(['login','--username','AWS','--password-stdin',REPO.split('/')[0]],{input:password});
    validateApproval(approval,plan);
    check(Date.now()-absenceAt<300000,'TAG_EVIDENCE_STALE');
    stage='BUILD_PUSH';save('build-push-intent',{at:Date.now(),image:REPO+':'+TAG,archiveSha256:ARCHIVE,attempt:1});builds++;
    const metadata=path.join(journal,'metadata.json');
    docker(['buildx','build','--builder','desktop-linux','--platform','linux/amd64','--provenance=mode=min','--output=type=registry,oci-mediatypes=true','--metadata-file',metadata,'--build-arg','SOURCE_REVISION='+revision,'--build-arg','SOURCE_REPOSITORY=https://github.com/vortica-labs/arc-backend','--label','com.squadhunt.worker.source-content='+SOURCE,'-t',REPO+':'+TAG,context],{timeout:900000});
    stage='BUILD_ACK';check(fs.statSync(metadata).size<1048576,'BUILD_METADATA_INVALID');const m=JSON.parse(fs.readFileSync(metadata)),digest=m['containerimage.digest'];check(/^sha256:[a-f0-9]{64}$/.test(digest||''),'BUILD_ACK_UNKNOWN');save('build-ack',{at:Date.now(),indexDigest:digest});
    stage='REGISTRY';save('registry-intent',{at:Date.now(),indexDigest:digest,attempt:1});registryReads++;
    const raw=Buffer.from(docker(['buildx','imagetools','inspect','--raw',REPO+'@'+digest]));const child=registry(raw,digest);
    check(Date.now()-approval.approvedAt<1800000,'PUBLICATION_FINISH_EXPIRED');
    artifact={at:Date.now(),runId:RUN,image:REPO+':'+TAG,indexDigest:digest,amd64ChildDigest:child,sourceContentSha256:SOURCE,archiveSha256:ARCHIVE,carrierRevision:revision,ecsAuthority:0};save('artifact-receipt',artifact);status='CLOSED_WORKER_WITNESS_IMAGE_PUBLISHED_NO_DEPLOYMENT';stage='RECEIPT';
  }catch(e){reason=/^[A-Z0-9_]+$/.test(e.message)?e.message:'UNKNOWN_LOCAL_OR_PROVIDER_OUTCOME';}
  finally{save('authority-closed',{at:Date.now(),status,stage,reason,awsAttempts,builds,registryReads,remainingBuilds:0,remainingPushes:0,remainingReads:0,ecsAuthority:0});}
  console.log(JSON.stringify({status,stage,reason,journal,awsAttempts,builds,registryReads,...(artifact?{artifact}:{})},null,2));if(reason)process.exitCode=1;
}
module.exports={unpack,parseBuilder,registry,validateApproval,hash,parentDelta,priorState,execute};
if(require.main===module){try{execute();}catch(e){console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'LOCAL_PRECHECK_FAILED_NO_AWS');process.exitCode=1;}}
