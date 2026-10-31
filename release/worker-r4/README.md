# Protected worker artifact candidate

This directory contains the exact locally qualified R4 worker-only source: 759
frozen files and seven reviewed overlays. `source.zip` is a build context, not a
container image or a claim about deployed worker7. Inspect `worker.patch` and
`overlay/` for the application change; `source-manifest.json` and `isolation.json`
bind every file. No dependency lock, API admission, storage or Dockerfile change
is introduced relative to the frozen parent. The repository main tree differs
from that deployed-parent context, so building the whole checkout would not
reproduce the qualified candidate.

Worker source content SHA256:
`2d26090dd563b8f7cc329f6b47638b0a515db8a569df6b9d3f535760afb44329`

Source ZIP SHA256:
`7d198bf776ea41073c9a596625616fa141bf76b16c8f960a48bc3e6a5873d599`

The public signing-key/task/service bindings in a future worker definition must
be exact and separately approved. The actual worker7 service currently uses
revision 7 while its owning stack records revision 3. Do not apply the old worker
stack template blindly: reconcile that drift first. The scalable target remains
0/1, has no policies/schedules and is not owned by the inspected worker stack.
IAM simulation returned missing-context implicit denials, not effective permission
clearance. None of these dependencies is bypassed by this artifact PR.

## Existing deployment-laptop workflow

GitHub review/merge → exact clean pull on the separate Docker laptop → existing
`deploy.sh`. Merging this PR is not build/push or deployment approval. No Docker
installation or image build is required on the coding laptop.

A new `SQUADHUNT_RELEASE_KIND=worker-artifact-plan` branch in `deploy.sh` validates
only local immutable bytes and prints a plan. The ordinary compatibility/API
script body and topology guard are unchanged. Unknown release modes reject.
The artifact-only build path never registers a task, updates a service, launches
an app/schema helper or touches a database/queue. API financial/schema/preflight
safety checks are retained on the API branch, not relabeled as PASS or skipped by
an API deployment flag. There is no worker-deployment mode in this PR.

After separate exact artifact-build approval, `worker-artifact-build` accepts an
external receipt through `WORKER_ARTIFACT_APPROVAL` and a new external journal
through `WORKER_ARTIFACT_JOURNAL`. Receipt fields:

```json
{
  "decision": "APPROVE_WORKER_ARTIFACT_BUILD_PUSH_ONLY",
  "sourceRevision": "<actual clean merged revision>",
  "contentSha256": "2d26090dd563b8f7cc329f6b47638b0a515db8a569df6b9d3f535760afb44329",
  "archiveSha256": "7d198bf776ea41073c9a596625616fa141bf76b16c8f960a48bc3e6a5873d599",
  "repository": "906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend",
  "runId": "<fresh reviewed run and tag>",
  "tag": "<same exact run/tag>",
  "dockerContext": "<reviewed default or desktop-linux>",
  "approvedAt": "<actual numeric local approval receipt time>",
  "maxBuilds": 1,
  "maxPushes": 1,
  "providerMutationsBeyondImagePush": 0
}
```

This is a schema example, not an approval receipt. The builder requires a local
Unix/named-pipe Docker endpoint and an existing `docker` driver, performs one
build-and-registry-push attempt, and closes permanently on any outcome. It never
creates a builder or falls back to a remote/paid build system. Buildx support must
be qualified on the deployment laptop. No retry after lost push acknowledgement.
Use one fresh tag; a failed/ambiguous artifact requires separate metadata review.
The exact build/push identity, 30-minute window, tag, context, cleanup/storage/log
and cost terms must be accepted in that separate review before use.

The exact raw OCI registry index must match the observed build digest and contain
one Linux/amd64 child. Both are written to the artifact receipt only after an
actual build/push. No digest is inferred from source. The helper preserves the
external failed journal/context for review and makes zero ECS changes.

## Local tests

`node --test scripts/worker-artifact.test.js` tests frozen extraction, readable
runtime permissions, untouched API branch, approval and lost-push/restart guards,
observed index/child binding and exact worker-only task preparation. It performs
no actual Docker or AWS call.

Optional `scripts/worker-local/*.test.cjs` require the existing local test
libraries, Redis and FFmpeg. They run the exact worker entry against real local
BullMQ/Redis/FFmpeg, with a local ECS-agent fixture and injected persistence, plus
real local four-rung HLS. They do not prove Fargate, production JWT/S3 privacy,
real protection permissions or genuine accepted-source entitlement.

A later source/image/task/source-bound two-worker review remains required. No
new uploads, job retries, scaling min1/max4, verifier activation, ledger bootstrap
or all-authenticated eligibility change is authorized by this PR.
