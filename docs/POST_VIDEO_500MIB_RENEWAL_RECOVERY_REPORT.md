# Five-minute grants and recovery/capacity validation

**21 October follow-up:** see the current
[iOS/Safari report](POST_VIDEO_500MIB_IOS_SAFARI_FINAL_REPORT.md).
Xcode's managed package is installed, the full native workspace builds, and real
iOS Simulator 500 MiB transfers/recovery/processing/publication/playback passed
against a separately approved AWS staging environment. Safari rendering/HLS
blockers were fixed. Follow-up browser/privacy/cleanup status is recorded there;
physical iPhone validation is not claimed. The historical round-2 results below
remain unchanged. Production activation is still NOT READY.

20 October 2026. **Production activation: NOT READY.** The approved grant policy
and the core server-side capacity/recovery cases now have real AWS evidence.
This does not substitute for updated native-player, Safari and release validation.
Production `arc-backend:205` and its compatibility flags have not been changed.

The round-2 cleanup receipt is attached in the evidence directory. This is a
completed record of the bounded approved staging run, **not** a claim that all
production activation gates passed. Do not use it as deployment authorization.

## Scope, approval and provenance

- User approved five-minute renewable grants, then round-2 isolated staging in
  account `906446637180`, `us-east-1`, for six hours and an additional $15 cap.
- Window: `2026-10-20T02:41:43Z`–`2026-10-20T08:41:43Z`. At most two workers,
  two CodeBuild runs, and 10 GiB each source ingress/output/CDN traffic. One build
  used. No production migration, upload activation, IAM/storage/CDN/DNS change,
  commit or push is included in this approval.
- Base revision `8a7d68a2bdd85e29e450e0bc3486921aaf3fe065`; explicitly a dirty,
  reviewed staging snapshot, not a claim that all work was committed.
- Backend source archive SHA256:
  `0ab7eed870f090940eb5328b8a7efd67e1730e153ce3846d02e112992e8c2c1a`.
- Staging image digest:
  `sha256:45f077ce555da04c1c737090b81416a26707246d984bceabbf2c7cb7b1729ab0`.
  Later local validation scripts/test-command/documentation changes are not
  falsely represented as being in that image. Runtime grant code was in it.
- Separate staging secret namespace, new VPC/data/storage/CDNs, no production
  secrets loaded. Temporary resource IDs and credentials are kept out of this
  report; sanitized evidence is exported separately.

## Approved revocation policy and implementation

NEW `post-video-playback/*` grants have a fixed **300-second maximum**, with
270–300-second actual lifetimes in stable 30-second issuance buckets. HLS
master/variant/segment, optimized MP4 and thumbnail grants share the expiry.
Clients renew 60 seconds early with current application authentication; anonymous
renewal is allowed only where current public-content policy allows it. Public
content remains anonymously accessible under existing privacy rules.

The renewal endpoint reads the live publication/session, current viewer and
author, profile visibility, follow/block/activity/moderation/deletion state
before signing. An old media bearer does not authorize renewal. Manifests also
recheck current access. Responses use `private, no-store`.

Previously issued asset URLs can start requests until expiry. In-flight transfers
and downloaded/cached bytes cannot be recalled. This is the bounded policy the
user selected, not instant revocation. Original-source retention stays **0**
(retain live READY sources); legacy media delivery is unchanged.

Web and native share byte-identical bounded lease logic: one in-flight request,
early renewal, abort/cleanup, bounded transient retries, denial/expiry blocking
and foreground reauthorization. URL rotation retains the existing player,
playhead and play/pause state rather than mounting a second player. Expired or
denied NEW-pipeline media never falls back to the original source.

### Relevant files

| Area | Files |
| --- | --- |
| Signing/renewal | `src/legacy-src/utils/postVideoDelivery.js`, `privateMediaDelivery.js`; `controllers/videoUploadController.js`; `src/modules/posts/posts.routes.ts` |
| Backend tests | `postVideoPolicy.test.js`, `videoPostPublication.integration.test.js`, `scripts/post-video-staging-preparation.test.js`, backend `package.json` |
| Web lease/player | `frontend/src/features/post-upload/{playbackGrantLease,usePlaybackGrant,useRenewedVideoPosition,FeedAdaptiveVideo}.ts*`; `features/clips/AdaptiveClipVideo.tsx`; `utils/postContent.ts` |
| Web controls/tests | `components/MediaSwiper.tsx`, `MediaSwiper.unifiedAudio.test.tsx`; `FeedAdaptiveVideo.test.tsx`, `AdaptiveClipVideo.test.tsx`, `playbackGrantLease.test.ts` |
| Native lease/player | `mobile-ui/arc-mobile/src/services/{playbackGrantLease,usePlaybackGrant,nativeGrantSource,useRenewedNativeSource}.ts`; `components/PostCard.tsx`; `app/(tabs)/clips.tsx`; `utils/postMedia.ts` |
| Native tests | `src/services/playbackGrant.test.mts`; mobile `package.json` adds it to `test:post-video-upload` |
| Stage isolation | `infra/post-video-staging-{api,data}.yaml` namespace parameter; approved staging templates and resource-sampling files from the preceding staging work are preserved |
| Operational docs | `POST_VIDEO_500MIB_ROLLOUT.md`, `POST_VIDEO_500MIB_IMPLEMENTATION_REPORT.md` historical notice, `infra/post-video.env.example`, renewal/recovery plan and this report |
| AWS harnesses | `scripts/validate-post-video-{aws,renewal,expired-put,part-recovery,processing-retry}.m*`; existing staging privacy/control/DocumentDB scripts |

Paths in this table are relative to the appropriate backend/Web/mobile codebase;
this is not a list of unrelated pre-existing dirty-worktree changes.

## Real AWS transfers and processing

These rows used the existing Web upload engine with a **Node HTTP transport**,
real authenticated staging APIs, S3 bodies and actual FFmpeg workers. They are
not physical Android, Mobile Safari or browser-XHR upload claims.

| Source | Bytes | Duration / input | Parts | Result |
| --- | ---: | --- | ---: | --- |
| Small portrait | 9,892,321 | 30 s, H.264/AAC | 2 | READY; HLS 200, MP4 Range 206, unsigned 403 |
| Long landscape | 100,637,571 | 300 s, 640×360, H.264/AAC | 12 | READY; accepted-part reuse and one canonical publication |
| Portrait stress | 312,746,573 | 120 s, 1080×1920, H.264/AAC | 38 | Worker forcibly stopped; recovered after real lease expiry; READY on attempt 2 |
| Exact boundary | **524,288,000** | 180 s, 1920×1080, H.264/AAC | **63** | All bytes acknowledged once; READY on attempt 1; duplicate job skipped |
| Expired PUT | 9,892,321 | Same small synthetic source | 2 | Real 900 s expiry → S3 403; only missing part re-signed/uploaded; READY |
| Interrupted PUT | 9,892,321 | Same small synthetic source | 2 | Client-aborted PUT absent from accepted parts; retry missing part only; READY |

The exact-boundary source contains 523,048,867 encoded bytes plus a disclosed
1,239,133-byte MP4 free atom solely to reach exactly 500 MiB. It is a three-minute
encoded motion/noise stress source, not a two-second padded fixture. Its SHA256 is
`2c11cd7581ec7a44e1b8a2b7e036514575da5edd0a649a35794d1d70b9fb7f91`.
These synthetic fixtures do not establish camera/gaming/low-light/lip-sync/HDR
quality or all supported source-codec behavior.

Publication was repeated with the same client key for the completed main
fixtures and returned the same post. Incomplete publication returned 409;
another owner could not read/list/sign/cancel a session (four 404 checks).
Cancellation blocked further parts with 410. Exactly 500 MiB was accepted and
the extra byte rejected. No production fixture or personal video was used.

## Real privacy and expiry evidence

- 634 seconds of actual authorized HTTP HLS/child/thumbnail/MP4 renewal checks;
  child assets shared expiry. This is separate from browser playback evidence.
- Profile-private, non-follower, accepted-follower, blocked-viewer and owner
  cases exercised through real APIs. Fresh denied responses contained no grants.
- Privacy change: fresh renewal and old HLS manifest denied immediately; an
  already-issued MP4 remained usable before its approved expiry, then new Range
  requests received 403 after expiry.
- Deleted disposable post: even owner renewal and old manifest received 403;
  prior MP4 Range requests changed from 206 before expiry to 403 afterward.
- Anonymous S3 source, unsigned CloudFront source and **correctly signed**
  CloudFront source requests all returned 403. A separately signed optimized-MP4
  control returned 206/1024 bytes, ruling out an invalid signer as the explanation.
- Live source-deny bucket policy was checked. Signing private keys, JWTs,
  presigned URLs, raw client IPs and raw access-log query strings are not exported.
- Moderation/inactive-viewer/unattached/unready and stale-worker publication
  races are additionally covered by local integration tests; do not label every
  one of those as an executed live administrative workflow.

## Capacity, worker recovery and storage

Two workers, each **2 vCPU / 4 GiB / 40 GiB**, one job per worker and two FFmpeg
threads. Queue samples captured **two active jobs plus one waiting**, never more
than two active queue jobs. Worker scale sequence was 2→1; the selected task fully
STOPPED with **exit 137**; only then 1→2. No deployment surge created a third worker.

The interrupted portrait session retained its real lease until
`03:48:00.872Z`, restarted at about `03:48:13Z` without timestamp edits, and reached
READY on attempt 2. A concurrent duplicate of the active 500 MiB session returned
`skipped: true` without incrementing its processing attempt. Final database checks
found one output version and one post reference per published READY session.

| Successful processing | Wall seconds | CPU seconds | Peak sampled RAM MiB | Peak sampled scratch MiB |
| --- | ---: | ---: | ---: | ---: |
| Small portrait | 57.95 | 103.46 | 262.74 | 35.82 |
| Five-minute 360p | 85.62 | 139.33 | 346.34 | 214.49 |
| Exact 500 MiB | **668.19** | **1,240.49** | **1,093.39** | **775.74** |
| Portrait retry attempt 2 | 458.25 | 853.49 | 816.30 | 482.26 |

One-second cgroup samples include FFmpeg children and are not exact hardware
high-water marks. Final metrics for the killed attempt were not emitted. Upload,
queue waiting, interruption/lease waiting and processing are not conflated: the
500 MiB transfer-through-completion was 703.94 s, while complete test wall time
was 1,522.15 s. The interrupted portrait total was 2,078.69 s, not encoder time.
API one-minute CloudWatch MemoryUtilization reported a maximum 13.48% of its
1 GiB allocation across the measured round-2 window through 06:03 UTC; this is
not an exact instantaneous peak or a whole-file-buffering proof by itself.

Exact-500 output bytes: optimized MP4 **56,573,494**; HLS 360p **18,093,032**,
540p **33,887,659**, 720p **65,478,899**, 1080p **115,081,023** (variant figures include
their playlists). Total HLS including master **232,541,056**, thumbnail **20,912**.
All outputs together **289,135,462** bytes. One viewer does not necessarily fetch
every variant; aggregate storage is not a single playback-file size.

The five-minute 360p input's fallback is 94,165,404 bytes versus a 100,637,571-byte
source, while HLS is 30,090,912 bytes. Do not promise a fixed compression ratio or
that total multi-rendition storage is always smaller than every source.
No throughput SLA or higher concurrency is inferred from this bounded batch.

## Recovery evidence and honest limitations

- Expired PUT: actually waited the API-issued 900 seconds; S3 returned
  `AccessDenied`/expired. Part 1 was reused, one fresh PUT uploaded part 2.
- Completion acknowledgement deliberately discarded after real HTTP success:
  resume used existing PROCESSING/READY state with one completion call. This is
  application-acknowledgement loss, not a physical packet-loss measurement.
- Interrupted PUT: 262,144 body bytes pulled before client abort; S3 accepted no
  partial second part. Part 1's ETag **and LastModified** were exactly unchanged
  before/after resume. Bytes pulled are not proof of bytes received by S3.
- Real DocumentDB reboot: seven sessions, five posts, one exposure record and six
  session indexes survived with identical selected-content SHA256 and index
  definitions. The snapshot comparison preceded later test-fixture additions.
  The separate DocumentDB 5.0 migration test also passed additive/idempotent
  apply/reapply/verify and preservation checks. No production migration ran.
- A transient-source test initially used an incorrect bucket-versioning
  assumption; its guard failed before mutation. The subsequent temporary-backup
  test restored SHA256-identical bytes/metadata, and automatic BullMQ recovery
  won a race against its manual-retry assertion. That harness assertion failed;
  no application regression was demonstrated. The unpublished disposable
  recovered fixture was cancelled, and the fault/backup removed.
- The deterministic held-queue retry then **passed**: a verified original was
  temporarily copied to a staging backup, the queue was held immediately after
  `PROCESSING_FAILED`, and SHA256-identical source bytes/metadata were restored.
  One real processing-retry API call reached READY with **zero client
  re-uploaded bytes**; repeated publication returned the same post. The temporary
  fault/backup were removed and the staging queue resumed. Final audit found
  zero active/waiting/failed jobs and one output version/reference for each
  published READY session.

## Browser and device validation

- Actual Chrome HLS/MSE playback observed across a 612.101-second span and
  rotating source generations, with successful automatic renewal API requests.
  Periodic observations are not frame-by-frame latency/freeze measurements.
- Actual paused Chrome playhead **17.547437 s** and paused state survived URL
  rotation in the staging-bound production bundle.
- After a live denial, source/poster were removed and playback stopped. A stale
  Pause control was reproduced in a failing regression, then fixed by observing
  the media `emptied` event. The repeated browser case showed Play, disabled
  Seek and `0:00 / 0:00`, with readyState 0 and no source/poster.
- Responsive Chrome viewport 390×844: document width 387, video played, no
  horizontal overflow. This is not physical Mobile Chrome/Safari evidence.
- Signed-in Desktop Chrome Home Feed and Clips independently rotated HLS/MSE
  source generations while playing (readyState 4 in subsequent observations),
  with successful page-specific renewal requests. The adjacent Clip preloader
  remained paused. The local production bundle was built against the staging
  API, not production. Its local CAPTCHA site-key inheritance was corrected to
  match staging's existing `TURNSTILE_MODE=off`; no production security setting
  changed.
- Native Chrome tab switching/minimization still reported visible in the
  automation environment and renewals continued; **background-stop is
  inconclusive**, not a PASS. Local lifecycle tests are not a substitute.
- Desktop Safari opened a blank page under both the development server and
  staging-bound production bundle, including its login route. A final read-only
  settings check confirmed **JavaScript enabled** and **developer features
  disabled**; the blank render was not explained by JavaScript being disabled.
  Permission to temporarily enable diagnostic features was requested but not
  supplied. No setting was changed, and the settings window was closed. **Not
  PASS**; do not claim Safari incompatibility or a verified root cause yet.
- New Samsung QA build `com.arcSquadHunt.videostagingqa` compiled/installed
  separately. After the user unlocked it and authorized sign-in, the synthetic
  owner signed in. Actual Clips playback, 55-second hold/release, stable paused
  on-video timestamp **196.333 s**, continued timestamp **214.767 s**, and a real
  Android OkHttp renewal HTTP 200 were observed. Renewal happened after release,
  not while paused. A **534.181 s** background interval had no renewal requests;
  foreground reauthorization returned 200. Existing Clips session refresh then
  showed no unseen fixtures and unmounted the prior player; that is not
  playhead-restoration proof. A separate **329.637 s** post-detail interval
  reauthorized successfully and resumed playback, but the existing
  `app/post/[id].tsx` foreground `fetchPost()` loading path remounted the card,
  resetting its position (20.200 s before; 3.067 s shortly after return).
  Continuity across that screen refresh is **not established/retained** and was
  not hidden by altering privacy or recommendation behavior. Separately, actual
  retained `NativeFeedVideo` playback renewed at **06:17:01.438Z / HTTP 200**;
  visible time advanced **157.467 → 232.633 s**, without the zero-position reset
  seen in the screen-remount case. Periodic observations do not prove frame-
  perfect QoE or native iOS behavior. It subsequently crossed the old grant's
  expiry and completed a five-minute loop while still playing. The separate QA
  package was uninstalled after evidence export; production and older QA app
  packages were preserved. The two temporary USB reverses and generated phone
  UI/screenshot files were removed, with evidence retained locally.
  No alarm, PIN or personal media was manipulated. A Mobile Web share URL invoked
  the existing `AppOpenRedirect` and briefly opened the production app; no
  production-account interaction was performed. Testing continued through
  browser login/Home/Clips routes instead. First-run physical upload results are
  historical, not new-player renewal proof.
- Physical Mobile Chrome: synthetic-owner sign-in, Home and Clips rendered;
  actual Clips frames/timecodes changed, and Android Chrome renewal requests
  returned 200 at **06:05:30.608Z** and **06:09:31.061Z** for the playing small
  fixture. Playback continued after the prior grant lifetime. Long-press can
  also invoke Chrome's existing native video context menu; it was dismissed,
  not treated as an app grant failure. Signed out afterward. These observations
  do not imply a new physical multipart upload or Safari/iOS success.
- iOS: `simctl list runtimes --json` returns zero runtimes. Although
  `xcodebuild -showsdks` lists iOS/Simulator SDK 26.5, the SquadHunt scheme has
  no eligible destination: Xcode says **iOS 26.5 is not installed**. An actual
  generic-simulator build with code signing disabled exited **70** before native
  compilation. No platform/runtime download was approved or performed. Swift
  native compilation and simulator/device playback therefore remain unverified.

## Regression checks

| Check | Executed result |
| --- | --- |
| Backend build/typecheck/runtime imports | PASS, Node 22 |
| Grant/publication/staging contract tests | **24/24**, no skips; local real MongoDB fixtures, not DocumentDB emulation |
| Disabled-feature compatibility smoke | PASS: production-mode startup without signing secrets/video indexes, legacy six-character login, text/image/legacy video HTTP posts, real FFmpeg HLS+MP4 via embedded BullMQ, Feed/Clips/detail, new sessions disabled |
| Deployment safety | 26 passed, no skips in the available local environment |
| Existing HLS, media integrity, privacy, auth/onboarding, discovery/recommendations and call producer suites | PASS in this follow-up worktree; ranking/no-repeat/preload semantics unchanged |
| Focused Web player/audio/preload/prefetch tests, latest rerun | **75/75 in 8 suites**, including red→green revoked-transport regression; earlier exposure/regression suites also passed |
| Web build / full TypeScript | PASS; existing Browserslist/chunk-size warnings remain |
| Mobile upload/playback/renewal | **23/23**; full TypeScript PASS |
| Mobile privacy / call-signaling | 42 / 24 passed respectively |
| Android QA debug assembly | PASS with Java 17; default Java 8 first attempt was an environment failure |
| iOS native | NOT VERIFIED: no simulator runtime |

A mobile test command initially tried unavailable `tsx`; the established Node 22
`--experimental-strip-types` command passed without adding a dependency. Existing
jsdom canvas warnings are reported, not silently treated as native-player proof.

## Deployment and activation verdicts

**Backend, feature disabled:** compatibility checks remain green. Deployment
still requires reviewed/committed source, clean release tree and guarded
preflights; no production deployment is authorized by this staging report.

```dotenv
POST_VIDEO_UPLOADS_ENABLED=false
CLIP_HLS_ENABLED=true
CLIP_HLS_WORKER_ENABLED=true
POST_VIDEO_PRIVATE_DELIVERY_ENABLED=false
POST_VIDEO_SOURCE_RETENTION_DAYS=0
VIDEO_DEPLOYMENT_MODE=compatibility
```

**500 MiB activation: NOT READY.** The approved five-minute policy, live
CloudFront expiry/privacy checks, core recovery cases, bounded two-worker batch,
actual Chrome and Samsung retained-player renewal checks are now evidenced.
These independent remaining gates must not be hidden by that progress:

1. Safari blank-render diagnosis and actual native-HLS/renewal validation.
   Developer-feature permission was requested but not supplied; no Safari
   setting was silently changed. Mobile Safari is not covered by Android Chrome.
2. Install/approve an eligible Xcode platform/destination, compile the Swift
   module and perform actual iOS source-access/upload/playback/lifecycle checks.
3. Decide/fix or explicitly accept the observed foreground screen-remount
   position reset. Successful reauthorization is not continuous-position proof
   across an intentionally refreshed recommendation/detail screen. Desktop
   background-stop remains inconclusive in the automation environment.
4. Representative camera/edited/high-motion/HDR/MOV-HEVC/unsupported-codec and
   audiovisual-quality cases, sustained load, longer-duration/concurrency limits,
   queue-age/processing SLOs and failure alarms. One passing batch establishes
   measured resource use, not a production throughput/SLA guarantee.
5. Release renewal-capable clients and define old-version handling before
   activation; **do not lengthen grants for old clients**. New client-grant code
   does not establish continuous background transfer while mobile apps suspend.
6. Separately reviewed production worker/private-delivery/IAM/CORS/lifecycle,
   monitoring/alert recipients, retention/resource and staged rollout approval.
   Preserve the embedded production worker until a compatible dedicated
   production consumer is healthy. Do not reactivate the old loading-delay work.

No production activation, migration, push or deployment was performed by this
round. Core runtime changes and tests are listed above; existing unrelated
worktree edits were preserved.

## Cleanup and spending

Sanitized evidence is exported to
[`docs/evidence/post-video-renewal-2026-10-20`](evidence/post-video-renewal-2026-10-20/README.md),
with per-file SHA256 hashes in `export-manifest.json`. The final resource-absence
verification completed at **06:40 UTC** and was rechecked at **06:42 UTC**,
before the approved 08:41 UTC deadline:

- All **six new round-2 stack IDs** are `DELETE_COMPLETE`.
- API/worker tasks stopped; stage cluster inactive and no active stage task
  definitions remain. Temporary build project/roles and delivery stacks deleted.
- **1,001** disposable source/output/build objects permanently removed; empty
  bucket, ECR repository, logs and alert topic deleted. No personal media used.
- New DocumentDB instance/cluster and Redis deleted. No production migration or
  record deletion occurred. Synthetic staging database/media are not recoverable
  through an application recycle bin; their removal was explicitly approved.
- New VPC/NAT/EIP removed. The new unused CloudFront-managed group was deleted
  only after its origin/distributions and ALB reference were gone, zero group
  ENIs and zero SG references were verified, and permission dry-run succeeded.
  The shared service-linked role is preserved with its original role ID.
- Three **round-2-only** secrets marked for deletion using a seven-day recovery
  window. Their raw AWS `DeletedDate` fields are not presented as promised final
  purge timestamps. Local synthetic credentials/private key were removed.
- Separate Samsung QA package, temporary USB reverses, phone UI/screenshot
  files and local Metro/preview servers cleaned up. Evidence screenshots are
  retained; production/older QA packages and personal files were not removed.
  Synthetic Web sessions signed out, agent-created test tabs closed, viewport
  override reset, original Safari tab preserved, no Safari setting changed.
- Production read-only recheck: **arc-backend:205**, same immutable digest,
  **1 running / 0 pending**, deployment completed, ALB healthy, `/health` **200**,
  exact compatibility flags unchanged. No production rollback was needed.

See `round2-final-cleanup-receipt.json`, `round2-cleanup-actions.json` and
`client-cleanup-evidence.json`. A CLI cluster-deletion waiter was unavailable;
direct `DBClusterNotFoundFault` verified deletion instead. Cleanup guards were
adjusted to permit only the network stack's own NAT ENI during its deletion and
to check the two exact ECS families rather than an incomplete family prefix.
No failed guard was bypassed with a FORCE option.

Last measured source/output storage was **977,241,428 / 717,031,660 bytes**;
CloudWatch reported approximately **306.8 MB** of CDN transfer at the final
pre-teardown sample (reporting lag applies), below each approved 10 GiB bound.
One CodeBuild run and no more than two workers were used. Actual AWS billing is
delayed; this report does **not** invent a finalized dollar charge or treat the
$15 approval as an AWS-enforced budget. No temporary billable staging services
were intentionally left running for further tests.
