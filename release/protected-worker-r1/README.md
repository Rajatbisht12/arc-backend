# Protected worker release preparation — no execution authority

This patch adds one two-action statement to the existing roles template. It keeps
all four prior statements, trust policy and the execution role unchanged. Its
static scope is tasks in account906446637180/us-east-1/arc-cluster, reinforced by
ArnEquals ecs:cluster. The task-ID wildcard is necessary before new service tasks
and autoscaled UUIDs exist; it is not Resource:"*". It permits these two operations
on other tasks in this cluster, not IAM-level self/service isolation. No unsupported
ecs:service key or unverified resource tag is used. See the official ECS Service
Authorization Reference. If this residual scope is unacceptable, exact task-ARN
policies require a separately designed per-task provisioning workflow; do not
silently widen or invent conditions.

Preferred change is an IAM-only owning-stack change set on
squadhunt-prod-video-roles. The creation proposal is public and immutable, but the
current owning template/parameters must first match the reviewed source. Creation
is not execution. Reject any resource except WorkerTaskRole.Policies, replacement,
trust-policy change or unrelated edit. Native effective permission still needs
positive task-role agent calls; an Allow or simulation cannot override SCPs.
Rollback removes only this exact addition after fresh policy hash and native proof
that no protected worker depends on the grant. No automatic rollback/revoke.

The image is already published at indexffff210127eb3512a0a7f5967a6a28e08dbd5a10e3c0d8745a234ee5bece2e8a,
with amd64child0e0c1b9a1cc850a2d9100b6a7245e324d95b93ec879388d4e27315b7952821da.
No build/push mode or worker image change is added. The task draft has null
owner/run/public-key bindings and no invented next revision. Worker7's zero ECS
Secrets entries remain zero; its existing runtime shared-config SDK behavior is
preserved, not replaced with the API's different injection configuration.

The existing deploy.sh gains only local worker-permission-plan/worker-release-plan
selectors. Ordinary API body/financial/schema/topology gates and artifact modes
are unchanged. There is intentionally no live worker release executor until the
missing native facts, signed control transport, retirement proof and rollback are
bound. Do not confuse plan output with a deployed service. Test via node, not by
executing deploy.sh under this preparation task.

Proposed stack reconciliation replaces only the Task resource with the exact
reviewed worker7 baseline plus pinned new image/protection/control settings and
Service.TaskDefinition dependency. Retain old Task resources; do not roll to3.
Actual next physical revision must be observed. Current templates, parameters and
service-owned properties still need qualification. Future execution must preserve
failed resources (proposed DisableRollback:true, not yet a native guarantee) and
explicitly manage the independent ECS circuit-breaker rollback. Leave intake owned
and paused on uncertainty; never resume an unqualified old/new fleet automatically.

Old worker7 has no qualified signed drain/child-process observer binding. Stable
queue/lease emptiness plus owner-reported inactivity is not a substitute for any
missing native FFmpeg/claim proof. The retirement guard deliberately refuses such
an incomplete receipt. A separately owned queue pause/natural drain/native proof
must be qualified before service replacement. No new uploads or forced stop here.

GitHub review/merge -> clean pull on deployment laptop -> reviewed deploy.sh stays.
Source parent142ec2298d01d318882ff7078bda96f9553a9740. No dependency, Dockerfile,
application worker source, API219, Redis/DB, eligibility or scaling change.

Local validation: node --test scripts/protected-worker-release.test.js
