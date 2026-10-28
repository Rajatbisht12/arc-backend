'use strict';
// HOST ONLY. Docker-local experiment; deliberately contains no AWS SDK or CLI command.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code);};
const image='906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend@sha256:144b96e60256405280f77b29269595e04ff18ae5561310b87171d35bd7c04f1f';
function verify(base) {
  const m=JSON.parse(fs.readFileSync(path.join(base,'bundle-manifest.json')));
  check(m.scope==='LOCAL_ONLY_NO_AWS_MUTATIONS'&&m.files.length===9,'EXACT_LOCAL_BUNDLE_REQUIRED');
  for(const f of m.files){check(/^[A-Za-z0-9_.-]+$/.test(f.path),'SAFE_BUNDLE_PATH');const p=path.join(base,f.path),s=fs.lstatSync(p);
    check(s.isFile()&&!s.isSymbolicLink()&&s.size===f.bytes&&hash(fs.readFileSync(p))===f.sha256,'BUNDLE_FILE_CHANGED');}
  return m;
}
function main(args) {
  check(args.length===1&&['--check','--run-local'].includes(args[0]),'USE_CHECK_OR_RUN_LOCAL');
  const base=__dirname,m=verify(base);
  if(args[0]==='--check'){console.log(JSON.stringify({mode:'check',bundleSha256:hash(JSON.stringify(m)),filesVerified:m.files.length,awsMutations:0}));return;}
  const docker=(args,opts={})=>cp.execFileSync('docker',args,{cwd:base,encoding:'utf8',...opts});
  const info=JSON.parse(docker(['image','inspect',image]))[0];
  check(info.Os==='linux'&&info.Architecture==='amd64'&&info.Config?.Labels?.['io.squadhunt.source-content-sha256']===
    'e97f4a2f4a90620f7294855689df2313c56f5a59700c24b769efc844d8126b22','PULL_EXACT_FROZEN_WORKER7_IMAGE_FIRST');
  const project='worker7-local-'+crypto.randomBytes(8).toString('hex');
  check(!docker(['ps','-aq','--filter','label=com.docker.compose.project='+project]).trim(),'LOCAL_PROJECT_COLLISION');
  const results=path.join(base,'results');fs.mkdirSync(results,{recursive:true});
  check(fs.readdirSync(results).length===0,'PRESERVE_PRIOR_RESULTS_USE_FRESH_BUNDLE_COPY');
  if(process.platform!=='win32')fs.chmodSync(results,0o777); // Only this newly owned output directory for non-root container.
  const compose=['compose','--project-name',project,'--file',path.join(base,'compose.yaml')];
  let run;
  try {run=cp.spawnSync('docker',[...compose,'up','--abort-on-container-exit','--exit-code-from','runner'],
    {cwd:base,stdio:'inherit',timeout:900000});}
  finally {docker([...compose,'down','--remove-orphans'],{stdio:'inherit'});}
  check(run?.status===0,'LOCAL_REHEARSAL_FAILED_PRESERVE_RESULTS');
  const receipt=JSON.parse(fs.readFileSync(path.join(results,'receipt.json')));
  check(receipt.passed&&receipt.platform==='linux'&&receipt.architecture==='x64'&&receipt.awsMutations===0,'LINUX_RECEIPT_NOT_VERIFIED');
  console.log(JSON.stringify({project,receipt:path.join(results,'receipt.json'),receiptSha256:hash(JSON.stringify(receipt)),
    verdict:'LOCAL_LINUX_REHEARSAL_PASSED_NOT_AWS_RECOVERY'},null,2));
}
module.exports={verify};
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
