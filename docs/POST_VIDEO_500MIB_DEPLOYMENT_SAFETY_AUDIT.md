# 500 MiB video pipeline: deployment safety and staging validation audit

> Historical audit. Its deployment blockers/verdict are superseded by
> [the deployment blocker resolution](POST_VIDEO_500MIB_DEPLOYMENT_BLOCKERS_RESOLUTION.md),
> which records subsequent fixes, image provenance and executed startup/regression
> tests. The uncompleted 500 MiB activation gates remain outstanding.

Date: 20 October 2026 (IST). Live checks were read-only AWS queries, public HTTP
reads, and non-publishing browser checks. This report supersedes no implementation
claims: it adds new evidence to `POST_VIDEO_500MIB_IMPLEMENTATION_REPORT.md` and
`POST_VIDEO_500MIB_ROLLOUT.md`.

## A. Backend deployment verdict

**NEEDS ADDITIONAL VERIFICATION** for an unconditional deployment approval.

The inspected source is compatible with a disabled-feature rollout in the local
checks below. It does not require a dedicated video worker or new CloudFront
signing configuration just to import and serve legacy requests. The deployment
already running in production is healthy. These are narrower findings than proof
that every existing production client and feature remains compatible.

Outstanding release evidence:

1. Trace production image tag `f4660ee` to its actual source and build. That Git
   object is absent from the fetched backend `main` history. An ECR tag matching a
   short SHA is not source attestation.
2. Run a clean production Node 22 container build/import check on the deployment
   laptop and record the source SHA and image digest. Local tests here used Node
   26.7.0. The local Node 22 executable cannot start because its Homebrew
   `libsimdutf.34.dylib` dependency is missing; Docker is unavailable here. Neither
   the Dockerfile's Node 22 stage nor the exact running image was rebuilt here.
3. Complete the remaining authorized legacy-client smoke checks. No live post,
   story, DM attachment, avatar, follow mutation, or call was submitted during
   this audit. Installed iOS client compatibility is unverified.
4. Investigate the failing mobile privacy/call source contracts documented below.
   Their cause was not attributed to this pipeline or dismissed as harmless.

This is **not** a recommendation to roll back the currently healthy service.
There is no verified production outage attributable to this deployment.

### Source and deployed identity

| Item | Observed value |
| --- | --- |
| Local backend branch | `main` |
| Local backend HEAD | `e8cb9e77f36c1ed754ac89b2c6ba0254addf4ebf` |
| Fetched `origin/main` | `c4407ff78846f0ea2435d1f326612a129324a3ff` |
| Local HEAD versus fetched main | Identical tree; main includes merge history |
| ECS region / cluster / service | `us-east-1` / `arc-cluster` / `arc-backend` |
| Task definition | `arc-backend:204` |
| Task status | 1 RUNNING / HEALTHY; desired 1; pending 0 |
| Deployment state | COMPLETED; failed tasks 0 |
| Running image tag | `arc-backend:f4660ee` |
| Running/ECR digest | `sha256:85bb1a51490b7b7d5abee7bacf8a8dd7470568d862cc7c5b2868432e853ba679` |
| ALB target | healthy |
| API task resources | 512 CPU units / 1024 MiB memory |
| New worker deployment | None found in this account's `us-east-1` ECS inventory; only the API service/task was running |
| Database | Available Amazon DocumentDB 5.0.0 cluster |
| Cache | Available ElastiCache Redis 7.1.0 cluster |
| Web local HEAD | `a959289` (resumable uploads and Feed HLS); clean source tree |

`GET https://api.squadhunt.in/health` returned 200. Public
`/api/posts?limit=1` and `/api/posts/clips?limit=1` returned 200 with normal
data/pagination objects. Unauthenticated `/api/posts/video-uploads/policy`
returned the expected 401, not an authenticated feature-availability response.
The health handler itself is not a database, FFmpeg, queue, or private-CDN probe.

Recent one-hour log checks on the running task found no matching fatal-bootstrap,
duplicate-Post-model, video-recovery, or Clip-job-failure events. A separate
task-lifetime Clip-failure query returned an unexhausted pagination token; it is
not evidence of zero failures over the entire task lifetime.

### Exact disabled-feature configuration

For an initial disabled rollout with no in-flight new-pipeline work, preserve or
explicitly configure these values in the **candidate ECS API container**:

```dotenv
POST_VIDEO_UPLOADS_ENABLED=false
CLIP_HLS_ENABLED=true
CLIP_HLS_WORKER_ENABLED=true
POST_VIDEO_PRIVATE_DELIVERY_ENABLED=false
POST_VIDEO_SOURCE_RETENTION_DAYS=0
```

Preserve all existing authentication, APNs, database/TLS, Redis/TLS, S3, CORS,
financial-encryption, email and other established production configuration.
No new signing key or dedicated-worker environment is required for legacy media.
Do not copy `infra/post-video.env.example` wholesale: it deliberately sets the
embedded-worker flag to false for the later dedicated-worker topology.

All five flags above, and worker concurrency, were **unset** in task-definition
environment, ECS named secret bindings, and the shared runtime secret. All five
new private-signing settings were absent. Repository defaults are uploads=false,
HLS=true, embedded worker=true, concurrency=1, private delivery unavailable, and
original retention=0. Exact image behavior is not asserted solely from these
source defaults because the image/source mapping remains unresolved.

References: `src/config/env.ts:102`, `src/server.ts:41`,
`src/legacy-src/services/videoUploadService.js:23`,
`src/legacy-src/utils/postVideoDelivery.js:19`.

### Deployment script and migration precautions

`deploy.sh` builds/tests, pushes ECR, clones the **active** task definition,
replaces the image, performs database/provider preflights, updates ECS and waits
for stability. It does not copy these video flags from shell exports into ECS.
Setting a local `.env` or `export POST_VIDEO_UPLOADS_ENABLED=false` alone is not
proof of the candidate container's configuration.

The video-index migration is **not** invoked by `deploy.sh` or
`scripts/preflight-push-release.js`. It is not required for the isolated legacy
requests tested with the feature disabled; it must be reviewed/applied/verified
before new-pipeline activation. No production migration was run here.

Routine deployment is not database-write-free. Existing preflights prepare or
apply push, broadcast, username-registry and Random Connect structures/cleanup.
Even the audit path includes financial collection/index preparation. Existing
schema markers are bank=3, monetization=1, discovery exposure=2; the current
routine path verifies exposure indexes without repeating historical exposure
backfill. Do not force a discovery/financial migration or broadcast repair as
part of this video rollout.

After release evidence is resolved and production deployment is explicitly
authorized, the existing script can be used, provided the candidate environment
and existing preflight effects are reviewed. First run `npm ci --include=dev`
and `npm run build` on the build laptop; do not bypass `verify:runtime-imports`.
Record the old and new task revisions/digests. Validate the candidate flags,
single canonical legacy model tree, running-task revisions, ALB health, public
API reads, authenticated disabled policy, rejected new sessions, and controlled
legacy-client smoke checks after deployment. No deployment was performed here.

Rollback: for this initial disabled rollout, an explicitly approved ECS rollback
can restore the recorded known-good task definition and desired count without
deleting database records, derivatives or exposure history. After any future
new-pipeline activation, first stop **new session creation**, retain compatible
dedicated consumers and completion/status/cancel APIs until work drains, and do
not restore an embedded consumer that rejects `process-upload` jobs.

## B. Worker and startup compatibility

The actual queue is `clip-video` (`src/infrastructure/jobs/queue.ts`).

| Consumer | Job names | Behavior |
| --- | --- | --- |
| API embedded worker, line 342 | `transcode-hls` only | Autorun requires HLS enabled AND embedded worker enabled; throws on `process-upload` |
| Dedicated worker, `src/clip-worker.ts:24` | `transcode-hls` and `process-upload` | Handles legacy and new work; concurrency defaults to one |

`src/server.ts:41` refuses uploads=true plus embedded-worker=true. With uploads
false that check does not require a dedicated worker. Private signing is checked
when new delivery/session operations need it, not as a mandatory legacy startup
dependency. New modules still load at import time; disabled does not mean absent.
The compiled import check passed with signing settings absent, including the
Apple runtime dependency and canonical Post model adapter.

Importantly, `startVideoUploadScheduler()` is unconditional
(`src/server.ts:104`, queue line 401). It performs bounded session recovery and
cleanup even when new sessions are disabled. The flag is a creation gate, not a
kill switch for every session operation or background write. Existing sessions
must remain recoverable during rollback. Current production index presence and
session-row inventory were not queried directly.

A separate **real local Redis/BullMQ** check imported the compiled queue module,
kept uploads=false / embedded-worker=true, enqueued a synthetic `transcode-hls`
job, and verified one completion. The transcoding function was stubbed; this
proves consumer wiring, not AWS/FFmpeg processing or production Redis health.

Safe future transition:

1. Keep new sessions disabled. Deploy an API-compatible dedicated worker.
2. Verify its database/Redis/storage connectivity, actual legacy-job consumption,
   error/queue metrics, and immutable image identity.
3. Disable embedded consumption on **all** API tasks and verify old consumers
   have drained. A short overlap is acceptable only for compatible legacy jobs;
   BullMQ claims jobs, but stall recovery still needs idempotency testing.
4. Keep API recovery producers running. Verify legacy work continues on the
   dedicated worker before allowing any `process-upload` producer.
5. Enable new sessions in approved staging only after storage/privacy gates.

Dedicated worker health currently checks Redis ping and `worker.isRunning()`.
It does not independently certify current MongoDB, S3, signing, FFmpeg capacity,
or end-to-end processing readiness (`src/clip-worker.ts:54`).

## C. Database migration safety

Inspected `scripts/migrate-video-upload-indexes.js` in full. It creates five
VideoUploadSession indexes and **one Post idempotency index**, not only session
indexes. It does not delete/update records, media, or ContentExposure. It uses
`createIndex`, not `syncIndexes`/index drops, disables auto-index/create on the
connection, and has no TTL removal. Unique conflicts fail without repairing
or deleting records. Multiple-index application is not transactional: earlier
indexes can remain if a later one fails.

Local execution used a disposable MongoDB **8.3.7**, not DocumentDB:

| Operation | Result |
| --- | --- |
| Verify before indexes exist | exit 2, six expected noncompliant indexes |
| Apply | exit 0, six compliant indexes |
| Apply again | exit 0, idempotent |
| Verify afterward | exit 0 |
| Before/after fixture-document hash | unchanged for posts, sessions and ContentExposure |
| Exposure indexes | untouched |

Only the isolated local database received writes. Its process/data were cleaned
up by the test. This is useful additive/idempotency evidence, **not** the requested
representative target-DocumentDB migration gate.

Target compatibility concern: `src/legacy-src/models/Post.js:335` declares
`partialFilterExpression: { clientPostId: { $type: 'string' } }`. AWS documents
DocumentDB 5.0 partial-index operators as `$eq`, `$exists`, top-level `$and`, and
comparison operators; `$type` is not in that supported list. Do not certify or
apply this index to production from a MongoDB-only success. Validate on isolated
DocumentDB 5.0 and review a compatible definition if rejected. Do not silently
replace it with a uniqueness condition that indexes all legacy missing/null keys.
See [AWS partial-index documentation](https://docs.aws.amazon.com/documentdb/latest/devguide/partial-index.html).

## D. Infrastructure status and staging preparation

Read-only inspection was limited to the configured AWS account/`us-east-1` and
its current media distribution. It is not a claim about every AWS account/region.

| Requirement | Actual observation | Gate |
| --- | --- | --- |
| Dedicated Fargate worker | No separate ECS worker service/task found | Pending approval/deployment |
| Worker template | CloudFormation `validate-template` passed | Syntax only, not provisioned |
| IAM template | CloudFormation validation passed | Additive merge still required |
| Current API task role | Object GET/PUT/DELETE and bucket list; no observed multipart-abort/part-list permissions | New multipart permissions pending |
| Runtime secret | Loader hardcodes production secret | Unsafe as an unchanged isolated-stage template |
| Database/Redis | Existing production DocumentDB 5.0 / Redis 7.1 available | No isolated staging endpoints verified |
| S3 CORS | GET/HEAD only; read CORS includes `.com` and localhost | PUT preflight not configured |
| S3 multipart lifecycle | `NoSuchLifecycleConfiguration` | Abort rule pending |
| S3 public-access block | All four protections true | Necessary, not sufficient for private CDN paths |
| Source-prefix deny | Existing OAC allow statement, no explicit new source-prefix deny | Pending reviewed merge |
| CloudFront | `media.squadhunt.com`; no ordered behaviors; no trusted key groups | Private playback not configured |
| New private prefixes | No objects found in either source/playback prefix | No existing asset available for denial/grant tests |
| New signing configuration | Absent | Must remain off |
| Monitoring template | Worker log/queue/error alarms supplied | No deployed video-worker metrics verified |

Reviewed all seven supplied templates. JSON templates parse; CloudFormation
syntax validation creates no stack/resources and was the only CloudFormation
operation performed beyond listing existing stacks.

### Concrete isolation blockers

`src/config/secrets.ts:3` hardcodes `arc/prod/backend`; the worker template sets
NODE_ENV=production and its launcher calls this loader before imports. Giving a
staging worker the current production secrets role is not safe isolation.
Before a staging deployment, review a configurable explicit staging secret
selection and narrow role, or another fully isolated loader arrangement that
does not fall back to production. This audit did not change the loader.

Queue names and Redis connection are shared constants with no configured staging
queue namespace/database selector. Use a **separate staging Redis endpoint**;
a different Mongo database alone does not isolate consumers from production jobs.
Use separate staging database credentials and storage/distribution resources.
Do not run the hardcoded production `deploy.sh` against a staging release.

### Proposed approval package (not executed)

- Isolated staging API/task and approved test accounts/database; representative
  DocumentDB 5.0 rather than claiming MongoDB 8 is equivalent.
- Separate Redis endpoint/queue ownership, staging secret and least-privilege
  task/execution roles, VPC connectivity and private subnets with required egress
  or endpoints. Preserve production identities and credentials.
- Dedicated worker candidate: one task, 2 vCPU, 4 GiB RAM, 40 GiB ephemeral disk,
  concurrency 1, FFmpeg threads 2. Treat this as a benchmark starting point.
- Separate private staging media bucket and OAC distribution/trusted key group;
  staging browser origins, ETag/range CORS, bounded multipart abort rule, source
  deny and versioned output access. Do not replace production configurations.
- Staging signing keys in Secrets Manager only; no client private keys. Validate
  actual source denial and signed/unsigned delivery before setting private
  delivery true, then enable new sessions in staging only.
- Log retention, queue age/depth, failed/stalled attempts, worker CPU/memory,
  ephemeral disk, cleanup backlog and alert delivery. Restrict production
  notifications/email/push side effects from synthetic accounts.
- Approve resource names, region, budget/retention, fixtures, test accounts,
  teardown behavior and the asset-grant revocation SLA before provisioning.

No live AWS resources/configuration, policies, secrets or feature flags were
created or modified. Approval and isolation decisions are prerequisites, not
silent permission inferred from the request to prepare staging.

## E. Real AWS upload and recovery matrix

| Source | Platform | Upload | Resume | Processing | Playback | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 10 MiB | Web / Android / iOS | Not run | Not run | Not run | Not run | Blocked: approved isolated stage absent |
| 50 MiB | Web / Android / iOS | Not run | Not run | Not run | Not run | Same |
| 100 MiB | Web / Android / iOS | Not run | Not run | Not run | Not run | Same |
| 200 MiB | Web / Android / iOS | Not run | Not run | Not run | Not run | Same |
| 300 MiB | Web / Android / iOS | Not run | Not run | Not run | Not run | Same |
| 500 MiB | Web / Android / iOS | Not run | Not run | Not run | Not run | Same |

Previous padded two-second loopback fixtures are not recounted as representative
videos or AWS measurements. This audit submitted no production source/media/post.

Staging still needs real portrait, landscape, H.264/AAC, supported MOV/HEVC,
edited/unedited, high-motion and longer-duration sources. Obtain permission for
the exact fixtures/test accounts and record source bytes/duration/codecs, wall
upload time, parts/retries/reused bytes, processing time, CPU/RSS/peak disk, every
output's bytes, READY time and actual device playback. Observe API memory during
multipart transfer to verify the API does not buffer the source in practice.

Local selected tests exercise owner rejection, expiry, bounded signing,
completion-response-loss recovery, verified parts, publication races, retry
leases, cleanup and private manifest access. They do **not** complete any real
AWS browser/device interruption matrix.

All requested network loss/return, part failures, URL expiry, pause/resume,
cancel, reload/tab close, force-stop/reopen, Wi-Fi/cellular transition, lost
completion/publication response, worker kill/stall/retry, duplicate prevention,
cleanup and no-unfinished-recommendation scenarios remain staging acceptance
items. Native implementation promises safe pause/reconcile/resume, not continuous
transfer while suspended or after process termination.

## F. Worker performance

No dedicated AWS worker was deployed or benchmarked. CPU, peak RSS, ephemeral
disk, processing duration, queue wait/age, retry/restart behavior and output-size
measurements on representative near-limit sources are **NOT VERIFIED**. The API's
0.5 vCPU / 1 GiB allocation must not be treated as the proposed worker capacity.
Local FFmpeg tests validate generated media, not Fargate throughput/cost.

## G. Web validation

Actual Chrome execution:

- Existing authenticated deployed Web session (`xyz`) displayed Home and an
  advancing legacy video timeline.
- Deployed Create Post modal opened at desktop size and 390x844 viewport. No
  source was selected/submitted. At the narrow viewport, document scroll width
  was 387 CSS pixels versus inner width 390: no horizontal overflow observed.
- Modal closed and the temporary viewport override was reset.
- Screenshots: workspace `artifacts/video-deployment-audit/desktop-composer.png`
  and `mobile-web-composer.png`.
- Initial localhost tab had a stopped dev server and failed lazy import, not a
  verified backend failure. A local Vite server was started at localhost:3000;
  after reload that local session showed Sign In. No sign-out or password action
  was submitted. Browser checks continued in the already authenticated deployed
  tab. Local authentication restoration was not certified.

HTTP delivery read: one real public legacy MP4 from the anonymous Clips API was
requested with `Range: bytes=0-1023`. CloudFront returned **206**, `video/mp4`,
`Content-Range: bytes 0-1023/1398883`, and allowed origin `https://squadhunt.com`.
Only 1024 response bytes were read. This is legacy progressive-delivery evidence,
not a new private-output security test or loading-latency measurement.

The sampled 30 public Clip videos all reported historical `TRANSCODE_FAILED`
playback metadata, dated 14–22 September 2026; no ready HLS URL was available in
that sample. Consequently a real ready legacy HLS playlist was **not tested**.
Do not attribute those historical statuses to revision 204, infer all videos are
affected, or reopen the earlier 3–5-second performance investigation from this
sample. Progressive fallback worked for the selected public file.

New-upload UI progress/pause/resume/reload/publication, new HLS/fallback playback,
private posts and native mobile browsers remain untested against staging. A
desktop Chrome narrow viewport is not a physical Android Chrome or Mobile Safari
execution. Safari was not exercised.

## H. Android and iOS

### Android

ADB currently lists the authorized Samsung **SM-S928B** as connected (`device`).
Production and separate `com.arcSquadHunt.videouploadqa` packages are both installed,
versionName 1.0.0 / versionCode 22. The QA package update timestamp is 19 October
2026 15:56 IST; production package 19 October 10:48 IST. Version number alone does
not identify an immutable JS/native source build.

The first new offline Gradle invocation failed because the shell selected Java 8.
Using Android Studio's existing bundled JDK **for that command only**:

```sh
./gradlew :app:assembleDebug -PsquadHuntQaApplicationIdSuffix=.videouploadqa --offline
```

passed in 30 seconds, 590 actionable tasks (36 executed, 554 up-to-date). No
reinstall, production app-data clearing, phone network manipulation, force-stop,
new video selection or upload occurred in this audit. Earlier composer/draft
checks remain prior evidence, not a substitute for real multipart/device tests.
Full Samsung transfer/recovery/publication/playback validation is **pending**.

### iOS

System developer selection is CommandLineTools. Per-command DEVELOPER_DIR can
reach Xcode 26.6 (17F113) without changing the system selection. It lists iOS and
Simulator SDK labels for 26.5, but `simctl list runtimes` and available devices
are empty, and the SquadHunt scheme has no eligible destination.

An actual workspace build attempt with generic iOS Simulator destination and
CODE_SIGNING_ALLOWED=NO failed **exit 70**: no matching destination; Xcode reports
“iOS 26.5 is not installed” and directs installation from Settings > Components.
No Swift part-copy compilation or native runtime pass is claimed. No platform
runtime was downloaded or host installation changed. An eligible platform/runtime
or authorized physical destination and another build are required.

## I. Privacy/security validation

Production is **not configured for new private delivery**. No asset existed in
either new prefix. Testing a nonexistent key returning 403 would not establish
that an existing object is protected, so no such misleading pass is recorded.

| Security case | Actual cloud result |
| --- | --- |
| Existing unsigned source denied | Not run: no staged source |
| Existing unsigned new playback denied | Not run: no staged output/private behavior |
| Authorized HLS and child segments | Not run |
| Private/blocked/deleted access and expiry | Local service tests only; cloud/device not run |
| New private MP4 range and thumbnail authorization | Not run |
| S3 browser PUT CORS | Not configured in inspected bucket |
| Legacy public MP4 range/read CORS | Passed for selected actual public object |

`src/legacy-src/utils/postVideoDelivery.js:58` issues grants expiring up to one
hour later (stable 15-minute issuance windows). Manifest routes recheck current
post/viewer permissions, but already issued asset URLs are bearer grants until
expiry. Block, deletion or privacy changes are not immediate revocation of every
previously issued segment/MP4/thumbnail grant.

Whether that window is acceptable is a **product/security approval**, not a
technical assumption. No acceptance was inferred. Stricter revocation needs a
reviewed shorter renewable or edge-authorization design plus actual device/CDN
tests before private delivery is enabled.

## J. Tests executed and results

| Check | Fresh result | Scope/limitations |
| --- | --- | --- |
| Backend `npm run build`, runtime import guard, `typecheck` | Pass | Node 26; no private signing required for import |
| Node 22 host run | Blocked before Node starts | Missing Homebrew simdutf dylib; container build not run here |
| Pipeline/policy/publication/private delivery selected tests | 18 pass, 0 skipped | Isolated database/mocked storage where documented |
| `test:clip-hls` | 25 pass, 0 skipped, plus storage/CDN contracts | Includes real local FFmpeg; not cloud |
| `test:discovery` | Pass | Includes 230 unique Clips over 24 pages and migration tests |
| `test:recommendations` | Pass | Freshness, exposure/no-repeat, engagement/cursors |
| Backend `test:privacy` | Pass | Selected controller/service/contracts, not all live identities |
| Backend `test:random-connect` | Pass | No live call placed |
| `test:message-media`, `test:story-music` | Pass | No live upload submitted |
| Deployment/discovery contract tests | 6 pass | No deployment executed |
| Real loopback compiled HTTP compatibility smoke | Pass | Isolated Mongo + real Sharp/FFmpeg, S3 mocked; details below |
| Local Redis compiled consumer smoke | Pass | Real BullMQ/Redis; processing function stubbed |
| Video-index apply/reapply/verify | Pass locally | MongoDB 8.3.7, NOT DocumentDB 5.0 |
| CloudFormation `validate-template` and JSON parsing | Pass | No stack deployed; placeholders remain |
| Web Vite production build + TypeScript | Pass | Large-chunk/Browserslist warnings |
| Selected Web upload/HLS/exposure/preload tests | 68 pass across 13 files | jsdom canvas/act/localStorage warnings, not browser E2E |
| Mobile `test:post-video-upload` | 18 pass | Upload engine/playback/prefetch checks, not real network/device |
| Mobile `test:post-editor` | 31 pass | No near-limit device workload |
| Mobile `test:home-feed` | 13 pass | Source contracts |
| Mobile TypeScript | Pass | Does not compile Swift/Kotlin |
| Mobile `test:privacy` | **29 pass / 3 fail** | Source-contract assertions below |
| Mobile `test:call-signaling` | **23 pass / 1 fail** | Source-contract assertion below |
| Android QA offline debug build with bundled JDK | Pass | Not installed/tested against staging |
| iOS Simulator workspace build | Blocked, exit 70 | No eligible platform/destination |

### Real local HTTP compatibility results

The compiled app was bound to loopback with disposable MongoDB, dummy credentials,
no signing configuration, uploads=false, and mocked S3 send/HEAD operations:

| Request | Result |
| --- | --- |
| Existing synthetic account with six-character password login | 200 |
| Authenticated new-upload policy | 200, enabled=false |
| New session creation | 503 VIDEO_UPLOADS_UNAVAILABLE before any S3 access |
| Legacy text post | 201 |
| Legacy PNG post, real Sharp conversion | 201 |
| Legacy 200,575-byte H.264/AAC MP4, real FFmpeg verification | 201; normal progressive media and HLS-processing metadata |

There was intentionally no queue bridge in that HTTP harness. Legacy HLS enqueue
logged unavailable and deferred to recovery, while progressive publication
succeeded. Actual queue wiring was checked separately with isolated Redis. This
is not proof that this HTTP fixture was asynchronously processed end-to-end.

### Legacy exact-limit finding

An isolated real HTTP test of the unchanged shared Multer middleware found:

| Video body bytes | HTTP result |
| --- | --- |
| 52,428,799 | 200 (middleware accepted) |
| 52,428,800 | 413 FILE_TOO_LARGE |
| 52,428,801 | 413 FILE_TOO_LARGE |

These were synthetic byte-boundary bodies, not decoded videos. The configured
limit is 50 MiB, but effective acceptance is exclusive at that exact boundary.
The middleware file is byte-identical to its August 30 version (`88aafda`) and
to fetched main, so it is not a change introduced by this audit. The acceptance
claim “every <=50 MiB upload passes” is therefore not established. No limit or
middleware behavior was changed; resolve this discrepancy separately before
claiming that exact-boundary requirement passed.

### Failed mobile contracts requiring triage

1. `src/contexts/PresenceContext.contract.test.mjs:32`: focused-surface/capability
   assertion, including missing expected “Unfollowing may instantly revoke...”
   source text.
2. `src/services/MobilePrivacyContent.contract.test.mjs:17`: canonical follow-gate
   assertion expecting a fail-closed expression.
3. `src/services/PrivacySettings.contract.test.mjs:61`: profile-capability/rendering
   assertion, including expected hidden-follower expression.
4. `src/services/callPermissionPolicy.test.mjs:27`: conversation interaction gate
   source assertion expecting the earlier `canStartDirectInteraction` structure.

These are regex/source-contract failures, not live proof of an access leak or
call failure. The extensively dirty mobile worktree was preserved. No clean
baseline comparison established their introduction, and no unrelated mobile
code/test was rewritten just to make the audit green.

Not executed live: story/DM/avatar/banner publication, follow/unfollow mutation,
full owner/follower/nonfollower/blocked identity matrix, old iOS app execution,
voice/video/Random Connect connections, and representative new-upload workload.
Normal browser viewing can produce the application's normal exposure telemetry;
no recommendation/exposure history was reset or directly migrated.

## K. Remaining authorization, evidence, and final readiness

**Final production readiness: NOT READY for controlled 500 MiB rollout.**

Keep production new sessions and new private delivery disabled. Preserve current
legacy embedded consumption until the dedicated transition is proven. Do not
equate healthy API / passing builds / local S3 emulation with cloud readiness.

Before execution can continue, obtain:

1. Deployment laptop's actual source/repository mapping for `f4660ee`, plus a
   reproducible Node 22 container build/digest.
2. Approval for a named, isolated, billable staging deployment with budget,
   resource scope, credentials/secret isolation, representative DocumentDB and
   separate Redis; review secret-loader/namespace blockers first.
3. Target-DocumentDB migration compatibility evidence and approval before any
   production migration. No production migration is automatically required just
   to repeat the locally tested disabled legacy requests.
4. Approved test accounts and representative source files for actual AWS/device
   upload, publication, interruption, cleanup and private-delivery testing.
5. A decision on the maximum grant-revocation delay and source retention policy.
6. Eligible iOS toolchain/destination; triage of failed mobile contracts and the
   existing legacy exact-size discrepancy.
7. Measured worker capacity, cost/queue behavior, legacy HLS canary, real browser
   and physical-device playback, and a reviewed rollback/drain rehearsal.

Files changed by this audit: this report and two generated screenshot artifacts
in workspace `artifacts/video-deployment-audit/`. No application source, flags,
AWS configuration or infrastructure were changed; no production media was
uploaded/published; no package or simulator runtime was installed. Local builds
updated generated output/cache files, and Git fetch refreshed remote refs.

The configuration-validation workflow drove environment precedence, worker-gate
and template/isolation review; browser verification used visible UI and an
explicitly reset viewport. Android checks used existing ADB/build tooling. These
checks intentionally stop at the unapproved cloud-change boundary.
