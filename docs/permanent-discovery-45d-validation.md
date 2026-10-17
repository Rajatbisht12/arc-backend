# Permanent discovery exclusion and 45-day priority

## Policy and root cause

Automatic Home Feed and Clips recommendations now have exactly two tiers:

1. Eligible unseen, non-interacted Posts published within 45 days (inclusive).
2. Eligible unseen, non-interacted Posts older than 45 days.

There is no viewed or interacted fallback, regardless of media type. An empty
unseen catalog returns exhaustion; it does not recycle consumed items. Existing
personalization, quality, boost placement and diversity rank within each tier.
The timestamp comes from the stored Post and the server's UTC-consistent clock.
The freshness window is not a retention policy or a content expiration.

The refresh defect had multiple confirmed causes:

- The previous backend explicitly allowed previously viewed/interacted non-video
  fallback tiers. A new delivery session could therefore return them despite
  correctly persisted exposure records. Session uniqueness was not permanent
  exclusion. Regression tests reproduced consumed non-video catalog recycling.
- The final primary-database exposure recheck covered only videos. A concurrent
  text/image acknowledgment during candidate hydration could escape that gate;
  new text/image race tests failed before the fix while the video check passed.
- Web/native pending and acknowledged recommendation exclusions covered only
  videos. Failed or pending text/image reports and stale returned pages were
  not reconciled with the same protection. Outbox regressions reproduced this.
- Native Home's non-video qualification required 50% of the entire card. Cards
  taller than twice the viewport could never qualify. The new implementation
  uses measured overlap of half the smaller of card and actual viewport height.
- Image-first mixed carousels lacked an active-image observation path when the
  containing Post also had video. They now qualify by visible image duration;
  a paused video still cannot qualify merely by being visible.

No evidence established broken canonical mapping or lost persistent records.
The main backend behavior was the old intentional fallback policy, not a Redis
cache incorrectly becoming authoritative.

## Implementation

`discoveryRankingService.js` partitions strictly unseen candidates by 45 days,
removes repeat retrieval, and marks exhaustion only after both unseen sources
are exhausted. Stable indexed Post-ID candidate windows, atomic delivery claims,
bounded contention attempts, privacy joins and v3 cursors remain intact. The
240-row candidate window is a per-query work budget, not a catalog cap.

`excludeExposedPosts` rechecks only the bounded outgoing page against primary
exposure rows immediately before delivery, now for every media type. It excludes
viewed or historically interacted Posts. Direct targets remain separately
accessible. Home and Clips use the same canonical Post identity; media URL
matching is not used.

The ranking policy becomes `unseen-only-45d-v1`. Its existing checkpoint hash
invalidates old ranking exhaustion proofs without resetting delivery sessions or
exposure history. No ranked recommendation list is cached in Redis, so no Redis
flush is needed. `discovery-v3` and cursor format remain backward compatible.

Both clients retain the existing account-bound retry outbox and bounded 1.5-second
pre-request flush. Pending and recently acknowledged exclusions now cover all
Post IDs (100 compatibility hints; 512 in-memory acknowledgment keys), not just
videos. New/restored pages are reconciled; the currently visible card is not
abruptly removed during ordinary browsing. Unacknowledged reports survive
reload/restart and are cleared only after acknowledgment. Local hints are race
protection, not lifetime history or the authoritative exclusion policy.

Native Home uses low-threshold candidate observation plus existing measured
cell layouts and the viewport-overlap helper. One continuous foreground second,
screen focus, app activity and modal gates remain mandatory. Videos still need
one second of actual visible playback progression. Web mixed carousels observe
their active image or active video appropriately. Public counters are unchanged.

Web/native Clips stop automatic repeat-session cycling when the backend signals
genuine unseen exhaustion. Manual refresh remains available to find new uploads.
Older-server compatibility is retained without creating an empty-request loop.

## Persistence, privacy and migrations

No schema, index, migration, deploy-script or retention changes were made.
`ContentExposure` still has no TTL, uses canonical `user:post` idempotent upserts,
and retains monotonic interaction history. `RecommendationDelivery` still expires
after seven days. `RecommendationState` keeps its 60-second exhaustion checkpoint.
No migration or cache clear is required for this policy update if the existing
exposure/index deployment prerequisites are already satisfied.

Current privacy, moderation, accepted-follow, blocked-account and visibility
checks remain server-side. Profiles, direct links, Search and saved content stay
accessible intentionally. Automatic recommendations cannot opt out of exclusion
using `includeViewed`, page numbers or a new session.

## Automated validation

- Backend discovery suite: 568 integration assertions; nine within-tier ranking
  tests; nine permanent-exclusion tests; four watched-refresh race tests;
  230 unique Clips across 24 pages; canonical follow-state and migration checks.
- Permanent tests exercise actual controllers and MongoDB persistence: three
  ten-Post refresh cycles, both surfaces, session-record expiration, another
  device/session, text at position 1, image at 9, mixed media at 50, retries,
  concurrent acknowledgments for all four media types, direct access, exact
  45-day boundary, older eligibility, compatibility personalized-feed controller,
  no consumed fallback, unchanged reservation TTL and no exposure TTL.
- Recommendation/engagement and privacy suites passed. Backend production build
  passed. No database/deployment scripts changed.
- Web: 148 tests in 18 focused suites passed, covering pending/failed reports,
  remount/refresh, active-image mixed carousels, Clips exhaustion, media sizing,
  prefetching, audio ownership and selected-Clip navigation. Production and
  fixture builds passed.
- Native: 43 focused tracker, outbox, geometry, Home, Clips reselect/navigation
  and timestamp tests passed. Native TypeScript passed, Android arm64 release
  compiled, and the iOS Hermes bundle exported successfully.
- Web full TypeScript still reports pre-existing `MatchInterface.tsx` WebRTC
  type errors and a `Profile.tsx` initialization-order error. These were not
  introduced or changed here. No new error appeared in changed source.

## Browser and device evidence

The loopback-only fixture uses real recommendation/exposure HTTP controllers,
real local MongoDB and 320 disposable seeded Posts; it does not return canned
recommendation pages. Only nonessential UI APIs and local media are stubbed.
No production accounts, content, exposures or engagement counts are modified.

Desktop/mobile Chrome and desktop/mobile WebKit each passed three reload cycles
of ten mixed Home posts, then ten meaningfully played Clips. Every counted item
required an acknowledged exposure HTTP response and a canonical database row.
Twelve new-session Home/Clips response comparisons per environment returned zero
confirmed consumed IDs. A second browser context without the first context's
local history also verified authoritative exclusion.

The Samsung SM-S928B passed three native ten-plus-Post refresh cycles (12, 23,
then 33 cumulative acknowledged exposures), Home → Clips → Home, ten actual
Clips exposures and app restart: seven response comparisons, zero repeats.
The 45-record native snapshot included image, mixed and video posts. A targeted
text-only local fixture check then qualified three visible text cards and
excluded all three on refresh. Only disposable catalog eligibility was adjusted
for that focused check and restored afterward; no production data was changed.

Physical Samsung Chrome 155.0.8059.79 also passed three ten-mixed-Post reload
cycles plus ten Clips: 40 confirmed exposures, 12 response comparisons and zero
repeats or page errors. A fresh desktop Web context using the native fixture's
same account excluded 46 native-recorded exposures without local history. Its
newly qualified Web exposure was then excluded by a fresh native-compatible
recommendation request, confirming both directions through the actual backend.

Native validation used a separately identified arm64 QA release pointed at the
loopback fixture over USB reverse. The QA app was removed after testing, and
the normal production app was restored signed in as Zoro, with its unchanged
build-22 installation timestamp and data. The reproducible QA APK remains in
the artifact directory. USB forwarding was removed. The standard local Android
build output was rebuilt without the QA package/API overrides.
WebKit on macOS is not a physical iPhone Safari test; no native iPhone is connected.

## Performance checks

Local indexed MongoDB, 231 eligible videos, page size ten, rolling 100-ID hints:

| Surface | Unique / pages | First | Median | P95 |
| --- | --- | ---: | ---: | ---: |
| Home | 231 / 24 | 37.34 ms | 25.56 ms | 37.34 ms |
| Clips | 231 / 24 | 46.88 ms | 24.45 ms | 46.88 ms |

A 20,000-row exposure-history check returned ten eligible records in 30.09 ms.
These are local synthetic request timings, not production DocumentDB latency,
capacity guarantees, or a controlled before/after speedup measurement. The
implementation does not download lifetime history, mount additional players,
change video preloading budgets or introduce playback delays. Actual production
DocumentDB explain plans/load remain a rollout check.

## Deployment audit and remaining rollout steps

Read-only ECS/ECR inspection found production `arc-cluster/arc-backend` on task
revision 196, image tag `6eead1b`, migration marker 2. The downloaded image's
discovery, exposure and recommendation source matched the pre-change local
version, including `unseen-age-neutral-v1` and non-video fallback. Thus the new
policy is **not yet deployed**. The public Web referenced `index-BD54Qp6A.js`.
The normal installed Samsung app was version 1.0.0/build 22, last updated
2026-10-17 04:42:03 before this task. The exposure endpoint exists and requires
authentication (unauthenticated request returned 401).

Earlier approved read-only production diagnostic output confirmed compliant
exposure/delivery/state/Post indexes and zero writes. That is historical audit
evidence, not a fresh production data replay during this task. No production
migration, deploy, service update or new ECS diagnostic task was run here.

After approval: deploy the backend through the existing gated `deploy.sh`,
publish the Web changes, and release the native changes using normal signing.
The existing deployment index verification remains in place; this policy itself
requires no new backfill. Then repeat authenticated production refresh tests and
DocumentDB latency/index verification. Local source/tests must not be described
as a completed production rollout.

## Files changed in this task

Backend:

- `src/legacy-src/services/{discoveryRankingService,contentExposureService,recommendationService}.js`
- `src/legacy-src/services/discoveryRanking.integration.test.mjs`
- `src/legacy-src/services/discoveryAgeNeutral.integration.test.mjs` (legacy filename; now within-tier tests)
- `src/legacy-src/services/permanentDiscovery.integration.test.mjs`
- `package.json` (include permanent tests in the discovery command)
- `scripts/discovery-validation-fixture.mjs`
- `scripts/validate-permanent-discovery.mjs`
- `scripts/validate-permanent-discovery-android.mjs`
- `scripts/validate-discovery-cross-client.mjs`
- `scripts/validate-discovery-browser.mjs` (current policy assertion)
- `docs/discovery-recommendations.md` and this report
- `docs/validation/permanent-discovery-45d.json` (canonical-ID comparisons)

Web:

- `src/utils/recommendationExposure.ts` and `.test.ts`
- `src/components/MediaSwiper.tsx` and `.exposure.test.tsx`
- `src/pages/Clips.tsx`, `ClipsFeedSession.contract.test.ts`, `Dashboard.feedStability.test.tsx`
- `docs/recommendations/web-exposure-validation.md`

Native (the worktree already contained unrelated user changes):

- `app/(tabs)/index.tsx`, `app/(tabs)/clips.tsx`
- `src/services/exposureOutbox.ts` and `.test.mts`
- `src/services/clipsTabReselect.contract.test.mjs`
- `src/components/HomeFeed.contract.test.mjs`

Raw build/test/browser/device evidence: `/tmp/squadhunt-45d.LQE3eC/`.
The fixture and QA package are for validation only, not production releases.

## Canonical-ID refresh verification table

All rows use actual response IDs and acknowledged, persisted exposure records.
For compactness the table shows the last six hex characters of each Post ID;
[the complete 24-character canonical ID sets](validation/permanent-discovery-45d.json)
are retained alongside this report. Each comparison uses the full ID, not these
abbreviations. Browser cycle 1/2/3 checks compare 10/20/30 consumed IDs respectively.

Test | Previously Viewed IDs (suffixes) | IDs Returned After Refresh (suffixes) | Repeated IDs | Result
--- | --- | --- | --- | ---
desktop-chrome refresh 1 | de8c83, de8cc1, de8c9f, de8cc9, de8ccb, de8cb2, de8c7b, de8cc4, de8c9e, de8c7e | de8cb7, de8caf, de8ca2, de8cbe, de8ccc, de8cc8, de8cc7, de8c7f, de8c87, de8c8a | None (0) | PASS
desktop-chrome refresh 2 | de8c83, de8cc1, de8c9f, de8cc9, de8ccb, de8cb2, de8c7b, de8cc4, de8c9e, de8c7e, de8cbb, de8ca6, de8ccf, de8c72, de8c9b, de8ca3, de8c96, de8ccc, de8cba, de8cb3 | de8ce3, de8cc0, de8cd3, de8cb6, de8c9a, de8cc5, de8cdd, de8cd6, de8cbe, de8ccd | None (0) | PASS
desktop-chrome refresh 3 | de8c83, de8cc1, de8c9f, de8cc9, de8ccb, de8cb2, de8c7b, de8cc4, de8c9e, de8c7e, de8cbb, de8ca6, de8ccf, de8c72, de8c9b, de8ca3, de8c96, de8ccc, de8cba, de8cb3, de8cc8, de8cd4, de8ccd, de8c8f, de8c97, de8cc7, de8cb7, de8cbe, de8cab, de8ce2 | de8cef, de8ce0, de8c86, de8caa, de8cc2, de8cda, de8cd3, de8c7f, de8cea, de8ca2 | None (0) | PASS
mobile-chrome refresh 1 | de8c9b, de8cbe, de8c8f, de8cc8, de8cc7, de8cc5, de8c96, de8cb7, de8cc4, de8cc2 | de8ccb, de8c7e, de8c9f, de8cab, de8ca6, de8cb3, de8c72, de8ca3, de8c9a, de8cbf | None (0) | PASS
mobile-chrome refresh 2 | de8c9b, de8cbe, de8c8f, de8cc8, de8cc7, de8cc5, de8c96, de8cb7, de8cc4, de8cc2, de8ccc, de8cba, de8cc1, de8c7b, de8cd4, de8ccd, de8caf, de8c82, de8c8a, de8ccb | de8cc9, de8c9e, de8c7e, de8c97, de8cbb, de8ccf, de8ce0, de8cde, de8cd3, de8cb3 | None (0) | PASS
mobile-chrome refresh 3 | de8c9b, de8cbe, de8c8f, de8cc8, de8cc7, de8cc5, de8c96, de8cb7, de8cc4, de8cc2, de8ccc, de8cba, de8cc1, de8c7b, de8cd4, de8ccd, de8caf, de8c82, de8c8a, de8ccb, de8cbb, de8cab, de8cc9, de8ce2, de8cce, de8cd9, de8c97, de8c86, de8c7e, de8cdc | de8c83, de8ca6, de8cb2, de8ca3, de8c77, de8cef, de8cd5, de8ce7, de8c9e, de8c7f | None (0) | PASS
desktop-webkit refresh 1 | 9326bb, 932703, 9326f3, 9326db, 93270b, 9326c7, 9326f6, 9326be, 932708, 9326b7 | 9326ff, 9326ee, 93270a, 932714, 9326e6, 9326fe, 932713, 9326e3, 9326f4, 9326e9 | None (0) | PASS
desktop-webkit refresh 2 | 9326bb, 932703, 9326f3, 9326db, 93270b, 9326c7, 9326f6, 9326be, 932708, 9326b7, 932713, 93270a, 9326d3, 93271b, 93270d, 932706, 932714, 9326e3, 932719, 9326ee | 9326d7, 932717, 93270f, 9326c6, 932724, 932718, 93271d, 932710, 932727, 932702 | None (0) | PASS
desktop-webkit refresh 3 | 9326bb, 932703, 9326f3, 9326db, 93270b, 9326c7, 9326f6, 9326be, 932708, 9326b7, 932713, 93270a, 9326d3, 93271b, 93270d, 932706, 932714, 9326e3, 932719, 9326ee, 9326b6, 932702, 9326ff, 9326e2, 932721, 93270c, 932705, 932711, 9326c3, 9326bf | 93272b, 932724, 9326e6, 93271e, 9326fa, 932729, 932716, 9326d1, 9326c0, 9326f5 | None (0) | PASS
mobile-webkit refresh 1 | 9326e3, 93270b, 9326d3, 9326b6, 9326bb, 9326db, 9326be, 932706, 932704, 93270d | 9326c3, 9326ff, 932712, 9326ee, 93270f, 932717, 93270a, 9326de, 9326bf, 9326f6 | None (0) | PASS
mobile-webkit refresh 2 | 9326e3, 93270b, 9326d3, 9326b6, 9326bb, 9326db, 9326be, 932706, 932704, 93270d, 932714, 9326ff, 932713, 93271b, 9326ea, 932702, 93270f, 9326d7, 9326c7, 9326ef | 932712, 932703, 932721, 9326fe, 9326d2, 932708, 9326de, 9326e6, 9326b7, 93271f | None (0) | PASS
mobile-webkit refresh 3 | 9326e3, 93270b, 9326d3, 9326b6, 9326bb, 9326db, 9326be, 932706, 932704, 93270d, 932714, 9326ff, 932713, 93271b, 9326ea, 932702, 93270f, 9326d7, 9326c7, 9326ef, 9326c3, 932703, 93270a, 9326bf, 932725, 9326da, 932719, 932716, 9326e6, 932711 | 9326e7, 9326e2, 93272c, 9326b7, 9326f6, 932722, 9326f3, 932709, 9326f0, 9326b9 | None (0) | PASS
physical-android-chrome refresh 1 | 584838, 584849, 58482c, 584855, 584866, 58482d, 584820, 584850, 584863, 58483d | 58486c, 584867, 584870, 58485e, 584825, 584862, 58483c, 584854, 584875, 584828 | None (0) | PASS
physical-android-chrome refresh 2 | 584838, 584849, 58482c, 584855, 584866, 58482d, 584820, 584850, 584863, 58483d, 584851, 58481d, 584821, 584844, 584835, 584854, 58486a, 584874, 584811, 584873 | 584831, 584878, 584867, 58481c, 584839, 584815, 584834, 58487c, 584877, 584860 | None (0) | PASS
physical-android-chrome refresh 3 | 584838, 584849, 58482c, 584855, 584866, 58482d, 584820, 584850, 584863, 58483d, 584851, 58481d, 584821, 584844, 584835, 584854, 58486a, 584874, 584811, 584873, 584860, 584810, 584880, 58486b, 58487c, 584879, 584865, 584871, 584841, 58485c | 58485d, 58488a, 584885, 58481c, 584888, 58488d, 584818, 584817, 58486d, 58487e | None (0) | PASS
Samsung native Home refresh cycle 1 | 733b1f, 733b23, 733b33, 733b60, 733b6f, 733b77, 733b78, 733b7e, 733b7f, 733b81, 733b86, 733b8c | 733b21, 733b1d, 733b79, 733b29, 733b71, 733b59, 733b24, 733b41, 733b65, 733b44 | None (0) | PASS
Samsung native Home refresh cycle 2 | 733b1d, 733b1f, 733b21, 733b23, 733b24, 733b29, 733b33, 733b41, 733b44, 733b59, 733b60, 733b65, 733b6f, 733b71, 733b77, 733b78, 733b79, 733b7e, 733b7f, 733b81, 733b83, 733b86, 733b8c | 733b38, 733b4c, 733b55, 733b28, 733b30, 733b91, 733b3d, 733b85, 733b49, 733b88 | None (0) | PASS
Samsung native Home refresh cycle 3 | 733b1d, 733b1f, 733b21, 733b23, 733b24, 733b28, 733b29, 733b30, 733b33, 733b38, 733b3d, 733b41, 733b44, 733b49, 733b4c, 733b55, 733b59, 733b60, 733b65, 733b6f, 733b71, 733b77, 733b78, 733b79, 733b7e, 733b7f, 733b81, 733b83, 733b85, 733b86, 733b88, 733b8c, 733b91 | 733b7c, 733b6a, 733b92, 733b7d, 733b5d, 733b84, 733b50, 733b72, 733b68, 733b53 | None (0) | PASS
Samsung native Home to Clips | 733b1d, 733b1f, 733b21, 733b23, 733b24, 733b28, 733b29, 733b30, 733b33, 733b38, 733b3d, 733b41, 733b44, 733b49, 733b4c, 733b55, 733b59, 733b60, 733b65, 733b6f, 733b71, 733b77, 733b78, 733b79, 733b7e, 733b7f, 733b81, 733b83, 733b85, 733b86, 733b88, 733b8c, 733b91 | 733ba1, 733bb6, 733b98, 733b5c, 733bbb, 733b8a, 733ba4, 733b93, 733baf, 733b8f | None (0) | PASS
Samsung native Clips to Home | 733b1d, 733b1f, 733b21, 733b23, 733b24, 733b28, 733b29, 733b30, 733b33, 733b38, 733b3d, 733b41, 733b44, 733b49, 733b4c, 733b55, 733b59, 733b5c, 733b60, 733b65, 733b6f, 733b71, 733b77, 733b78, 733b79, 733b7c, 733b7e, 733b7f, 733b81, 733b83, 733b85, 733b86, 733b88, 733b8a, 733b8c, 733b8f, 733b91, 733b93, 733b98, 733ba1, 733ba4, 733baf, 733bb6, 733bbb | 733b50, 733ba2, 733b72, 733b99, 733b6b, 733b84, 733b8b, 733b92, 733b69, 733b6e | None (0) | PASS
Samsung native QA app restart | 733b1d, 733b1f, 733b21, 733b23, 733b24, 733b28, 733b29, 733b30, 733b33, 733b38, 733b3d, 733b41, 733b44, 733b49, 733b4c, 733b55, 733b59, 733b5c, 733b60, 733b65, 733b6f, 733b71, 733b77, 733b78, 733b79, 733b7c, 733b7e, 733b7f, 733b81, 733b83, 733b85, 733b86, 733b88, 733b8a, 733b8c, 733b8f, 733b91, 733b93, 733b98, 733ba1, 733ba4, 733baf, 733bb6, 733bbb, 733bc9 | 733b9a, 733b7a, 733b25, 733b8d, 733b73, 733b80, 733b39, 733ba6, 733b2c, 733b9d | None (0) | PASS
Samsung native QA app restart | 733b1d, 733b1f, 733b21, 733b23, 733b24, 733b28, 733b29, 733b30, 733b33, 733b38, 733b3d, 733b41, 733b44, 733b49, 733b4c, 733b55, 733b59, 733b5c, 733b60, 733b65, 733b6f, 733b71, 733b77, 733b78, 733b79, 733b7c, 733b7e, 733b7f, 733b81, 733b83, 733b85, 733b86, 733b88, 733b8a, 733b8c, 733b8f, 733b91, 733b93, 733b98, 733ba1, 733ba4, 733baf, 733bb6, 733bbb, 733bc9 | 733b8d, 733b9d, 733ba2, 733b6a, 733b76, 733b9a, 733b1a, 733b7d, 733b62, 733b4e | None (0) | PASS
Samsung native text-only refresh | 733b32, 733b3a, 733b56 | 733b62, 733b46, 733b36, 733b52, 733b5e, 733b2a, 733b42, 733b1e, 733b4e, 733b5a | None (0) | PASS
Native account to fresh Web storage | 733b1d, 733b1f, 733b21, 733b23, 733b24, 733b28, 733b29, 733b30, 733b33, 733b38, 733b3d, 733b41, 733b44, 733b49, 733b4c, 733b55, 733b59, 733b5c, 733b60, 733b65, 733b6f, 733b71, 733b77, 733b78, 733b79, 733b7c, 733b7e, 733b7f, 733b81, 733b83, 733b85, 733b86, 733b88, 733b8a, 733b8c, 733b8d, 733b8f, 733b91, 733b93, 733b98, 733ba1, 733ba4, 733baf, 733bb6, 733bbb, 733bc9 | 733b45, 733ba7, 733b84, 733b76, 733b96, 733b6c, 733b5d, 733ba2, 733b50, 733b4d | None (0) | PASS

