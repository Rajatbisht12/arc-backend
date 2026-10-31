'use strict';
// LOCAL PREPARATION ONLY. Deliberately no provider client or deployment executor.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const before=require('../../release/protected-worker-r1/roles-before.json');
const base=require('../../release/worker-r4/baseline-worker7.json');
const P=require('./protected-worker-definition');
const check=(v,c)=>{if(!v)throw Error(c);},clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const IMAGE='906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend@sha256:ffff210127eb3512a0a7f5967a6a28e08dbd5a10e3c0d8745a234ee5bece2e8a';
const CHILD='sha256:0e0c1b9a1cc850a2d9100b6a7245e324d95b93ec879388d4e27315b7952821da';
const ROLE='arn:aws:iam::906446637180:role/squadhunt-prod-video-roles-WorkerTaskRole-pfneHq58I2ZC';
const ROLE_ID='AROA5GDDOBB6O4TFUCMR5',POLICY_HASH='5508ff4eb0044827fbb1ae3e79b712edb316294bc2db422817158592233706ce';
const OLD_TASK='arn:aws:ecs:us-east-1:906446637180:task/arc-cluster/cde9c6d466d04b13944e3b8395778468';
function grant(){return{Sid:'ProtectDedicatedWorkerTasksInArcCluster',Effect:'Allow',Action:['ecs:GetTaskProtection','ecs:UpdateTaskProtection'],Resource:'arn:aws:ecs:us-east-1:906446637180:task/arc-cluster/*',Condition:{ArnEquals:{'ecs:cluster':'arn:aws:ecs:us-east-1:906446637180:cluster/arc-cluster'}}};}
function patchRoles(actual){
 check(hash(actual)===hash(before),'CURRENT_ROLE_TEMPLATE_NOT_QUALIFIED');const out=clone(actual),policies=out.Resources.WorkerTaskRole.Properties.Policies;
 check(policies.length===1&&policies[0].PolicyName==='ProductionVideoWorker'&&policies[0].PolicyDocument.Statement.length===4,'EXACT_FOUR_STATEMENTS_REQUIRED');
 policies[0].PolicyDocument.Statement.push(grant());return out;
}
function rolePreflight(v){
 check(v.roleArn===ROLE&&v.roleId===ROLE_ID&&v.policySha256===POLICY_HASH,'ROLE_OR_POLICY_CHANGED');
 check(v.trustPolicySha256==='1c91a44c9e42f2aa5f228c847933d40d8f61f7cc114da1707dc4790749246b4d','ROLE_TRUST_CHANGED');
 check(v.attachedPolicies===0&&v.permissionsBoundary===false&&JSON.stringify(v.inlinePolicies)===JSON.stringify(['ProductionVideoWorker']),'UNREVIEWED_ROLE_POLICY_SET');
 check(v.ownedRole===true&&v.templateSha256===hash(before)&&v.completeParameters===true,'OWNING_STACK_BINDING_MISSING');return true;
}
function rollbackRoles(actual,proof){check(hash(actual)===hash(patchRoles(before)),'GRANT_OR_OTHER_POLICY_CHANGED');check(proof?.nativeEvidence===true&&proof.dependentProtectedTasks===0&&proof.unknownDependencies===0,'GRANT_STILL_REQUIRED');check(/^[a-f0-9]{64}$/.test(proof.expectedPostGrantPolicySha256||'')&&proof.currentIdentityPolicySha256===proof.expectedPostGrantPolicySha256,'LIVE_POST_GRANT_POLICY_CHANGED');return clone(before);}
function iamRequest(){return{StackName:'squadhunt-prod-video-roles',ChangeSetName:'pi-worker-protection-cs-r1-20261101',ChangeSetType:'UPDATE',TemplateBody:JSON.stringify(patchRoles(before)),Parameters:[{ParameterKey:'MediaBucketArn',UsePreviousValue:true},{ParameterKey:'BackendSecretArn',UsePreviousValue:true}],Capabilities:['CAPABILITY_IAM'],ClientToken:'pi-worker-protection-cs-r1-20261101'};}
function onlyProperties(change,names){
 check(change.Action==='Modify'&&change.Replacement==='False'&&change.Scope?.every(s=>s==='Properties')&&change.Details?.length>0,'UNREVIEWED_RESOURCE_REPLACEMENT');
 for(const d of change.Details)check(d.Target?.Attribute==='Properties'&&names.includes(d.Target.Name)&&(!d.Target.RequiresRecreation||d.Target.RequiresRecreation==='Never'),'UNREVIEWED_PROPERTY_CHANGE');
}
function iamChangeSet(v){check(v.Status==='CREATE_COMPLETE'&&v.ExecutionStatus==='AVAILABLE'&&v.Changes?.length===1,'IAM_CHANGESET_NOT_EXACT');const c=v.Changes[0].ResourceChange;check(c?.LogicalResourceId==='WorkerTaskRole'&&c.ResourceType==='AWS::IAM::Role','UNRELATED_IAM_RESOURCE');onlyProperties(c,['Policies']);return{onlyWorkerRolePolicies:true,executionAuthorized:false};}
function candidate(binding){
 const ready=binding?.owner&&binding?.runId&&binding?.publicKeyPem;
 let td;if(ready)td=P.prepare(base,IMAGE,binding);else{td=clone(base);for(const k of ['taskDefinitionArn','revision','status','requiresAttributes','compatibilities','registeredAt','registeredBy'])delete td[k];td.containerDefinitions[0].image=IMAGE;}
 const c=td.containerDefinitions[0],changes={VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED:'true',VIDEO_WORKER_R4_CONTROL_ENABLED:'true',VIDEO_WORKER_EXPECTED_SERVICE:'squadhunt-prod-video-worker-Service-5bK8EbU7Uwmj',VIDEO_WORKER_EXPECTED_FAMILY:td.family,VIDEO_WORKER_CONTROL_OWNER:ready?binding.owner:null,VIDEO_WORKER_CONTROL_RUN_ID:ready?binding.runId:null,VIDEO_WORKER_CONTROL_PUBLIC_KEY_PEM:ready?binding.publicKeyPem:null,VIDEO_TASK_PROTECTION_MINUTES:'120'};
 for(const [name,value]of Object.entries(changes)){const row=c.environment.find(x=>x.name===name);if(row)row.value=value;else c.environment.push({name,value});}
 return{status:ready?'BOUND_SOURCE_DRAFT_NOT_RELEASE_AUTHORITY':'UNBOUND_DRAFT_NOT_REGISTERABLE',taskDefinition:td,expectedIndex:IMAGE.split('@')[1],expectedLinuxAmd64Child:CHILD,actualTaskRevision:null,providerCalls:0};
}
function mapProperties(value,fields,label){const out={};for(const [k,v]of Object.entries(value)){check(fields[k],label+'_UNSUPPORTED_FIELD');out[fields[k]]=v;}return out;}
function cfnTask(td){
 check(td.cpu==='2048'&&td.memory==='4096'&&td.taskRoleArn===ROLE&&td.containerDefinitions.length===1,'WORKER_TOPOLOGY_CHANGED');
 const c=td.containerDefinitions[0];check(c.environment.every(x=>typeof x.name==='string'&&typeof x.value==='string'),'CONTROL_BINDINGS_MISSING');
 const out=mapProperties(td,{family:'Family',taskRoleArn:'TaskRoleArn',executionRoleArn:'ExecutionRoleArn',networkMode:'NetworkMode',volumes:'Volumes',placementConstraints:'PlacementConstraints',runtimePlatform:'RuntimePlatform',requiresCompatibilities:'RequiresCompatibilities',cpu:'Cpu',memory:'Memory',ephemeralStorage:'EphemeralStorage',containerDefinitions:'ContainerDefinitions'},'TASK');
 check(td.volumes.length===0&&td.placementConstraints.length===0,'UNREVIEWED_TASK_VOLUME_OR_PLACEMENT');
 out.RuntimePlatform=mapProperties(td.runtimePlatform,{operatingSystemFamily:'OperatingSystemFamily',cpuArchitecture:'CpuArchitecture'},'RUNTIME');
 out.EphemeralStorage=mapProperties(td.ephemeralStorage,{sizeInGiB:'SizeInGiB'},'STORAGE');
 const x=mapProperties(c,{name:'Name',image:'Image',cpu:'Cpu',links:'Links',portMappings:'PortMappings',essential:'Essential',entryPoint:'EntryPoint',command:'Command',environment:'Environment',environmentFiles:'EnvironmentFiles',mountPoints:'MountPoints',volumesFrom:'VolumesFrom',secrets:'Secrets',stopTimeout:'StopTimeout',dnsServers:'DnsServers',dnsSearchDomains:'DnsSearchDomains',extraHosts:'ExtraHosts',dockerSecurityOptions:'DockerSecurityOptions',dockerLabels:'DockerLabels',ulimits:'Ulimits',logConfiguration:'LogConfiguration',healthCheck:'HealthCheck',systemControls:'SystemControls',credentialSpecs:'CredentialSpecs'},'CONTAINER');
 for(const k of ['links','portMappings','environmentFiles','mountPoints','volumesFrom','secrets','dnsServers','dnsSearchDomains','extraHosts','dockerSecurityOptions','dockerLabels','ulimits','systemControls','credentialSpecs'])check(Object.keys(c[k]||{}).length===0,'UNREVIEWED_CONTAINER_STRUCTURED_SETTING');
 x.Environment=c.environment.map(e=>({Name:e.name,Value:e.value}));x.LogConfiguration={LogDriver:c.logConfiguration.logDriver,Options:clone(c.logConfiguration.options)};
 x.HealthCheck=mapProperties(c.healthCheck,{command:'Command',interval:'Interval',timeout:'Timeout',retries:'Retries',startPeriod:'StartPeriod'},'HEALTH');out.ContainerDefinitions=[x];return out;
}
function patchWorker(actual,td){
 check(!actual.Transform&&actual.Resources?.Task?.Type==='AWS::ECS::TaskDefinition'&&actual.Resources?.Service?.Type==='AWS::ECS::Service','UNQUALIFIED_WORKER_TEMPLATE');
 check(JSON.stringify(actual.Resources.Service.Properties.TaskDefinition)===JSON.stringify({Ref:'Task'}),'UNREVIEWED_SERVICE_TASK_REFERENCE');
 const out=clone(actual);out.Resources.Task.Properties=cfnTask(td);out.Resources.Task.UpdateReplacePolicy='Retain';out.Resources.Task.DeletionPolicy='Retain';return out;
}
function workerChangeSet(v){
 check(v.Status==='CREATE_COMPLETE'&&v.ExecutionStatus==='AVAILABLE'&&v.Changes?.length===2,'WORKER_CHANGESET_NOT_EXACT');
 const changes=v.Changes.map(x=>x.ResourceChange);check(new Set(changes.map(x=>x.LogicalResourceId)).size===2,'DUPLICATE_RESOURCE_CHANGE');
 const task=changes.find(x=>x.LogicalResourceId==='Task'),service=changes.find(x=>x.LogicalResourceId==='Service');
 check(task?.ResourceType==='AWS::ECS::TaskDefinition'&&task.Action==='Modify'&&task.Replacement==='True'&&service?.ResourceType==='AWS::ECS::Service','UNRELATED_WORKER_RESOURCE');onlyProperties(service,['TaskDefinition']);return{taskReplacementExpected:true,serviceTaskOnly:true,executionAuthorized:false};
}
function retirement(v,now=Date.now()){
 check(v?.taskArn===OLD_TASK&&v.nativeEvidence===true&&typeof v.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(v.evidenceSha256),'NATIVE_OLD_WORKER_PROOF_MISSING');
 check(Number.isSafeInteger(v.observedAt)&&v.observedAt<=now&&now-v.observedAt<=20000,'RETIREMENT_PROOF_STALE');
 check(v.pauseOwned&&v.pauseReadback&&v.completeStableSets&&v.activeJobs===0&&v.processingLeases===0&&v.nativeFfmpegChildren===0&&v.ambiguousClaims===0,'OLD_ACCEPTED_WORK_NOT_DRAINED');
 check(v.noNewClaimsUntilStop===true&&v.oldTaskProtectionVerified===true,'OLD_TASK_TERMINATION_NOT_FENCED');return true;
}
function executeRequest(changeSetArn){check(/^arn:aws:cloudformation:us-east-1:906446637180:changeSet\//.test(changeSetArn||''),'EXACT_OBSERVED_CHANGESET_ARN_REQUIRED');return{ChangeSetName:changeSetArn,DisableRollback:true};}
function readiness(){return{status:'PREPARATION_ONLY_NOT_DEPLOYABLE',iamDocumentReady:true,iamMutationApproved:false,image:IMAGE,expectedChild:CHILD,missing:['current owning templates/parameters qualification','reviewed IAM change-set response and separate execution approval','exact revision3 provider definition comparison','owner/public signing key and private control transport','owned queue pause and positive old-worker drain proof','fence-preserving rollback and approved capacity overlap','native permission/acquire/renew/drain/fault readbacks'],providerCalls:0,buildAuthority:0,serviceAuthority:0};}
function main(){const mode=process.argv[2];if(mode==='iam-plan')console.log(JSON.stringify({status:'UNAPPROVED_CHANGESET_PROPOSAL_ONLY',request:iamRequest(),requestSha256:hash(iamRequest()),scope:'IAM_ONLY_CHANGESET_CREATE_NOT_EXECUTE',missing:'current owner-template/parameter qualification',providerCalls:0}));else if(mode==='worker-plan')console.log(JSON.stringify(readiness()));else throw Error('NO_EXECUTION_MODE_IMPLEMENTED');}
module.exports={grant,patchRoles,rolePreflight,rollbackRoles,iamRequest,iamChangeSet,candidate,cfnTask,patchWorker,workerChangeSet,retirement,executeRequest,readiness,hash,IMAGE,CHILD};
if(require.main===module){try{main();}catch{console.error('PROTECTED_WORKER_PLAN_HELD_NO_PROVIDER_CALL');process.exitCode=1;}}
