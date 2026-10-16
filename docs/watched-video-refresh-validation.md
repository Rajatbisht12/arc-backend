# Watched-video exclusion: refresh investigation and validation

Validated 17 October 2026 (Asia/Kolkata).

## Outcome and deployment boundary

Implemented reliable 1-second playback qualification, durable pending exposure
delivery, refresh reconciliation, and a final server-side watched-video gate.
Installed and validated the updated Android app without clearing data or logging
out. Backend and Web source changes are **not deployed or pushed** by this task.
The existing production backend successfully persisted and excluded the ten
videos watched during the Android validation. That does not prove the new
backend race fix is already live.

The policy remains unchanged: unseen content from the last 7 days first, then
older unseen content. Viewed/interacted **non-video** fallback tiers remain.
A video meaningfully watched for at least 1 second is never eligible for an
automatic Home/Clips repeat, even on genuine inventory exhaustion. Intentional
profile, search, saved, post-detail, and direct-target access remains available.

## Actual deployment and migration findings

- Production ECS service: `arc-cluster/arc-backend`, `us-east-1`.
  Active task definition `arc-backend:195`; one completed PRIMARY deployment.
  Image tag `8efd817`, running image digest
  `sha256:6c045aabf70ab53486f8b5f754f056fc2f159aca98bc1de12308d29523f1a73b`.
- Extracted the relevant source from the actual ECR image. Its exposure,
  discovery, recommendation, controller and migration files matched the local
  pre-fix implementation after normalizing CRLF. It already contained discovery
  v3, 7-day freshness, the 1-second threshold and strict video exclusion.
  An undeployed original recommendation implementation was **not** the cause.
- Exposure route exists, rejects unauthenticated requests (401), and successful
  authenticated Web/native requests were visible in production logs.
- Active migration marker is `DISCOVERY_EXPOSURE_MIGRATION_VERSION=2`.
  Existing deployment logs showed successful apply and verify. Approved
  read-only diagnostics independently verified compliant collections/indexes
  for `contentexposures`, `recommendationdeliveries`,
  `recommendationstates` and `posts`, with zero diagnostic writes.
- All ten Android test videos had actual persistent, canonical
  `userId:postId` exposure rows, correct video media type and timestamps.
  The same canonical Post ID is used by Home and Clips; no URL-based identity
  merging was introduced.
- A user-owned open Chrome tab was running `index-C9gNznO2.js`, while fresh
  production HTML referenced `index-CkGhfZjD.js`. This proves an older client
  bundle remained open; it does not independently prove that tab caused a
  particular repeated video. Production has no exposed exact Web build SHA.
- A separate fresh production browser login was blocked by Cloudflare.
  No challenge bypass was attempted; the existing user browser/session stayed
  unchanged. ECS Exec was unavailable, so the two explicitly approved
  read-only Fargate diagnostics used the existing image, primary DB reads,
  disabled automatic index creation, no server startup and no migrations.
  Both finished STOPPED with exit code 0; no service traffic was changed.

## Reproduced defects and fixes

1. **Visibility was not reliable watch qualification.** Web required half the
   entire card to be visible, impossible for some cards taller than the
   viewport. Video card visibility could also qualify paused media.
   Video exposure now belongs to the actual active player's advancing media
   time, with foreground visibility and pause/seek/error guards. Non-video
   visibility uses half of the smaller of card height and viewport height.
   Android Home now feeds the existing tracker from actual player progress;
   an offscreen, preloaded, paused or covered player does not qualify.
2. **Qualified reports could disappear after navigation/network failure.**
   The old component retry stopped on unmount and swallowed failures.
   Pending reports now persist in a token-free, user-keyed delivery outbox
   (localStorage / AsyncStorage), survive reload/restart, coalesce concurrent
   submissions and remain pending until server acknowledgment. Replay is
   account-bound; reconnect/foreground or the next recommendation request
   can retry. There is no uncontrolled timer/request loop.
3. **Refresh could race exposure persistence or reapply stale pages.**
   Home/Clips flush pending reports before fetching, bounded to 1.5 seconds
   of network waiting and 20 submissions per flush. They send at most 100
   recently qualified/acknowledged video IDs as exclusion hints and reconcile
   newly returned/staged recommendation pages. They never purge the card
   currently being watched or reorder the visible feed.
4. **Backend candidates could become watched after selection.**
   A deterministic regression acknowledged exposure during delivery reservation
   and reproduced a repeat in both Home and Clips before the fix. The backend
   now rechecks the small outgoing video page on the primary immediately before
   delivery, after hydration/media resolution. Legacy first-view-only records
   are also excluded. Direct targets are not subjected to this automatic-feed
   gate.

The persistent backend remains authoritative across devices. Client hints are
bounded, not a permanent local watch-history substitute. Exposure rows have no
TTL and were not reset. No schema, index, migration, backend API contract,
public view-count, CDN or video asset change was made.

## Connected Samsung validation against production

Device: Samsung SM-S928B. Updated signed Android release installed with
`adb install -r`; existing login/data preserved. App version remains
1.0.0 / build 22, so version number alone cannot distinguish the QA build.
Conditional exposure/playback tracing was enabled for this validation build;
it logs post/context/duration, not tokens or user identity.

- Watched 5 distinct Home videos and 5 distinct Clips for at least 3.5 seconds
  each. Actual exposure acknowledgment occurred at 1,017–1,195 ms.
- Checked 17 Home/Clips refresh/reselection responses, including six Home
  refreshes before Clips, six after Clips and four new Clips visits.
  None reintroduced videos that had already qualified at that point.
- Forced app stop/restart without clearing storage: Home and Clips each loaded
  ten IDs, with zero repeats from the ten watched videos. The cold Home
  request had **zero client exclusion hints**.
- Read back all ten exposure records from production DocumentDB; all persisted
  with canonical keys. Three fresh read-only eligibility sessions per surface,
  using the actual deployed audience filter and primary database, returned
  none of those IDs. These diagnostic calls did not reserve deliveries.
- Native trace IDs describe the list applied after client reconciliation,
  not an independently captured raw HTTP body. Cold restart plus primary DB
  eligibility checks establish that the result is not merely local filtering.
- Playback, cross-surface navigation, refresh and returning to Home worked
  during this run. This was not a comprehensive engagement/privacy manual QA
  of every unrelated feature. The app was left on Home; temporary USB browser
  forwards/reverse and the device UI-dump file were removed.

## Browser validation

Built Web bundle → actual post/exposure/recommendation controllers → disposable
MongoDB. Seeded 231 distinct canonical video Posts, local MP4/poster fixtures,
isolated test account, real media playback and exposure writes. Nonessential
UI endpoints/auth identity are fixture-backed; external network is blocked.
This is integration validation, **not a successful production Web login**.

Each environment watched 5 Home videos and 5 Clips for >=3 seconds, checked
actual exposure persistence, performed six browser reloads and 24 fresh
Home/Clips recommendation-session API checks. All passed with zero watched
repeats and no page errors:

| Environment | Watched videos | Fresh-session checks | Result |
| --- | ---: | ---: | --- |
| Desktop Chrome | 10 | 24 | PASS |
| Mobile Chrome viewport (390×844) | 10 | 24 | PASS |
| Desktop WebKit | 10 | 24 | PASS |
| Mobile WebKit viewport | 10 | 24 | PASS |
| Physical Samsung Chrome 155 | 10 | 24 | PASS |

WebKit runs used macOS WebKit, not physical iOS Safari. No connected iPhone was
available. Existing production Web and Android accounts were not switched to
the disposable test identity; physical Chrome tests used a separate loopback
origin via USB forwarding.

## Anonymized per-video verification

IDs below are SHA-256(canonical Post ID), first 10 characters. Fixture DB state
was reset between browser environments; an alias can therefore occur under
different isolated test runs without representing a within-session repeat.
Native rows were read back from production; browser rows from disposable DB.
"EXCLUDED" refers to subsequent checked recommendation sessions, not intentional
direct access or removal from the currently visible list.

| Platform | Source Feed | Canonical Video ID (hashed) | Exposure Recorded | Subsequent Home Feed | Subsequent Clips | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Samsung native / production | Home | `a7723217f2` | Yes (1017 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Home | `ce41ecc869` | Yes (1026 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Home | `9b4bd2a8d2` | Yes (1024 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Home | `081ceea9d8` | Yes (1026 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Home | `9f2d965b16` | Yes (1028 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Clips | `c47b9b41c0` | Yes (1119 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Clips | `9d9e45b6f7` | Yes (1142 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Clips | `e4b346af77` | Yes (1168 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Clips | `a83eddaac2` | Yes (1097 ms) | EXCLUDED | EXCLUDED | PASS |
| Samsung native / production | Clips | `7e113213c5` | Yes (1195 ms) | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Home | `4fa587c422` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Home | `57b09c1f12` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Home | `787f3066e6` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Home | `a47573315d` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Home | `aeb7eae27f` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Clips | `f16107f67e` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Clips | `376e5bfb89` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Clips | `75bfc5e197` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Clips | `b9dbd334d3` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-chrome / local E2E | Clips | `6d7b7760c8` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Home | `f16107f67e` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Home | `75bfc5e197` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Home | `be2695e04a` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Home | `6d66df5944` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Home | `57b09c1f12` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Clips | `3c61cfbb78` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Clips | `0c07c7a561` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Clips | `52b0f5fef3` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Clips | `18577d01f2` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-chrome / local E2E | Clips | `d93071e30e` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Home | `0bd3e0c1f2` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Home | `39e9b31210` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Home | `d21d126f9b` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Home | `d3952bdb00` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Home | `ece7de3d29` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Clips | `63cfe5be71` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Clips | `944f0dab06` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Clips | `1f0c501c89` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Clips | `3d7636cebd` | Yes | EXCLUDED | EXCLUDED | PASS |
| desktop-webkit / local E2E | Clips | `6bcd52e30d` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Home | `4da5e64c9b` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Home | `3d7636cebd` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Home | `b066eeb596` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Home | `df569ca617` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Home | `d3952bdb00` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Clips | `944f0dab06` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Clips | `3c1f1e32be` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Clips | `54cf6fab87` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Clips | `52143d850f` | Yes | EXCLUDED | EXCLUDED | PASS |
| mobile-webkit / local E2E | Clips | `83290f4426` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Home | `24f8431be7` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Home | `88f1756448` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Home | `3be739a840` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Home | `e84ae8729a` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Home | `5d9a14ceff` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Clips | `d19a9ca87c` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Clips | `d792e8dfd5` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Clips | `e51eb779e9` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Clips | `ddd089bb18` | Yes | EXCLUDED | EXCLUDED | PASS |
| Physical Android Chrome / local E2E | Clips | `fc4bdc3c9f` | Yes | EXCLUDED | EXCLUDED | PASS |

## Automated verification and performance

- Reproduced red tests before implementation: tall-card exposure, failed
  delivery after unmount, and both backend in-flight exposure races.
- Backend `npm run test:discovery`: PASS. Includes the existing 571-check
  discovery integration suite, new 4-test repeated-refresh/concurrency suite,
  Clips pagination, follow-state and migration suites. Seeded pagination
  serves 231 unique eligible clips across 24 pages; no 150-item cap.
- New backend tests cover twelve fresh sessions per surface, canonical
  positions 1/9/50, 1-second and 3-second watches, 999-ms/non-viewed eligibility,
  idempotence, real exhaustion, session-state deletion and concurrent exposure.
  Existing suites retain non-video fallback, privacy, direct-target, historical
  generic media type and large-history coverage.
- Backend `test:recommendations`, `test:privacy`, build and syntax checks: PASS.
- Web focused exposure/playback/feed/preload suite: 119 tests / 16 files PASS;
  additional TeamProfile suites: 25 tests / 2 files PASS. Web production build:
  PASS. Full TypeScript check still reports pre-existing WebRTC typing errors
  in MatchInterface and a mutation initialization error in Profile; these were
  not expanded into unrelated repairs. No new exposure-related type errors.
- Native tracker/outbox/Home/navigation/timestamp tests: 35 PASS.
  Native TypeScript: PASS. Android arm64 release build/install: PASS.
  iOS production JavaScript/Hermes export: PASS; no physical iOS runtime test.
- Latest local seeded discovery timings: Home median 24.71 ms / p95 43.55 ms;
  Clips median 24.63 ms / p95 40.18 ms, with 20,000 seeded exposure records.
  These are local MongoDB measurements, not production DocumentDB benchmarks
  or a controlled before/after performance claim. The final gate adds one
  indexed, bounded outgoing-page primary read, not a lifetime-history scan.
- Existing video render/preload windows and pagination state machines are
  preserved. Slow/failed exposure retry and timeout behavior is regression
  tested; physical network disconnection and cross-device production Web
  login could not be fully exercised during this run.

## Files changed for this task

Paths below are relative to `arc_-main`. Mobile had extensive existing dirty
changes; they were preserved and were not staged or committed.

Backend (`modular-backend/`):

- `src/legacy-src/services/contentExposureService.js`
- `src/legacy-src/services/discoveryRankingService.js`
- `src/legacy-src/services/recommendationService.js`
- `src/legacy-src/services/watchedVideoRefresh.integration.test.mjs` (new)
- `scripts/validate-discovery-browser.mjs` (new)
- `package.json`
- `docs/discovery-recommendations.md`
- `docs/watched-video-refresh-validation.md` (this report)

Web (`frontend/`):

- `src/utils/recommendationExposure.ts` and `.test.ts`
- `src/components/MediaSwiper.tsx`, `MediaSwiper.exposure.test.tsx` (new)
- `src/components/PostCard.tsx`, `PostCard.exposure.test.tsx`
- `src/pages/Dashboard.tsx`, `Dashboard.feedStability.test.tsx`
- `src/pages/Clips.tsx`, `Clips.exposure.test.tsx`,
  `ClipsFeedSession.contract.test.ts`
- `src/pages/PostDetail.tsx`, `Profile.tsx`, `TeamProfile.tsx`
- `docs/recommendations/web-exposure-validation.md`

Mobile (`mobile-ui/arc-mobile/`):

- `app/(tabs)/index.tsx`, `app/(tabs)/clips.tsx`, `app/post/[id].tsx`
- `src/components/PostCard.tsx`
- `src/services/exposureOutbox.ts`, `exposureOutbox.test.mts` (new)
- `src/services/recommendationExposureTransport.ts` (new)

## Reproduce and release requirements

Automated entry points:

```sh
# modular-backend
npm run test:discovery
npm run test:recommendations
npm run test:privacy
# Actual browser / disposable real-controller integration:
# Requires a frontend Vite build pointing API/socket URLs at the local origin,
# Playwright (or SQUADHUNT_PLAYWRIGHT_MODULE), clip.mp4 and poster.png fixtures.
node scripts/validate-discovery-browser.mjs <web-dist> <fixture-media-dir> <output.json>
```

Detailed temporary logs/screenshots and ID-level validation data are retained
locally at `/tmp/squadhunt-no-repeat.yo6iFl/`; these temporary artifacts can be
removed by the OS and are not committed account watch history.

Normal backend and Web releases are still required for these source changes
to become active for all users. No new migration or forced backfill is required
for this patch: production v2 indexes and completed backfill were independently
verified. Keep the existing deployment preflight verification. Release Android
and iOS through the normal distribution process; only the connected Android
device was updated here. Validate the deployed Web/backend versions and repeat
the same refresh checks after release before claiming a production-wide fix.

