# iOS Simulator and Safari validation — chronological working log

Current consolidated results and cleanup status are in
[the iOS/Safari report](POST_VIDEO_500MIB_IOS_SAFARI_FINAL_REPORT.md).
Earlier pending/blocked statements below are dated checkpoints, not the current
Xcode or native-upload verdict.

21 October 2026 (Asia/Kolkata). This is a running evidence report, not production
activation approval. Production 500 MiB uploads remain disabled.

## Live round-3 findings (follow-up)

- Actual iOS Simulator selection of a 30-second synthetic portrait H.264/AAC
  source completed authenticated native multipart transfer to the new staging
  S3 bucket. S3 recorded **9,892,321 bytes / two parts**, session
  `6ad7e430690653b0d1853ef4`. The authenticated session endpoint returned
  **READY**, with exactly one published post `0aa4b3994972a30e57694d79`.
  Its generated video is visible in the native Home Feed and actual desktop Safari.
- Actual selection of the three-minute, 1920x1080 synthetic boundary source
  created session `6ad7e574690653b0d18543f9`: **524,288,000 bytes, 63 parts,
  8 MiB full parts**. This is not a two-second padded fixture. Only 1,239,133
  trailing container bytes establish the exact boundary. Actual S3 completion,
  FFmpeg processing and publication subsequently passed. The completed object's
  63-part ETag matched the independently calculated source multipart checksum:
  `2aed85ead332748dc754eeb8b716656b-63`. Exactly one published post is
  `d4e3bbfd39a25bd27d1a7386`; it is visible in native Home Feed and playing
  as processed HLS in native Clips and Desktop Safari Clips.
- Real testing caught and fixed two progress issues: native byte events may be
  omitted, so confirmed PUT completion now emits a committed-byte update;
  the composer mounted guard now resets in effect setup after Strict Mode
  cleanup/replay. A regression test failed before the committed-part fix and
  passed afterward. Actual UI subsequently showed **24/500 MiB**, then
  **136/500 MiB**, instead of remaining at zero. Progress is measured, not simulated.
- Real testing caught iOS part-file leakage. Expo legacy `deleteAsync` checks
  parent permissions using `file/..`; for native files in `tmp` the check
  returns false. A direct Foundation probe reproduced false for that path and
  true for the real parent. Swift now creates bounded files under
  `Library/Caches/ArcUploadParts`, an Expo-owned writable scope. The new full
  workspace build completed **BUILD SUCCEEDED / exit 0**; no Pods upgrades.
  Two-second runtime observation after reinstall shows at most **one 8 MiB
  cache part**, and **zero** after pausing. Five old tmp parts (35,058,145 bytes)
  from the pre-fix build were preserved for the existing 24-hour orphan cleanup,
  not falsely reported as new-build leakage or immediately removed.
- App update changed the Simulator data-container UUID, exposing stale absolute
  draft URLs. A focused helper rebases **only the current account/draft's
  `Documents/arc-post-drafts` files**, rejects foreign/remote/traversal paths,
  and avoids React Native's HTTP-only `URL.pathname`. Actual saved caption,
  cover and exact-sized source now restore after update and a cold launch.
- Explicit pause, saving/leaving and app backgrounding retained accepted S3
  parts. Returning from background showed **Paused / 56.0 MiB transferred**;
  the current cache part had been removed. Parts 1/2 retained their original
  ETags across the app update and resume. Mid-transfer force-stop recovery is
  also passed: S3 retained exactly 176 MiB before/after force-stop with identical
  accepted-part ETags; reopening reconciled and resumed the same session.
  A real network timeout at 208 MiB preserved accepted parts, and retry finished
  the exact 500 MiB source. Continuous suspended/background transfer is not claimed.
- Real desktop Safari exposed a second, distinct playback blocker: native
  no-CORS HLS loads violate the API's Helmet same-origin CORP header. The new
  renewable Feed/Clips players now use `crossOrigin="anonymous"`; legacy
  unsigned media request mode and server privacy/CORS rules are unchanged.
  New tests were **2 failures before / 14 of 14 passing after**. Actual Safari
  now reports **native HLS**, readyState 4, no media error, advancing frames,
  and a rotated five-minute grant—not merely MP4 fallback or a mock player.
  Desktop Safari's actual AWS HLS observation exceeded ten minutes with two
  grant rotations; Simulator Mobile Safari AWS checks are still ongoing.

Temporary local evidence includes `s3-transfer-observations.json`,
`native-resource-observations.json`, `native-resource-cache-fix.json` and
`native-session-worker-observations.json` under the round-3 run directory.
The small source's FFmpeg worker sample recorded **33.53 s wall / 57.35 CPU s,
272,560,128-byte peak sampled container memory, 37,563,324-byte peak sampled
scratch**, 34 one-second samples. These are sampled measurements, not true
high-water marks. The exact 500 MiB / three-minute source subsequently measured
**451.863 s wall / 815.871 CPU s, 1,145,171,968-byte peak sampled container memory,
813,416,512-byte scratch and 201.24% peak sampled core CPU**, 452 one-second
samples, one worker attempt. This is one representative source/worker result,
not a multi-worker capacity guarantee.

## Authority and boundaries

Follow-up at 22:44 UTC: native recovery after a real `NSURLErrorDomain -1001`
part timeout reused session `6ad7e574690653b0d18543f9` and passed **328/500 MiB**
in the actual UI. The failure exposed an additional security/UX bug: Expo's
raw NSError message contains the full S3 presigned URL and overflows the alert.
The transport boundary now emits a fixed, credential-free retry message and
preserves cancellation as a pause. No raw native error is passed to the alert.
The source and verified parts were retained; retry completed and published.

Real desktop Safari AWS observations exported to
`desktop-safari-aws-observations.json`: **603.196 seconds / 307 samples**, native
HLS throughout the sampled sources, no media error. Grant expiry rotated from
22:37 to 22:41 and 22:45 UTC while playback resumed at its saved playhead;
source replacement briefly has readyState 0, so this is not a zero-buffer-gap
promise. Actual CloudFront NEW requests after a captured 22:42:30 expiry returned
**403 for MP4 Range, child segment and thumbnail** at 22:43:18 UTC. Earlier
authorized requests returned root/variant/segment/thumbnail **200**, MP4 Range
**206 / 1,024 bytes**; unsigned MP4/source **403** and a foreign owner's upload
session **404**. The API's `CORP: same-origin` remains in place, with CORS allowing
only the configured staging Web origin.

Hidden-tab testing exposed a genuine parent-level bug: foreground auth refresh
recreated the user object, and PostDetail's loading transition unmounted the
player, losing its paused position. PostDetail now still revalidates same-viewer
claims but retains its current player while that request runs. Account/role
changes and privacy events still block/clear protected content. A focused test
failed before and passed after this change; all 12 PostDetail auth tests pass.
Actual Safari retest retained the same video node and exact **25.77036737561778 s**
paused position across a hidden interval and renewed grant. A later expired
source while the docked inspector pushed the player out of view was cleared;
bringing the player back into the viewport renewed and restored the same paused
position. This is expected inactive-view expiry, not unattended background renewal.
Sanitized observations preserve both the original failure and successful retests.

After the recovery fixes, standalone Node 22 runs passed upload/playback/grant
**27/27**, editor **34/34**, privacy **42/42**, call-signaling **24/24**. Mobile
and Web full TypeScript checks passed. Focused Web player tests **14/14**, and
expanded upload/player regression **50/50** passed; expanded Web privacy checks
**82/82** passed after correcting two pre-existing test fixtures (missing theme
provider mock and obsolete follow-request button name); harmless testing-library
`act` warnings remain. A native development-menu Reload caused a React Fabric
`EXC_BAD_ACCESS` during scheduler reinitialization; cold app launch works. This
was not presented as a fixed release-device issue or hidden from the report.

The user separately approved Apple's iOS component installation, temporary
Safari developer features (restore afterward), and the new isolated staging
plan in `POST_VIDEO_500MIB_IOS_SAFARI_STAGING_PLAN.md`: an additional $15 cap,
six hours starting with the first new billable resource, at most one worker,
and scoped cleanup. No production deployment, migration, flag, IAM, storage,
CDN or DNS mutation is authorized. The new staging window started only after
the synchronized full iOS build and local Sign In launch passed; timing is
recorded below.

## Xcode findings

- `xcode-select -p` returns `/Library/Developer/CommandLineTools`. Plain
  `xcodebuild` and `simctl` therefore fail. No global switch has been made.
- Using `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` selects
  **Xcode 26.6 / build 17F113**, with iOS and Simulator SDK **26.5**.
- Initially both available device and runtime inventories were empty. The workspace's
  generic Simulator build reproduced **exit 70** before application compilation.
  The scheme reports iOS 26.5 missing despite the SDK appearing in `-showsdks`.
- Xcode Components offers **iOS 26.5.1 + iOS 26.5 Simulator, 10.6 GB**. The
  approved command selects **iOS 26.5 Simulator 23F73 arm64, 8.52 GB**:

  ```sh
  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
    xcodebuild -downloadPlatform iOS -buildVersion 26.5 -architectureVariant arm64
  ```

- Approximately 69 GiB free before installation. A roughly 30 GiB working-space
  budget for download/unpacking/build/media was proposed, not asserted as an
  Apple-published installation minimum. The standalone runtime download and
  installation completed successfully (installer exit 0); see the remaining
  Xcode-managed platform-package blocker below.
- Initially `ios/Podfile.lock` equaled `ios/Pods/Manifest.lock`; no dependency reinstall,
  CocoaPods update, Xcode reinstall or unrelated package upgrade was performed.
- Deployment target is 15.1 and application Swift language version is 5.0.
  `ArcMediaEditor` is linked through the installed Expo/CocoaPods project with
  AVFoundation/CoreImage/ImageIO/UIKit. Camera, microphone, photo read/add usage
  descriptions are present. Presence is not permission-dialog execution proof.
- `xcodebuild -checkFirstLaunchStatus` with the explicit Xcode developer
  directory returns exit 0; first-launch completion is not the remaining blocker.

### Native compilation results

The actual installed-Pods target build completed **BUILD SUCCEEDED / exit 0**:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/Pods/Pods.xcodeproj -target ArcMediaEditor \
  -configuration Debug -sdk iphonesimulator ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build
```

The log includes actual `SwiftCompile normal arm64` for
`modules/arc-media-editor/ios/ArcMediaEditorModule.swift`, including its bounded
`copyUploadPart` function. No genuine Swift compiler error was found in this
target and its source was not changed. React umbrella-header and build-script
warnings remain. This establishes native module compilation, **not** full-app
build, runtime part copying, real upload or iPhone execution.

The broader `Pods-SquadHunt` target build reached Expo's asset compilation and
failed with **No available simulator runtimes for platform iphonesimulator** in
`expo-dev-launcher/ios/Assets.xcassets`. No compiler protection was bypassed.
Temporary logs: `/tmp/squadhunt-ios-20261021-module-build.log` and
`/tmp/squadhunt-ios-20261021-pods-build.log` (not exported raw into Git; build
logs can contain environment details).

### Runtime installed and booted; full workspace still blocked

- `simctl` now reports **iOS 26.5 / 23F73 / arm64 / isAvailable=true** and
  runtime disk image state **Ready**. Installer identity:
  `9CC97514-F016-4DE5-B94A-1EB59A0987A5`.
- Selected the iPhone 17 Pro newly auto-created by the installation:
  `6F05DFB4-2DD8-464F-A464-158BE955F8B3`. `simctl bootstatus -b` completed
  **exit 0**, with terminal status Finished. No old simulator was erased or
  removed; other auto-created devices were preserved.
- The actual full workspace build against this UDID still exits **70** before
  application compilation. Explicit `-sdk iphonesimulator` destination discovery
  also reports `iOS 26.5 is not installed`; booting a runtime alone did not fix
  the Xcode-managed platform requirement.
- Xcode Components now lists the installed **iOS 26.5 Simulator, 8.49 GB**
  under Other Installed Platforms, but still marks **iOS 26.5.1 + iOS 26.5
  Simulator, 10.6 GB** as **Get** under Platform Support. Its Info sheet identifies
  **SDK Version 26.5.1 (23F81a), Apple Silicon**. Read-only runtime mapping also
  prefers build 23F81a while the independently downloaded runtime is 23F73.
- No manual runtime mapping, SDK file edit, Xcode reinstall, global developer
  directory switch, cache deletion or signing bypass beyond normal Simulator
  `CODE_SIGNING_ALLOWED=NO` was used. The smaller standalone-runtime choice did
  not install the complete package originally shown by Xcode.
- A fresh `Pods-SquadHunt` build after booting the standalone runtime reached
  actual native compilation on Node 22, then exited 65 at asset compilation:
  `No simulator runtime version from ["23F73"] available to use with
  iphonesimulator SDK version 23F81a`. This directly verifies the SDK/runtime
  mismatch; it is not inferred just from the scheme's destination message.
  Log: `/tmp/squadhunt-ios-20261021-pods-runtime-build.log`. The temporary
  `ios/.xcode.env.local` Node-22 override was restored to its original Node-26
  path after the build. No dependency or SDK files were edited to bypass it.
- The user approved the **additional Xcode-managed package**: up to another
  10.6 GB download (cache reuse is possible, not guaranteed). With 50 GiB free,
  the exact Platform Support Get action was started and Xcode reported
  **Preparing…**. The 8.52 GB transfer and installation subsequently completed;
  Xcode now lists the managed package as installed (8.49 GB), without Get.
  `simctl` reports both available runtime builds **23F73 and 23F77**. The
  existing runtime, iPhone UDID and device data were preserved.
- After installation, the workspace's `-showdestinations` returns exit 0 and
  lists the iPhone 17 Pro UDID as an **available iOS Simulator destination**.
  The previous destination blocker is resolved without SDK or runtime-mapping
  edits. Full workspace compilation completed **BUILD SUCCEEDED / exit 0** on
  standalone Node 22 with isolated placeholder API/TURN/payment settings.
  The log includes actual arm64 Swift compilation of ArcMediaEditorModule.swift
  and successful app/Expo asset compilation. No Swift source patch was needed.
  The temporary local Node override was restored after completion. The built
  app installed and launched on the preserved simulator, then connected to
  local Metro port 8087; JavaScript startup is still being verified. This is
  not yet real iOS upload proof. Mobile source HEAD is
  `f04a47bc315c0f4d5f1a93384fd5312a18b7b4bc` plus preserved worktree changes.

### Local launch caught stale native dependencies

The first complete build installed and launched, but real JavaScript startup
reported `Cannot find native module 'ExpoMediaLibrary'` from clipDownload.ts,
then the app closed. Therefore that build was **not** accepted as native
runtime readiness and no staging resources were started.

Installed Expo autolinking resolves expo-media-library 18.2.1, while both the
initial Pod lockfile and generated ExpoModulesProvider omitted it. Equal Pod
and Manifest lockfiles did not prove synchronization with current package.json.
The old Pods also omitted already-declared Lottie and SVG native modules.

The native metadata was backed up to
`/tmp/squadhunt-ios-20261021-pre-pod-sync.tgz`, then
`pod install --project-directory=ios --no-repo-update` completed exit 0.
It added ExpoMediaLibrary 18.2.1, lottie-ios 4.6.0, lottie-react-native 7.3.8,
RNSVG 15.12.1 and its common subspec. A comparison preserved **all 201 existing
Pod/subspec versions**. Local module checksums were refreshed from their
existing local sources; no npm package or unrelated version upgrade was made.
The generated provider now imports ExpoMediaLibrary and registers its modules.
The synchronized full workspace rebuild completed **BUILD SUCCEEDED / exit 0**.
The artifact was reinstalled on the isolated simulator and the actual native
Sign In screen remains open, with responsive Show/Hide password controls.
No production credentials were entered. The missing native-module startup
failure is resolved. Logs: `/tmp/squadhunt-ios-20261021-pod-sync.log` and
`/tmp/squadhunt-ios-20261021-app-build.log`.

Non-fatal local diagnostics remain: Expo notifications reports missing keychain
entitlement in the unsigned Simulator build, and navigation reports a
development-only unhandled POP_TO_TOP warning. They were not suppressed
globally or represented as successful push/physical-device checks. The local
readiness receipt records these limitations and pins the actual successful
build-log hash and device ID before any staging mutation.

## Safari blank-page root cause and focused fix

Actual **Safari 27.0 on macOS 26.7**, not Playwright WebKit impersonation.
The isolated Vite server points its app API/socket configuration to unused local
port 5999; no production account was used. The local login was blank.

After approved temporary developer-feature enablement, Web Inspector showed:

```text
https://127.0.0.1:3001/@react-refresh
https://127.0.0.1:3001/@vite/client
https://127.0.0.1:3001/src/index.tsx
Failed to load resource: A TLS error caused the secure connection to fail.
```

`index.html` contains `Content-Security-Policy: upgrade-insecure-requests`.
HTTP Vite has no HTTPS listener; Safari upgrades its loopback subresources.
Raw HTTP headers contained no additional enforcing CSP. The before-fix command
`node --test scripts/local-http-csp.test.cjs` failed **2/2**, specifically on the
upgrading meta policy in actual Vite development and preview responses.

Fix: `frontend/server/localHttpCsp.cjs`, registered in `vite.config.ts`, adjusts
**only Vite loopback HTTP responses**. Request-local async context prevents
cross-request policy leakage. Preview serves a changed response copy without
editing the built artifact. HTTPS, LAN/non-loopback, production builds and other
CSP policies retain their policy. No browser security was disabled.

After-fix policy/security tests: **5/5**. Actual Safari renders the login form
from both Vite development and a locally served production build. The previously
failed origin retained cached TLS failures; a fresh loopback origin succeeded.
No global cache clearing or security bypass was used. The built production
`index.html` still contains its original upgrade policy; Vercel headers unchanged.

## Actual Safari local HLS and renewal

Reproducible fixture harness:

```sh
node scripts/validate-safari-local-renewal.mjs /path/to/synthetic-hls-outputs 3003
```

It imports the **actual** `FeedAdaptiveVideo`, `AdaptiveClipVideo`, grant lease
and position hooks. Local metadata/grant transport is a controlled fixture,
not a real authenticated AWS API or CloudFront signature. The existing generated
five-minute H.264/AAC 640x360 video and fMP4 HLS outputs are served with real
byte ranges and server-clock 300-second expiries; child manifests/init/segments
carry the fixture grant. Nothing personal is served.

- Both actual Safari players reported native HLS (`currentSrc` is the m3u8,
  not an MSE blob), readyState 4, no media error, and advancing video frames.
- Initial grants at `2026-10-20T19:25:27.795Z`. Renewal HTTP 200 for both players
  at `19:29:27.816–818Z`, and again at `19:33:27.834–836Z`.
- Actual Safari observation at `19:36:05.055Z` is **over ten minutes** after
  issue. Clips remained playing through two URL rotations and source loops;
  Feed remained paused at **35.585 s** on both renewed sources.
- A NEW Range request using the initial, expired local grant returned **403**.
  This is fixture-transport evidence, not an AWS expiry retest.
- Actual visibility instrumentation recorded `hidden` at `19:36:32.169Z` and
  `visible` at `19:39:08.631Z`: **156.462 seconds hidden**, spanning the current
  grant's expiry. The server recorded no renewals while hidden. Foreground
  renewal returned 200 at `19:39:08.636–637Z`; sources rotated to generations
  7/8 and both positions were retained (Feed 35.585 s, Clips 60.885 s).
  Safari itself paused Clips while hidden; it stayed paused on return and
  pressing Play resumed it. This is not a claim of automatic or continuous
  background playback.
- A local access-denial control caused both real renewal hooks to receive
  **403** at `19:40:11.599–600Z`. Actual Safari inspection showed both `src`
  and `poster` attributes **null**, time 0, paused true and readyState 0.
  Safari's `currentSrc` retained the old string after unloading; it was not
  misreported as an attached source. This remains local ACL-fixture evidence.
- The owned Safari test tab was closed, original Start Page preserved,
  developer features restored to **off**, original preferences pane restored,
  and preferences closed. No remote automation, security setting or global
  cache was changed. Local fixture event export is at
  `/tmp/squadhunt-safari-20261021-fixture-events.json`.
- Full page authentication, production deployment, Mobile Safari, physical
  iPhone, audiovisual-quality and fresh real-AWS iOS transfer are not established
  by this Desktop Safari fixture check. See the separate Simulator Mobile Safari
  results below.

### Simulator Mobile Safari — local, not AWS

The preserved iPhone 17 Pro / iOS 26.5 simulator ran actual Mobile Safari
(Safari version 26.5). Its local page imports the real player and renewal hooks;
the transport remains the synthetic fixture, without a production account.
Timestamped player observations are now exported by this diagnostic entry only.

- Grants used for the measured run were issued at
  `2026-10-20T20:21:20.665Z`. At `20:31:25.866Z` (**605.201 seconds** later),
  both players were playing native m3u8 sources, readyState 4 and error null.
  Playback advanced through a five-minute source loop.
- Both were paused before the first renewal at exactly **107.432 s** (Feed)
  and **107.410 s** (Clips). Renewals at `20:25:20.688Z` and `20:25:21.028Z`
  returned 200; those paused positions and paused state were preserved exactly
  on the new sources. The Play both control resumed them.
- Second renewals returned 200 at `20:29:20.701Z` and `20:29:21.037Z` while
  playing. Both continued playing on the rotated sources.
- A NEW Range request with the expired initial fixture grant returned 403.
  Deny renewal locally caused actual renewal-hook responses of 403 at
  `20:31:31.574Z` and `20:31:31.822Z`. At `20:31:35.888Z`, both players had
  srcAttribute null, poster null, currentTime 0, paused true and readyState 0.
  As on Desktop Safari, the stale currentSrc string was not treated as an
  attached or playing source.
- Actual Mobile Safari rendered the real local `/login` in both Vite development
  (localhost:3001) and locally served Node-22 production build (localhost:3002).
  No credentials were entered; this establishes rendering, not authentication.
- Evidence: `/tmp/squadhunt-mobile-safari-20261021-fixture-events.json`. It
  contains synthetic local grant IDs and player samples, not real signed URLs.
  It does not establish native-app uploads, real CloudFront authorization,
  physical iPhone behavior, audible quality or background-transfer capability.

## Regression checks in this run

| Check | Result |
| --- | --- |
| Backend build and typecheck | PASS on available Node 26.7.0 |
| Backend renewal/publication contract suite | 24/24, no skips |
| Staging preparation | 6/6 |
| All six staging templates via AWS validate-template | PASS syntax only |
| Web full TypeScript and production build | PASS |
| Web player/audio/preload/prefetch suites | 75/75 in eight suites |
| Local HTTP CSP and existing security-header tests | 5/5, before-fix failures reproduced |
| Simulator Mobile Safari local rendering/HLS/renewal | PASS: development and preview login render; >10 minutes, two renewals, pause preservation and denial cleanup; fixture transport only |
| Mobile full TypeScript | PASS |
| Mobile upload/playback/grant suite | 23/23 |
| Post-Pod-sync mobile regressions on Node 22 | Upload/playback 23/23, privacy 42/42, call signaling 24/24, full TypeScript PASS |
| ArcMediaEditor native arm64 Simulator target | BUILD SUCCEEDED, exit 0 |
| Expo iOS export / Hermes JavaScript bundle | PASS, existing standalone Node 22.23.3; isolated placeholder API/TURN/payment config, not native runtime proof |
| Simulator runtime and iPhone boot | PASS: iOS 26.5 / 23F73, iPhone 17 Pro bootstatus exit 0 |
| Managed platform package / workspace destination discovery | PASS: installation complete, both runtime builds preserved, selected iPhone is eligible |
| Full workspace app build and local startup | BUILD SUCCEEDED / exit 0 after Pod synchronization; native Sign In remains open and controls respond; non-fatal diagnostics documented |
| Native iOS real multipart/upload/playback | PASS in iOS Simulator: 9,892,321 bytes and exactly 524,288,000 bytes to actual staging S3, processed/published once, Home Feed and Clips playback; physical iPhone remains untested |

The Homebrew Node 22 binary cannot start because `libsimdutf.34.dylib` is
missing. This attempt was an environment failure; it was not repaired silently.
Initial tests/builds used functioning Node 26.7.0. The existing standalone
**Node 22.23.3** from the preceding approved validation was then located at
`/tmp/squadhunt-node22-eaR1gV/node-v22.23.3-darwin-arm64/bin/node`; no new download
or system Node repair was required. Backend build/runtime imports/typecheck and
24/24 renewal tests, Web full TypeScript/75 tests/5 policy tests, and mobile
full TypeScript/23 tests were re-executed successfully on that Node 22 binary.
Stage Docker must still separately build/run its reviewed Node 22 image before
candidate services start.

### Prepared synthetic native fixtures

Original synthetic files were reused without modification. Exact-boundary
source: H.264/AAC, 1920x1080, 180 seconds, **524,288,000 bytes**, SHA-256
`2c11cd7581ec7a44e1b8a2b7e036514575da5edd0a649a35794d1d70b9fb7f91`.
As in the preceding run, 523,048,867 bytes are the encoded container and
1,239,133 bytes the final `free` atom used only to reach the exact boundary;
this is not a two-second padded upload or natural phone-footage quality proof.
A new valid 524,288,001-byte rejection fixture extends only a copied free atom.
Also prepared: 9,892,321-byte small H.264/AAC source and a new 4,008,598-byte,
15-second 720x1280 `hvc1` HEVC/AAC MOV. The first two sources have now transferred
through native iOS into actual staging S3; HEVC and +1-byte selection checks are
still pending at this checkpoint. The local fixture manifest is under the new round-3
root. No personal video or production upload was used.

## Staging status and next gates

AWS identity read-only check confirms account 906446637180. Production is still
`arc-backend:205`, one running / zero pending / COMPLETED. No active previous
staging stacks were returned. The original shared CloudFront VPC-origin role
identity is preserved. New round-3 helper root:
`/tmp/squadhunt-ios-safari-staging-r3.bW8kuu`.

Its mutation path was executed as a fail-closed test: **refused before any
staging change set/resource** because the full iOS build has not passed. No
paid window had started at that failed-gate checkpoint. It has new round-3 namespace/bucket/manifest bindings,
one-worker start limit, and retains the reviewed source/digest and cleanup
checks. Do not execute an earlier round's provisioning or cleanup helpers.

After the managed package, Pod synchronization, full app rebuild and real local
startup passed, the approved round-3 window began at **2026-10-20T21:22:07Z**
(21 October, **02:52 IST**). Deadline: **2026-10-21T03:22:07Z / 08:52 IST**,
additional cap $15 and at most one worker. Only Add-only change sets for the new
isolated network, media and data stacks were executed. Network and media
and data creation completed. The first temporary CodeBuild execution succeeded;
the staging image is pinned to
`sha256:30fe43a30030f8d8b53bad171fb0b552d62d3e725bda43c10fb9c5869fdceb09`.
Reviewed backend archive SHA-256:
`78c54d7d1d0fcc9a293417195d41ab261266925508558a6a21ee77ed13829237`,
base HEAD `8a7d68a2bdd85e29e450e0bc3486921aaf3fe065` plus its preserved worktree.
The new API stack is being prepared at **zero tasks**. Production was
rechecked read-only: revision 205, one running,
zero pending, rollout COMPLETED, health 200, all compatibility flags unchanged.

Next: complete isolated API/worker bootstrap and actual native uploads/Safari
signed-media tests within the approved window, then scoped cleanup. No real
iOS AWS transfer has passed yet. Production activation remains **NOT READY**.
