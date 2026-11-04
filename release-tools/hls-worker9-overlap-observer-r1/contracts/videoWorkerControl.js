'use strict';
const {createPublicKey,verify,randomUUID}=require('node:crypto');
const check=(v,c)=>{if(!v)throw Error(c);};
const FIELDS=['version','owner','runId','taskArn','containerId','instanceId','action','issuedAt','expiresAt','nonce'];
const canonical=x=>JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,x[k]])));
function validateConfig({owner,runId,publicKeyPem}){check(/^[a-z0-9-]{8,80}$/.test(owner||'')&&/^[a-z0-9-]{8,80}$/.test(runId||''),'CONTROL_OWNER_BINDING');const key=createPublicKey(publicKeyPem);check(key.asymmetricKeyType==='ed25519','CONTROL_PUBLIC_KEY_REQUIRED');return key;}
function create({owner,runId,publicKeyPem,identity,intake,consumer,protection,witness,claims=async()=>({owned:false}),now=Date.now}){
 check(/^[a-z0-9-]{8,80}$/.test(owner||'')&&/^[a-z0-9-]{8,80}$/.test(runId||''),'CONTROL_OWNER_BINDING');
 const key=validateConfig({owner,runId,publicKeyPem});
 check(identity.taskArn===protection.taskArn&&identity.instanceId&&identity.containerId,'CONTROL_TASK_BINDING');
 let state='OPEN',busy=null,pauseStarted=false,consumerClosed=false,closeStarted=false,releaseStarted=false;
 const nonces=new Set();
 function authenticate(x){
  check(x&&Object.keys(x).sort().join()===([...FIELDS,'signature'].sort().join()),'CONTROL_FIELDS');
  check(x.version===1&&x.owner===owner&&x.runId===runId&&x.taskArn===identity.taskArn&&x.containerId===identity.containerId&&x.instanceId===identity.instanceId&&['OBSERVE','DRAIN'].includes(x.action),'CONTROL_SCOPE');
  const t=now();check(Number.isSafeInteger(x.issuedAt)&&Number.isSafeInteger(x.expiresAt)&&x.issuedAt<=t&&x.expiresAt>t&&x.expiresAt-x.issuedAt<=60000,'CONTROL_CLOCK');
  check(/^[a-f0-9]{32}$/.test(x.nonce)&&!nonces.has(x.nonce)&&nonces.size<4096,'CONTROL_REPLAY_OR_BUDGET');
  check(typeof x.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(x.signature)&&verify(null,Buffer.from(canonical(x)),key,Buffer.from(x.signature,'base64')),'CONTROL_SIGNATURE');
  nonces.add(x.nonce);
 }
 async function bounded(fn){let timer;try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DRAIN_DEADLINE')),3000);})]);}finally{clearTimeout(timer);}}
 function reconcile(){
  if(busy||state!=='DRAINING')return busy;
  busy=(async()=>{
   try{
    if(!pauseStarted){pauseStarted=true;await bounded(()=>consumer.pause(true));}
    const w=witness.snapshot(),i=intake.snapshot();check(w.qualified===true&&w.taskArn===identity.taskArn,'WITNESS_UNQUALIFIED');
    if(i.activeJobs!==0||w.activeFfmpeg!==0)return;
    if(!closeStarted){closeStarted=true;await bounded(()=>consumer.close());check(consumer.closed===true,'CONSUMER_CLOSED_READBACK_REQUIRED');consumerClosed=true;}
    check(consumerClosed&&intake.snapshot().closing&&intake.snapshot().activeJobs===0&&witness.snapshot().activeFfmpeg===0,'DRAIN_CHANGED');
    check(!releaseStarted,'RELEASE_ALREADY_ATTEMPTED');releaseStarted=true;
    await protection.release({intakeFenced:true,activeJobs:0,consumerClosed:true});
    const p=protection.snapshot();check(p.taskArn===identity.taskArn&&p.released===true&&p.protected===false,'PROTECTION_CLEAR_UNKNOWN');state='DRAINED';
   }catch{state='HOLD';intake.hold('OWNED_DRAIN_UNRESOLVED');}
  })().finally(()=>{busy=null;});return busy;
 }
 function readback(){return{...identity,owner,runId,state,intake:intake.snapshot(),consumerClosed,releaseAttempted:releaseStarted,protection:protection.snapshot(),witness:witness.snapshot()};}
 async function command(x){authenticate(x);if(x.action==='DRAIN'&&state==='OPEN'){intake.drain();state='DRAINING';}await reconcile();return{...readback(),claim:await claims()};}
 return{command,readback,challenge:()=>({...identity,owner,runId,protocol:1}),
  http:async(req,res)=>{
   const send=(code,x)=>{res.statusCode=code;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
   if(req.method==='GET'&&req.url==='/control/challenge'){send(200,{...identity,owner,runId,protocol:1});return;}
   if(req.method!=='POST'||req.url!=='/control'){send(404,{code:'NOT_FOUND'});return;}
   let size=0;const chunks=[];req.setTimeout(2000,()=>req.destroy());
   try{for await(const b of req){size+=b.length;check(size<=2048,'CONTROL_BODY_BOUND');chunks.push(b);}const out=await command(JSON.parse(Buffer.concat(chunks).toString()));send(out.state==='HOLD'?503:200,out);}catch{send(403,{code:'CONTROL_REJECTED'});}
  }};
}
module.exports={create,canonical,validateConfig};
