'use strict';
// Windows-local validation only. Never emits a signature or private material.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),K=(()=>{const module={exports:{}};
'use strict';
// LOCAL ONLY: Windows ACL + Ed25519. No AWS/network/provider imports or commands.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const OWNER='squadhunt-worker-rollout-r2',RUN='pi-worker-rollout-r2-20261101';
const check=(v,c)=>{if(!v)throw Error(c);};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const ACL_READBACK=String.raw`$ErrorActionPreference='Stop'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$item=Get-Item -LiteralPath $env:SQUADHUNT_KEY_ACL_PATH -Force
$acl=Get-Acl -LiteralPath $env:SQUADHUNT_KEY_ACL_PATH
$rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
$unexpected=@($rules | Where-Object { $_.IdentityReference.Value -ne $sid }).Count
$denies=@($rules | Where-Object { $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow }).Count
$full=@($rules | Where-Object { $_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and (($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) }).Count -gt 0
[ordered]@{kind='WINDOWS_OWNER_ONLY_ACL';protected=$acl.AreAccessRulesProtected;ownerMatches=($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid);unexpectedPrincipals=$unexpected;denyEntries=$denies;ownerFullControl=$full;reparsePoint=(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)} | ConvertTo-Json -Compress`;
function systemTool(exe,env=process.env){
 const tools={'whoami.exe':['System32','whoami.exe'],'icacls.exe':['System32','icacls.exe'],'powershell.exe':['System32','WindowsPowerShell','v1.0','powershell.exe']};
 check(Object.hasOwn(tools,exe),'UNREVIEWED_LOCAL_TOOL');const relative=tools[exe],root=env.SystemRoot||env.SYSTEMROOT;
 check(typeof root==='string'&&/^[A-Za-z]:[\\/]/.test(root)&&!root.includes('\0')&&path.win32.isAbsolute(root)&&!root.split(/[\\/]/).includes('..'),'WINDOWS_SYSTEM_ROOT_REQUIRED');
 return path.win32.join(root,...relative);
}
function windowsCommands({run=execFileSync,env=process.env}={}){return(exe,args,options={})=>{const file=systemTool(exe,env);try{return run(file,args,{encoding:'utf8',timeout:10000,maxBuffer:16384,stdio:['pipe','pipe','pipe'],...options});}catch{throw Error({'whoami.exe':'WINDOWS_IDENTITY_COMMAND_FAILED','icacls.exe':'WINDOWS_ACL_COMMAND_FAILED','powershell.exe':'WINDOWS_ACL_READ_COMMAND_FAILED'}[exe]);}};}
const command=windowsCommands();
function verifyAcl(target,{commands=command}={}){
 const text=commands('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ACL_READBACK,'utf16le').toString('base64')],{env:{...process.env,SQUADHUNT_KEY_ACL_PATH:target}});let v;try{v=JSON.parse(String(text).replace(/^\uFEFF/,''));}catch{throw Error('ACL_READBACK_JSON_REQUIRED');}
 check(v&&Object.keys(v).sort().join()===['kind','protected','ownerMatches','unexpectedPrincipals','denyEntries','ownerFullControl','reparsePoint'].sort().join()&&v.kind==='WINDOWS_OWNER_ONLY_ACL'&&v.protected===true&&v.ownerMatches===true&&v.unexpectedPrincipals===0&&v.denyEntries===0&&v.ownerFullControl===true&&v.reparsePoint===false,'WINDOWS_PRIVATE_ACL_NOT_VERIFIED');return true;
}
function protect(target,sid,directory,{commands=command}={}){check(/^S-1-5-[0-9-]+$/.test(sid),'CURRENT_WINDOWS_SID_REQUIRED');commands('icacls.exe',[target,'/inheritance:r','/grant:r','*'+sid+(directory?':(OI)(CI)F':':F')]);verifyAcl(target,{commands});}
function trustedPath(directory,localAppData,{fsImpl=fs}={}){
 check(typeof localAppData==='string'&&path.isAbsolute(localAppData)&&path.isAbsolute(directory),'LOCALAPPDATA_KEY_PATH_REQUIRED');
 const parent=path.dirname(directory),local=fsImpl.realpathSync(localAppData),actualParent=fsImpl.realpathSync(parent);
 const relative=path.relative(local,actualParent);check(relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!/(?:onedrive|dropbox|icloud|google drive)/i.test(actualParent),'KEY_OUTSIDE_LOCALAPPDATA_OR_SYNCED');
 check(!fsImpl.existsSync(directory)&&!fsImpl.lstatSync(parent).isSymbolicLink(),'NEW_REAL_KEY_DIRECTORY_REQUIRED');return directory;
}
function create(directory,{platform=process.platform,localAppData=process.env.LOCALAPPDATA,commands=command,fsImpl=fs}={}){
 check(platform==='win32','WINDOWS_DEPLOYMENT_LAPTOP_ONLY');trustedPath(directory,localAppData,{fsImpl});
 const sidOutput=String(commands('whoami.exe',['/user','/fo','csv','/nh'])),matches=sidOutput.match(/S-1-5-[0-9-]+/g);check(matches?.length===1,'CURRENT_WINDOWS_SID_REQUIRED');const sid=matches[0];
 fsImpl.mkdirSync(directory,{mode:0o700});protect(directory,sid,true,{commands});
 const pair=crypto.generateKeyPairSync('ed25519'),publicKeyPem=pair.publicKey.export({type:'spki',format:'pem'}).toString(),privateBytes=Buffer.from(pair.privateKey.export({type:'pkcs8',format:'pem'}));
 const keyFile=path.join(directory,'control-private.pem');let fd;try{fd=fsImpl.openSync(keyFile,'wx',0o600);fsImpl.writeFileSync(fd,privateBytes);fsImpl.fsyncSync(fd);check(crypto.timingSafeEqual(fsImpl.readFileSync(keyFile),privateBytes),'PRIVATE_KEY_DURABLE_READBACK');}finally{if(fd!==undefined)fsImpl.closeSync(fd);privateBytes.fill(0);}
 protect(keyFile,sid,false,{commands});
 const key=crypto.createPrivateKey(fsImpl.readFileSync(keyFile));check(crypto.createPublicKey(key).export({type:'spki',format:'pem'}).toString()===publicKeyPem,'KEY_PAIR_READBACK');verifyAcl(directory,{commands});
 const receipt={kind:'WORKER_CONTROL_LOCAL_PUBLIC_KEY',owner:OWNER,runId:RUN,algorithm:'ed25519',publicKeyPem,publicKeySha256:hash(publicKeyPem),windowsDirectoryAclVerified:true,windowsPrivateFileAclVerified:true,privateKeyExported:false,providerCalls:0,productionMutations:0};
 const receiptFile=path.join(directory,'control-public.json'),bytes=JSON.stringify(receipt,null,2)+'\n',rfd=fsImpl.openSync(receiptFile,'wx',0o600);try{fsImpl.writeFileSync(rfd,bytes);fsImpl.fsyncSync(rfd);}finally{fsImpl.closeSync(rfd);}check(fsImpl.readFileSync(receiptFile,'utf8')===bytes,'PUBLIC_RECEIPT_DURABLE_READBACK');return receipt;
}
function inspect(directory,{platform=process.platform,commands=command,fsImpl=fs}={}){check(platform==='win32','WINDOWS_DEPLOYMENT_LAPTOP_ONLY');verifyAcl(directory,{commands});verifyAcl(path.join(directory,'control-private.pem'),{commands});const r=JSON.parse(fsImpl.readFileSync(path.join(directory,'control-public.json'),'utf8')),key=crypto.createPrivateKey(fsImpl.readFileSync(path.join(directory,'control-private.pem')));check(r.owner===OWNER&&r.runId===RUN&&r.publicKeySha256===hash(r.publicKeyPem)&&crypto.createPublicKey(key).export({type:'spki',format:'pem'}).toString()===r.publicKeyPem,'PUBLIC_RECEIPT_KEY_MISMATCH');return{kind:'WORKER_CONTROL_LOCAL_KEY_CHECK',publicKeySha256:r.publicKeySha256,windowsDirectoryAclVerified:true,windowsPrivateFileAclVerified:true,providerCalls:0};}
function failureCode(e){const allowed=['UNREVIEWED_LOCAL_TOOL','WINDOWS_SYSTEM_ROOT_REQUIRED','WINDOWS_IDENTITY_COMMAND_FAILED','WINDOWS_ACL_COMMAND_FAILED','WINDOWS_ACL_READ_COMMAND_FAILED','WINDOWS_DEPLOYMENT_LAPTOP_ONLY','LOCALAPPDATA_KEY_PATH_REQUIRED','KEY_OUTSIDE_LOCALAPPDATA_OR_SYNCED','NEW_REAL_KEY_DIRECTORY_REQUIRED','CURRENT_WINDOWS_SID_REQUIRED','ACL_READBACK_JSON_REQUIRED','WINDOWS_PRIVATE_ACL_NOT_VERIFIED','PRIVATE_KEY_DURABLE_READBACK','KEY_PAIR_READBACK','PUBLIC_RECEIPT_DURABLE_READBACK','PUBLIC_RECEIPT_KEY_MISMATCH','KEY_DIRECTORY_REQUIRED','ONLY_LOCAL_INIT_OR_CHECK'];if(allowed.includes(e?.message))return e.message;return['ENOENT','EEXIST','EACCES','EPERM','ENOSPC','EIO'].includes(e?.code)?e.code:'SANITIZED_LOCAL_FAILURE';}
module.exports={hash,ACL_READBACK,systemTool,windowsCommands,failureCode,verifyAcl,trustedPath,create,inspect};
if(require.main===module){try{const directory=process.env.WORKER_CONTROL_KEY_DIRECTORY;check(typeof directory==='string','KEY_DIRECTORY_REQUIRED');const mode=process.argv[2];check(['init','check'].includes(mode),'ONLY_LOCAL_INIT_OR_CHECK');console.log(JSON.stringify(mode==='init'?create(directory):inspect(directory)));}catch(e){console.error(JSON.stringify({result:'LOCAL_WORKER_KEY_HELD_NO_PROVIDER_CALL_NO_RETRY',code:failureCode(e)}));process.exitCode=1;}}

return module.exports;})();
const EXPECTED='f7aa9f7c9e4e080aa76159114cded44fdb86782f9d6545a120a905487142a603';
function prove(key){const data=Buffer.from('SquadHunt LOCAL KEY CHECK ONLY 20261104; not a worker-control command'),sig=crypto.sign(null,data,key);return crypto.verify(null,data,crypto.createPublicKey(key),sig);}
function inspect(){if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('WINDOWS_SIGNING_LAPTOP_REQUIRED');const base=fs.realpathSync(process.env.LOCALAPPDATA),directory=path.join(base,'SquadHuntRelease','worker-rollout-r2-signing'),actual=fs.realpathSync(directory),relative=path.relative(base,actual);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||/(onedrive|dropbox|icloud|google drive)/i.test(actual))throw Error('LOCAL_NON_SYNCED_SIGNER_REQUIRED');const receipt=K.inspect(directory);if(receipt.publicKeySha256!==EXPECTED)throw Error('EXISTING_WORKER_KEY_MISMATCH');const file=path.join(directory,'control-private.pem');if(fs.statSync(file).size>16384)throw Error('LOCAL_KEY_BOUND');const bytes=fs.readFileSync(file);let key;try{key=crypto.createPrivateKey(bytes);}finally{bytes.fill(0);}if(!prove(key))throw Error('LOCAL_KEY_POSSESSION_FAILED');return{kind:'WORKER8_LOCAL_SIGNER_VERIFIED',publicKeySha256:EXPECTED,windowsDirectoryAclVerified:true,windowsPrivateFileAclVerified:true,localPossessionVerified:true,privateKeyExported:false,workerCommandSigned:false,providerCalls:0,productionMutations:0};}
module.exports={prove,inspect,EXPECTED};
if(require.main===module){let out=null;const put=(name,value)=>{const file=path.join(out,name+'.json'),b=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(!fs.readFileSync(file).equals(b))throw Error('LOCAL_JOURNAL_UNKNOWN');};let status='CLOSED_HOLD';try{if(process.argv.length!==3)throw Error('APPROVAL_TIME_ARGUMENT_REQUIRED');const approvedAt=Number(process.argv[2]);if(!Number.isSafeInteger(approvedAt)||Date.now()<approvedAt||Date.now()-approvedAt>=1800000)throw Error('APPROVAL_EXPIRED_OR_CLOCK_MISMATCH');if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('WINDOWS_SIGNING_LAPTOP_REQUIRED');const candidate=path.join(process.env.LOCALAPPDATA,'SquadHuntRelease','hls-worker8-key-binding-r1-20261104-consumed');if(fs.existsSync(candidate))throw Error('EXISTING_KEY_CHECK_JOURNAL_NO_RETRY');fs.mkdirSync(candidate,{mode:0o700});out=candidate;put('intent',{at:Date.now(),approvedAt,operation:'CHECK_EXISTING_LOCAL_SIGNER_ONLY',privateKeyExported:false,workerCommandSigned:false,providerCalls:0});const r=inspect();put('receipt',{at:Date.now(),...r});status='CLOSED_LOCAL_SIGNER_VERIFIED';console.log(JSON.stringify({status,...r},null,2));}catch(e){const code=/^[A-Z0-9_]+$/.test(e.message)?e.message:K.failureCode(e);if(out)put('hold',{at:Date.now(),code});console.error(JSON.stringify({status,code,privateKeyExported:false,providerCalls:0}));process.exitCode=1;}finally{if(out)put('authority-closed',{at:Date.now(),status,remainingChecks:0,workerCommands:0,providerCalls:0});}}
