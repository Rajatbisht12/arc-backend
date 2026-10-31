'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const P=require('./lib/protected-worker-release'),before=require('../release/protected-worker-r1/roles-before.json'),base=require('../release/worker-r4/baseline-worker7.json');
const binding=()=>({owner:'worker-release-owner-r1',runId:'worker-release-r1-test',publicKeyPem:crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()});
test('grant contains only two actions on this account/region/cluster tasks with supported cluster condition',()=>{
 const g=P.grant();a.deepEqual(g.Action,['ecs:GetTaskProtection','ecs:UpdateTaskProtection']);a.equal(g.Resource,'arn:aws:ecs:us-east-1:906446637180:task/arc-cluster/*');a.deepEqual(g.Condition,{ArnEquals:{'ecs:cluster':'arn:aws:ecs:us-east-1:906446637180:cluster/arc-cluster'}});a(!JSON.stringify(g).includes('ecs:service'));a.equal(g.Effect,'Allow');
});
test('owning template patch appends one statement while preserving all four original statements/trust/resources',()=>{
 const original=JSON.stringify(before),after=P.patchRoles(before);a.equal(JSON.stringify(before),original);a.equal(after.Resources.WorkerTaskRole.Properties.Policies[0].PolicyDocument.Statement.length,5);
 const restored=structuredClone(after);restored.Resources.WorkerTaskRole.Properties.Policies[0].PolicyDocument.Statement.pop();a.deepEqual(restored,before);a.throws(()=>P.patchRoles(after));a.throws(()=>P.patchRoles({...before,Description:'unknown current template'}));
});
test('IAM preflight binds exact role ID/current policy and owning-template/parameter proof',()=>{
 const proof={roleArn:base.taskRoleArn,roleId:'AROA5GDDOBB6O4TFUCMR5',policySha256:'5508ff4eb0044827fbb1ae3e79b712edb316294bc2db422817158592233706ce',trustPolicySha256:'1c91a44c9e42f2aa5f228c847933d40d8f61f7cc114da1707dc4790749246b4d',attachedPolicies:0,permissionsBoundary:false,inlinePolicies:['ProductionVideoWorker'],ownedRole:true,templateSha256:P.hash(before),completeParameters:true};
 a(P.rolePreflight(proof));for(const patch of [{roleId:'other'},{policySha256:'other'},{attachedPolicies:1},{completeParameters:false},{ownedRole:false},{permissionsBoundary:true}])a.throws(()=>P.rolePreflight({...proof,...patch}));
});
const change=(id,type,property)=>({ResourceChange:{LogicalResourceId:id,ResourceType:type,Action:'Modify',Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:property,RequiresRecreation:'Never'}}]}});
test('IAM-only change-set gate rejects role replacement, trust changes and any unrelated resource',()=>{
 const v={Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[change('WorkerTaskRole','AWS::IAM::Role','Policies')]};a(P.iamChangeSet(v).onlyWorkerRolePolicies);
 for(const x of [{...v,Changes:[...v.Changes,change('WorkerExecutionRole','AWS::IAM::Role','Policies')]},{...v,Changes:[change('WorkerTaskRole','AWS::IAM::Role','AssumeRolePolicyDocument')]},{...v,Changes:[{ResourceChange:{...v.Changes[0].ResourceChange,Replacement:'True'}}]}])a.throws(()=>P.iamChangeSet(x));
 const request=P.iamRequest();a.equal(request.ChangeSetType,'UPDATE');a(request.Parameters.every(p=>p.UsePreviousValue===true));a(!JSON.stringify(request).includes('ExecuteChangeSet'));a.deepEqual(JSON.parse(request.TemplateBody),P.patchRoles(before));
});
test('rollback removes only the exact addition and refuses changing policies/unknown or protected dependents',()=>{
 a.deepEqual(P.rollbackRoles(P.patchRoles(before),{nativeEvidence:true,dependentProtectedTasks:0,unknownDependencies:0,expectedPostGrantPolicySha256:'a'.repeat(64),currentIdentityPolicySha256:'a'.repeat(64)}),before);
 a.throws(()=>P.rollbackRoles(before,{nativeEvidence:true,dependentProtectedTasks:0,unknownDependencies:0}));a.throws(()=>P.rollbackRoles(P.patchRoles(before),{nativeEvidence:true,dependentProtectedTasks:1,unknownDependencies:0}));
});
test('immutable image draft is intentionally unregisterable until real owner/public-key bindings exist',()=>{
 const d=P.candidate();a.equal(d.status,'UNBOUND_DRAFT_NOT_REGISTERABLE');a.equal(d.actualTaskRevision,null);a.equal(d.taskDefinition.containerDefinitions[0].image,P.IMAGE);a.throws(()=>P.cfnTask(d.taskDefinition));
 a.equal(P.IMAGE.split('@')[1],'sha256:ffff210127eb3512a0a7f5967a6a28e08dbd5a10e3c0d8745a234ee5bece2e8a');a.equal(P.CHILD,'sha256:0e0c1b9a1cc850a2d9100b6a7245e324d95b93ec879388d4e27315b7952821da');
});
test('bound definition preserves every unrelated worker7 property, private HLS and concurrency1',()=>{
 const d=P.candidate(binding()).taskDefinition,c=d.containerDefinitions[0],original=base.containerDefinitions[0];
 for(const k of ['cpu','memory','taskRoleArn','executionRoleArn','ephemeralStorage','networkMode','runtimePlatform'])a.deepEqual(d[k],base[k]);for(const k of ['command','entryPoint','secrets','healthCheck','logConfiguration','stopTimeout'])a.deepEqual(c[k],original[k]);
 const env=Object.fromEntries(c.environment.map(x=>[x.name,x.value]));a.equal(env.CLIP_HLS_WORKER_CONCURRENCY,'1');a.equal(env.POST_VIDEO_PRIVATE_DELIVERY_ENABLED,'true');a.equal(env.VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED,'true');a.equal(env.VIDEO_TASK_PROTECTION_MINUTES,'120');a(!c.secrets.some(x=>x.valueFrom.includes('play-integrity-verifier')));
});
test('CloudFormation conversion preserves startup/health/storage and rejects unknown structured task fields',()=>{
 const d=P.candidate(binding()).taskDefinition,cf=P.cfnTask(d);a.equal(cf.Cpu,'2048');a.equal(cf.Memory,'4096');a.deepEqual(cf.EphemeralStorage,{SizeInGiB:40});a.deepEqual(cf.ContainerDefinitions[0].HealthCheck.Command,d.containerDefinitions[0].healthCheck.command);a.equal(cf.ContainerDefinitions[0].StopTimeout,120);a.deepEqual(cf.ContainerDefinitions[0].Secrets,[]);
 a.throws(()=>P.cfnTask({...d,volumes:[{name:'unreviewed'}]}));a.throws(()=>P.cfnTask({...d,unreviewed:true}));
});
test('worker patch retains historical Task and changes no service/network/count/other infrastructure properties',()=>{
 const t={Resources:{Task:{Type:'AWS::ECS::TaskDefinition',Properties:{Family:'old'}},Service:{Type:'AWS::ECS::Service',Properties:{TaskDefinition:{Ref:'Task'},DesiredCount:1,NetworkConfiguration:{awsvpc:{}}}},Other:{Type:'AWS::Logs::LogGroup',Properties:{RetentionInDays:7}}}};
 const out=P.patchWorker(t,P.candidate(binding()).taskDefinition);a.deepEqual(out.Resources.Service,t.Resources.Service);a.deepEqual(out.Resources.Other,t.Resources.Other);a.equal(out.Resources.Task.UpdateReplacePolicy,'Retain');a.equal(out.Resources.Task.DeletionPolicy,'Retain');a.throws(()=>P.patchWorker({...t,Transform:'unreviewed'},P.candidate(binding()).taskDefinition));
});
test('worker change-set and execute proposal cannot roll back implicitly to stale revision3',()=>{
 const task=change('Task','AWS::ECS::TaskDefinition','ContainerDefinitions');task.ResourceChange.Replacement='True';const v={Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[task,change('Service','AWS::ECS::Service','TaskDefinition')]};a(P.workerChangeSet(v).serviceTaskOnly);
 a.throws(()=>P.workerChangeSet({...v,Changes:[task,change('Service','AWS::ECS::Service','DesiredCount')]}));a.throws(()=>P.executeRequest(null));a.equal(P.executeRequest('arn:aws:cloudformation:us-east-1:906446637180:changeSet/observed/id').DisableRollback,true);
});
test('old-task retirement holds on stale/unknown/incomplete work proof or one running FFmpeg/lease/claim',()=>{
 const p={taskArn:'arn:aws:ecs:us-east-1:906446637180:task/arc-cluster/cde9c6d466d04b13944e3b8395778468',nativeEvidence:true,evidenceSha256:'a'.repeat(64),observedAt:1000,pauseOwned:true,pauseReadback:true,completeStableSets:true,activeJobs:0,processingLeases:0,nativeFfmpegChildren:0,ambiguousClaims:0,noNewClaimsUntilStop:true,oldTaskProtectionVerified:true};a(P.retirement(p,1001));
 for(const patch of [{nativeEvidence:false},{observedAt:-20000},{pauseOwned:false},{activeJobs:1},{nativeFfmpegChildren:1},{ambiguousClaims:1},{processingLeases:1},{noNewClaimsUntilStop:false},{oldTaskProtectionVerified:false}])a.throws(()=>P.retirement({...p,...patch},1001));
 const natural={...p,nativeFfmpegChildren:null,reviewedNaturalDrain:{nativeEvidence:true,sourceImageContractSha256:'b'.repeat(64),completeAcceptedCohort:true,nativeChildCloseReceiptsComplete:true,accountingStable:true,unknownOutcomes:0}};a(P.retirement(natural,1001));a.throws(()=>P.retirement({...natural,reviewedNaturalDrain:{...natural.reviewedNaturalDrain,nativeChildCloseReceiptsComplete:false}},1001));
});
test('deploy dispatch preserves API body and has plan modes only; source files expose no provider executor',()=>{
 const root=path.resolve(__dirname,'..'),original=execFileSync('git',['show','142ec2298d01d318882ff7078bda96f9553a9740:deploy.sh'],{cwd:root,encoding:'utf8'}),actual=fs.readFileSync(root+'/deploy.sh','utf8');
 a.equal(actual.replace('  worker-permission-plan) exec node scripts/lib/protected-worker-release.js iam-plan ;;\n','').replace('  worker-release-plan) exec node scripts/lib/protected-worker-release.js worker-plan ;;\n',''),original);
 const code=fs.readFileSync(__dirname+'/lib/protected-worker-release.js','utf8');a(!code.includes('spawnSync'));a(!code.includes('execFile'));a.equal(P.readiness().serviceAuthority,0);a.equal(P.readiness().buildAuthority,0);
});
