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
function command(exe,args,options={}){return execFileSync(exe,args,{encoding:'utf8',timeout:10000,maxBuffer:16384,stdio:['pipe','pipe','pipe'],...options});}
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
module.exports={hash,ACL_READBACK,verifyAcl,trustedPath,create,inspect};
if(require.main===module){try{const directory=process.env.WORKER_CONTROL_KEY_DIRECTORY;check(typeof directory==='string','KEY_DIRECTORY_REQUIRED');const mode=process.argv[2];check(['init','check'].includes(mode),'ONLY_LOCAL_INIT_OR_CHECK');console.log(JSON.stringify(mode==='init'?create(directory):inspect(directory)));}catch{console.error('LOCAL_WORKER_KEY_HELD_NO_PROVIDER_CALL_NO_RETRY');process.exitCode=1;}}
