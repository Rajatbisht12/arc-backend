'use strict';
// Artifact-only path for existing deploy.sh. No ECS, IAM, DB, queue or secret APIs.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),os=require('node:os'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),REPO='906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend';
const CONTENT='2d26090dd563b8f7cc329f6b47638b0a515db8a569df6b9d3f535760afb44329',ARCHIVE='7d198bf776ea41073c9a596625616fa141bf76b16c8f960a48bc3e6a5873d599';
const check=(v,c)=>{if(!v)throw Error(c);},hash=b=>crypto.createHash('sha256').update(typeof b==='string'||Buffer.isBuffer(b)?b:JSON.stringify(b)).digest('hex');
function source(){
 const b=fs.readFileSync(ROOT+'/release/worker-r4/source.zip'),m=JSON.parse(fs.readFileSync(ROOT+'/release/worker-r4/source-manifest.json'));
 check(b.length<4*1024**2&&hash(b)===ARCHIVE&&hash(m.files)===CONTENT&&m.contentSha256===CONTENT&&m.files.length===759,'FROZEN_SOURCE_CHANGED');
 const expected=new Map(m.files.map(x=>[x.path,x]));expected.set('.source-manifest.json',null);
 const records=new Map();let eocd=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 check(eocd>=0&&b.readUInt16LE(eocd+4)===0&&b.readUInt16LE(eocd+6)===0&&b.readUInt16LE(eocd+10)===760,'ZIP_LAYOUT');
 let at=b.readUInt32LE(eocd+16),total=0;
 for(let n=0;n<760;n++){
  check(b.readUInt32LE(at)===0x02014b50,'ZIP_DIRECTORY');const flags=b.readUInt16LE(at+8),method=b.readUInt16LE(at+10),packed=b.readUInt32LE(at+20),size=b.readUInt32LE(at+24),nameLen=b.readUInt16LE(at+28),extra=b.readUInt16LE(at+30),comment=b.readUInt16LE(at+32),offset=b.readUInt32LE(at+42),mode=b.readUInt32LE(at+38)>>>16;
  const name=b.toString('utf8',at+46,at+46+nameLen);check(!(flags&1)&&[0,8].includes(method)&&size<=16*1024**2&&expected.has(name)&&!records.has(name)&&!path.isAbsolute(name)&&!name.split('/').includes('..')&&(mode&0xf000)!==0xa000,'ZIP_ENTRY');
  check(b.readUInt32LE(offset)===0x04034b50,'ZIP_LOCAL_HEADER');const localName=b.readUInt16LE(offset+26),localExtra=b.readUInt16LE(offset+28);check(b.toString('utf8',offset+30,offset+30+localName)===name,'ZIP_LOCAL_NAME');
  const start=offset+30+localName+localExtra;check(start+packed<=b.length,'ZIP_EXTENT');const raw=method===0?b.subarray(start,start+packed):zlib.inflateRawSync(b.subarray(start,start+packed),{maxOutputLength:size});check(raw.length===size,'ZIP_SIZE');total+=size;check(total<=64*1024**2,'ZIP_TOTAL');
  const pin=expected.get(name);if(pin)check(raw.length===pin.bytes&&hash(raw)===pin.sha256,'SOURCE_FILE_PIN');else check(JSON.stringify(JSON.parse(raw))===JSON.stringify(m),'SOURCE_MANIFEST_PIN');records.set(name,raw);at+=46+nameLen+extra+comment;
 }
 check(records.size===expected.size,'SOURCE_COMPLETENESS');return{manifest:m,records};
}
function extract(directory){check(!fs.existsSync(directory),'BUILD_CONTEXT_ALREADY_EXISTS');const v=source();fs.mkdirSync(directory,{recursive:false,mode:0o700});for(const[n,b]of v.records){const p=path.join(directory,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b,{flag:'wx',mode:0o644});}return directory;}
function approval(a,revision,now=Date.now()){
 check(a?.decision==='APPROVE_WORKER_ARTIFACT_BUILD_PUSH_ONLY'&&a.sourceRevision===revision&&a.contentSha256===CONTENT&&a.archiveSha256===ARCHIVE&&a.repository===REPO&&/^[a-z0-9-]{8,80}$/.test(a.runId||'')&&a.tag===a.runId,'EXACT_ARTIFACT_APPROVAL_REQUIRED');
 check(Number.isSafeInteger(a.approvedAt)&&a.approvedAt<=now&&now-a.approvedAt<1800000&&a.maxBuilds===1&&a.maxPushes===1&&a.providerMutationsBeyondImagePush===0&&['default','desktop-linux'].includes(a.dockerContext),'ARTIFACT_APPROVAL_WINDOW');
}
function digests(metadata,raw){
 const index=metadata['containerimage.digest'];check(/^sha256:[a-f0-9]{64}$/.test(index||'')&&raw.length<=1048576,'BUILT_INDEX_REQUIRED');
 const parsed=JSON.parse(raw),children=parsed.manifests?.filter(x=>x.platform?.os==='linux'&&x.platform?.architecture==='amd64');
 check(parsed.mediaType==='application/vnd.oci.image.index.v1+json'&&children?.length===1&&/^sha256:[a-f0-9]{64}$/.test(children[0].digest),'ONE_LINUX_AMD64_CHILD_REQUIRED');
 // Registry raw output may include a CLI-added trailing newline; digest only
 // the exact JSON bytes when it does. Accept no reserialized approximation.
 check('sha256:'+hash(raw)===index||(raw.at(-1)===10&&'sha256:'+hash(raw.subarray(0,-1))===index),'REGISTRY_INDEX_DIGEST_MISMATCH');return{indexDigest:index,linuxAmd64ChildDigest:children[0].digest};
}
function command(exe,args,options={}){const r=spawnSync(exe,args,{encoding:'utf8',maxBuffer:2*1024**2,timeout:30000,...options});check(r.status===0&&!r.error,'ARTIFACT_COMMAND_FAILED_OR_UNKNOWN');return r.stdout;}
function build(a,journal,io=command){
 const revision=io('git',['rev-parse','HEAD']).trim();check(/^[a-f0-9]{40}$/.test(revision)&&!io('git',['status','--porcelain','--untracked-files=all']).trim(),'CLEAN_MERGED_SOURCE_REQUIRED');approval(a,revision);source();
 check(path.isAbsolute(journal)&&!fs.existsSync(journal)&&!journal.startsWith(ROOT+path.sep),'EXCLUSIVE_EXTERNAL_JOURNAL_REQUIRED');fs.mkdirSync(journal,{mode:0o700});
 const save=(n,v)=>{const f=fs.openSync(path.join(journal,n),'wx',0o600);fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(f);fs.closeSync(f);const d=fs.openSync(journal,'r');fs.fsyncSync(d);fs.closeSync(d);};
 save('consumed.json',{runId:a.runId,at:Date.now(),oneBuildPushMaximum:true});let pass=false;
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AWS_')));Object.assign(env,{AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_PAGER:''});
 const docker=(args,options)=>io('docker',['--context',a.dockerContext,...args],options);
 const aws=(...args)=>io('aws',[...args,'--profile','default','--region','us-east-1'],{env});
 try{
  const who=JSON.parse(aws('sts','get-caller-identity'));check(who.Account==='906446637180'&&who.Arn==='arn:aws:iam::906446637180:root','ARTIFACT_CALLER_CHANGED');
  const endpoint=JSON.parse(docker(['context','inspect',a.dockerContext,'--format','{{json .Endpoints.docker.Host}}']));check(typeof endpoint==='string'&&(endpoint.startsWith('unix:///')||endpoint.startsWith('npipe:')),'LOCAL_DOCKER_ENDPOINT_REQUIRED');
  check(docker(['buildx','inspect',a.dockerContext,'--format','{{.Driver}}']).trim()==='docker','EXISTING_LOCAL_DOCKER_DRIVER_REQUIRED');
  const context=extract(path.join(journal,'context'));const password=aws('ecr','get-login-password');docker(['login','--username','AWS','--password-stdin',REPO.split('/')[0]],{input:password,timeout:30000});
  approval(a,revision);save('build-push-intent.json',{at:Date.now(),sourceRevision:revision,contentSha256:CONTENT,tag:a.tag,attempts:1});
  const metadata=path.join(journal,'build-metadata.json'),image=REPO+':'+a.tag;
  docker(['buildx','build','--builder',a.dockerContext,'--platform','linux/amd64','--provenance=mode=min','--output=type=registry,oci-mediatypes=true','--metadata-file',metadata,'--build-arg','SOURCE_REVISION='+revision,'--build-arg','SOURCE_REPOSITORY=https://github.com/vortica-labs/arc-backend','--label','com.squadhunt.worker.source-content='+CONTENT,'-t',image,context],{timeout:900000,maxBuffer:1048576});
  const m=JSON.parse(fs.readFileSync(metadata));const raw=Buffer.from(docker(['buildx','imagetools','inspect','--raw',REPO+'@'+m['containerimage.digest']]));const observed=digests(m,raw);
  check(Date.now()<a.approvedAt+1800000,'ARTIFACT_FINAL_EXPIRED');save('artifact-receipt.json',{...observed,image,sourceRevision:revision,sourceContentSha256:CONTENT,at:Date.now(),ecsChanges:0,apiChanges:0,workerChanges:0});pass=true;return observed;
 }finally{save('authority-closed.json',{status:pass?'CLOSED_PASS':'CLOSED_HOLD',at:Date.now(),remainingBuilds:0,remainingPushes:0,ecsAuthority:0});}
}
function main(){process.chdir(ROOT);const mode=process.argv[2];if(mode==='plan'){source();console.log(JSON.stringify({kind:'WORKER_ARTIFACT_ONLY',contentSha256:CONTENT,archiveSha256:ARCHIVE,files:759,imageDigest:null,ecsAuthority:0,executionApproved:false}));return;}
 check(mode==='build','WORKER_ARTIFACT_MODE_REQUIRED');const a=JSON.parse(fs.readFileSync(process.env.WORKER_ARTIFACT_APPROVAL||''));build(a,process.env.WORKER_ARTIFACT_JOURNAL);console.log('WORKER_ARTIFACT_BUILT_AND_CLOSED_NO_DEPLOYMENT');}
module.exports={source,extract,approval,digests,build,CONTENT,ARCHIVE,REPO};
if(require.main===module){try{main();}catch{console.error('WORKER_ARTIFACT_HELD_NO_RETRY');process.exitCode=1;}}
