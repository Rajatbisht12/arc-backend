'use strict';
const {test}=require('node:test');
const a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('./lib/worker-artifact');
const inspection=(name='desktop-linux',driver='docker')=>`Name:          ${name}\r\nDriver:        ${driver}\r\nLast Activity: 2026-10-31\r\n\r\nNodes:\r\nName:          ${name}\r\nEndpoint:      ${name}\r\nStatus:        running\r\nPlatforms:     linux/amd64\r\n`;
test('plain Buildx inspection accepts CRLF and rejects wrong/duplicate/missing/remote driver bindings',()=>{
 a.equal(A.builderDriver(inspection(),'desktop-linux'),'docker');
 for(const text of [inspection('other'),inspection('desktop-linux','docker-container'),inspection().replace('Nodes:','Driver: docker\nNodes:'),inspection().replace('Driver:        docker',''),inspection().replace('Nodes:','Unknown:'),'x'.repeat(65537)])a.throws(()=>A.builderDriver(text,'desktop-linux'));
});
test('Windows without O_SYNC uses exclusive file fsync/readback, never directory opens, and refuses overwrite',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worker-windows-journal-test-'));let syncs=0;
 const constants={...fs.constants};delete constants.O_SYNC;
 const io={...fs,constants,openSync(file,flags,...rest){a.equal(flags,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL);return fs.openSync(file,flags,...rest);},fsyncSync(fd){syncs++;return fs.fsyncSync(fd);}};
 try{A.saveJournal(dir,'consumed.json',{attempts:1},{fsImpl:io,platform:'win32'});a.equal(syncs,1);a.equal(JSON.parse(fs.readFileSync(path.join(dir,'consumed.json'))).attempts,1);a.throws(()=>A.saveJournal(dir,'consumed.json',{attempts:2},{fsImpl:io,platform:'win32'}),{code:'EEXIST'});a.throws(()=>A.saveJournal(dir,'../escape.json',{}, {platform:'win32'}));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Windows file-sync and readback failures remain fatal and retain exclusive consumed state',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worker-journal-fault-test-'));
 try{for(const name of ['sync','readback']){const io={...fs};if(name==='sync')io.fsyncSync=()=>{throw Object.assign(Error('synthetic'),{code:'EIO'});};else io.readFileSync=()=> 'wrong';a.throws(()=>A.saveJournal(dir,name+'.json',{attempts:1},{fsImpl:io,platform:'win32'}));a(fs.existsSync(path.join(dir,name+'.json')));a.throws(()=>A.saveJournal(dir,name+'.json',{attempts:2},{platform:'win32'}),{code:'EEXIST'});}}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('POSIX directory-sync failure is not ignored and descriptor is closed',{skip:process.platform==='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worker-posix-journal-test-'));let dirFd,closed=false;
 const io={...fs,openSync(file,flags,...rest){const fd=fs.openSync(file,flags,...rest);if(file===dir)dirFd=fd;return fd;},fsyncSync(fd){if(fd===dirFd)throw Error('DIRECTORY_SYNC_FAILED');return fs.fsyncSync(fd);},closeSync(fd){if(fd===dirFd)closed=true;return fs.closeSync(fd);}};
 try{a.throws(()=>A.saveJournal(dir,'intent.json',{}, {fsImpl:io,platform:'linux'}));a(closed);a(fs.existsSync(path.join(dir,'intent.json')));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('local capability check uses only local Docker reads, no --format on buildx and no bootstrap/build/cloud',()=>{
 const calls=[];const out=A.localCheck((exe,args)=>{calls.push([exe,args]);a.equal(exe,'docker');if(args[0]==='context')return'desktop-linux\n';if(args.includes('context'))return JSON.stringify('npipe:////./pipe/dockerDesktopLinuxEngine');a.deepEqual(args,['--context','desktop-linux','buildx','inspect','desktop-linux']);return inspection();});
 a.equal(calls.length,3);a.equal(out.providerCalls,0);a.equal(out.builds,0);a.equal(out.ecsAuthority,0);
 a.throws(()=>A.localCheck(()=> 'unreviewed-context'));
});
test('local failure diagnostics allow only fixed guard/errno codes and suppress arbitrary values/messages',()=>{
 a.equal(A.localFailure(Error('JOURNAL_READBACK_REQUIRED')).code,'JOURNAL_READBACK_REQUIRED');
 a.equal(A.localFailure({code:'EPERM',message:'private path'}).code,'EPERM');
 for(const error of [null,Error('PRIVATE_CONFIG_URL'),{message:'mongo://private',code:'PRIVATE_TOKEN'}]){const out=A.localFailure(error);a.equal(out.code,'UNKNOWN_LOCAL_FAILURE');a.equal(out.providerCalls,0);a.equal(out.ecsAuthority,0);a(!JSON.stringify(out).includes('private'));}
});
