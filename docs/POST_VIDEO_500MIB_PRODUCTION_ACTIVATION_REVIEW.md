# Production 500 MiB activation review

> Historical pre-deployment review. For the live phase-one infrastructure,
> `arc-backend:206`, dedicated legacy-HLS proof and remaining activation
> blockers, see [POST_VIDEO_500MIB_PRODUCTION_PHASE1_STATUS.md](POST_VIDEO_500MIB_PRODUCTION_PHASE1_STATUS.md).

21 October 2026, Asia/Kolkata. This is a reviewed change proposal, **not**
authorization to execute it. Physical iPhone and signed release build checks
were explicitly deferred for this follow-up; their absence is not recorded as
a pass. Production still runs `arc-backend:205` with large uploads disabled.

## Read-only production inventory

AWS account `906446637180`, `us-east-1` was inspected directly. ECS
`arc-cluster/arc-backend` has one running, zero pending tasks on revision 205,
image `sha256:cbd57c9f550b8143f9d05046d878d56e9b9f0ca68c9b6799e0250dc40ac73d55`.
The API task has 0.5 vCPU / 1 GiB and uses the embedded Clip HLS consumer.
The existing media distribution has one S3 OAC origin, zero ordered cache
behaviors, zero trusted key groups, and a viewer-response CORS function on its
default behavior. The media bucket blocks public policies/ACLs and uses SSE-S3.
Its policy currently lets that CloudFront distribution read every key. Bucket
CORS has GET/HEAD but no PUT; no bucket lifecycle rule exists. There is no
CloudFront key group/public key, SNS topic or CloudWatch alarm in the account.
The existing production backend secret has the compatibility video flags but
no post-video CloudFront signing/private-delivery key fields; only key names,
not secret values, were inspected.
An account-wide $100 monthly AWS Cost Budget exists; it is not an incremental
video-worker budget or a spend cutoff.

DocumentDB 5.0 and Redis are healthy. Production API subnets route to an
internet gateway and tasks get public IPs. Existing private subnets route only
within the VPC; there is no NAT gateway or VPC endpoint. A worker started with
the prior template's `AssignPublicIp: DISABLED` in those subnets could not pull
ECR layers or reach Secrets Manager/logs/S3. Existing DocumentDB/Redis security
groups accept the API security group, not a new dedicated worker group.

The current task role has Get/Put/Delete access across the media bucket and
can read the production backend secret. The separate worker-role proposal
retains broad read access to legacy media inputs because their historical
object-key distribution has not been audited against production data. Its
write/delete scope is limited to legacy Clip outputs and new video outputs.
The API-only additive IAM template grants new multipart operations but does
**not** narrow that pre-existing broad API role. Least-privilege reduction of
the legacy role is a separate reviewed change, not an effect of this plan.

## Code and templates prepared locally

- Production `POST_VIDEO_UPLOADS_ENABLED=true` now requires either an explicit
  `POST_VIDEO_ROLLOUT_MODE=all` or a nonempty valid canary account-ID list.
  The default is `canary`; missing/invalid IDs refuse startup. The policy
  endpoint reports disabled for other accounts and their create requests return
  403. Existing session status, part-signing, completion, retry and cancellation
  remain owner-scoped and available during a pause. Staging retains its isolated
  all-QA-account behavior. Rollout mode and IDs must be task bootstrap values,
  not silently introduced/expanded by the shared runtime secret.
- `infra/post-video-production-worker-network.yaml` defines private S3 gateway
  and ECR API/DKR, Logs and Secrets Manager interface endpoints in the two
  existing private subnets, a worker group with no inbound listener, and only
  worker-to-DocumentDB/Redis ingress on existing groups. The existing private
  route table gains the S3 service route when this stack is applied.
- `infra/post-video-production-worker-roles.yaml` defines separate execution
  and task roles; `infra/post-video-iam.yaml` now adds multipart/cleanup rights
  only to the API role. Both are proposals requiring IAM review.
- `infra/post-video-worker.yaml` defaults to **zero** tasks, pins an immutable
  image, keeps the worker's HTTP upload flag false, and emits optional
  per-job memory, scratch and wall-time measurements in production. Its alarms
  require a real, subscribed operations SNS topic. Task count must be raised
  only after network, roles, image, secret and alarm tests pass.

These changes have not been committed or deployed. Backend, Web and mobile
worktrees all contain unrelated or previously in-progress edits. In particular,
the mobile composer file mixes this work with other changes. A release owner
must review and isolate the exact source snapshot before producing immutable
Web, API and app artifacts. Do not commit the entire dirty trees as a shortcut.

## Validation of the proposal, not of a live production rollout

With local Node 22.23.3, backend build/runtime-import verification, typecheck,
34/34 post-video renewal/rollout tests, 27/27 deployment-safety tests, 2/2
worker-resource tests and the production-mode legacy compatibility smoke passed.
Existing Clip HLS, privacy and recommendation suites passed after the worker
observation change. `git diff --check` passed. CloudFormation `validate-template`
accepted the private-worker network, separate roles, API IAM and worker stack;
this checks syntax/parameters, not a real change set, IAM effective permissions
or endpoint connectivity. CloudWatch `test-metric-filter` matched both sample
queue and resource JSON events. A real worker/alarm has not been deployed to
production. A subprocess import confirmed production startup rejects an enabled
canary with no owner IDs.

## Proposed changes to existing production media delivery

Record the current S3 bucket policy, CORS, lifecycle and CloudFront distribution
ETag/config before any update. Merge, do not replace, existing rules:

1. Add only the required production Web origins to the multipart PUT CORS rule;
   retain existing GET/HEAD origins and exposure headers. Android/iOS direct
   uploads do not depend on browser Origin headers.
2. Add the two-day incomplete multipart-abort rule scoped to
   `post-video-sources/`; do not expire live playback objects or original
   sources by prefix.
3. Add the explicit S3 deny for CloudFront's service principal on
   `post-video-sources/*`. Its Deny must override today's OAC allow for all
   objects. Verify both unsigned and correctly signed CDN source requests
   return 403, while authorized worker/API S3 operations still work.
4. Create a dedicated CloudFront public key and trusted key group; store the
   private key only in Secrets Manager. Add an ordered
   `post-video-playback/*` behavior on the existing OAC origin with the trusted
   key group. Preserve the default legacy behavior, current viewer-response
   CORS function, logging and cache/security policies. Verify signed/unsigned
   HLS child segments, thumbnails, MP4 Range requests and real privacy changes
   before any API issues production grants.

The JSON in `infra/post-video-cloudfront-behavior.json` is a merge template;
it omits the live function association and actual origin/key-group IDs. Do not
submit it as a complete replacement distribution config. Staging passed this
delivery model, but production has none of these controls today.

## Capacity and alert policy for the first canary

The isolated single-worker 180-second, exact-500-MiB job took **451.9 s**;
the round-2 two-worker batch's exact-500-MiB job took **668.2 s**. Each worker
was 2 vCPU / 4 GiB / 40 GiB with concurrency 1 and two FFmpeg threads. The
observed 500-MiB sampled peak was about 1.1 GiB memory and 0.8 GiB scratch.
These two points imply only a rough saturated ceiling of **5.4–8.0 such jobs
per worker-hour**, not a throughput guarantee for longer/HDR/high-motion media.

Start with one allowlisted synthetic production QA account and at most two
workers. Keep the existing per-owner session/rate limits. Stop admitting new
sessions if waiting jobs reach three for five minutes, any job fails repeatedly,
worker health fails, or the 15-minute job alarm fires; inspect queue age and
underlying error before resuming. The worker template also alarms on sampled
memory above 3 GiB and scratch above 30 GiB. These per-job metrics are emitted
at job completion, so ECS service memory/CPU and task health must be watched
during processing. An alert recipient and escalation owner have not been
chosen; alarms without a subscribed destination are not an activation pass.

Cost drivers are continuous worker tasks, four interface endpoints across two
AZs, S3 originals plus renditions, processing logs and CloudFront egress.
Staging traffic is not a production-volume forecast. Before approving a paid
production canary, set an incremental AWS Budget and alert thresholds against
an owner-approved amount; AWS Budgets alerts are not a hard spend cutoff.
Capture actual first-day task hours, ingest, storage, egress and queue demand
before expanding the allowlist. No dollar forecast is asserted from the small
synthetic sample.

## Ordered, reversible rollout proposal

1. Freeze reviewed Git commits and immutable image/web/app artifacts. Run
   backend build, typecheck, deployment safety, private-media, HLS and renewal
   suites; Web typecheck/build/player tests; mobile TypeScript/upload/privacy/
   call tests. Existing Android, Safari and iOS Simulator staging results are
   evidence for these components, not proof of the future release artifacts.
2. Review a CloudFormation change set for the private endpoint/network and
   worker-role templates. These endpoints incur recurring charges even with
   zero worker tasks. Apply only under a separate production change approval.
   Create/subscribe a real operations alert topic and test alarm delivery.
3. Apply the additive VideoUploadSession/index migration with an explicit
   production approval and run `--verify`; the normal `deploy.sh` does **not**
   run it. Prior isolated DocumentDB 5.0 apply/reapply/verify passed. Preserve
   Post and ContentExposure data. Record pre/post index lists.
4. Prepare S3, CloudFront and signing-secret changes as reviewed diffs. Check
   source denial and signed playback while no new upload session can be
   created. Preserve public legacy Clip routes and existing media CORS.
5. Deploy the identical API-compatible image to a worker service at desired
   count zero, then start one worker and verify Redis/DocumentDB/S3 connectivity,
   alarm telemetry and real **legacy** HLS consumption. Keep the API's embedded
   legacy worker enabled until the dedicated consumer is healthy.
6. Deploy the new API with `POST_VIDEO_UPLOADS_ENABLED=false`,
   `CLIP_HLS_ENABLED=true`, `CLIP_HLS_WORKER_ENABLED=false`,
   `POST_VIDEO_PRIVATE_DELIVERY_ENABLED=true`,
   `POST_VIDEO_SOURCE_RETENTION_DAYS=0`, and remove API-only
   `VIDEO_DEPLOYMENT_MODE=compatibility`. New signing keys and exact API/media
   origins must be set; legacy posts/Clips, auth, calls and recommendations
   get smoke tests. `deploy.sh` always pins compatibility mode and therefore
   cannot perform this cutover. A separately reviewed task-definition update
   and its own preflight/rollback procedure are required.
7. After the dedicated worker and private delivery pass, update only the API
   task to `POST_VIDEO_UPLOADS_ENABLED=true`,
   `POST_VIDEO_ROLLOUT_MODE=canary` and a reviewed
   `POST_VIDEO_CANARY_USER_IDS` containing the single QA owner. Keep two worker
   tasks only if alarm delivery, load and queue behavior justify the second.
   Exercise an authorized small source first, then near-limit transfer,
   processing, playback, expiry, privacy, cancellation and legacy regressions.
   Keep the first QA video private to its owner/approved QA viewers. The
   installed older mobile-client population has not been proven capable of
   renewing a five-minute grant; an owner allowlist controls creation, not who
   sees a public post. A public-content canary needs an explicit old-client
   compatibility or minimum-version policy before publication.
8. Expand accounts only after observed queue age, costs and failure/recovery
   results meet an explicitly approved service target and renewal-capable
   client adoption/old-version behavior is resolved. An all-account rollout
   requires the separate `POST_VIDEO_ROLLOUT_MODE=all` setting and removal of
   canary IDs.

## Rollback boundary

Before any new session is accepted, revert the candidate API task definition
and worker configuration to their recorded prior revisions if health fails.
After sessions exist, first set **only** `POST_VIDEO_UPLOADS_ENABLED=false` to
stop new sessions; retain the new API/private delivery and a compatible worker
until existing sessions and published posts are safely served or drained.
Do not revert directly to `arc-backend:205`, disable the worker, remove the
signed playback behavior/key or delete S3/index/session records while new
media is in use. The controlled rollout needs a tested drain and playback
continuity decision before approval.

## Remaining decisions and status

**Current production activation verdict: NOT READY.** The production network,
roles, key group, source denial, CORS/lifecycle, alarm recipient, worker and
indexes have not been changed. The rollout source is not yet reviewed/committed.
An activation-specific guarded ECS procedure and live production smoke tests
must be completed after the above changes. Physical iPhone and signed release
build validation remain deferred by the user's instruction; a decision to
accept that release risk must be explicit when approving activation. No
production mutation was made in this review.
