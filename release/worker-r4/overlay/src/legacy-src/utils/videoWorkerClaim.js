'use strict';
const {createHash}=require('node:crypto');
function create({getClaim,consumer,timeoutMs=2000}){
 let pending=false;
 return async()=>{
  const claim=getClaim(),worker=consumer();if(!claim||!worker||pending||!/^[a-f0-9]{24}$/.test(claim.sessionId))return{owned:false};
  pending=true;let timer;
  const work=(async()=>{
   const client=await worker.client;if(client.status!=='ready')throw Error('CLAIM_REDIS_UNAVAILABLE');
   const rows=await client.multi().get('bull:clip-video:'+claim.jobId+':lock').pttl('bull:clip-video:'+claim.jobId+':lock').exec();
   if(getClaim()!==claim||!rows||rows.length!==2||rows.some(x=>x[0])||rows[0][1]!==claim.token||Number(rows[1][1])<5000)return{owned:false};
   const hash=x=>createHash('sha256').update(x).digest('hex');return{owned:true,observedAt:Date.now(),jobReference:hash(claim.jobId),sourceReference:hash(claim.sessionId),lockTtlMs:Number(rows[1][1])};
  })().finally(()=>{pending=false;});
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CLAIM_READ_DEADLINE')),timeoutMs);})]);}catch{return{owned:false};}finally{clearTimeout(timer);}
 };
}
module.exports={create};
