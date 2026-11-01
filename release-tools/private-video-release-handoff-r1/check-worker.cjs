'use strict';
// Read-only local handoff check. Never calls git, Docker, AWS or a network client.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'release-tools/legacy-private-video-release-r1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(){
 const plan=JSON.parse(fs.readFileSync(path.join(D,'build-plan.json'))),artifact=JSON.parse(fs.readFileSync(path.join(D,'worker-artifact.PROPOSED.json')));
 if(hash(JSON.stringify(plan))!=='c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130'
   ||artifact.sourceContentSha256!=='8987e09a78724bd6152464ed59a444e860aeb6cc0d8b6c30f09e7e76f171bae2'
   ||artifact.sourceArchiveSha256!=='95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee')throw Error('EXACT_APPROVAL_BINDINGS_CHANGED');
 for(const pin of plan.controls)if(hash(fs.readFileSync(path.join(D,pin.path)))!==pin.sha256)throw Error('EXACT_CONTROL_CHANGED');
 const source=require('../legacy-private-video-release-r1/verify.cjs').verify(artifact);
 return{kind:'WINDOWS_HANDOFF_LOCAL_CHECK_NOT_APPROVAL',planSha256:hash(JSON.stringify(plan)),sourceContentSha256:artifact.sourceContentSha256,archiveSha256:artifact.sourceArchiveSha256,sourceFiles:source.sourceFiles,providerCalls:0,builds:0,approvalRequired:true};
}
module.exports={check};if(require.main===module){try{console.log(JSON.stringify(check(),null,2));}catch{console.error('HANDOFF_CHANGED_STOP_NO_BUILD');process.exitCode=1;}}
