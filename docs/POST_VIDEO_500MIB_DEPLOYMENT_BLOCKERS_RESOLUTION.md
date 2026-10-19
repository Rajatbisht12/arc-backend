# 500 MiB deployment blocker resolution — 2026-10-20

## Independent verdicts

**Latest backend with the feature disabled: SAFE under the compatibility release
procedure below.** Code/configuration blockers identified in the prior audit are
resolved locally and tested. Commit/review these changes first; the deployment
script intentionally refuses the current dirty worktree. The candidate ECS
preflight must pass before traffic changes. No production deployment, migration,
bucket/CloudFront/IAM change or 500 MiB activation was performed in this work.

The configuration-validation skill drove the fail-closed runtime/release guards;
the debugging skill drove reproduction and behavioral checks before fixes.

**500 MiB activation: NOT READY.** Actual isolated DocumentDB migration, dedicated
worker capacity, real AWS multipart/interruption matrix, private delivery and
native/device gates remain separate activation requirements. They do not block
the demonstrated legacy compatibility mode.

## 1. Production image provenance

Read-only ECS/ECR inspection identifies the healthy service as `arc-cluster` /
`arc-backend`, task definition `arc-backend:204`: running=1, pending=0,
rollout=COMPLETED. Public `/health` returned HTTP 200 and status `ok` during
this audit. Current task allocation is 512 CPU units / 1024 MiB; this is the
existing API/embedded-worker allocation, not approved 500 MiB processing capacity.

Image tag: `arc-backend:f4660ee`.

| Evidence | Value |
| --- | --- |
| Running/ECR OCI index digest | `sha256:85bb1a51490b7b7d5abee7bacf8a8dd7470568d862cc7c5b2868432e853ba679` |
| linux/amd64 image manifest | `sha256:adeca662183faeaf61ee71ac7d0b9625c9239efeb5b7720c527c99493db58bb2` |
| BuildKit attestation manifest | `sha256:0ee179ba5827e1931bf8abad821811c6804b3539fb59a71f0c793272554932db` |
| SLSA attestation layer | `sha256:65e84655c412ecc9e839e2751995cf093cdf8f5a71e30a6b38615c9922ced173` |
| Attested source repository | `https://github.com/Rajatbisht12/arc-backend.git` |
| Attested source commit | `f4660eec7d6568fa468520dc672f075feb13e48a` |
| Build start/end UTC | `2026-10-19T12:56:53.4726538Z` / `2026-10-19T12:58:52.570211441Z` |

The commit was fetched from Rajat's repository and identified as PR #143's merge
commit. `git diff e8cb9e77f36c1ed754ac89b2c6ba0254addf4ebf
f4660eec7d6568fa468520dc672f075feb13e48a` was empty before this fix. The previously
audited local backend tree therefore matches the deployed source tree. Merely
searching the local Vortica remote had missed the separate Rajat merge commit.

The attestation describes BuildKit building `node:22-alpine`; the source
`deploy.sh` performs local Docker build, ECR push, ECS registration and preflight.
A specific CI runner identity and independently trusted/signed builder are NOT
established by this metadata. A tag alone was never treated as source proof.
New builds add OCI source/revision labels, require a clean Git tree and deploy
the resolved ECR digest rather than a mutable tag.

## 2. DocumentDB migration blocker

AWS reports production engine `docdb` **5.0.0**. The risk was the Post publication
idempotency index included by `scripts/migrate-video-upload-indexes.js`, not the
ordinary VideoUploadSession compound indexes. Its partial filter used `$type`.
AWS documents `$eq`, `$exists`, top-level `$and`, and range operators, not `$type`:
[DocumentDB partial-index support](https://docs.aws.amazon.com/documentdb/latest/devguide/partial-index.html).

Changed the filter to `{clientPostId: {$gt: ''}}`, index name
`post_owner_client_nonempty_unique_v2`. All accepted client publication IDs are
nonempty validated UUID strings. Missing/null/empty legacy values are excluded;
valid publication keys retain per-owner uniqueness. The new name avoids replacing
an existing index. No `dropIndex`, `syncIndexes`, record rewrite or TTL deletion
is used by the migration.

Executed against disposable **MongoDB 8.3.7**, not DocumentDB: missing-index
verification fails, apply succeeds twice, verify succeeds, duplicates reject,
different-owner IDs succeed. Existing missing/null records, posts and
ContentExposure document hashes remain unchanged; the existing old index remains.
No representative non-production DocumentDB exists in the inspected account, so
actual DocumentDB execution is **NOT VERIFIED** and is required before activation.

Feature-disabled API startup uses `autoCreate=false`, `autoIndex=false` and needs
none of these new indexes. The real startup test publishes legacy posts without
creating any upload-session/publication-lock collection or publication index.
Neither `deploy.sh` nor its preflight invokes the video-index migration.

## 3. Staging secret isolation blocker

Previously both launchers used a hardcoded `arc/prod/backend` loader. An isolated
worker template could therefore retrieve production DB/Redis/storage credentials.

`src/config/runtimeIsolation.ts` and `secrets.ts` now:

- Preserve the existing production secret default, task-env precedence and
  established transport-outage fallback when complete production env is present.
- Require staging `NODE_ENV=production`, `DEPLOYMENT_ENVIRONMENT=staging` and an
  explicit secret under `arc/staging/`; no production-secret fallback.
- Require four independent task-provided guards for Mongo host/database, Redis
  host and S3 bucket. Guard identities must carry a separated stage/staging marker
  and match hydrated connection settings. Secrets cannot supply/override guards.
- Reject production resource mismatches/origins, static AWS credentials and
  secret-fetch/isolation failures before DB/queue startup. Use a staging ECS role.
- Refuse shared-secret flags conflicting with an explicit compatibility release
  instead of silently disabling an active dedicated worker/private-delivery path.

Worker template parameters now supply these bootstrap controls. Optional
`infra/post-video-staging-isolation.yaml` is a deny-only, staging-role policy
template: deny secrets except the exact staging secret, deny batch secret reads,
deny S3 outside the staging bucket, deny AssumeRole/PassRole escape. It grants
nothing and must be combined with reviewed least-privilege allows and independent
DB/Redis credentials/network controls. Both CloudFormation templates passed AWS
`validate-template`. Neither was deployed or attached; live staging isolation is
**NOT VERIFIED**. Naming guards are defense in depth, not a replacement for IAM,
security groups or correct secret provisioning.

## 4. Four regression failures reproduced and classified

| Failure | Cause and correction |
| --- | --- |
| Mobile PresenceContext contract | Real cached-access regression in the dirty profile unfollow implementation: a previous no-private-flicker change retained follower capabilities/media while refetching. Added pure `revokeFollowerCapabilities`, immediate media/story/presence revocation, DM grant/cache invalidation, pagination/request invalidation, and fail-closed handling of a lost DELETE response. Preserves the public shell instead of restoring DEFAULT_PRIVACY_ACCESS's restricted shell. |
| MobilePrivacyContent contract | Stale assertion required inline `?? false` in Clips; current code uses `resolveCreatorFollowAction` and explicit unknown/follow gating. Updated contract and included the existing resolver behavior tests. No product follow-policy change. |
| PrivacySettings contract | Stale typography assertion expected an em dash; UI deliberately uses a hyphen for hidden counts. Test now verifies hidden followers/following do not expose counts without requiring one glyph. No UI change. |
| Mobile callPermissionPolicy contract | Stale variable/expression assertions after conversation/account-scoped `activeDmPermission` and transient-preflight state were introduced. Updated assertions verify the stricter scoped gate, blocked message sends and call-button gate. No call/signaling product code changed. |

The four failures reproduced before fixes. Their affected source paths are mobile
privacy/conversation logic, not the multipart implementation. Tests exist in
history from July; the current mobile worktree contains extensive pre-existing
uncommitted changes, so an exact historical commit/date for every source change
cannot responsibly be assigned. They were investigated rather than dismissed as
unrelated. All unrelated worktree changes were preserved.

After fixes: mobile privacy **42/42**, mobile call-signaling **24/24**, mobile
TypeScript passes. These are automated tests, not new physical-device call tests.
The mobile privacy fix needs a subsequent app build/release to reach installed
clients; no protocol change or mandatory client upgrade was introduced.

## 5. Legacy upload boundary

The old Multer/Busboy limit was exclusive: **52,428,799 bytes** accepted;
**52,428,800 bytes** rejected despite the stated 50 MiB policy. Set parser limit
to policy+1 and defensively check actual received size against the policy.

Real loopback HTTP tests executed for single, array and named-field upload
wrappers: 50 MiB−1 accepted, **exactly 50 MiB accepted**, 50 MiB+1 rejected with
HTTP 413. These boundary fixtures test middleware bytes, not video decoding.
The separate real-video startup smoke tests decoding/storage/transcoding. No
legacy route was expanded to 500 MiB; all existing smaller uploads remain valid.

## 6. Disabled-feature startup and worker proof

`scripts/video-compatibility.smoke.test.js` runs the actual compiled launcher
under NODE_ENV=production and all five required flags. Uses disposable loopback
MongoDB/Redis, generated test APNs key, synthetic users and a two-second real
H.264/AAC video. No .env, production credentials, data or external sockets are
used. Only AWS secret/S3 transports are substituted; MongoDB, HTTP routes, JWT,
password comparison, BullMQ and FFmpeg execute for real.

Verified: health 200; existing six-character password login 200; text/image/video
publication 201; Feed, Clips and post-detail 200; embedded worker running; real
legacy `transcode-hls` job reaches READY with HLS master and optimized MP4;
policy enabled=false; new session creation 503 VIDEO_UPLOADS_UNAVAILABLE; no
new session collections/indexes; no signing secrets or dedicated worker needed.

The embedded worker remains legacy-only. `enqueueVideoUpload` now rejects when
the embedded consumer is enabled. Upload recovery/cleanup does not start in
compatibility mode. Dedicated-worker draining of already accepted sessions is
preserved when using the dedicated topology. Preflight refuses active/READY/
attached session content and pending `process-upload` jobs before re-enabling a
legacy-only consumer; it also fails closed at its bounded queue audit limit.

## 7. Build and regression results

Executed with checksum-verified temporary official **Node 22.23.3**. System
Homebrew node@22 was broken (missing libsimdutf); it was not modified. Existing
dependencies were used, no package installation was necessary.

| Check | Result |
| --- | --- |
| Backend production build, runtime imports, typecheck | PASS |
| Video deployment safety | 9 runtime-isolation + 16 release/migration/upload tests PASS; no skips locally |
| Compiled compatibility smoke | PASS, real local services/FFmpeg as described above |
| Upload-session policy/service/publication/cleanup regressions | 17 tests PASS on isolated fixtures/local MongoDB; no real AWS or 500 MiB transfer implied |
| HLS regression | 25 tests + storage/CloudFront contracts PASS |
| Media integrity | 12 JS + 7 storage tests + resource contracts PASS |
| Discovery / recommendations | PASS; permanent exposure, age/freshness, feed/Clips identity and 230-clip/24-page cursor test preserved |
| Auth onboarding, limiter, login audit | PASS |
| Backend privacy and private-media suites | PASS |
| Backend notification producers / call sessions | PASS |
| Random Connect / entitlement / admission | PASS |
| Message media / story music / Apple IAP | PASS |
| Existing release gates: email/notification policy, broadcast, bank details, monetization | PASS |
| Mobile privacy / call signaling / TypeScript | 42 / 24 PASS; typecheck PASS |
| Web upload + adaptive Feed player | 19 tests across 4 files PASS; existing React act warnings in hook test remain |
| Bash syntax / CloudFormation template validation | PASS |
| Real Linux Docker build on this laptop | NOT EXECUTED: Docker unavailable; operator's build remains gated by Dockerfile build/import checks |
| Physical Android/iOS and live multi-party calls | NOT EXECUTED in this task |
| Production database migration / authenticated production media writes | NOT EXECUTED, intentionally |

Automated legacy HTTP/client contracts and current healthy production source
provenance support backward compatibility; this is not a claim of exhaustive
testing of every historical installed binary or every browser/device combination.

## 8. Exact release configuration and safe procedure

Read-only inspection confirmed these flags are absent in both revision 204 task
env and shared runtime secret; existing source defaults match compatibility mode.
The existing DB/Redis/JWT/admin/bank/S3 settings are present (values not recorded).
The candidate pins them explicitly:

```dotenv
POST_VIDEO_UPLOADS_ENABLED=false
CLIP_HLS_ENABLED=true
CLIP_HLS_WORKER_ENABLED=true
POST_VIDEO_PRIVATE_DELIVERY_ENABLED=false
POST_VIDEO_SOURCE_RETENTION_DAYS=0
VIDEO_DEPLOYMENT_MODE=compatibility
```

Preserve all other production settings/keys. Do not add signing secrets or
staging guard variables to production. Do not store VIDEO_DEPLOYMENT_MODE in
the shared runtime secret; the deploy script sets it on the candidate API task.

After reviewing/committing the backend changes, on the authorized deployment
laptop with Node 22, Docker and AWS CLI, from a clean backend checkout:

```bash
npm ci --include=dev
npm run build
npm run typecheck
npm run test:video-deployment-safety
bash deploy.sh
```

The last command is a production deployment requiring separate authorization;
it was NOT executed here. No FORCE_* or financial recovery switches are needed
for revision 204's current markers (bank=3, monetization=1, discovery=2). Do not
set those switches to bypass an unrelated failed preflight.

The script tests/builds, pins source labels and ECR digest, prepares the task with
exact compatibility flags, runs secret-hydrated ECS preflights, and only updates
traffic after they succeed. Candidate startup refuses conflicting shared-secret
topology. Existing automatic preflight operations are NOT all read-only:
bank collection/index prepare, username registry apply/verify, push/broadcast/
Random Connect index preparation remain. Routine schema-3 deployment verifies
bank/monetization rows; discovery v2 checks indexes without historical rebackfill.
No new video migration was added to this workflow. If policy disallows even
existing automatic preparation, obtain explicit approval before running deploy.

Health: require ECS deployment COMPLETED, task HEALTHY, ALB targets healthy,
`https://api.squadhunt.in/health` HTTP 200, no startup/queue failures, policy false.
Smoke authorized legacy login, <=50 MiB publication, HLS job completion, existing
private access, Feed/Clips and calls after deployment. Do not test 500 MiB sources
in production. A services-stable waiter timeout alone does not prove rollback;
inspect task events/logs and active digest first.

## 9. Rollback

Record original task definition/digest before starting; at audit time it is
`arc-backend:204` and the digest above. For a normal additive compatibility
release, if the candidate fails, an authorized operator can restore that task:

```bash
aws ecs update-service --region us-east-1 --cluster arc-cluster \
  --service arc-backend --task-definition arc-backend:204
aws ecs wait services-stable --region us-east-1 \
  --cluster arc-cluster --services arc-backend
```

Then inspect health, active digest and legacy HLS jobs. Do not delete session,
post, exposure or index data. The existing financial-maintenance failure handler
deliberately does not blindly restart old writers after mutating financial
cutovers; follow that recovery procedure if someone intentionally requests such
a cutover. If 500 MiB activation ever occurs, this simple rollback is no longer
sufficient: retain compatible dedicated worker/private delivery and drain first.

## 10. Remaining activation gates

1. Approved isolated staging resources/secret/task roles/network guardrails.
2. Actual additive migration apply/reapply/verify on DocumentDB 5.0, no production
   application without approval.
3. Compatible dedicated worker healthy/consuming legacy and new jobs before
   disabling the embedded worker; measured CPU/RAM/disk/queue behavior.
4. Approved S3 CORS, abort lifecycle, source denial and signed CloudFront behavior.
5. Signed/unsigned/private/block/deletion/expiry/HLS-child/range-request tests and
   explicit decision on the up-to-one-hour grant revocation window.
6. Representative real 10–500 MiB AWS uploads, retry/resume/interruption and worker
   restart tests; no padded fixture substitutes for processing measurements.
7. Desktop/Mobile Web and Samsung actual multipart transfer/playback, iOS native
   compilation/runtime and source-access checks. Continuous suspended-app upload
   is not promised.
8. Approved canary/monitoring/rollback plan. Keep the five compatibility values
   unchanged until these activation gates pass.

## Files changed in this task

Backend: `Dockerfile`, `deploy.sh`, `package.json`,
`infra/post-video-worker.yaml`, `infra/post-video-staging-isolation.yaml`,
`infra/post-video.env.example`, `scripts/lib/video-release.js`,
`scripts/verify-video-compatibility-release.js`,
`scripts/preflight-push-release.js`, `scripts/migrate-video-upload-indexes.js`,
`scripts/migrate-video-upload-indexes.test.js`,
`scripts/video-deployment-safety.test.js`,
`scripts/video-compatibility.smoke.test.js`,
`scripts/discovery-deployment.test.js`, `src/config/env.ts`,
`src/config/secrets.ts`, `src/config/runtimeIsolation.ts`,
`src/config/runtimeIsolation.test.ts`, `src/infrastructure/jobs/queue.ts`,
`src/legacy-src/config/videoDeploymentPolicy.js`,
`src/legacy-src/middleware/upload.js`,
`src/legacy-src/middleware/upload.inclusive-limit.test.js`,
`src/legacy-src/models/Post.js`, this report, rollout documentation and a
supersession note in the prior safety audit.

Mobile (focused patches within an already dirty tree): `package.json`,
`app/user/[username].tsx`, `src/services/profilePrivacyTransition.ts`,
`src/services/profilePrivacyTransition.test.mts`,
`src/contexts/PresenceContext.contract.test.mjs`,
`src/services/MobilePrivacyContent.contract.test.mjs`,
`src/services/PrivacySettings.contract.test.mjs`,
`src/services/callPermissionPolicy.test.mjs`. Web source unchanged.
