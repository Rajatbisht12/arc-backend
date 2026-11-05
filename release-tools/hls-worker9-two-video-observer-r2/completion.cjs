'use strict';
const C=require('./protocol.cjs');
const key=c=>C.prefix(c)+'requests/completed.json';
const seed=()=>C.hash([]);
function next(chain,{sequence,action,taskArn,commandSha256}){C.check(/^[a-f0-9]{64}$/.test(chain)&&Number.isSafeInteger(sequence)&&sequence>0&&action==='OBSERVE'&&/^[a-f0-9]{64}$/.test(commandSha256),'EXACT_OBSERVE_CHAIN');C.task(taskArn);return C.hash({prior:chain,sequence,action,taskArn,commandSha256});}
function record(c,{count,chain,status,now}){C.check(c.mode==='OBSERVE_ONLY'&&['OVERLAP_OBSERVED','NO_OVERLAP'].includes(status)&&Number.isSafeInteger(count)&&count>=0&&count<=c.maximumCommands&&/^[a-f0-9]{64}$/.test(chain),'EXACT_OBSERVER_COMPLETION');return{kind:'WORKER9_OBSERVER_COMPLETED',runId:c.runId,scopeSha256:c.scopeSha256,helperTaskArn:c.helperTaskArn,clientId:c.clientId,commands:count,commandChainSha256:chain,status,issuedAt:now};}
function validate(v,c,{count,chain,now}){C.check(v&&Object.keys(v).sort().join()==='clientId,commandChainSha256,commands,helperTaskArn,issuedAt,kind,runId,scopeSha256,status'&&v.kind==='WORKER9_OBSERVER_COMPLETED'&&v.runId===c.runId&&v.scopeSha256===c.scopeSha256&&v.helperTaskArn===c.helperTaskArn&&v.clientId===c.clientId&&v.commands===count&&v.commandChainSha256===chain&&['OVERLAP_OBSERVED','NO_OVERLAP'].includes(v.status)&&Number.isSafeInteger(v.issuedAt)&&v.issuedAt<=now+5000&&v.issuedAt>=now-60000,'NATIVE_COMPLETION_DOES_NOT_MATCH_PUBLISHED_COMMANDS');return v;}
module.exports={key,seed,next,record,validate};
