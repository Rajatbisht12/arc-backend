'use strict';
// Local source packaging only. No Docker, AWS client, credentials or publication.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),BASE=require('../play-integrity-worker-r5/pr-overlay/scripts/lib/worker-artifact.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function prepare(){
 const prior=BASE.source(),records=new Map(prior.records);records.delete('.source-manifest.json');
 const overlay=['src/legacy-src/utils/clipHlsProcessing.js','src/legacy-src/utils/videoProcessing.js','src/legacy-src/utils/legacyVideoPlayback.js','src/legacy-src/services/clipTranscodingService.js','src/legacy-src/models/Post.js'];
 const changes=overlay.map(name=>{const b=fs.readFileSync(path.join(ROOT,name)),old=records.get(name);records.set(name,b);return{path:name,beforeSha256:old?sha(old):null,sha256:sha(b),bytes:b.length};});
 const files=[...records].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,b])=>({path:name,bytes:b.length,sha256:sha(b)}));
 const manifest={kind:'WORKER_ONLY_FORMAT_PRIVATE_LEGACY_SOURCE',baseArchiveSha256:BASE.ARCHIVE,baseContentSha256:BASE.CONTENT,files,contentSha256:sha(JSON.stringify(files))};
 const d=path.join(__dirname,'release/worker-format-r1');fs.mkdirSync(d,{recursive:true});
 fs.writeFileSync(path.join(d,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arc-private-worker-context-'));
 try{for(const[name,b]of records){const target=path.join(temp,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);}fs.copyFileSync(path.join(d,'source-manifest.json'),path.join(temp,'.source-manifest.json'));
 const code="import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for p in sorted(r.rglob('*')):\n  if p.is_file():\n   i=zipfile.ZipInfo(p.relative_to(r).as_posix(),date_time=(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,p.read_bytes())\n";
 const zip=spawnSync('python3',['-c',code,temp,path.join(d,'source.zip')],{encoding:'utf8',timeout:30000});if(zip.status!==0)throw Error('LOCAL_SOURCE_ARCHIVE_FAILED');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 const artifact={kind:'NEW_WORKER_IMAGE_CANDIDATE_NOT_BUILT',runId:'pi-worker-format-legacy-r1-20261101',repository:BASE.REPO,tag:'pi-worker-format-legacy-r1-20261101',platform:'linux/amd64',sourceFiles:files.length,sourceContentSha256:manifest.contentSha256,sourceArchiveSha256:sha(fs.readFileSync(path.join(d,'source.zip'))),overlay:changes,dependenciesAndDockerfileUnchanged:true,indexDigest:null,amd64ChildDigest:null,buildPushApproved:false,providerAuthority:0,previousProtectedArtifact:{index:'sha256:ffff210127eb3512a0a7f5967a6a28e08dbd5a10e3c0d8745a234ee5bece2e8a',child:'sha256:0e0c1b9a1cc850a2d9100b6a7245e324d95b93ec879388d4e27315b7952821da',automaticRollbackAllowed:false},activation:'new worker first under Q0/work-preserving release; API legacy flag remains off until matching worker is native-qualified'};
 artifact.workerOnly=true;artifact.apiDeploymentForbidden=true;artifact.previousProtectedArtifact.canProcessNewPrivateLegacyJobs=false;
 fs.writeFileSync(path.join(__dirname,'worker-artifact.PROPOSED.json'),JSON.stringify(artifact,null,2)+'\n');
 const task=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/evidence/worker-r7-acceleration-preparation-2026-11-01/worker-task.PROPOSAL_ONLY.json')));task.containerDefinitions[0].image=BASE.REPO+'@sha256:UNBOUND_NEW_NATIVE_DIGEST_REQUIRED';
 fs.writeFileSync(path.join(__dirname,'worker-task.UNBOUND.json'),JSON.stringify(task,null,2)+'\n');
 const controls=['build-once.cjs','verify.cjs','controls.test.cjs','prepare.cjs','worker-artifact.PROPOSED.json','release/worker-format-r1/source-manifest.json'].map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(__dirname,p)))}));
 const plan={kind:'WORKER_FORMAT_IMAGE_PUBLICATION_ONLY_UNAPPROVED',runId:artifact.runId,repository:artifact.repository,tag:artifact.tag,sourceContentSha256:artifact.sourceContentSha256,sourceArchiveSha256:artifact.sourceArchiveSha256,controls,headResolver:'CLEAN_MERGED_CARRIER_HEAD_LABEL_ONLY_V1; exact archive supplies all build bytes',platform:'linux/amd64',operatorPlatform:'Windows',dockerContext:'desktop-linux',driver:'docker',maximumAwsReadAttempts:3,maximumBuildPushInvocations:1,maximumRegistryIndexReads:1,approvalMinutes:30,buildCommandSeconds:900,otherCommandSeconds:30,remainingDeploymentAuthority:0,privateKeyAccess:0,unapprovedCleanup:0,unknownAcknowledgement:'HOLD_NO_RETRY',ordinaryRegistryStorageTransferAndScanningCosts:true,hardBillingCapClaimed:false};
 fs.writeFileSync(path.join(__dirname,'build-plan.json'),JSON.stringify(plan,null,2)+'\n');
 return artifact;
}
module.exports={prepare};if(require.main===module)console.log(JSON.stringify(prepare(),null,2));
