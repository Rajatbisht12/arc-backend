# 500 MiB staging execution evidence — 20 October 2026

Status: **Validation and approved staging cleanup completed, with explicit rollout gaps — NOT a production activation approval.** All six disposable staging stacks are deleted, including the final empty VPC. Production remains revision 205 with large uploads disabled.

Reviewed durable evidence: [sanitized evidence bundle](evidence/post-video-staging-2026-10-20/README.md), including the synthetic [exact-500 HLS screenshot](evidence/post-video-staging-2026-10-20/desktop-500-hls.png). Original private working directory: `/var/folders/m6/h030hkv550d30w71hbk0xyph0000gn/T/squadhunt-video-staging-XRXovM`. Do not publish that directory wholesale: it contains generated test configuration and some private test-recording screenshots. Reports omit passwords, tokens, signed URLs, database credentials and the personal recording's filename. Credential material is removed during final cleanup.

## A. Staging infrastructure

The user approved the named isolated plan, a 12-hour test window and $25 spending authorization, then separately approved temporary staging CodeBuild within the same allowance. Window: **2026-10-19 23:12:46 UTC → 2026-10-20 11:12:46 UTC** (cleanup deadline 16:42 India). This is an operational allowance, not an AWS-enforced spend cap. Separate approval permits deleting the user's 235,705,228-byte recording's **staging copies only**; its original phone file and production are excluded. A 15-second Samsung mobile-data interruption was separately approved and executed; data was restored, Wi-Fi remained off.

All resources were NEW in account `906446637180`, `us-east-1`. These are the historical test identities/configuration, not a claim that the services remain deployed after teardown (J):

| Component | Actual identity / configuration |
| --- | --- |
| Six stacks | `squadhunt-video-staging-{network,data,media,build,api,worker}` |
| Network | VPC `vpc-0056c433f8f6295e8`, private API/worker, TLS DB/cache, no production peering; one NAT, S3 gateway endpoint |
| Database | `arc-video-staging-db` / `arc-video-staging-db-1`, actual DocumentDB **5.0.0**, db.t3.medium, encrypted/TLS |
| Queue | `arc-video-staging-redis`, Redis OSS 7.1, cache.t4g.micro, TLS/auth, isolated `clip-video` |
| API | Cluster/service `squadhunt-video-staging` / `squadhunt-video-staging-api`, task family `squadhunt-video-staging-api-api:3`, 0.5 vCPU/1 GiB, internal ALB + CloudFront VPC origin |
| Worker | `squadhunt-video-staging-worker-Service-OcEVOGpuiXhh`, 2 vCPU/4 GiB/40 GiB disk, concurrency 1, FFmpeg threads 2, linux-amd64 |
| Storage | NEW staging bucket from the approval manifest; originals and versioned derivatives use distinct prefixes; no production bucket access |
| Media CDN | `E1SI0E05QW5OND`, `https://d2276zh0eod6of.cloudfront.net`, OAC + trusted key group, restricted default behavior |
| API CDN | `EJUNUD97YQ9JU`, `https://d2y51obt3p9puq.cloudfront.net`, private VPC origin `vo_DNX5zO84wCuBYr8uSjTHyl` |
| Build | Temporary `squadhunt-video-staging-build`, encrypted source archives, staging ECR only; no production secret access |
| Monitoring | Worker queue/failure metrics/alarms, cgroup/scratch samples, CloudWatch logs; SNS topic exists but has no subscription, so operator notification delivery is NOT verified |

The ALB ingress was tightened after bootstrap to the independently verified staging CloudFront VPC-origin service SG `sg-0cae9926bc18f82ae`. Task roles explicitly deny other secrets, role escalation and S3 outside the new bucket. Runtime isolation requires independently supplied database/cache/bucket/API/media bindings; secrets cannot invent those controls. Stage credentials/signing keys were generated independently, not copied from production. Four synthetic users were seeded; no production DB, users, queue, exposure history, secrets, DNS or CDN were changed.

AWS created the approved account-scoped `AWSServiceRoleForCloudFrontVPCOrigin`. It is shared and must **not** be automatically deleted during staging cleanup.

### Image provenance

Base source: `8a7d68a2bdd85e29e450e0bc3486921aaf3fe065`. These staging changes are an **uncommitted worktree snapshot**, not a new Git commit. No commit/push was performed.

* Worker image: `sha256:ad1305517a2fb7b9395d61af5be8716efd62ca1ed52376f4fcd9bfbb3bebc524`; archive `f74c6c5856674ed85c59a44fa29906e18c44199cb1d0acaaab378a4916016949`; CodeBuild `53ac19ed-3a35-4561-8f6e-c65b52391af4`.
* API revision 3: `sha256:a07eb6d28947bae108c90a0323127bd27496e447cb1fa08e2d6027cea32559dc`; archive `ede673c08642dcdf5ff85db7048c0aad0bbeb76638af01c135ac3267e3d26c4a`; CodeBuild `d8a76d6c-59ca-4571-8250-d3210ea2ee37`. Adds safe access logging; same upload/queue protocol as worker.
* Superseded-output cleanup correction: image `sha256:2445faefff50f35db794d26013fcb3a338b70bc4b9d7d09bdb2356c298b181cf`; archive `16bb09870118c73b7816268175ecf036289964828e09a7d2e576b710e3c527f8`; CodeBuild `23e7ec6c-ede0-45f2-acb6-1f36dac79b0a`. Executed only in one-shot validation task `1b00abf8337d45799c98efbce0a543c1` (exit 0); the API and processing-worker services were NOT rolled to this fourth image. Real maintenance cleanup was verified; the immediate READY-commit cleanup hook was integration-tested locally.
* Initial CodeBuild failed on a Bash-only substring under `/bin/sh`; buildspec was corrected and rebuilt successfully. No failed image received traffic.

Production image remains `sha256:cbd57c9f550b8143f9d05046d878d56e9b9f0ca68c9b6799e0250dc40ac73d55`. Its exact compatibility flags remain false/true/true/false/0 for uploads/HLS/embedded worker/private delivery/retention, with `VIDEO_DEPLOYMENT_MODE=compatibility`. Production deployment was never run.

## B. DocumentDB

Actual AWS DocumentDB 5.0.0 task `37c79cd397fa47128a43c3afa3b3657e` exited 0. `scripts/validate-post-video-documentdb.mjs` applied, reapplied and verified six indexes in isolated database `video_staging_migration_a7897fd572c2460c84b9e7252594bb4f`, then disconnected/reconnected and verified again.

Verified: missing/null/empty client IDs allowed; duplicate owner/client ID rejected; different owner accepted; existing posts/exposure hash unchanged (`f1eedebc6cb3a61540f76ad777f0d20cb5de247dedc222ba56b648ac2ad0d8d1`); unrelated index retained. No destructive index replacement or production migration. Stage application DB apply/verify also passed in bootstrap task `f5ac1625af1c4f30801002c38b8983c8`.

Evidence: `documentdb-migration-evidence.json`. After worker replacement, a fresh secret-hydrated ECS task `ef4f5219abf5477db23f3d5fbce81e68` exited 0 and verified all six indexes again (`restart-indexes-and-duplicate-evidence.json`). This demonstrates persistence across new application containers/connections, **not a database-server reboot or failover**; those remain unexecuted.

## C. Worker

Actual dedicated ECS worker consumed `process-upload` jobs independently from the API, which has its embedded worker disabled **only in staging**. Prod embedded HLS worker remains enabled. FFmpeg/ffprobe 8.1.2 were executed in the staging image. Sampler measures the whole cgroup (including FFmpeg children) and bounded video scratch directories every second; these are sampled maxima, not exact high-water marks.

Original task `2ba1c3a8a19744c19b4b42aed1a016c0` was intentionally stopped while native 100 MiB-class session `6ad6bbc6150b5a84475cb947` was PROCESSING. It exited 137 after the ECS shutdown allowance. Replacement `ac54f69330ac474cadbf705a8635cb10` became healthy and logged the stalled job. The session's 10-minute lease prevents concurrent processing; a stalled BullMQ delivery was acknowledged as skipped while that lease remained active. Maintenance recovered the expired lease and queued attempt 2: **READY at 01:16:54 UTC, exactly one post**. No lease timestamp was artificially shortened. This recovery can take several minutes and must not be presented as instantaneous.

Two deliberate duplicate deliveries for the READY native 300 MiB-class session completed with `{skipped:true}`. Its attempts/output-prefix hash stayed unchanged and publication count stayed 1. A real 1,024-byte corrupt source failed after three attempts with `PROCESSING_FAILED`, created no post and left one expected failed queue entry; it was not mistaken for a successful video. Final queue snapshot: waiting 0, active 0, delayed 0, failed 1 (the intentional corrupt fixture).

| Source | Worker job wall seconds | CPU seconds | Sampled peak RAM bytes | Sampled scratch bytes |
| --- | ---: | ---: | ---: | ---: |
| 10 MiB class | 57.715 | 104.325 | 273,244,160 | 37,562,276 |
| 50 MiB class | 106.521 | 195.056 | 447,275,008 | 100,594,646 |
| 100 MiB class | 167.331 | 306.687 | 434,974,720 | 200,489,973 |
| 200 MiB class | 422.373 | 777.818 | 731,217,920 | 400,502,970 |
| 300 MiB class | 464.891 | 863.828 | 852,107,264 | 505,689,934 |
| Exact 500 MiB | 718.346 | 1,331.845 | 1,148,186,624 | 813,421,790 |
| Samsung recording, 224.8 MiB | 663.840 | 1,252.866 | 786,784,256 | 381,069,402 |
| Actual desktop 50 MiB-class upload | 105.371 | See evidence | 461,467,648 | 100,594,264 |
| Native 100-class recovered attempt | 165.836 | 301.971 | 438,804,480 | 200,496,215 |
| Native 300 class | 474.195 | 880.528 | 841,285,632 | 505,688,226 |
| Native exact 500 MiB | 722.431 | 1,351.401 | 1,145,618,432 | 813,420,415 |
| MOV/HEVC, 20 seconds | 73.754 | 135.912 | 401,711,104 | 37,829,851 |
| Silent 4K, 10 seconds | 58.614 | 106.728 | 551,325,696 | 112,697,522 |

CPU approached two fully utilized cores. No observed OOM or disk exhaustion. Queue wait is **not** included in job wall time. Exact-500 total elapsed was 1,548.400 seconds: about 403.646 seconds through upload completion, queue wait, then 718.346 seconds worker time and final checks/publication. A single long job delays later jobs; this is a measured capacity limitation, not a playback startup regression.

## D. Real AWS upload matrix

The six size classes below used the **existing Web upload engine in Node**, real HTTPS S3 PUT bodies, real APIs, actual worker and CloudFront. This is NOT a claim that each size was executed in a browser or on Android. Every accepted source byte was counted; at most two part PUTs were in flight per engine. A controlled lost application acknowledgement after two real S3 successes forced draft reload/ListParts reconciliation. Accepted parts were not re-uploaded. Publication repeated with the same client key returned the same canonical post ID.

| Platform / source | Actual source bytes | Parts | S3 PUT window sec | Upload completion sec | Processing / playback |
| --- | ---: | ---: | ---: | ---: | --- |
| Node/Web engine, 10 class | 9,892,321 | 2 | 14.281 | 17.887 | READY; HLS/segment 200, MP4 range 206, unsigned 403 |
| Node/Web engine, 50 class | 52,086,658 | 7 | 53.110 | 55.562 | Same checks PASS |
| Node/Web engine, 100 class | 103,883,820 | 13 | 65.633 | 68.003 | Same checks PASS |
| Node/Web engine, 200 class | 207,742,629 | 25 | 248.809 | 251.203 | Same checks PASS |
| Node/Web engine, 300 class | 312,746,573 | 38 | 278.925 | 281.223 | Same checks PASS; total elapsed 1,844.590 sec includes queue |
| Node/Web engine, **exact 500 MiB** | **524,288,000** | **63** | **401.043** | **403.646** | Same checks PASS; S3 HEAD confirms exact object length/session binding |
| Desktop Chrome, 50 class | 52,086,658 | 7 | UI execution, not Node timing | Complete | Paused twice, reload/reselect/recovery, READY, one post `2137250afc5ae04581e1dfd5` |
| Physical Samsung Chrome, synthetic 10 class | 9,892,321 | 2 | Not instrumented separately | Complete | READY, one post `d2d58068226f7dd8f5911d8b`; transfer finished before mid-transfer pause could be captured |
| Samsung native QA, real recording | 235,705,228 | 29 | Not instrumented separately | Complete | READY, post `c0baee7840a03ba02ff96a81`; force-stop/draft restore during processing; native playback observed |
| Samsung native QA, 100 class | 103,883,820 | 13 | Not separately timed | 202.911 from session creation, includes pauses | READY after worker recovery, post `eeb49584cf47d48532c72539`, publication count 1; accepted part retained after force-stop |
| Samsung native QA, 300 class | 312,746,573 | 38 | Not separately timed | 238.002 from session creation, includes interruption | READY, post `bbf874cd3540dcdd4062f1c4`, publication count 1; all 15 accepted parts reused after network loss |
| Samsung native QA, **exact 500 MiB** | **524,288,000** | **63** | Not separately timed | **353.882 from session creation** | READY, post `9ae4902338d290b9cf2e7fff`, publication count 1; exact S3 HEAD/session metadata; native Clips playback observed |
| Node/Web engine, MOV/HEVC | 9,347,335 | 2 | 14.643 | 18.380 | READY, HLS/MP4/range/security checks PASS; post `61d8a07c3b96d523d82aaabc` |
| Node/Web engine, silent 4K | 97,163,045 | 12 | 104.100 | 106.438 | READY, HLS/MP4/range/security checks PASS; post `192d4517c810c86ade539335` |

Nominal classes are labelled honestly; they are not all exact binary boundaries. Exact 500 fixture contains **523,048,867 bytes of genuinely encoded 180-second high-motion/noise H.264/AAC media**, plus a disclosed 1,239,133-byte valid `free` atom solely to hit the exact boundary. It is NOT the previous two-second padded performance fixture. Source +1 byte was rejected with `400 VIDEO_SIZE_LIMIT`; an exact-size declared session was separately created/cancelled before the actual complete 500 MiB transfer.

MOV/HEVC and silent 4K completed through real AWS processing and delivery. Generated fixtures are synthetic, not labelled camera, low-light or gaming footage. The separate user-provided screen recording is identified as such, not as camera footage. Native timings start at session creation and are not directly comparable to instrumented Node PUT windows. Evidence: `final-upload-output-matrix.json`, `android-500-source-head.json`, `cleanup-fix-aws-evidence.json`.

Instrumented Node/Web-engine runs across these eight sources recorded **162 successful S3 part PUTs / 1,317,150,381 acknowledged source bytes**, peak concurrency 2 and two reused accepted parts per restored session (`node-web-transfer-counters.json`). These are part-transfer counters, **not** a complete count of every S3 ListParts/HEAD/completion/CDN request. The Node interruption was deliberately lost application acknowledgement after S3 success, not an actual network outage; the physical native 300-class run provides the separate real network-loss evidence. Native failed-PUT retry counts were not independently instrumented and are not invented from worker attempt counts.

## E. Compression results

Actual S3 inventory, not estimated compressed sizes. HLS bytes below sum **all variants**, not one viewer's download:

| Source bytes | Duration | HLS bytes, all variants | MP4 fallback bytes | Thumbnail bytes |
| ---: | ---: | ---: | ---: | ---: |
| 9,892,321 | 30 sec | 18,021,554 | 9,596,378 | 52,023 |
| 52,086,658 | 30 sec | 38,884,236 | 9,603,125 | 20,627 |
| 103,883,820 | 60 sec | 77,533,972 | 19,009,237 | 62,944 |
| 207,742,629 | 120 sec | 154,979,861 | 37,759,853 | 20,627 |
| 312,746,573 | 120 sec | 155,051,846 | 37,783,806 | 107,709 |
| 524,288,000 | 180 sec | 232,540,423 | 56,572,455 | 20,912 |
| Samsung 235,705,228 | 102.576 sec | 119,865,312 | 25,450,279 | 101,287 |
| Native 103,883,820 | 60 sec | 77,706,359 | 19,011,940 | 62,944 |
| Native 312,746,573 | 120 sec | 155,115,111 | 37,783,121 | 107,709 |
| Native 524,288,000 | 180 sec | 232,604,173 | 56,572,796 | 20,912 |
| MOV/HEVC 9,347,335 | 20 sec | 21,982,855 | 6,482,785 | 16,876 |
| Silent 4K 97,163,045 | 10 sec | 12,337,287 | 3,182,261 | 14,929 |

Processing times and sampled resources are in C. These are actual active-prefix S3 totals, including HLS manifests/init objects, so small differences from the persisted encoder-only `outputBytes.hls` values are expected. `final-upload-output-matrix.json` retains per-session byte counts. The 10-class synthetic was later intentionally deleted to verify privacy/deletion cleanup; its pre-deletion sizes are retained above.

All applicable 360/540/720/1080 variants were generated, with no source upscaling in the encoder checks. Aggregate HLS bytes were preserved; a complete per-rendition byte-size export for every source was **not** retained before approved teardown. Do not infer exact rendition sizes from nominal bitrate settings. Add that export to the next approved capacity run.

The exact-500 MP4 is about **10.8% of source size**, not a guarantee for other inputs. Some small/highly compressed sources require more storage after a multi-variant ladder. Originals are retained (`SOURCE_RETENTION_DAYS=0`) but are not the new pipeline's normal playback URLs.

Local encoder tests additionally covered portrait 1080p, square, 4K, HEVC MOV, silent 720p, 300-second video and jittered VFR, with full output decode, dimensions/aspect, no upscaling and MP4 fast-start checks. They ran on the Mac, NOT Fargate capacity tests. Actual Samsung recording: H.264, 1080×2340, VFR average ≈59.06 fps, **no audio stream**. Its nominal `r_frame_rate=90000` prompted bounded tests, but both existing and capped variants completed normally; no runaway-FPS bug was reproduced and no encoder FPS policy was changed. Subjective quality, HDR/low-light camera footage and perceptual lip-sync remain unverified.

## F. Web testing

Actual desktop Chrome selected a real 52,086,658-byte file using the native picker. Byte progress paused at about 5.5 MiB, resumed, paused at 42.6 MiB, survived reload, restored caption/session, required reselecting the original file, resumed and published once. Extension `setFiles` was blocked by Chrome's file-URL permission; the ordinary native picker worked without weakening browser settings.

Physical Samsung Chrome used `adb reverse` for `http://localhost:3001`, synthetic stage owner only, and actually transferred the selected 30-second 9,892,321-byte file. It reached READY and published. No personal file was selected in this check. This small transfer completed too quickly to verify a mid-transfer Mobile Web pause; native Android pause is separate evidence, not a substitute.

A follow-up Mobile Web 100-class selection attempt was interrupted by Chrome pull-to-refresh before a transfer/session was established; it is NOT counted as another successful upload or as proof of a product draft-loss defect. Physical Chrome subsequently played the exact-500 derivative in Clips; redacted API logs show successful master and 360/540/720/1080 playlists, and observed frames advanced (`mobileweb-500-hls-request-evidence.json`).

Light-theme upload guidance was genuinely white-on-light due to inherited text color. `PostVideoUploadStatus.tsx` now uses the existing theme and explicit readable slate colors; three focused status tests cover light/dark, byte progress/actions and processing-vs-transfer state. Physical light-theme screenshot verifies readable text. A browser viewport override did not actually change the observed 1506px layout; it is **not counted as a successful 390px browser test**. Physical narrow Chrome execution is the real mobile layout evidence. Safari/WebKit not executed.

## G. Android

Device: connected **SM-S928B / RZCXA1QHPYA**. A separate APK `com.arcSquadHunt.videostagingqa` was built/installed; production `com.arcSquadHunt` and other existing app installations/data were preserved. Metro 8085 and generated QA configuration point only to stage API; no production tokens reused.

The real recording fully uploaded before force-stop, so that first test proved **processing/draft recovery**, not interrupted transfer recovery. The later 100 MiB-class test really paused after S3 part 1 (8,388,608 bytes), force-stopped QA, relaunched, restored its media draft and resumed the same session. S3 part 1's ETag **and LastModified** were unchanged as later parts arrived. App backgrounding paused at 88 MiB and foreground retry resumed. The 300 MiB-class network test removed cellular connectivity for ~15 seconds (Wi-Fi already off), surfaced a recoverable DNS/upload error, restored mobile data to 1 and retried; all 15 previously accepted S3 parts retained ETag/LastModified. This is safe recovery, **not continuous background transfer**.

All three native sizes reached READY and each has exactly one published canonical post (D). The exact-500 source HEAD confirmed 524,288,000 bytes, 63 parts and matching upload-session metadata. Native Clips playback of its processed landscape video advanced from 0:00 to about 1:00 with correct letterboxing; synthetic screenshots `android-500-clips.png` and `android-500-clips-later.png` preserve evidence. Native post-detail playback of the processed real recording was also observed with correct portrait aspect; its lack of sound is expected because the input has no audio stream. AAC metadata/decoding on synthetic inputs is not a physical audible audio or lip-sync verification. Device-lock and Wi-Fi/cellular handover tests were not executed. A Samsung system-update prompt was dismissed without installation or scheduling.

## H. iOS

Swift native part-copy syntax parsing and mobile TypeScript checks passed. Xcode 26.6 (`17F113`) is present at `/Applications/Xcode.app`; with per-command `DEVELOPER_DIR`, the actual `ios/SquadHunt.xcworkspace` / scheme `SquadHunt` reports **iOS 26.5 platform not installed** and no compatible available simulator/device. No physical iPhone was attached. No large runtime download or global machine-setting change was performed.

**Native compilation, simulator execution, upload/file-access/permissions, recovery and iOS playback NOT VERIFIED.** TypeScript or Swift parsing is not an iOS build.

## I. Private delivery

Real AWS checks passed: unsigned playback 403; expired signed playback 403; signed MP4 range 206 / exactly 1,024 bytes; signed thumbnail 200; unsigned S3 source 403; even a signed CloudFront source-prefix URL 403. Valid HLS master, variant and segment return 200. API manifests are private/no-store; allowlisted local origin receives correct CORS. Disallowed production origin lacks ACAO; its HTTP 206 is **not** an authorization-denial test, because CORS is a browser restriction.

HLS child initialization and media segments each returned signed 200 / unsigned 403 with allowlisted `localhost:3001` CORS (`hls-child-authorization-evidence.json`). The earlier standalone control-object test used allowlisted `localhost:3000`; later browser/API tests used 3001. Both are intentional local staging origins, not production DNS changes.

Real API privacy cases: public anonymous detail 200; followers-only non-follower 403; accepted follower 200; private owner 200, follower 403; blocked viewer 403. After privacy changed, an already-issued viewer **manifest** returned 403. Deleted synthetic post detail returned 404, old manifest 403. Owner-scoped session read/list/sign/cancel from another account each returned 404.

**Known production blocker:** an already-issued signed MP4 still returned 206 after the privacy change. Actual grants can remain valid ~45–60 minutes. This confirms the documented bearer-grant window, not immediate revocation. Decide explicitly between accepting that maximum, tested 5-minute renewable grants, or stronger edge/session revocation. No policy was silently weakened or changed. Full long-playback grant renewal remains untested.

## J. Cleanup

Real incomplete completion returned 409, cancel returned 200/CANCELLED, later part access 410; AWS confirmed zero remaining multipart uploads/objects for the cancelled session. Repeated actual maintenance cleanup was idempotent.

Deleted-post test first verified its media survived the real grace. Only the already-deleted synthetic fixture's `updatedAt` was then advanced to 25 hours ago; real maintenance removed source and derivatives. Repeating maintenance preserved cleanup timestamps and did not remove the active exact-500 source. This is an **accelerated fixture-clock test**, not 24 hours of elapsed wall-clock observation. Evidence: `deleted-grace-cleanup-evidence.json`.

An expired synthetic session was given a past fixture expiry; real maintenance changed it to EXPIRED, removed its source/parts and was idempotent (`expired-cleanup-evidence.json`). This accelerated expiry is not a 24-hour wall-clock test. Account deletion, hard-delete tombstone/shared-reference and some cleanup-failure combinations have local integration coverage but were not all repeated against AWS.

**Verified retry-orphan defect and fix:** killing attempt 1 left 59 partial derivative objects after attempt 2 reached READY. `cleanupSupersededOutputs` now deletes only owner/session-scoped obsolete attempt prefixes, never the active winning prefix/source; successful removal is recorded with a guarded READY/current-prefix update. Failed deletions remain retryable, and bounded maintenance revisits them. Actual new-image maintenance removed all 59 objects, preserved the current MP4 ETag and original source, and a repeat was idempotent (`cleanup-fix-aws-evidence.json`). Local integration coverage includes a failed deletion followed by successful retry and rejects out-of-scope prefixes. No active-original retention policy changed.

Approved teardown is recorded in `cleanup-events.jsonl` and the final cleanup evidence below. Stateful resources use Retain, so explicit deletion is required in addition to stack removal. Only manifest/tag/account-verified staging resources are targeted; the shared AWS service-linked role is left alone. The AWS cleanup skill informed ownership checks and dependency ordering, not an account-wide cleanup.

Cleanup already verified: all staging tasks stopped; both distributions disabled; **2,281 approved object versions permanently removed**, including the personal recording's staging source/derivatives; empty staging bucket and stage-only ECR deleted; three stage log groups removed; three stage secrets scheduled for deletion with a **7-day recovery window**; stage SNS topic removed. The temporary staging QA app was uninstalled and four generated phone fixtures (10/100/300/exact-500 classes) removed, totaling 950,810,714 bytes. Production app plus pre-existing chat/video QA apps remain installed. The original recording on the phone was not selected for deletion. Vite/Metro stopped, task-created desktop tabs closed, and 3001/8085 ADB reverse mappings removed. Database/network final status is recorded at completion below.

Local cleanup also removed the 186,515,456-byte partial download of the staging recording and six generated sign-in/private-key files. These generated credentials/copies are not recoverable locally; the original phone recording is untouched. The durable bundle retains only reviewed synthetic screenshots, not images of that personal recording.

**Final network exception resolved after separate explicit approval:** the five application/data/media/build/worker stacks deleted successfully, but the empty VPC was blocked by unused `CloudFront-VPCOrigins-Service-SG` (`sg-0cae9926bc18f82ae`). AWS describes this group as service-managed and advises against edits ([AWS guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)), so no manual attempt was made until the user specifically approved this irreversible orphan deletion. Fresh checks confirmed account/region, staging VPC tags, exact group name/ownership, zero VPC origins, zero network interfaces and zero incoming/outgoing SG references. The permission dry-run returned `DryRunOperation`; the exact-group deletion then returned `Return:true`, and a subsequent describe found no group. CloudFormation completed the already-approved VPC deletion without force/retain overrides. **All six stacks are now DELETE_COMPLETE; VPC `vpc-0056c433f8f6295e8` is absent.** No production group or shared service-linked role was deleted or modified.

The earlier **2026-10-20 01:57:28 UTC** receipt is preserved as [pre-approval evidence](evidence/post-video-staging-2026-10-20/pre-orphan-approval-cleanup-receipt.json): full cleanup was correctly false at that point, and the verifier exited 2. The updated [AWS resource/production receipt](evidence/post-video-staging-2026-10-20/final-cleanup-receipt.json) and [approved cleanup actions](evidence/post-video-staging-2026-10-20/cleanup-actions.json) record the post-approval result. The shared `AWSServiceRoleForCloudFrontVPCOrigin` remains intact; three staging secret deletion markers remain within their configured seven-day recovery windows. Those deliberate exceptions are not running staging services. No ongoing agent monitoring is promised after handoff.

**Final verification PASS (receipt started 2026-10-20 02:04:24 UTC / 07:34 India):** all six stacks DELETE_COMPLETE; no remaining staging distributions/origins, DocDB instances/clusters/snapshots, Redis, S3 bucket, ECR/build project, active task definitions/ECS cluster, VPC/ENIs/security groups, NAT/EIP, load balancers, log groups, task roles or alarm topic. `computeDatabaseStorageAndNatRemoved=true`, `disposableResourcesRemoved=true`, `productionUnchangedAndHealthy=true`; verifier exit **0**. Production remains task definition **205** and the same immutable image, desired/running **1**, pending **0**, rollout COMPLETED, ALB healthy, `/health` **200**, uploads **false**, HLS **true**, embedded HLS worker **true**, private delivery **false**, source retention **0**, deployment mode **compatibility**. No production mutations or additional code/dependency changes were needed to resolve this cleanup exception.

## K. Playback

Real desktop post-detail initially verified the optimized MP4 at 1280×720 with advancing time/no media error. Clips exposed a real issue: this Chrome build advertises native HLS but returns native media error 4. Existing code jumped directly to MP4. A focused fix in **both existing Feed and Clips components** now retries the already-installed HLS.js MSE engine after native HLS fails, then preserves the existing bounded MP4 fallback if MSE is unavailable/fails. Healthy native HLS still avoids loading a second engine. No preload scheduler, ranking, rendering architecture or codec ladder redesign.

Retest: actual exact-500 Clips video advanced through HLS/MSE at **1920×1080**, duration 180 sec, readyState 4, no media error; actual Home Feed played the portrait recording through HLS/MSE at 540×1170 with advancing time. Inactive feed entries did not all attach video elements. Two focused native-failure recovery/cleanup tests were added; existing progressive/native-HLS/stale-import/buffer contracts remain passing. Browser diagnostics log error categories only, never signed URLs.

Physical Android Chrome's fresh exact-500 Clips retest passed through HLS with successful quality-playlist requests and advancing frames; native QA also played its own exact-500 derivative (G). There is no controlled before/after startup latency benchmark in this run. Do not claim a measured startup speed improvement/regression, zero console errors across HMR, or a fix to the previously resolved 3–5-second issue. HMR dependency-array warnings occurred during code editing; fresh reload was used for runtime verification. Safari/native iOS playback and exhaustive request-volume/preload timing measurements remain unexecuted.

## L. Recommendations

No ranking/exposure code changed. Local discovery/recommendation, media-integrity, privacy, authentication/onboarding, Random Connect and notification-producer suites passed. Actual stage viewer meaningful exposure (2 seconds) was accepted; the same canonical post was absent from **two fresh Feed sessions and two fresh Clips sessions** afterward. Initial no-exposure baseline was zero before UI viewing. No stage history was reset to manufacture the result. Unready publication returned 409; only READY sessions published.

Manual production calls, follow/unfollow, Random Connect audio/video and all legacy media surfaces were not re-created in production; regression suites and the feature-disabled HTTP compatibility smoke are the evidence, not a claim of complete live-production testing.

## M. Security and defects fixed

See `POST_VIDEO_500MIB_STAGING_SECURITY_REVIEW.md` for the 17 production dependency entries (6 moderate, 10 high, 1 critical) and prioritized patch/test plan. No blanket `npm audit fix --force` or unrelated dependency update. Numeric `TRUST_PROXY_HOPS` 1–2 does not establish the specific mapped-IPv6 CIDR-policy trigger of GHSA-jqcg-44mw-7w3h; patch is still recommended, and ingress/XFF rate-limit verification remains required.

Verified logging defect: Morgan combined format included the new manifest bearer token in query strings. `src/infrastructure/security/accessLog.ts` now strips query/fragment values from URL/referrer and control characters, without mutating requests or hiding genuine errors. Two tests passed and actual stage API revision 3 access logs showed redaction. Earlier disposable stage logs contain test grants and must be removed during cleanup. This formatter is not a claim that every Morgan advisory is resolved.

Fixture defects corrected without weakening auth: blocked/private seed usernames initially exceeded the real 20-character limit; they were changed to `stage_video_blocked` / `stage_video_private`. The sign-in fixture error was not fixed by resetting a production password. A suspected VFR encoder runaway was **not reproduced**; no speculative FPS change.

Focused corrections and retests:

| Verified problem | Minimal correction | Evidence |
| --- | --- | --- |
| Generated CloudFront staging origins must not be accepted merely because a secret labels them staging | Independent exact task-origin bindings and fail-closed runtime isolation | Runtime-isolation tests and real isolated task startup |
| Stage worker observation ended before an async processor settled; stage metrics needed isolation | Await the processor through `finally`; bounded stage-only sampler, explicit health port and per-stack metrics | Sampler/contracts and measured real FFmpeg jobs |
| White inherited upload guidance on light theme | Existing theme-aware readable colors only | Three status tests and actual composer observation |
| Native HLS false-positive support followed by media error 4 | Existing HLS.js MSE recovery before existing MP4 fallback | Focused player tests plus actual desktop/physical Chrome HLS playback |
| Manifest bearer query appeared in access logs | Strip URL/referrer queries and control characters in formatter, retain actual request/auth state | Two tests and real API revision-3 redacted logs |
| Interrupted processing left obsolete output objects after successful retry | Guarded owner/session-only obsolete-prefix cleanup, durable retryable maintenance | New integration test and actual 59-object cleanup with live source/output preserved |

## N. Cost and capacity

Current regional unit pricing and assumptions are recorded in the approval plan. Fixed running baseline ≈**$0.292145/hour**, ≈$3.51 for the approved full 12 hours, before requests/I/O/data/build/logs. Continuously running infrastructure would be ≈$214.47/month baseline, planning $225–250 at light usage. The approved bounded window estimate was $5–10 with a $25 ceiling; actual invoice attribution is NOT verified and AWS billing lags.

Exact-500 processing compute alone: `718.346 / 3600 × $0.10096 ≈ $0.0201`, excluding queue idle time, source/derivative storage, upload/CDN requests and delivery. Retained originals accumulate: a 500 MiB source for a full month is about $0.0112 at the quoted S3 rate, plus its derivatives. HLS aggregate storage is not per-view transfer; measured 56.57 MB fallback avoids normal playback of the 524.29 MB source. CDN geography/request costs still matter.

The 2-vCPU worker was CPU-bound in these samples; measured ~12-minute exact-500 job implies roughly five such jobs/hour **for this workload**, not an SLA. One worker's queue already produced multi-minute waits. Keep one job/container and two FFmpeg threads initially; do not raise concurrency from a single successful test. Recommend a test-account canary, one active large upload/account initially, two 8 MiB client parts, queue-age/backlog admission controls, and an initial **180-second duration cap proposal** until longer real AWS capacity is measured (current configurable default is 3,600 seconds; no cap was changed here). Autoscaling beyond one worker needs multi-worker lease/failure/load tests first. Suggested alert: queue age >10 minutes / waiting >2; admission threshold needs product approval, not a silent new limit.

The new bounded superseded-prefix maintenance query also needs realistic production-scale query-plan/index profiling before broad enablement; successful execution on this small real DocumentDB database is not a large-dataset performance result. No extra production index was silently introduced.

CloudWatch one-minute observed maximums during the run: API CPU 74.95%, API memory 12.84% of 1 GiB; worker CPU 99.01%. These include startup and are not exact process peaks. Worker cgroup samples above include FFmpeg children and better bound actual job memory. API source data went directly to S3, not through the backend; no actual 500 MiB API body was buffered.

## O. Files modified and checks

Backend tracked: `src/app.ts`; `src/config/runtimeIsolation.ts` and `.test.ts`; `src/clip-worker.ts`; `infra/post-video-worker.yaml`; `src/legacy-src/services/videoUploadService.js` and `videoPostPublication.integration.test.js`.

Backend added:

* `src/infrastructure/security/accessLog.ts`, `accessLog.test.ts`.
* `src/infrastructure/jobs/videoWorkerResourceSample.ts`, `videoWorkerResourceSample.test.ts`.
* `infra/post-video-staging-{network,data,media,api,build}.yaml`.
* `scripts/validate-post-video-documentdb.mjs`, `validate-post-video-aws.mts`, `validate-post-video-staging-privacy.mjs`, `validate-post-video-staging-controls.mjs`.
* `scripts/post-video-staging-preparation.test.js`, `benchmark-post-video-local.js`, `generate-post-video-staging-fixtures.js`, `serve-post-video-fixture.js`.
* This report, `POST_VIDEO_500MIB_STAGING_APPROVAL_PLAN.md`, `POST_VIDEO_500MIB_STAGING_SECURITY_REVIEW.md`.

Frontend: `src/features/post-upload/PostVideoUploadStatus.tsx` plus new `src/features/post-upload/PostVideoUploadStatus.test.tsx`; `src/features/post-upload/FeedAdaptiveVideo.tsx` and `src/features/post-upload/FeedAdaptiveVideo.test.tsx`; `src/features/clips/AdaptiveClipVideo.tsx` and `src/features/clips/AdaptiveClipVideo.test.tsx`.

Generated reviewed evidence files are listed in `docs/evidence/post-video-staging-2026-10-20/README.md`; they are test artifacts, not application runtime source.

No mobile source/dependency edits were made in this staging turn; existing mobile dirty worktree preserved. QA build used build-time stage endpoint and application-ID suffix. Generated private manifests/credentials/images/screenshots remain outside source repositories. No production deployment, migration, commit or push.

Executed checks:

| Check | Result |
| --- | --- |
| Node 22 backend build + compiled import gate + typecheck | PASS, rerun after superseded-output cleanup correction |
| `test:video-deployment-safety` | **26 passed**, no skipped tests in final rerun; local migration test is not substituted for real DocDB evidence |
| Runtime isolation/sampler/access logger focused set | 14 passed |
| Stage template contracts + disabled-feature compiled HTTP smoke | 6 passed; smoke used local isolated DB/Redis and stubbed AWS, real legacy HTTP upload/HLS |
| Upload/publication integration + staging contract | Latest **17 passed** (5 upload-service, 7 publication/cleanup, 5 staging contracts); all 12 service/publication tests also passed separately |
| Existing HLS suite | 25 passed |
| Media integrity | 12 + 7 passed |
| Discovery/privacy/auth/recommendation/Random Connect/producer chains | Executed successfully; some are assertion scripts, so no invented aggregate count |
| Mobile privacy / call-signaling / upload suites | 42 / 24 / 18 passed; TypeScript passed |
| Android debug build/install | PASS on separate staging QA identifier |
| Web focused latest playback/status/contracts | **30 passed** |
| Web upload/hook/store tests | Passed earlier in this run |
| Web production build | PASS after HLS recovery fix; existing bundle-size/Browserslist warnings remain |
| `git diff --check` | PASS for backend/frontend at latest check |
| iOS native build/runtime | BLOCKED, missing iOS 26.5 platform/destination |

Reproducible focused checks from the backend directory, using Node 22 and the existing installed development dependencies:

```sh
npm run build
npm run typecheck
npm run test:video-deployment-safety
node --test src/legacy-src/services/videoUploadService.test.js src/legacy-src/services/videoPostPublication.integration.test.js scripts/post-video-staging-preparation.test.js
```

The last command passed **17/17 with no skips** in the final rerun; deployment safety passed **10 + 16 = 26**, also no skips. Re-running real-AWS scripts requires a newly approved isolated staging environment; the recorded staging endpoints are intentionally torn down, not permanent testing services.

## P. Approvals and remaining activation sequence

No new production approval is implied by staging success. Before activation:

1. Review completed staging evidence and explicitly close remaining platform/chaos/quality gaps; resolve or explicitly accept iOS as a rollout exclusion. Outstanding cases include real camera/gaming/low-light quality and lip-sync, device lock/network handover, expired presigned PUT URL rotation, long-playback grant refresh and multi-worker load/failure behavior. A DB-server reboot/failover was not performed.
2. Choose and approve media-grant revocation policy; implement/test refresh or stronger revocation if required. Review reachable dependency findings separately.
3. Review/commit tested source; build identifiable immutable production candidate and preserve rollback image/flags.
4. Separately approve and verify additive production DocumentDB indexes; no production video migration is currently run.
5. Deploy compatible dedicated production worker, validate health/queue consumption before disabling embedded legacy HLS processing. Never disable the old consumer first.
6. Merge approved S3 CORS/IAM/source denial/lifecycle and private CloudFront settings into actual production configuration without overwriting unrelated policies. Verify signed/unsigned/child-manifest/range/CORS and privacy cases there.
7. Ship compatible reviewed Web/native clients; canary only authorized test accounts, capacity limits/alerts, rollback and retention approval in place.
8. Explicitly authorize production enablement; gradually widen only after measured canary results. Rollback stops new sessions first and preserves durable uploads/posts/exposure. Existing processing must remain serviced by a compatible consumer.

The separate staging-only orphaned-group deletion approval was received and executed only for `sg-0cae9926bc18f82ae` after fresh dependency/ownership checks. The empty VPC and final stack then deleted successfully. No further staging cleanup approval is outstanding. This narrow approval does not authorize production activation, production resource changes, removal of the shared service-linked role or changes to other security groups.

No retention deletion or one-hour privacy-policy acceptance has been approved for production. Source retention remains 0. Missing iOS runtime installation requires its own permission. Cleanup within the existing staging approval is required; extending the window/budget requires a new approval.

## Q. Production readiness

**NOT READY.** Real AWS upload/processing up to exact 500 MiB, actual DocumentDB compatibility, worker restart recovery/duplicate safety, private-origin controls, optimized fallback, browser HLS recovery and Android 100/300/exact-500 transfers/publication are established. This is no longer only a simulated-upload result. However, the unresolved bearer-grant revocation policy, iOS native/runtime blocker, remaining chaos/quality/capacity cases and separate production-infrastructure approvals prevent activation. Production revision 205 remains the healthy compatibility-mode release; do not redeploy it or enable uploads merely because this staging run succeeded.
