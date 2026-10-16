# Age-neutral Home Feed and Clips ranking

Implemented and validated 17 October 2026 (Asia/Kolkata). Not deployed or pushed.

## Audit and changes

The seven-day split was in `discoveryRankingService.js`: `FRESH_WINDOW_MS`,
the `createdAt` fresh/older partitions, and a four-tier selection loop. The
shared `scorePost` also supplied exponential upload-age points and a six-hour
new-post kicker. Automatic discovery called that scorer, so merely merging
the two unseen partitions would still have favored newer content.

The automatic recommendation policy is now:

1. All eligible unseen, non-interacted content, regardless of upload age.
2. Previously viewed non-video content, only after unseen exhaustion.
3. Previously interacted-with non-video content, as the final fallback.

Changes:

- Removed the seven-day constant, lower timestamp cutoff and fresh/older split.
- Removed upload-date ordering from bounded unseen candidate enumeration; it
  now uses stable indexed Post ID order. The existing relevance, personalization,
  engagement, quality, diversity and paid-placement logic ranks inside the
  bounded candidate windows. The 240-candidate query window is not a feed cap.
- `scorePost` is age-neutral by default. Only the separate intentional Search
  path opts into its previous upload-age behavior. This preserves unrelated
  Search behavior rather than replacing the removed rule with another window.
- Kept the upper publication-time guard so future-dated posts do not become
  eligible. Creation/update timestamps still support incremental exhaustion
  rechecks and remain in models and API responses.
- Simplified four priorities to three without changing the non-video repeat
  eligibility or least-recent-viewed fallback order.

## Video, persistence and pagination invariants

No exposure tracking or public view-count behavior was changed by this task.
The earlier pending watched-video fixes were preserved, including the final
primary exposure gate and client outboxes. Videos watched for at least one
second remain permanently excluded from automatic Home/Clips recommendations,
even when unseen inventory is exhausted. Direct targets/search/profiles remain
accessible. Home and Clips still share canonical Post exposure IDs.

`RecommendationDelivery` reservations still expire after exactly seven days.
`ContentExposure` still has no TTL. The existing 60-second exhaustion checkpoint
and delivery/session identity are preserved. No models, migration scripts,
deployment scripts, index definitions or retention policies were changed.

The response keeps `algorithm: discovery-v3` and compatible v3 cursors. It adds
`rankingPolicy: unseen-age-neutral-v1`, replaces `fresh_unseen_7d` with
`unseen_any_age`, and includes the policy in the exhaustion-checkpoint hash.
Old checkpoint proofs are revalidated; exposure history and delivery reservations
are not deleted or reset. There are no Redis ranked candidate lists to clear.
The existing `exhaustedFreshClips` response name is retained for compatibility;
it indicates unseen exhaustion, not upload-age eligibility.

## Automated tests

New regressions first failed on the old implementation (six policy failures),
then passed after the change. `npm run test:discovery` now includes nine new
age-neutral tests and the existing watched-video refresh tests.

Verified:

- Today's and 30-day-old unseen posts share tier 1 in both endpoints.
- Older content with stronger engagement can rank first.
- Following and author affinity still affect scores.
- Changing only the upload date leaves both helper and actual API ranking
  scores unchanged; tested across 1/6/7/8/30/365-day ages.
- Swapping publication dates in a 250-item catalog does not change stable
  candidate enumeration.
- Unseen → viewed non-video → interacted non-video priority remains strict.
- One-second watched videos stay excluded across Home/Clips refreshes.
- Reservation expiry is still seven days; exposure has no TTL.
- Old checkpoint hashes are revalidated without losing delivery deduplication.
- Existing tests preserve 1/2/3-second exposure, cross-surface exclusion,
  concurrent refresh safety, direct access, finite catalogs and privacy filters.
- Pagination returns all 231 unique seeded records over 24 pages on both
  surfaces. Separate Clips regression also passes 230 unique clips/24 pages.

Results:

| Check | Result |
| --- | --- |
| Discovery integration | 568 assertions PASS |
| Age-neutral + watched-refresh tests | 9 + 4 tests PASS |
| Clips pagination, follow state, migration regressions | PASS |
| `npm run test:recommendations` | PASS |
| `npm run test:privacy` | PASS |
| Backend production build / syntax / diff checks | PASS |
| Web exposure/feed/session regressions | 28 tests / 4 files PASS |
| Native exposure/outbox/Home/navigation regressions | 35 tests PASS |

Local seeded request medians were 24.57 ms (Home) and 24.20 ms (Clips).
The 20,000-row exposure-history request completed in 29.84 ms. These are local
MongoDB observations, not production DocumentDB capacity or speed guarantees.

## Browser and device validation

Reused the existing browser integration harness: unchanged local Web bundle →
actual post/exposure/recommendation controllers → disposable MongoDB, 231 video
Posts split between today and 30 days old. The older high-engagement fixture
appeared first; both ages appeared in the initial tier-1 response. Real video
playback and exposure writes were checked, not just mocked ranking output.

Each environment watched five Home videos and five Clips for at least three
seconds, performed six browser reloads and 24 fresh-session API checks. Every
response advertised `unseen-age-neutral-v1`; all returned recommendation rows
were tier 1. No watched videos repeated and no page errors occurred.

| Environment | Watched | Fresh-session checks | Result |
| --- | ---: | ---: | --- |
| Desktop Chrome | 10 | 24 | PASS |
| Mobile Chrome viewport | 10 | 24 | PASS |
| Physical Samsung SM-S928B / Chrome 155 | 10 | 24 | PASS |
| Desktop WebKit | 10 | 24 | PASS |
| Mobile WebKit viewport | 10 | 24 | PASS |

The Android CLI was unavailable, so existing ADB/Chrome debugging was used.
Only the temporary loopback-origin fixture tab was automated; production account
login/data were not changed. USB forwarding was removed and the native app was
returned to the foreground after testing. No native reinstall was necessary.

WebKit is macOS WebKit, not a physical iPhone/Safari test. Native Android/iOS
Home and Clips request/merge paths were audited: neither applies an independent
seven-day filter or upload-age sort. Both consume backend order. Native runtime
ranking against the new backend is not claimed: production was not deployed or
redirected to a fixture. Physical iOS was unavailable. These remain post-release
smoke checks; the shared backend regression and unchanged native contracts pass.

Temporary browser artifacts: `/tmp/squadhunt-age-neutral-{chrome,webkit,android-chrome}.json`
and adjacent screenshots/logs. They contain only disposable fixture identities.

## Files changed by this task

All paths are relative to `modular-backend/`:

- `src/legacy-src/services/discoveryRankingService.js`
- `src/legacy-src/services/recommendationService.js`
- `src/legacy-src/services/discoveryRanking.integration.test.mjs`
- `src/legacy-src/services/discoveryAgeNeutral.integration.test.mjs` (new)
- `src/legacy-src/services/recommendationService.freshness.test.js`
- `scripts/validate-discovery-browser.mjs` (mixed-age policy assertions)
- `package.json` (test entry point)
- `docs/discovery-recommendations.md`
- `docs/age-neutral-discovery-validation.md` (this report)

Existing uncommitted changes from the preceding exposure-fix task were retained.
No Web/native source files were changed for the age-neutral policy.

## Release requirements and limitations

This is a backend-only runtime policy change. No migration, cache purge, exposure
reset, Web release or app reinstall is needed specifically for this policy.
Deploy the backend through the normal reviewed release workflow; existing
preflight verification remains intact. The separate earlier pending exposure
fixes may still require their own Web/native releases. No deployment, migration,
commit or push was performed here. Currently visible/cached client cards are
not reordered; new backend recommendation requests use the new policy after
release.
