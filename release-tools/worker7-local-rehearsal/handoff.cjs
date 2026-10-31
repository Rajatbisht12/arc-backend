'use strict';
// HOST ONLY. No AWS SDK/CLI, deployment, provider call or cloud credential forwarding.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code);};
const image='906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend@sha256:144b96e60256405280f77b29269595e04ff18ae5561310b87171d35bd7c04f1f';
const content='e97f4a2f4a90620f7294855689df2313c56f5a59700c24b769efc844d8126b22';
const fixture='0dc4f0364b721ee47361d11f885393117905475750c9bc30dfc429003bb556a3';
function verify(base) {
 const m=JSON.parse(fs.readFileSync(path.join(base,'bundle-manifest.json')));
 check(m.scope==='LOCAL_ONLY_NO_AWS_MUTATIONS'&&m.files.length===9,'EXACT_LOCAL_BUNDLE_REQUIRED');
 for(const f of m.files){check(/^[A-Za-z0-9_.-]+$/.test(f.path),'SAFE_BUNDLE_PATH');const p=path.join(base,f.path),s=fs.lstatSync(p);
  check(s.isFile()&&!s.isSymbolicLink()&&s.size===f.bytes&&hash(fs.readFileSync(p))===f.sha256,'BUNDLE_FILE_CHANGED');}
 return m;
}
function verifyResults(dir) {
 const read=(name,max)=>{const p=path.join(dir,name),s=fs.lstatSync(p);
  check(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=max,'SAVED_RESULT_FILE_SHAPE');return fs.readFileSync(p);};
 const receipt=JSON.parse(read('receipt.json',32768).toString()),bytes=read('rehearsal.log',16*1024*1024),log=bytes.toString();
 check(receipt.scope==='LOCAL_ONLY_NOT_AWS_RECOVERY'&&receipt.platform==='linux'&&receipt.architecture==='x64'
  &&receipt.contentSha256===content&&receipt.fixtureSha256===fixture&&receipt.filesVerified===755
  &&receipt.testsExpected===21&&receipt.exitCode===0&&receipt.signal===null&&receipt.timedOut===false&&receipt.passed===true
  &&receipt.awsMutations===0&&receipt.documentDb5WritesVerified===false&&receipt.s3Verified===false
  &&receipt.mockStorageBoundaryCases===true&&receipt.acceleratedLocalLeases===true&&receipt.realApprovedFixtureEncode===true,'LINUX_RECEIPT_NOT_VERIFIED');
 check(hash(bytes)===receipt.logSha256,'SAVED_LOG_HASH_MISMATCH');
 for(const line of ['1..21','# tests 21','# pass 21','# fail 0','# cancelled 0','# skipped 0'])
  check(log.split(/\r?\n/).includes(line),'SAVED_TAP_SUMMARY_NOT_VERIFIED');
 const oks=[...log.matchAll(/^ok (\d+) - /gm)].map(m=>Number(m[1]));
 check(oks.length===21&&oks.every((n,i)=>n===i+1)&&!/^not ok /m.test(log),'SAVED_TAP_CASES_NOT_VERIFIED');
 const encoded=log.split(/\r?\n/).filter(l=>l.startsWith('# {"event":"local_real_encoder_result",'));
 check(encoded.length===1,'REAL_ENCODER_EVIDENCE_REQUIRED');const encode=JSON.parse(encoded[0].slice(2));
 check(encode.cloud===false&&encode.canonicalCount===1&&encode.fallbackCodec==='h264'
  &&Number.isFinite(encode.seconds)&&encode.seconds>0&&encode.maxObservedFallbackFps<=30,'REAL_ENCODER_EVIDENCE_REQUIRED');
 check(Number.isFinite(Date.parse(receipt.startedAt))&&Date.parse(receipt.finishedAt)>=Date.parse(receipt.startedAt),'SAVED_RESULT_CLOCK');
 return {verdict:'LOCAL_LINUX_TEST_RESULTS_VERIFIED_NOT_AWS_RECOVERY',receipt,receiptSha256:hash(JSON.stringify(receipt)),
  encode,orchestrationStatus:'not established by saved test results alone',awsCalls:0,dockerCalls:0};
}
function runLocal(base,io={}) {
 const spawn=io.spawn||cp.spawnSync,clock=io.clock||(()=>performance.now()),random=io.random||(()=>crypto.randomBytes(8).toString('hex'));
 const deadline=clock()+900000,project='worker7-local-'+random();check(/^worker7-local-[a-f0-9]{16}$/.test(project),'EXACT_LOCAL_PROJECT');
 const results=path.join(base,'results');fs.mkdirSync(results,{recursive:true});
 check(fs.readdirSync(results).length===0,'PRESERVE_PRIOR_RESULTS_USE_FRESH_BUNDLE_COPY');
 if(process.platform!=='win32')fs.chmodSync(results,0o777);
 const trace={project,startedAt:new Date().toISOString(),steps:[],passed:false,awsCalls:0};
 const save=()=>fs.writeFileSync(path.join(results,'orchestration.json'),JSON.stringify(trace,null,2)+'\n');save();
 const command=(args,label,maximum=30000,inherit=false,cleanup=false)=>{
  const timeout=cleanup?60000:Math.min(maximum,Math.max(1,deadline-clock()));
  const r=spawn('docker',args,{cwd:base,encoding:'utf8',timeout,maxBuffer:16*1024*1024,...(inherit?{stdio:'inherit'}:{})});
  trace.steps.push({step:label,status:r.status??null,signal:r.signal??null,errorCode:r.error?.code||null});save();
  check(r.status===0&&!r.error&&!r.signal,'DOCKER_'+label+'_FAILED');return r.stdout||'';
 };
 const compose=['compose','--project-name',project,'--file',path.join(base,'compose.yaml')];
 let created=false,failure=null,proof;
 try {
  const info=JSON.parse(command(['image','inspect',image],'IMAGE_INSPECT'))[0];
  check(info.Os==='linux'&&info.Architecture==='amd64'&&info.Config?.Labels?.['io.squadhunt.source-content-sha256']===content,'PULL_EXACT_FROZEN_WORKER7_IMAGE_FIRST');
  check(!command(['ps','-aq','--filter','label=com.docker.compose.project='+project],'PREEXISTING_CONTAINERS').trim(),'LOCAL_PROJECT_COLLISION');
  check(!command(['network','ls','-q','--filter','label=com.docker.compose.project='+project],'PREEXISTING_NETWORKS').trim(),'LOCAL_PROJECT_COLLISION');
  // Detach from Compose's interactive abort/exit propagation. Observe the actual owned runner instead.
  created=true;command([...compose,'up','--detach'],'UP',300000,true);
  const cid=command([...compose,'ps','--all','--quiet','runner'],'RUNNER_BIND').trim();
  check(/^[a-f0-9]{64}$/.test(cid),'EXACT_RUNNER_ID_REQUIRED');trace.runnerId=cid;save();
  const inspect=()=>{
   const a=JSON.parse(command(['inspect',cid],'RUNNER_INSPECT'));check(a.length===1,'EXACT_RUNNER_ID_REQUIRED');const t=a[0];
   check(t.Id===cid&&t.Config?.Image===image&&t.Config?.Labels?.['com.docker.compose.project']===project
    &&t.Config?.Labels?.['com.docker.compose.service']==='runner','FOREIGN_RUNNER_REJECTED');return t;
  };
  inspect();const status=command(['wait',cid],'WAIT',Math.max(1,deadline-clock())).trim();
  check(status==='0','RUNNER_EXIT_NONZERO');const terminal=inspect();
  trace.runnerExitCode=terminal.State?.ExitCode;trace.runnerFinishedAt=terminal.State?.FinishedAt;save();
  check(terminal.State?.Status==='exited'&&terminal.State.Running===false&&terminal.State.ExitCode===0
   &&terminal.State.OOMKilled===false&&!terminal.State.Error,'RUNNER_NOT_SUCCESSFULLY_STOPPED');
  const consoleLog=command(['logs',cid],'RUNNER_LOGS');fs.writeFileSync(path.join(results,'runner-console.log'),consoleLog);
  proof=verifyResults(results);trace.testResultsVerified=true;
 }catch(e){failure=e;trace.failure=e.message;}
 finally {
  if(created)try{
   command([...compose,'down','--remove-orphans'],'DOWN',60000,true,true);
   check(!command(['ps','-aq','--filter','label=com.docker.compose.project='+project],'FINAL_CONTAINERS',60000,false,true).trim(),'LOCAL_CONTAINERS_REMAIN');
   check(!command(['network','ls','-q','--filter','label=com.docker.compose.project='+project],'FINAL_NETWORKS',60000,false,true).trim(),'LOCAL_NETWORKS_REMAIN');
   trace.cleanupAbsenceVerified=true;
  }catch(e){trace.cleanupFailure=e.message;if(!failure)failure=e;}
  trace.finishedAt=new Date().toISOString();trace.passed=!failure&&Boolean(proof)&&trace.cleanupAbsenceVerified===true;save();
 }
 if(failure)throw failure;
 check(trace.passed,'LOCAL_REHEARSAL_FAILED_PRESERVE_RESULTS');
 return {project,receipt:path.join(results,'receipt.json'),receiptSha256:proof.receiptSha256,
  verdict:'LOCAL_LINUX_REHEARSAL_PASSED_NOT_AWS_RECOVERY',orchestration:path.join(results,'orchestration.json')};
}
function main(args) {
 check(args.length>=1&&['--check','--run-local','--verify-results'].includes(args[0]),'USE_CHECK_RUN_LOCAL_OR_VERIFY_RESULTS');
 check(args.length===(args[0]==='--verify-results'?2:1),'EXACT_LOCAL_ARGUMENTS_REQUIRED');const base=__dirname,m=verify(base);
 if(args[0]==='--check'){console.log(JSON.stringify({mode:'check',bundleSha256:hash(JSON.stringify(m)),filesVerified:m.files.length,awsMutations:0}));return;}
 if(args[0]==='--verify-results'){console.log(JSON.stringify(verifyResults(path.resolve(args[1])),null,2));return;}
 console.log(JSON.stringify(runLocal(base),null,2));
}
module.exports={verify,verifyResults,runLocal,main};
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
