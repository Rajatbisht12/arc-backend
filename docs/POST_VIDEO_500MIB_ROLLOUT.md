# Post video uploads: implementation and rollout

For the current read-only production inventory, account-scoped canary policy,
private-worker network/role proposals, capacity alarms, activation sequence and
rollback boundary, see [the production activation review](POST_VIDEO_500MIB_PRODUCTION_ACTIVATION_REVIEW.md).
This older implementation outline is not an instruction to apply its merge
templates directly to the live bucket or CloudFront distribution.

## Compatibility deployment (before activation)

See [deployment blocker resolution](POST_VIDEO_500MIB_DEPLOYMENT_BLOCKERS_RESOLUTION.md)
for the tested release verdict and exact operator procedure. The API must retain:

```dotenv
POST_VIDEO_UPLOADS_ENABLED=false
CLIP_HLS_ENABLED=true
CLIP_HLS_WORKER_ENABLED=true
POST_VIDEO_PRIVATE_DELIVERY_ENABLED=false
POST_VIDEO_SOURCE_RETENTION_DAYS=0
```

`deploy.sh` now explicitly pins these values plus API-task-only
`VIDEO_DEPLOYMENT_MODE=compatibility`, references an immutable image digest, and
refuses conflicting active topology or undrained new-pipeline work. No new video
index migration or private signing secrets are needed to run this mode. Do not
turn off the embedded worker by copying the later activation configuration.

## Contract and dependencies

The new path is additive and disabled by default. A post video may be at most
524,288,000 bytes (500 MiB); images, stories, messages, banners and audio retain
their existing policies. Posts retain five media slots and have a 1 GiB total
source-video budget. Clients transfer at most two 8 MiB parts concurrently.

Implementation order:

1. Durable owner-scoped upload sessions, indexes and authenticated multipart API.
2. Private S3 multipart source transfer, reconciliation and verified completion.
3. Dedicated BullMQ video worker extending the existing FFmpeg HLS generator.
4. Verified HLS, compressed MP4 and thumbnail; READY sessions consumed exactly
   once by post creation (Option B: no pending post enters recommendations).
5. Web and native progress/recovery; HLS selection in existing Feed players.
6. Restricted playback delivery, cleanup, local validation and staging canaries.

Session states are CREATED, UPLOADING, UPLOADED, QUEUED, PROCESSING, READY,
FAILED, CANCELLED and EXPIRED. Storage completion and publication are different
operations. The API never downloads or probes the large source. A session and
client post idempotency key prevent response-loss retries from creating another
post. No upload or preload creates a ContentExposure record.

## Baseline evidence

Before edits, backend `npm run typecheck` and `npm run test:clip-hls` passed
(17 tests, plus storage/CDN contracts). Existing Feed forced progressive while
Clips selected ready HLS. The app worktree already contained extensive user
changes; these must remain intact. Live infrastructure is not changed by this
implementation. Earlier playback-delay fixes are retained.

## Data and API migration

Create the VideoUploadSession collection and its owner/idempotency, status/lease
and expiry indexes with the supplied migration before enabling the feature.
Post creation remains multipart for images and user covers; videoUploadIds and
mediaOrder reference owner-authorized READY sessions. clientPostId identifies
the complete draft. Older clients continue using the old <=50 MiB route.

Do not TTL-delete session rows before aborting their multipart upload and cleaning
unreferenced objects. Cleanup is delayed, bounded and idempotent. Ready source
retention is disabled unless explicitly configured/approved. Do not add a blanket
S3 expiry rule covering playback objects referenced by active posts.

## Infrastructure and activation order

1. Build/deploy the API in compatibility mode above. Video indexes are NOT a
   prerequisite for this deployment. Separately, with approval in isolated
   staging, run `node scripts/migrate-video-upload-indexes.js --apply` and
   `--verify` before enabling sessions. Repeat on production only with approval.
   The publication index uses the DocumentDB-supported nonempty-string filter
   `$gt: ''` and a new name; it never drops an existing index. Apply/reapply/
   verify passed on isolated DocumentDB 5.0; a production migration still
   requires a separate approval and recorded pre/post index inventory.
2. Review `infra/post-video-production-worker-network.yaml` and
   `infra/post-video-production-worker-roles.yaml` before the
   `infra/post-video-worker.yaml` stack. Existing private subnets lack NAT/VPC
   endpoints; the worker cannot start there until ECR/S3/log/secret access and
   scoped DocumentDB/Redis ingress are installed. Start the stack at zero tasks
   with an immutable API-compatible image, then prove one healthy dedicated
   consumer processes legacy HLS while the API embedded consumer remains on.
   Switch the API embedded consumer off only after that proof. The guarded
   compatibility `deploy.sh` does not perform this cutover.
3. Merge the CORS and multipart-abort lifecycle rule in the supplied S3 template
   with existing rules; do not replace existing bucket configuration blindly.
4. Configure a CloudFront trusted key group for post-video-playback/*, require
   signed URLs for this behavior, and deny post-video-sources/* to all viewers.
   Restrict the S3 bucket to the worker/API roles plus the intended OAC paths.
   The behavior JSON is a merge template: replace the origin/key-group IDs and
   retain current media CORS/security function associations. It is not a complete
   distribution configuration. Merge the explicit source-deny statement into
   the current bucket policy. Verify unsigned playback and all source CDN URLs
   return 403 before setting POST_VIDEO_PRIVATE_DELIVERY_ENABLED=true.
5. Configure the private-delivery signing settings in `infra/post-video.env.example`.
   Keep signing keys in Secrets Manager. Never place private keys in Web/app env.
   The worker launcher uses the existing runtime Secrets Manager loader; the
   production task role must retain its current secrets-read, database, Redis
   and legacy Clip storage permissions. Staging must use a separate role/secret,
   database, Redis and bucket. `DEPLOYMENT_ENVIRONMENT=staging`, explicit
   `BACKEND_SECRET_ID=arc/staging/...`, and four `STAGING_*` resource guards must
   be provided by the task; copied production endpoints/static AWS keys fail
   startup. The loader never defaults a staging task to the production secret.
   The new IAM template is additive, not a replacement. Review the separate
   deny-only `infra/post-video-staging-isolation.yaml` guardrails and independent
   security groups/credentials before deploying any staging worker. Validation
   of a template is not proof that these guardrails are attached live.
6. Deploy Web/native clients while policy still reports disabled. Native builds
   must include the new bounded part-copy native method.
7. In staging, exercise the real-file matrix, resume, failed jobs, deletion,
   privacy, Feed/Clips, recommendation and device checks.
8. Enable the flag for controlled accounts only after every readiness gate passes.
   Production defaults to `POST_VIDEO_ROLLOUT_MODE=canary` and requires a
   reviewed nonempty `POST_VIDEO_CANARY_USER_IDS` list in the API task
   environment. Other accounts retain legacy upload behavior. A global rollout
   requires an explicit, separately reviewed `POST_VIDEO_ROLLOUT_MODE=all`.

Worker initial candidate: 2 vCPU, 4 GiB RAM, 40 GiB ephemeral storage, one job at
a time, two FFmpeg threads. This is a bounded starting configuration, not a
production capacity guarantee. Measure wall time, CPU, peak RSS/disk and queue
age on representative 500 MiB source durations before tuning or activation.

## Recovery semantics

| Interruption | Durable state / recovery |
| --- | --- |
| Part/network/URL failure | Reconcile S3 parts, renew URLs and retry missing parts. |
| Browser refresh/tab closure | Metadata/draft persists; reselect matching source if file access is lost. No closed-tab transfer guarantee. |
| Native background/lock | Pause safely where continuous transfer is unavailable; resume and reconcile on foreground. |
| App process termination | Restore account-scoped draft/session and accessible source; resume missing parts. |
| Completion response lost | Query/complete same session; do not re-upload accepted parts. |
| Worker restart | BullMQ stalled-job retry and database lease recovery. |
| Processing failure | Safe error stage, bounded retries, no public post/source fallback. |
| Cancel/expiry | Abort multipart; clean unreferenced completed sources/partial outputs. |
| Low device storage | Keep session/draft; explain part-file/preparation failure; retry after space is freed. |

## Rollback

Disable new session creation first; preserve status/complete/cancel access for
in-flight sessions. Keep a compatible worker running until uploads/jobs drain.
Restore client flag policy without deleting session data, completed derivatives
or exposure history. Do not roll back the worker to a version that cannot consume
new upload-session jobs. Existing posts remain playable and canonical Post IDs
do not change. Source retention and CDN revocation require separate approval.

## Readiness

The controlled staging matrix now covers near-limit multipart transfer,
processing, recovery, private CDN denial/authorization, Android, iOS Simulator
and Safari. **Production activation is still NOT READY**: production network,
roles, delivery controls, worker, indexes and alarm delivery are not installed,
and the exact release snapshot and controlled cutover are not approved. Physical
iPhone and signed-release validation are deferred, not passed. See the linked
production activation review for the current gates.

## Cleanup and revocation boundaries

Expired/cancelled unpublished sessions collect their private sources and tracked
partial output versions after aborting multipart transfer. Attached sessions are
scanned in bounded, fair batches. Soft-deleted posts and hard-deleted post
tombstones have a 24-hour cleanup grace; another active reference blocks deletion.
Sources and derivatives of deleted content are collected together after that
grace. Permanent account deletion marks sessions for delayed cleanup. Suspension alone
does not destroy media. Previously published legacy media is not swept by this
new-session cleanup and requires the existing separately reviewed retention plan.

READY originals of live content are retained by default (`POST_VIDEO_SOURCE_RETENTION_DAYS=0`)
until a positive retention value is explicitly approved. Never apply a blanket
playback-prefix expiry rule. Manifest requests recheck current post/viewer access;
already issued CloudFront MP4/thumbnail/segment grants remain usable until their
expiry. The approved 20 October follow-up limits NEW-pipeline grants to **five
minutes maximum** (270–300 seconds with stable 30-second issuance buckets).
This is bounded revocation, not instant revocation: requests already underway
and downloaded bytes cannot be recalled. Legacy media delivery is unchanged.

Updated players renew 60 seconds early through
`GET /api/posts/video-playback-grants/:sessionId`, using current application
authentication (or anonymous access only for public content). Every renewal
rechecks current post/profile/follow/block/activity/deletion/moderation access;
an old media bearer alone is not renewal authority. Responses and manifests are
`private, no-store`. Background/offscreen players do not poll; expiry/denial
stops further loading, and foreground recovery requires fresh authorization.
Renewal-capable clients and their old-version compatibility/release policy must
be verified before activation. Do not extend old-client grants to bypass the
approved five-minute policy. See `POST_VIDEO_500MIB_RENEWAL_RECOVERY_PLAN.md`
and its follow-up validation report. Production remains disabled.
