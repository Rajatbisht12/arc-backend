# iOS and Safari 500 MiB validation

21 October 2026, Asia/Kolkata. The approved iOS Simulator/Safari staging run and
scoped resource cleanup are complete. **Production activation remains NOT READY.**
This document supersedes
the chronological checkpoints in `POST_VIDEO_500MIB_IOS_SAFARI_VALIDATION_REPORT.md`.

## Outcome

- Xcode setup is resolved and the actual full iOS workspace builds successfully.
- Native iOS Simulator uploads to real AWS S3 passed at exactly **524,288,000
  bytes**, with accepted-part reuse after update, backgrounding, force-stop and
  an actual network timeout. This is not a TypeScript-only or local-emulation claim.
- Unedited HEVC MOV and an actual AVFoundation B&W edited export uploaded,
  processed and published. The extra-byte boundary was rejected in the picker.
- Safari blank-page and native-HLS blockers were reproduced and corrected.
  Desktop Safari Feed exceeded ten minutes; Clips exceeded 27 minutes with
  renewable five-minute grants. Simulator Mobile Safari Feed and Clips both
  exceeded ten minutes; actual privacy denial removed the source and poster.
- Production `arc-backend:205`, image
  `sha256:cbd57c9f550b8143f9d05046d878d56e9b9f0ca68c9b6799e0250dc40ac73d55`,
  remains healthy and unchanged. No production deployment or migration occurred.

## Xcode and native build

The SDK existed but no runtime was initially installed, and the separately
downloaded runtime did not satisfy Xcode's managed platform/asset compiler.
The user-approved Xcode-managed **iOS 26.5.1 + iOS 26.5 Simulator** package
resolved destination discovery and `actool` compatibility. No Xcode reinstall,
global `xcode-select` change, SDK patch or developer-data deletion was needed.

Environment: Xcode **26.6 / 17F113**, Simulator SDK build **23F81a**,
standalone Node **22.23.3**. Selected iPhone 17 Pro
`6F05DFB4-2DD8-464F-A464-158BE955F8B3` actually executes iOS **26.5 / 23F73**.
Build 23F77 is also installed; it was not falsely reported as the executed runtime.
The original `/Library/Developer/CommandLineTools` selection is preserved; builds
use an explicit `DEVELOPER_DIR`.

Equal old Pod/Manifest lockfiles initially hid missing ExpoMediaLibrary native
registration. `pod install --no-repo-update` synchronized already-declared native
dependencies, preserving all **201** existing Pod/subspec versions. No unrelated
library upgrade or npm install was used. Generated `ios/` metadata is ignored
by this mobile repository. `.xcode.env.local` was restored after the temporary
Node override.

The full workspace's **unsigned Simulator Debug configuration** rebuilt after
the Swift cache correction:
**BUILD SUCCEEDED / exit 0**, including real arm64 Swift compilation of
`ArcMediaEditorModule.swift`. Build-log SHA-256:
`52433cc792c7f0e80b030e4b4f03a0ba36d6e4d02781897dd2a11188fe41068f`.
The app installed, launched, authenticated to isolated staging and executed
native file copying/transfers. Expo iOS export/Hermes bundling also passed.

## Actual native upload matrix

All media below is generated synthetic media; no production account/post or
personal phone file was used in this round.

| Input | Actual bytes / parts | Result | Session / published post |
| --- | --- | --- | --- |
| 30 s portrait H.264/AAC, 1080x1920 | 9,892,321 / 2 | READY, one post, native Feed/Safari playback | `6ad7e430690653b0d1853ef4` / `0aa4b3994972a30e57694d79` |
| 180 s landscape H.264/AAC, 1920x1080 | **524,288,000 / 63** | READY, one post, native Feed/Clips and Safari Clips playback | `6ad7e574690653b0d18543f9` / `d4e3bbfd39a25bd27d1a7386` |
| Same boundary plus one byte | **524,288,001** | Picker rejected `synthetic-500mib-plus-one.mp4`; no upload session created | None |
| 15 s portrait unedited `hvc1` HEVC/AAC MOV, 720x1280 | 4,008,598 / 1 | READY, one post, native Home visible | `6ad7f4b9690653b0d1858885` / `0bc10b2acacd4c891a6aab97` |
| Native B&W-filtered export of that MOV | 13,730,660 / 2 | Native H.264/AAC export, READY, one post, grayscale cover/UI visible | `6ad7f52e690653b0d1858b09` / `f0968ad53b51a4b941468699` |
| Disposable second boundary-source session | 16,777,216 accepted before cancellation | CANCELLED, multipart upload absent afterward, no post or processing attempt | `6ad7f591690653b0d1858d09` / None |

The exact-boundary source contains 523,048,867 encoded-container bytes plus a
1,239,133-byte trailing `free` atom solely to establish the boundary. It is a
three-minute source, not a two-second padded fixture. Completed S3 multipart ETag
`2aed85ead332748dc754eeb8b716656b-63` matches an independently calculated source
multipart checksum. This proves actual transferred source bytes, not just a
client-declared size. It does not substitute for natural iPhone camera/HDR footage.

### Recovery and bounded copying

- Actual Pause, Save and leave, background/foreground and cold launch retained
  the same upload session and verified S3 parts.
- Native rebuild/reinstall changed the data-container UUID. The saved source,
  cover and caption restored correctly after the owned-draft URI fix.
- S3 contained exactly **176 MiB** before/after a mid-transfer force-stop;
  every retained part ETag matched. Reopening reconciled and resumed.
- A genuine `NSURLErrorDomain -1001` at **208 MiB** retained accepted parts.
  Retry finished the same 500 MiB session and published once.
- Swift accepts at most 16 MiB per part and copies in **64 KiB** reads. The
  configured run uses 8 MiB parts (4 MiB final boundary part). Two-second app
  observation saw at most **one 8 MiB current-build cache part** and zero after
  pause/completion/cancellation. This is sampled, not allocation-instrumented proof.
- Five pre-fix `tmp` orphans totaling 35,058,145 bytes remain governed by the
  existing 24-hour cleanup; they were not misclassified as new-cache leakage.
- Continuous transfer while iOS is suspended is **not supported or claimed**.
  Durable source/draft plus server-accepted parts support safe return/resume.
- The elapsed boundary upload includes deliberate pauses, rebuild/reinstall,
  force-stop and timeout; it is not a clean throughput benchmark.

## Measured worker/output results

One staging worker only: 2 vCPU, 4 GiB memory, 40 GiB temporary storage,
one job at a time, two FFmpeg threads. Each completed job used one attempt.

| Source | Processing wall / CPU seconds | Peak sampled memory / scratch | MP4 fallback / HLS bytes |
| --- | --- | --- | --- |
| Small H.264 | 33.528 / 57.345 | 272,560,128 / 37,563,324 | 9,595,542 / 18,023,438 |
| Exact 500 MiB H.264 | **451.863 / 815.871** | **1,145,171,968 / 813,416,512** | **56,570,885 / 232,536,715** |
| HEVC MOV | 17.574 / 28.781 | 242,016,256 / 16,253,356 | 4,118,732 / 8,074,935 |
| Edited H.264 | 18.372 / 30.248 | 253,972,480 / 28,460,091 | 4,918,598 / 9,777,756 |

The boundary job has 452 one-second samples and a peak sampled core CPU of
201.24%. These are cgroup samples, **not true high-water marks or fleet capacity**.
Its 360p/540p/720p/1080p HLS dimensions preserve landscape aspect ratio; portrait
sources preserve portrait dimensions without upscaling. The small HEVC source's
universal H.264 fallback is slightly larger than its original; transcoding does
not guarantee every input becomes smaller. HLS byte totals cover all variants,
not the bytes a single viewer must download.

Actual generated MP4 objects were downloaded from only the new staging bucket
and inspected with FFprobe. Boundary fallback: **1280x720, H.264, yuv420p,
30 fps, AAC stereo/48 kHz, 180.01 s**. HEVC-input and edited fallbacks:
**720x1280, H.264/yuv420p/30 fps and AAC stereo/48 kHz**, 15.018 s.
All three have top-level `ftyp, moov, free, mdat`, verifying fast-start metadata
before media bytes. This is output-file inspection, not a claim of physically
heard audio or every browser's forced-error fallback UI.

## Confirmed bugs and focused fixes

| Root cause | Change / verification |
| --- | --- |
| Loopback HTTP CSP upgraded Safari development/preview subresources to unusable HTTPS | Local-only Vite response adjustment; production artifact/HTTPS/LAN/Vercel policy unchanged. Reproduced failing tests then 5/5 pass; real Desktop/Mobile Safari login renders in dev and local production preview. |
| An initial staging-only preview was built with an empty Google client ID and threw `Missing client_id` | Corrected that test build's environment to a non-empty QA placeholder. Password sign-in to staging passed; Google/OAuth sign-in was not exercised and no production Google configuration was changed. |
| Native HLS no-CORS request conflicted with API `CORP: same-origin` | Anonymous CORS only for renewable media; no server-header weakening or legacy request-mode change. New tests 2 red to 14/14 green, real Safari native HLS verified rather than fallback. |
| Foreground auth object refresh destroyed PostDetail's authorized paused player | Same-viewer request still revalidates but retains player; account/role/privacy changes still clear/block. Regression red to green; 13 auth tests include subsequent 403 removing retained media. Same actual Safari node/paused playhead survives renewal. |
| Native transfer callbacks omitted/coalesced progress | Confirmed part PUT emits committed byte progress; actual UI/S3 bytes advance. |
| Strict Mode effect replay left composer mounted guard false | Reset guard in setup; retain unmount safety. |
| Expo legacy deletion refused `tmp/file/..` permission scope | Part files moved to owned `Library/Caches/ArcUploadParts`; actual full Swift rebuild and runtime zero-part cleanup verified. |
| iOS update moved absolute draft paths to a new container | Rebase only current account/draft's durable files; reject remote/foreign/traversal paths, avoid RN HTTP-only URL parser. Actual update/cold restore passes. |
| Native NSError exposed full signed S3 URL and overflowed failure alert | Fixed credential-free retry text at transport boundary; cancellation stays a pause. Contract test added; the original timeout/recovery was real, but a second timeout on the patched alert was not deliberately forced. |

The diagnosing-bugs workflow led to reproduction/red tests before changes;
actual UI/AWS results then exposed additional lifecycle issues not visible in
compilation alone. Unrelated worktree changes were preserved; nothing committed
or pushed by this validation run.

## Safari, privacy and grants

Desktop Safari **27**, local staging-bound production build at
`http://localhost:3001`, actual isolated AWS API/media CloudFront distributions.
Simulator Mobile Safari is genuine iOS WebKit, not Chrome device emulation.

- Desktop Feed: **603.196 seconds / 307 samples**, native HLS, advancing frames,
  two five-minute grant rotations, no media error.
- Desktop Clips: **over 27 minutes / 828 samples**, same native HLS node,
  advancing/looping 180-second video, expiry rotated through eight distinct
  values, no sampled media error.
- Paused foreground retest: same node, exact **25.77036737561778 s** paused
  playhead preserved while hidden/returning and renewing. Inactive/out-of-view
  expiry clears source; returning to view renews and restores paused position.
- Simulator Mobile Safari Feed: **657.305 seconds / 338 samples**, native HLS,
  no sampled media error, four distinct grant expiries (three rotations).
  A DevTools-driven pause at **21.19026618081901 s** remained paused after the
  next real renewal at **21.1902671 s** (sub-microsecond media-time rounding),
  then playback resumed. This pause is a media-element lifecycle probe, not a
  claim that every native Safari control tap was successfully automated.
- Simulator Mobile Safari Clips: **643.276 seconds / 323 samples**, same native
  HLS node, two renewals/three grant expiries, no sampled media error, still
  playing at readyState 4. Actual media dimensions **1280x720**, duration 180 s.
  Native iOS Clips separately obtained real 200 renewals at 23:02:31 and
  23:06:31 UTC while video continued; its observation is not falsely reported as
  a physical iPhone or a ten-minute uninterrupted native-device test.
- Real root/variant/segment/thumbnail requests returned **200**; MP4 Range
  returned **206 / 1,024 bytes**. Unsigned MP4/source returned **403**;
  another user's upload session returned **404**.
- After actual captured expiry, **new** MP4 Range/segment/thumbnail requests
  returned **403**. Previously downloaded/in-flight bytes cannot be recalled.
- Server CORP/privacy and exact allowlisted CORS remained intact; renewal is
  private/no-store. Five-minute policy is bounded revocation, not instant recall.
- Source rotation can briefly show readyState 0 and rebuffer before saved
  position resumes. No zero-buffer-gap or audible-quality guarantee is made.

The owner changed only the small synthetic staging post to private at
**23:47:36.773Z**. Its owner still obtained signed root/variant/segment/thumbnail
200 and MP4 Range 206 at **23:48:22.582Z**. The non-owner Mobile Safari player's
scheduled renewal returned **403 at 23:50:02.755Z**. At **23:50:25.220Z** the
same sampled video was paused, readyState 0, with **src and poster attributes
both removed**. Its stale `currentSrc` string was not falsely described as
attached media. The synthetic post was restored to public and viewer renewal
returned 200 at **23:51:03.058Z**. No production content/privacy was changed.

Sanitized browser observations, server renewal statuses, S3 part/ETag snapshots,
output probes, worker samples and read-only DB publication records are exported
under `docs/evidence/post-video-ios-safari-2026-10-21/`. The run-provenance record
pins the reviewed dirty source archive and immutable staging image; it does not
claim those changes were committed. Staging origins were temporary and are
removed during cleanup, not permanent client verification URLs.

## Tests and limitations

- Backend Node-22 build, runtime imports/typecheck, renewal/publication **24/24**;
  staging preparation **6/6**. Six templates validated and genuinely provisioned.
- Mobile Node-22: upload/playback/grants/draft paths **27/27**, editor **34/34**,
  privacy **42/42**, call signaling **24/24**, full TypeScript PASS; full native
  workspace and Hermes export PASS.
- Web: full TypeScript and production build PASS; existing player/audio/preload
  **75/75**, expanded upload/player **50/50**, final ten-suite privacy/auth/call
  regression **83/83** (82/82 at its earlier checkpoint),
  final focused four suites **29/29**, final Suggestions **2/2**, PostDetail auth
  **13/13**, local CSP/security **5/5**. These suites overlap; do not sum them as
  unique tests. Two pre-existing privacy fixtures were corrected (theme mock and
  current accessible follow-request name), not product privacy behavior.
- Non-fatal jsdom canvas / React `act`, native build-script and unsigned Simulator
  push-entitlement warnings remain. One development-menu Reload triggered a
  Fabric scheduler `EXC_BAD_ACCESS`; cold launches work. This dev-only event has
  not been reproduced/fixed or claimed absent in a release-signed device build.
- No physical iPhone, release signing/TestFlight, real camera/HDR/rotation metadata
  matrix, hardware thermal/battery/audio assessment, low-storage execution or
  all supported iOS-version matrix was completed. Simulator success is not a
  claim of those capabilities.
- The large native source is H.264. The HEVC and edited-input checks use small
  15-second sources; large natural HEVC/HDR inputs are not covered by those passes.
- Do not reopen the previous 3–5-second Home/Clips issue or reset exposure data;
  those optimizations and ranking/no-repeat semantics were not changed.

## Files changed in this follow-up

Web:
`server/localHttpCsp.cjs`, `vite.config.ts`,
`scripts/local-http-csp.test.cjs`, `scripts/fixtures/safari-renewal.tsx`,
`scripts/validate-safari-local-renewal.mjs`,
`src/features/post-upload/FeedAdaptiveVideo.tsx` and its test,
`src/features/clips/AdaptiveClipVideo.tsx` and its test,
`src/pages/PostDetail.tsx`, `src/pages/PostDetail.auth.test.tsx`,
`src/pages/PublicUserProfile.privacy.test.tsx`, `src/pages/Suggestions.privacy.test.tsx`.

Mobile:
`modules/arc-media-editor/ios/ArcMediaEditorModule.swift`, `app/create-post.tsx`,
`src/features/post-editor/videoUploadEngine.ts`, `videoUpload.ts`,
`videoUpload.test.mts`, `postDrafts.ts`, `postDraftPaths.ts`,
`postDraftPaths.test.mts`, `PostCreation.contract.test.mjs`, `package.json`.
Generated Pod synchronization is local build state, not an unrelated library upgrade.

Backend product code was not modified in this follow-up. Documentation, scoped
staging helpers/evidence and the existing report cross-reference are updated.

## Production activation requirements

**Do not enable production 500 MiB uploads from these test results alone.**
The separate [production activation review](POST_VIDEO_500MIB_PRODUCTION_ACTIVATION_REVIEW.md)
records the subsequent read-only AWS inventory, canary gate, worker/network/IAM
proposals, alarm policy and ordered cutover. None is applied to production.
The staging iOS build, signed delivery and FFmpeg results close major validation
gaps, but production still needs a separately reviewed/approved dedicated-worker,
IAM/secret/storage/private-CloudFront topology and additive migration rollout,
capacity/queue/cost policy and monitored rollback plan. Review the new client fixes
and release artifacts; complete physical iPhone/release-specific checks as required
for the supported device matrix. Then request explicit controlled activation
approval. Production remains in compatibility mode with the embedded legacy worker:

```dotenv
POST_VIDEO_UPLOADS_ENABLED=false
CLIP_HLS_ENABLED=true
CLIP_HLS_WORKER_ENABLED=true
POST_VIDEO_PRIVATE_DELIVERY_ENABLED=false
POST_VIDEO_SOURCE_RETENTION_DAYS=0
VIDEO_DEPLOYMENT_MODE=compatibility
```

## Cleanup and final verification

Sanitized evidence was exported before teardown. **All six recorded round-3
stacks are DELETE_COMPLETE.** Independent AWS checks confirmed absence of the
staging bucket/ECR, DocumentDB instance/cluster, Redis, both CloudFront
distributions/VPC origin, ECS cluster, stage IAM roles/logs/topic, VPC/NAT/EIP
and all VPC interfaces. Stage task definitions are inactive; these historical
definitions and service/build/billing history are not falsely claimed erased.
The original shared CloudFront service-linked role is preserved by RoleId.

Only the new orphaned CloudFront group was removed, after zero owned origins/
distributions, zero group ENIs, zero references and a permission dry-run.
The guard first refused deletion while CloudFront was still `InProgress`, and
refused cluster deletion while a DB member remained; neither guard was bypassed.
DocumentDB's actual instance-deleted event was observed before cluster removal.

All **500** disposable source/output/build object versions were permanently
removed, then the empty bucket deleted. No personal media was used. Staging
secrets were scheduled with a **seven-day recovery window**, not force-erased.
The cleanup receipt records deletion markers without mistaking their timestamp
for an independently verified recovery-expiry timestamp. No production secret,
database, bucket, IAM policy, queue, CDN or DNS was changed.

The run started at **2026-10-20T21:22:07Z** and resource teardown completed well
before its **2026-10-21T03:22:07Z** deadline (under the six-hour allowance).
One worker and one CodeBuild execution were used. Retained CloudWatch counters
show **2,107,139,309 media bytes / 5,644,248 API bytes** downloaded; source objects
were 551,919,579 bytes and derivative objects 343,914,350 bytes before deletion,
below the respective 10 GiB bounds. Counters can lag, and the **final AWS invoice
is not available**; this is not a claim of an exact final bill or AWS-enforced
$15 cap. Detailed original approvals, provenance and receipts are retained.

See [the cleanup receipt](evidence/post-video-ios-safari-2026-10-21/round3-final-cleanup-receipt.json)
and [evidence manifest](evidence/post-video-ios-safari-2026-10-21/evidence-export-receipt.json).
Final read-only production checks confirm revision 205, its existing image,
one running/zero pending, healthy service and `/health` **200**, with all six
compatibility flags unchanged. **No production rollout occurred.**

Independent cleanup verification completed at **2026-10-21T00:29:59.588Z**.
All **34** exported evidence files passed their recorded SHA-256/length checks
and the credential/private-network pattern scan. After verification, the seven
obsolete generated local staging credential/private-key files were removed at
**00:31:04.360Z**; the cleanup receipt is included in that manifest. No production
credentials or personal files were touched. These local deletions are not
recoverable through AWS; the separate AWS secret recovery window remains as
documented above.

Actual UI cleanup completed: Desktop owner, Mobile Safari viewer and native QA
owner all signed out; only the owned Desktop test tab/inspectors were closed,
the original Safari Start Page preserved, and Mobile Safari left at about:blank.
Safari **Show features for web developers = 0** was verified after restoring it.
No remote automation or browser security bypass was enabled. Working runtimes,
the Simulator device and app/developer data were preserved. Only the owned Metro,
preview, evidence collector and diagnostic observer processes were stopped.
