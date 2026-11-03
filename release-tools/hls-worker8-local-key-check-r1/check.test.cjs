'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const file=path.join(__dirname,'windows-key-check.cjs'),K=require(file);
test('Git transfer preserves the exact previously reviewed standalone script',()=>{a.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),'28b99e6209b0b7c8a253bd70b18a9321fdc0df1ebdfe2a224a2c21b0b680e29d');});
test('public export surface cannot select initialization or ACL mutation',()=>{a.deepEqual(Object.keys(K).sort(),['EXPECTED','inspect','prove']);a.equal(K.EXPECTED,'f7aa9f7c9e4e080aa76159114cded44fdb86782f9d6545a120a905487142a603');});
test('synthetic local Ed25519 proof returns a boolean without exporting a signature',()=>{const pair=crypto.generateKeyPairSync('ed25519');a.equal(K.prove(pair.privateKey),true);});
function cli(args){const r=spawnSync(process.execPath,[file,...args],{encoding:'utf8',timeout:5000,maxBuffer:16384});a.equal(r.status,1);a.equal(r.stdout,'');const error=JSON.parse(r.stderr);a.equal(error.privateKeyExported,false);a.equal(error.providerCalls,0);a.equal(error.status,'CLOSED_HOLD');return error;}
test('CLI rejects missing or extra arguments before key access',()=>{a.equal(cli([]).code,'APPROVAL_TIME_ARGUMENT_REQUIRED');a.equal(cli(['0','init']).code,'APPROVAL_TIME_ARGUMENT_REQUIRED');});
test('CLI rejects an initialization selector rather than treating it as a mode',()=>{a.equal(cli(['init']).code,'APPROVAL_EXPIRED_OR_CLOCK_MISMATCH');});
test('expired and future timestamps are rejected before key access',()=>{a.equal(cli([String(Date.now()-1800001)]).code,'APPROVAL_EXPIRED_OR_CLOCK_MISMATCH');a.equal(cli([String(Date.now()+60000)]).code,'APPROVAL_EXPIRED_OR_CLOCK_MISMATCH');});
test('current timestamp on another OS stops before signer lookup',{skip:process.platform==='win32'},()=>{a.equal(cli([String(Date.now())]).code,'WINDOWS_SIGNING_LAPTOP_REQUIRED');});
