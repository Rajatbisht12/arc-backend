# Production video phase-one status — 21 October 2026

This records the approved, limited production preparation in AWS account
`906446637180`, `us-east-1`. It does **not** authorize or record activation of
500 MiB uploads. The production API remains on `arc-backend:206` with
`POST_VIDEO_UPLOADS_ENABLED=false`, `CLIP_HLS_ENABLED=true`,
`CLIP_HLS_WORKER_ENABLED=true`, `POST_VIDEO_PRIVATE_DELIVERY_ENABLED=false`,
`POST_VIDEO_SOURCE_RETENTION_DAYS=0` and
`VIDEO_DEPLOYMENT_MODE=compatibility`.

## Prepared and verified

- The dedicated production worker service
  `squadhunt-prod-video-worker-Service-5bK8EbU7Uwmj` ran one task from
  `squadhunt-prod-video-worker-worker:1` in private subnets for the proof,
  then was scaled back to desired/running **0/0** through a reviewed
  CloudFormation change set. The API's embedded legacy HLS worker has **not**
  been disabled. Its execution/task roles, VPC
  endpoints, DocumentDB/Redis security-group access, log group and five alarms
  were deployed in separate CloudFormation stacks. The operations SNS
  subscription was confirmed and its test message received.
- Additive video upload indexes were applied and independently verified on
  production DocumentDB 5.0. No existing Post or ContentExposure records were
  modified by the migration.
- Existing S3 GET/HEAD CORS rules and the default CloudFront OAC behavior were
  preserved. A production Web PUT preflight returned HTTP 200 with the
  expected origin, method and headers. The new source prefix is denied to
  CloudFront; the versioned playback prefix has a trusted-key-group behavior.
  Tiny isolated probes returned source 403, unsigned playback 403, valid
  signed playback 200, signed Range 206 and expired signed playback 403.
  Legacy Clip manifest delivery remained HTTP 200.
- A 495,092-byte synthetic H.264/AAC clip was published by the authorized
  `zoro` account while its profile was `Followers Only`. The **dedicated**
  worker log recorded `Clip HLS processing started`, `completed` and `job
  completed` for post `6ad867e0fb63059857331a48`, media
  `6ad867e0fb63059857331a49`, version
  `4dfd835c-50ca-442d-9450-34c57839ace4`. Processing took 1.303 seconds,
  generated a 360p rendition, fallback MP4 and thumbnail, and sampled about
  85 MB peak container memory and 1.2 MB scratch. The HLS master and segment
  returned HTTP 200 from the CDN. The owner viewed the color-bars video in
  the Android app. Before deletion, anonymous post access returned 403 and
  public SEO returned 404.
- The QA post was soft-deleted through the owner's app. Its direct owner link
  then displayed `Post not found`, and an anonymous API fetch returned 404.
  The exact one source object and six derived objects were separately removed
  from S3 because legacy post deletion does not remove media. CloudFront
  invalidation `I41Z4XMAJKKPHR9AXIDEGI2622` completed for only those paths;
  the old manifest is no longer retrievable. The synthetic copy placed in
  Android Downloads was removed. The S3 bucket has no versioning, so these
  seven media objects are not recoverable from S3. The inactive post database
  record remains by product design.
- After the test, the API remained running/healthy, its `/health` returned
  200, the dedicated service completed its scale-to-zero, and all five
  video-worker alarms were `OK` before scale-down.

## Compatibility-only cutover and rollback

The owner separately approved a compatibility-only API cutover after the
dedicated-worker proof. The operations inbox confirmed receipt of both the SNS
test message and a manually triggered CloudWatch alarm email; the test alarm
was restored to `OK`.

The dedicated worker was restarted and became healthy. A one-off API task
using the proposed environment passed the disabled-upload/private-delivery
startup check, and the compatibility preflight found no active new-video
sessions or incompatible queued work. Candidate `arc-backend:207` used the
same immutable image as `:206`; its only environment changes were
`CLIP_HLS_WORKER_ENABLED=true` to `false`,
`POST_VIDEO_PRIVATE_DELIVERY_ENABLED=false` to `true`, and removal of
`VIDEO_DEPLOYMENT_MODE=compatibility`. `POST_VIDEO_UPLOADS_ENABLED=false`,
`CLIP_HLS_ENABLED=true`, and `POST_VIDEO_SOURCE_RETENTION_DAYS=0` stayed
unchanged. No 500 MiB session was enabled.

Revision `:207` deployed and reached ECS/ALB healthy status. `/health`,
anonymous feed and Clips requests, legacy HLS and MP4 delivery, and the five
alarms passed immediate smoke checks. **It was then deliberately rolled back
to `arc-backend:206`**: the approved 48-hour worker window ends with a
scheduled scale-to-zero on 23 October, and leaving `:207` active would stop
legacy HLS processing at that time. The API rollback completed with one
healthy `:206` task and `/health` HTTP 200. A subsequent ordinary legacy clip
was processed to completion by the restored embedded worker. The dedicated
worker was returned to ECS desired/running **0/0**; its CloudFormation stack
again declares `DesiredCount=0` and is `UPDATE_COMPLETE`. All five alarms
were `OK` after the rollback. The scheduled scale-to-zero remains as a
backstop.

The cutover is therefore technically proven in a short window, but **not an
approved durable topology**. Repeating it requires an explicit ongoing worker
budget/ownership decision, a schedule consistent with continuous legacy HLS
processing, and a fresh guarded cutover and smoke test. Do not simply change
the API flags or allow the scheduled worker stop while the embedded worker is
disabled.

## Time, cost and operational boundaries

The approved incremental spend limit is $30 for the first 48-hour preparation
window, with no more than one 2-vCPU/4-GiB worker. Application Auto Scaling
scheduled action `pause-prod-video-worker-phase1-20261023` sets the worker
target min/max to zero at **2026-10-23 06:30 UTC** (12:00 IST). Verify the
actual service desired/running count at that time. The worker is already at
zero; this scheduled action is a backstop against an unsanctioned restart.
Private VPC endpoints
continue to incur cost until separately removed; the scheduled worker stop
does not remove them. Do not treat AWS budget alerts as a hard spending cap.

The shared Redis uses parameter group `default.redis7`, whose
`maxmemory-policy` is `volatile-lru`. No evictions were reported during the
one-hour observation and database memory usage was about 6.4%, but BullMQ's
recommended `noeviction` policy is not configured. The queue retains 352
historical failed jobs (sampled failures from September had the old task
role's S3 ListBucket denial). None were retried in this phase.

## Not yet authorized or verified

1. Do not leave the API embedded HLS worker off or private delivery enabled
   beyond a separately approved, continuously staffed/funded worker window.
   The short, approved `:207` cutover was rolled back; `deploy.sh` pins
   compatibility mode and must not be used to perform that cutover.
2. Do not enable `POST_VIDEO_UPLOADS_ENABLED` or create production large-video
   sessions yet. A separate allowlisted canary approval, owner-only publication
   path, old-client five-minute grant renewal decision and monitored stop
   conditions are still required.
3. Real production 500 MiB multipart/processing/playback, long-duration load,
   failure recovery and privacy revocation have not been proven in this phase.
   CloudWatch alarm-action email delivery was confirmed, but end-to-end
   alarm coverage under real failures remains untested. Staging evidence does
   not replace those production checks.
4. Physical iPhone and signed release-build checks remain deferred, not passed.

**Verdict:** phase-one production infrastructure and dedicated legacy-HLS
proof passed; the limited compatibility cutover passed immediate checks but
was rolled back to the safe embedded-worker topology before the approved
worker window expires. **500 MiB production activation remains NOT READY.**

The proposed next bounded QA step, its additional spending/cleanup approvals,
and a local (not deployed) owner-only canary publication guard are documented
in [POST_VIDEO_500MIB_PRODUCTION_CANARY_PROPOSAL.md](POST_VIDEO_500MIB_PRODUCTION_CANARY_PROPOSAL.md).
