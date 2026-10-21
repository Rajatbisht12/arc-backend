# iOS and Safari end-to-end validation — proposed new staging window

21 October 2026. **User approved this new staging window and additional $15 cap.**
Previous staging environments were deleted. Their time/spending authorizations
do not authorize this run. Production activation is not part of this plan.

The approved window started at **2026-10-20T21:22:07Z** (21 October, 02:52 IST)
only after the synchronized full iOS build and local native Sign In launch
passed. Deadline: **2026-10-21T03:22:07Z / 08:52 IST**. Read-only AWS/template
validation and local helper preparation are not provisioning evidence; actual
round-3 identities and execution times are recorded in its separate manifest.

## Preconditions

- Complete the separately approved Apple iOS component installation.
- Boot an eligible iPhone simulator; complete the full SquadHunt workspace build
  and Swift module checks. Do not spend the AWS window waiting for a runtime.
- Diagnose local Safari rendering and exercise the actual player components.
- Record the reviewed source/archive hash; run build/typecheck/client regressions.
- Recheck AWS account, existing resource names, quotas and costs read-only before
  creating anything. Abort if the reviewed isolation controls do not pass.

## Requested bounds

- Account **906446637180**, region **us-east-1**.
- **New six-hour window**, starting at the first new billable resource, and an
  **additional $15 authorization cap**. This is a spending limit, not a price
  quote or an AWS-enforced cap. Billing can lag; stop before a bound is reached.
- At most **one** dedicated worker, 2 vCPU / 4 GiB / 40 GiB, one job/container
  and two FFmpeg threads. No concurrent capacity expansion in this run.
- At most two staging-only CodeBuild builds if local Docker remains unavailable.
- At most 10 GiB each of source ingress, derivative storage and CDN transfer.
- Only synthetic accounts and generated media. No production sign-in, posts,
  personal videos, production migrations or production configuration changes.

## New isolated infrastructure

Reuse the reviewed staging templates, not production deploy.sh. Create new
physical identities and stack IDs, record them in a round-3 manifest, and use
`ValidationRound=3`, `Environment=staging` and an explicit expiry.

- New VPC/subnets, one NAT/EIP, staging SGs and S3 gateway endpoint; no peering
  or routing to production.
- New DocumentDB 5.0 t3.medium, Redis 7.1 t4g.micro, independently generated
  credentials and `arc/staging/post-video-r3/*` secrets. Do not restore or reuse
  earlier secrets scheduled for deletion.
- New private bucket `squadhunt-video-staging-r3-906446637180-us-east-1`, source
  and versioned playback prefixes, CORS and multipart cleanup scoped to staging.
- New API task (0.5 vCPU / 1 GiB), internal ALB, API CloudFront VPC origin and
  signed-media distribution/OAC/key group. No public DNS changes.
- Stage-only ECS worker/queue/IAM roles, ECR, encrypted build archive, logs and
  monitoring. No production secret, database, Redis or media permissions.
- Preserve the existing shared CloudFront VPC-origin service-linked role and
  managed prefix list. No new external alarm subscribers without approval.
- API/worker desired counts remain zero until exact staging bindings, candidate
  startup, additive index preparation and source provenance are verified.

## Execution and evidence

1. iOS Simulator: actual multipart transfer with representative synthetic video,
   including the exact 524,288,000-byte boundary and extra-byte rejection. Verify
   bounded native part copying, temporary cleanup and actual transferred bytes.
2. Progress/pause/resume/cancel; accepted-part reuse after network failure,
   background/foreground, process termination and draft/session reconciliation.
   Do not claim continuous transfer during app suspension.
3. Process to READY; publish once, retry without duplicates; Feed/Clips playback,
   MP4 fallback, aspect ratio, audio and current permissions.
4. Actual Desktop Safari and Simulator Mobile Safari: native HLS, child-segment
   authorization, >10-minute five-minute-grant renewal, paused position, expiry,
   foreground reauthorization and denial with source removal.
5. Real unsigned/signed CloudFront controls and new Range requests after expiry.
   Previously downloaded/in-flight bytes cannot be revoked.
6. Keep local fixture and real AWS evidence separate. Simulator checks are not
   physical iPhone checks, nor a sustained-load or production-QoE guarantee.

## Cleanup requested with this plan

After sanitized evidence export, stop only newly identified stage tasks, abort
stage multipart uploads, disable/delete the new distributions/origin, purge
synthetic objects/build archives, delete stage DB/cache/bucket/ECR/logs/roles and
then network/NAT/EIP. Secrets retain a seven-day recovery window. Record exact
IDs before mutations; never use an earlier cleanup manifest against new stacks.

Deletion of a new orphaned CloudFront-managed staging SG is included only after
its exact new VPC is verified, its origins/distributions are gone, **zero ENIs
and zero SG references** are proven, and a permission dry-run succeeds. Never
edit/delete an active service-managed SG or the shared service-linked role.

Production `arc-cluster/arc-backend` and all its flags, data, queues, storage,
IAM, CDN and DNS remain unchanged. No production rollback is a test action.
