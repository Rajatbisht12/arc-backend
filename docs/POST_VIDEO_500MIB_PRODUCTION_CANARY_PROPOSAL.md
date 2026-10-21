# Production large-video canary proposal — 21 October 2026

**Proposal, not an authorization or deployment record.** The live API remains
`arc-backend:206` with `POST_VIDEO_UPLOADS_ENABLED=false`, the embedded HLS
worker enabled, and the dedicated worker at ECS/CloudFormation desired 0.
The earlier approval covered a compatibility-only cutover, not 500 MiB uploads.

## New fail-closed QA safeguard prepared locally

The production canary owner allowlist controls who may create upload sessions,
but existing post clients default to public visibility. Local, **uncommitted and
undeployed** backend changes now force posts containing new video upload
sessions to `private` in production canary mode. A persisted immutable marker
blocks later user edits to `public` or `followers`, including after admissions
are paused. The same guard suppresses mention notifications for those posts.
Private means owner-only under `privacyPolicy`; it excludes the post from public
SEO and discovery. Normal legacy posts, isolated staging and a separately
approved all-account rollout retain their previous behavior. This guard must
be in the reviewed production image before any canary flag is enabled.

Local checks passed: backend build/runtime imports, typecheck, 38 post-video
renewal tests (including real MongoDB publication and edit denial), private
media tests, deployment-safety suite, Clip HLS processing, privacy, SEO,
recommendations, discovery, and the disabled-feature compatibility smoke.
The native iOS physical-device and signed-release checks are still deferred.

## Cost and operating boundary to approve separately

Recommend an **additional $30 incremental operational stop threshold over a
72-hour window**, beginning only when the reviewed canary image is ready.
Limit to one Linux/x86 Fargate worker at 2 vCPU, 4 GiB RAM and 40 GiB ephemeral
storage; use one QA owner (`xyz` proposed), private synthetic/explicitly
approved test media, and no public publication. This is a proposed limit,
not a hard AWS cost cap or a promise of final cost.

Using AWS's published us-east-1 Linux/x86 example rates, the worker is about
$0.101/hour including 20 GiB of paid storage above the included 20 GiB. Four
existing interface endpoints in two AZs are about $0.08/hour at the published
$0.01 per endpoint-AZ-hour example rate. That baseline is about **$13.03 for
72 hours**, or **$130.29 for a 30-day continuously running topology**. The
estimate excludes endpoint data processing, S3 storage/requests, CloudFront
egress, logs, taxes and other workload-dependent charges. AWS Budgets and
CloudWatch alerts can lag; an operator must monitor actual spend and task
hours. Sources: [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
and [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/).

The existing scheduled action would set the dedicated worker to zero at
2026-10-23 06:30 UTC. **Do not disable the embedded worker while that timer
could stop the only consumer.** A new canary window needs a reviewed schedule
and a named operator available to close or extend it. If sessions or QA posts
remain at the deadline, pause new admissions first; do not auto-stop their
processing/playback path. Escalate for a budget extension or complete the
owner-approved cleanup and drain. Private endpoints continue to cost money
with no worker running.

## Required sequence after explicit approval

1. Review/commit the canary privacy guard and freeze backend, Web and app
   source revisions. Build an immutable API/worker image and rerun release,
   mobile and Web tests for those exact revisions. Do not build from the dirty
   working tree or change production simply to run a test.
2. Record live ECS task definition/image, secret-key presence (not values),
   DocumentDB indexes, queue depth, CloudFront/S3 protections, all five alarm
   states, and the currently scheduled worker stop. Confirm operations email
   and an on-call owner for the complete canary/drain window.
3. With uploads still **false**, start one dedicated worker on the reviewed
   image. Check task/queue health and a controlled legacy HLS job. Review a
   candidate API task diff that turns embedded worker off and private delivery
   on; retain a safe rollback task definition. Remove or move the old stop
   schedule only as part of a reviewed, bounded replacement.
4. Deploy the compatibility cutover and repeat API, ALB, auth, legacy upload,
   feed/Clips, signed/unsigned media and alarm smoke tests. If it fails before
   any new session is admitted, restore the embedded worker/API baseline.
5. Change only the API task's upload admission to `true`, with
   `POST_VIDEO_ROLLOUT_MODE=canary` and the **single reviewed QA account ID** in
   `POST_VIDEO_CANARY_USER_IDS`. Verify non-allowlisted accounts still receive
   the disabled policy/403, and canary publication is private even when a
   client sends `visibility=public`.
6. Test a small source first; then representative 50, 100, 200, 300 and exact
   500 MiB sources only if the preceding checks and budget remain healthy.
   Record upload bytes/parts, interruption/resume, processing CPU/memory/disk,
   HLS/MP4 playback, five-minute renewal, unauthorized/expired access, and
   owner-only visibility. Use the connected Android, Desktop/Mobile Web and
   iOS Simulator where available; report any physical-iPhone/release gap.
7. Stop new sessions on waiting jobs >=3 for five minutes, repeated failures,
   unhealthy worker, 15-minute job alarm, privacy leak, failed grant renewal,
   or budget threshold. Keep a compatible worker and private delivery alive
   for accepted sessions and published QA content until drained or safely
   removed. Do not automatically revert to revision 206 while such content
   still depends on it.
8. After approved QA-post/source/derivative cleanup and verification that no
   active sessions or private new-media posts remain, restore the baseline API
   and embedded worker, then scale dedicated worker to zero. Keep the
   endpoint-retention decision separate because endpoints have recurring cost.

## Approval still needed

- The new 72-hour/$30 incremental window, named operator/escalation owner and
  schedule replacement; permission to retain processing beyond the window
  **only if** accepted sessions cannot safely be drained in time.
- Which QA owner ID to allowlist (`xyz` proposed) and which exact test media
  may be uploaded to production. No personal media is implied by this plan.
- Permission for owner-only QA post publication and exact test-media cleanup.
  The canary code must be reviewed and deployed disabled first.
- Decision on physical-iPhone/signed-release risk and old-client compatibility
  before any public or wider activation. An owner-only canary does not prove
  general rollout readiness.

**Current verdict: production 500 MiB activation remains NOT READY.**
