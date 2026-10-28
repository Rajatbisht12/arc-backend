'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const H=require('./handoff.cjs'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const image='906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend@sha256:144b96e60256405280f77b29269595e04ff18ae5561310b87171d35bd7c04f1f';
function saved(dir,change){
 fs.mkdirSync(dir,{recursive:true});
 let log=Array.from({length:21},(_,i)=>'ok '+(i+1)+' - fixture case '+(i+1)).join('\n')+
  '\n# {"event":"local_real_encoder_result","seconds":17.83,"fallbackCodec":"h264","maxObservedFallbackFps":24,"canonicalCount":1,"cloud":false}\n'+
  '1..21\n# tests 21\n# pass 21\n# fail 0\n# cancelled 0\n# skipped 0\n';
 const receipt={scope:'LOCAL_ONLY_NOT_AWS_RECOVERY',platform:'linux',architecture:'x64',
  contentSha256:'e97f4a2f4a90620f7294855689df2313c56f5a59700c24b769efc844d8126b22',
  fixtureSha256:'0dc4f0364b721ee47361d11f885393117905475750c9bc30dfc429003bb556a3',filesVerified:755,testsExpected:21,
  exitCode:0,signal:null,timedOut:false,passed:true,awsMutations:0,documentDb5WritesVerified:false,s3Verified:false,
  mockStorageBoundaryCases:true,acceleratedLocalLeases:true,realApprovedFixtureEncode:true,
  startedAt:'2026-10-28T07:58:15.383Z',finishedAt:'2026-10-28T07:58:55.718Z',logSha256:hash(log)};
 if(change){const x=change(receipt,log);if(typeof x==='string')log=x;}
 fs.writeFileSync(path.join(dir,'rehearsal.log'),log);fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt));return receipt;
}
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'worker7-host-launcher-test-'));
function harness(change={}){
 const base=temp(),calls=[],cid='a'.repeat(64),project='worker7-local-0123456789abcdef';let waited=false;
 const spawn=(bin,args)=>{
  assert.equal(bin,'docker');calls.push(args);const step=args.join(' ');let out='';
  if(change.fail?.(args))return{status:change.status??1,signal:change.signal??null,error:change.error};
  if(args[0]==='image')out=JSON.stringify([{Os:'linux',Architecture:'amd64',Config:{Labels:{'io.squadhunt.source-content-sha256':'e97f4a2f4a90620f7294855689df2313c56f5a59700c24b769efc844d8126b22'}}}]);
  else if(args[0]==='ps')out=change.preexisting?'existing':'';
  else if(args[0]==='network')out=change.networkRemnant&&calls.some(a=>a.includes('down'))?'remaining':'';
  else if(args[0]==='compose'&&args.includes('ps'))out=cid+'\n';
  else if(args[0]==='inspect')out=JSON.stringify([{Id:cid,Config:{Image:image,Labels:{'com.docker.compose.project':change.foreign?'other':project,'com.docker.compose.service':'runner'}},
   State:{Status:waited?'exited':'running',Running:!waited,ExitCode:change.exitCode||0,OOMKilled:Boolean(change.oom),Error:'',FinishedAt:'2026-10-28T07:58:56Z'}}]);
  else if(args[0]==='wait'){waited=true;saved(path.join(base,'results'),change.receiptChange);out=String(change.exitCode||0)+'\n';}
  else if(args[0]==='logs')out='local runner console';
  else assert(args[0]==='compose'&&(args.includes('up')||args.includes('down')),'unexpected: '+step);
  return{status:0,signal:null,stdout:out};
 };
 return{base,calls,run:()=>H.runLocal(base,{spawn,clock:()=>0,random:()=>project.slice('worker7-local-'.length)}),trace:()=>JSON.parse(fs.readFileSync(path.join(base,'results/orchestration.json')))};
}
test('saved Linux receipt and raw TAP hash verify without Docker or AWS calls',()=>{
 const dir=temp();saved(dir);const cp=require('node:child_process'),original=cp.spawnSync;cp.spawnSync=()=>{throw Error('unexpected subprocess');};
 try{const r=H.verifyResults(dir);assert.equal(r.receipt.passed,true);assert.equal(r.dockerCalls,0);assert.match(r.orchestrationStatus,/not established/);}finally{cp.spawnSync=original;}
});
test('saved log mutation is rejected even when receipt claims success',()=>{const d=temp();saved(d);fs.appendFileSync(path.join(d,'rehearsal.log'),'changed');assert.throws(()=>H.verifyResults(d),/SAVED_LOG_HASH_MISMATCH/);});
test('wrong platform, source or cloud verification claims fail closed',()=>{for(const p of [{platform:'darwin'},{contentSha256:'changed'},{awsMutations:1},{s3Verified:true},{documentDb5WritesVerified:true},{filesVerified:754},{exitCode:1}]){const d=temp();saved(d,r=>Object.assign(r,p));assert.throws(()=>H.verifyResults(d),/LINUX_RECEIPT_NOT_VERIFIED/);}});
test('rehashed incomplete TAP cannot be accepted as 21 passing cases',()=>{const d=temp();saved(d,(r,l)=>{const x=l.replace('ok 17 -','not ok 17 -');r.logSha256=hash(x);return x;});assert.throws(()=>H.verifyResults(d),/SAVED_TAP_CASES_NOT_VERIFIED/);});
test('detached launch binds exact runner, waits for its zero exit and proves cleanup absence',()=>{
 const f=harness();const r=f.run();assert.match(r.verdict,/PASSED_NOT_AWS/);assert(f.calls.some(a=>a.includes('up')&&a.includes('--detach')));
 assert(!f.calls.some(a=>a.includes('--exit-code-from')||a.includes('--abort-on-container-exit')));assert.equal(f.trace().runnerExitCode,0);assert.equal(f.trace().cleanupAbsenceVerified,true);assert.equal(f.trace().passed,true);
});
test('nonzero host CLI status remains a failure even with valid saved results',()=>{const f=harness({fail:a=>a[0]==='wait'});assert.throws(f.run,/DOCKER_WAIT_FAILED/);assert.equal(f.trace().passed,false);assert.equal(f.trace().steps.find(x=>x.step==='WAIT').status,1);assert(f.calls.some(a=>a.includes('down')));});
test('timeout signal is recorded and cleanup still runs',()=>{const f=harness({fail:a=>a[0]==='wait',status:null,signal:'SIGTERM',error:{code:'ETIMEDOUT'}});assert.throws(f.run,/DOCKER_WAIT_FAILED/);assert.equal(f.trace().steps.find(x=>x.step==='WAIT').errorCode,'ETIMEDOUT');assert(f.calls.some(a=>a.includes('down')));});
test('foreign runner and real nonzero or OOM exits never pass',()=>{for(const config of [{foreign:true},{exitCode:1},{oom:true}]){const f=harness(config);assert.throws(f.run);assert.equal(f.trace().passed,false);assert(f.calls.some(a=>a.includes('down')));}});
test('remaining network makes cleanup fail instead of declaring completion',()=>{const f=harness({networkRemnant:true});assert.throws(f.run,/LOCAL_NETWORKS_REMAIN/);assert.equal(f.trace().passed,false);});
test('existing project collision is never started or removed',()=>{const f=harness({preexisting:true});assert.throws(f.run,/LOCAL_PROJECT_COLLISION/);assert(!f.calls.some(a=>a.includes('up')||a.includes('down')));});
test('prior saved results are preserved and block a new experiment',()=>{const f=harness();saved(path.join(f.base,'results'));assert.throws(f.run,/PRESERVE_PRIOR_RESULTS/);assert.equal(f.calls.length,0);});
