# Discovery recommendations

Home Feed and Clips use the same authenticated backend recommendation policy.
Videos have a strict no-repeat policy: after at least one second of meaningful
exposure, the same canonical video is excluded from both Home Feed and Clips
recommendations. A one- or two-second watch is sufficient; completion is not
required. Watching on one surface excludes it on the other, across sessions and
devices. Videos with explicit interaction history are also excluded.

Eligible candidates are ordered by these strict tiers:

1. Unseen and never explicitly interacted with, published in the last 7 days.
2. Other unseen and never explicitly interacted with content.
3. Previously viewed **non-video** posts with no explicit interaction, after unseen content is exhausted.
4. Previously interacted with **non-video** posts, after all higher tiers are exhausted.

Tiers 3 and 4 never return videos, including when all unseen videos have been
exhausted. Clips stops with no continuation instead of recycling watched videos.
Non-video Home Feed fallback behavior is unchanged. Public view counts and
metadata prefetching remain independent from meaningful exposure.

The 7-day boundary uses the server's current UTC time and `Post.createdAt`.
The existing relevance, content quality, following, and diversity signals operate
inside each tier. A popularity or paid boost score cannot promote a lower tier
above available higher-tier inventory. Already visible cards stay in their
existing order; the policy applies to subsequent recommendation requests.

## Persistent exposure and delivery reservations

`ContentExposure` stores one document per authenticated user and canonical Post:

- `_id`: `userId:postId`.
- `user`, `post`, and `contentType` (`post` or `video`).
- `firstViewedAt` and `lastViewedAt`, when a meaningful view was observed.
- Monotonic `interacted`, `firstInteractedAt`, and `lastInteractedAt`.

An unlike or unsave does not erase historical exposure or interaction. Home Feed
videos and Clips are the same Post record, so watching either surface updates
the same identity. Matching media URLs never merges independent content.
Intentional profile, saved, search, and direct-link access remains available.
The no-repeat rule is enforced against the actual Post's video media, not only
the historical `contentType` hint, which may be generic in older exposure rows.
Delivery/session expiry never makes a persistently watched video unseen again.

Qualified `view`, `watch`, and `dwell` events from existing engagement endpoints
now update exposure immediately as well as analytics. They use the same one-second
threshold as the private exposure endpoint. A metadata GET or zero-duration public
view event still does not qualify. Short watches therefore do not depend on
rerunning the historical migration before they affect the next recommendation.

`RecommendationDelivery` is separate from exposure. Its `session:post` identity
prevents a recommendation session from re-serving fetched metadata. Delivery
reservation expiry allows bounded session storage without erasing durable view
history. Fetching or preloading a recommendation is not a meaningful view and
does not increment public video view counts.

Deliveries expire after seven days, with an explicit timestamp check as well as
the database TTL monitor. Atomic unique reservations prevent concurrent requests
from returning the same item. The v3 cursor restores this server session even if
the client omits its seed on the next page; no lifetime ID array or deep database
offset is encoded in it. Authorized rolling client exclusions and explicitly
opened target videos are reserved in the same session. A direct target is still
returned separately, so Home-to-Clips and intentional Search navigation can
open previously viewed content immediately.

`RecommendationState` keeps a 60-second, audience-specific checkpoint after both
unseen tiers have been confirmed exhausted. Every request still checks newly
created or updated posts; changed following/privacy/block filters invalidate the
checkpoint. Its expiry never extends beyond the earliest delivery expiry. This
avoids repeatedly scanning the old catalog during repeat browsing. It stores no
cached recommendation list and cannot promote a stale interacted candidate.
Ranked feed lists are not cached in Redis; durable exposure is never held only
in Redis. Exposure/eligibility reads use the primary database.

Exposure data is private, associated only with the authenticated user, and is
not exposed as public watch history. Recommendations still apply current post
visibility, moderation, account status, accepted Follow relationships, blocks,
and per-viewer report suppression before returning content.

## Deployment prerequisite: indexes and historical backfill

Production disables automatic MongoDB collection/index creation. Deploying the
model files alone does not provision the indexes.

### Standard ECS deployment

Run `bash deploy.sh` as usual. It runs these steps inside the new image's ECS
preflight, after loading deployment secrets and **before switching the service
to the new revision**:

- First discovery rollout or upgrade to exposure backfill v2: read-only audit,
  `--apply`, then `--verify`.
- Subsequent deployments: `--verify` only, without rescanning historical signals.

No manual commands are required after deploying through this script. The active
task definition's `DISCOVERY_EXPOSURE_MIGRATION_VERSION=2` records the completed
rollout. A newly registered revision cannot receive traffic until all preflight
steps succeed; a failed backfill blocks activation and is retried on the next
deployment. Merely registering a task definition does not mark the active
service as migrated. Missing/conflicting indexes block even a routine deployment.

Backfill v2 reconciles qualified historical view/watch/dwell events created
after the initial backfill but before those existing endpoints started updating
exposure live. It reuses the additive, idempotent migration; no new collections,
schema changes or manual post-deployment commands are required. It still does not
guess exposure from unqualified zero-duration views or metadata prefetches.

If changing the target database or intentionally reconciling historical data,
use `FORCE_DISCOVERY_EXPOSURE_MIGRATION=1 bash deploy.sh` to rerun audit and
backfill. This is additive and idempotent, but scans history, so it should not be
enabled for every release. Do not manually copy the version marker onto an
unmigrated service. Existing financial maintenance-window gates remain unchanged.

### Manual or nonstandard deployment

For staging validation or a release that bypasses `deploy.sh`, run the following
in the intended deployment environment with the new source and dependencies,
**before enabling the new backend revision**. Inspect the aggregate audit report
before applying:

```sh
node scripts/migrate-discovery-exposure.js
node scripts/migrate-discovery-exposure.js --apply
node scripts/migrate-discovery-exposure.js --verify
```

Supply `MONGODB_URI`, `MONGODB_TLS`, and `MONGODB_TLS_CA_FILE` through the existing
deployment secret configuration. The script supports DocumentDB TLS and disables
retryable writes when TLS is configured, matching other operator migrations.
It does not print user identities, individual viewing events, or connection
strings.

Default audit mode reads existing indexes and historical signal sources. It
never creates collections, builds indexes, or writes exposure records. The
report's `validOperations` counts valid historical signal operations, not unique
users or content. Different signals may refer to the same exposure. `--verify`
checks collection/index existence and options, including TTL/unique settings,
and exits with code 2 if they are missing or inconsistent.

`--apply` creates the three recommendation collections, adds their missing schema
indexes and the two discovery-update Post indexes, and streams
historical data in batches of 250. Existing indexes with conflicting options
are reported as noncompliant instead of being dropped automatically. Resolve
such conflicts during a reviewed database maintenance change and verify again.
The script never drops records or indexes.

Backfill sources are:

- `PostEngagement` view/watch/dwell events with at least 1,000 ms of recorded
  exposure, using their recorded server timestamps.
- Historical explicit like/comment/share/save engagement events, including
  unlike/unsave events that prove an action subsequently removed.
- Actual embedded Post likes/comments/shares and User saved-post references.

Server delivery `impression` records, unqualified short observations, and
zero-duration view events emitted by older GET post-detail requests are excluded.
Legacy `Post.viewedBy` is also excluded because older direct GET requests and
instant clip activation populated it before meaningful playback. Its timestamp
alone cannot distinguish a real observation from a fetch or brief skip. These
historical public-view records remain unclassified until a qualified exposure
or explicit action occurs.
Public view counters are never changed by the backfill.

Each batch checks referenced users and posts in bulk. Missing posts and deleted
or inactive user accounts are skipped. Historical explicit actions without a
timestamp still establish `interacted: true`; missing dates are never replaced
with the migration execution date. View-only records without any valid date
are skipped. First dates use `$min`, last dates use `$max`, and interaction is
monotonic, so retries and reruns cannot turn interacted content back into unseen
content. Duplicate upsert races with live traffic are retried as updates.

The new collections must exist before aggregation lookups run: DocumentDB
can return an empty input stream when the lookup target collection is absent.
The migration uses ordinary reads and classic updates, not MongoDB-only
correlated lookup pipelines, aggregation update pipelines, or `$facet`.
Server startup also materializes the three recommendation collections so an
empty lookup collection cannot silently empty an otherwise valid feed.

Exposure has a unique `(user, post)` index in addition to its deterministic
`_id`, plus `(user, interacted, lastViewedAt, post)` and
`(user, interacted, lastInteractedAt, post)` indexes for repeat retrieval.
Delivery/state have expiry TTL indexes and owner cleanup indexes. Post gets
`discovery_updates` on `(isActive, updatedAt, _id)` and
`discovery_video_updates` on `(isActive, content.media.type, updatedAt, _id)`.
The migration deliberately does not provision unrelated historical Post indexes.

## Retention and account closure

Persistent exposure has no automatic TTL: expiration would make old content
appear unseen after login or on another device. It stores only the minimum
identity, timestamps, content type, and historical-interaction flag needed for
ranking. Existing detailed engagement analytics remain a separate collection.

Owner account closure and administrator hard deletion must remove the user's
ContentExposure, RecommendationDelivery and RecommendationState records; both
account-closure paths now include that cleanup. Content eligibility
is checked from current content/account state, so retaining a historical exposure
cannot make deleted or restricted content eligible again. Ordinary logout clears
the session, not durable exposure history.

Changing exposure retention or adding a viewing-history export/reset feature
requires a separate product/privacy decision. The repository contains no existing
user-facing watch-history export or retention setting to reuse.

## Pagination and finite catalogs

Recommendation pages must advance through remaining eligible inventory rather
than recycle a fixed candidate pool. Delivery reservations and canonical Post
IDs prevent repeated entries within a session. Each new request rechecks current
exposure and explicit actions so a previously prepared candidate cannot bypass
the strict tiers after an action on another device.

Unseen retrieval streams the audience's indexed publication order with equality
joins to one exposure key and one session-delivery key, before applying a bounded
candidate limit (at most 240). This is a per-query work window, not a catalog cap:
unselected candidates remain eligible for subsequent requests. Only selected
cards are fully populated. Repeat retrieval starts from the viewer's indexed
exposure rows in least-recent order, rather than sorting the whole Post catalog.
Interest signals use bounded recent histories; exact eligibility does not use
the previous 400/1,500-row view-history truncation. Saved status is projected for
only the returned cards in one batch.

The legacy `includeViewed=true` client hint cannot bypass the tiers. Four bounded
reservation attempts prevent contention from creating a request loop; partial
contention retains a continuation instead of falsely declaring exhaustion.
No new media players, video downloads, scroll resets or UI rankings were added.

Fresh unseen inventory precedes older unseen inventory. Only confirmed unseen
exhaustion permits **non-video Home Feed** viewed fallback, followed by non-video
interacted fallback. Repeat inventory favors least recently viewed non-video
posts; watched videos are never recycled, even with `includeViewed=true` or a
new client recommendation cycle. A finite or empty catalog has
an explicit termination/continuation state; it must not cause a tight empty-page
request loop or claim that more unique records exist than the catalog contains.

## Baseline audit and measurement

Before implementation, the ranker loaded only 48 hours/400 seen rows, a bounded
recent interaction profile, and time-decaying item penalties. API delivery was
recorded as an impression. Such candidate-window penalties did not enforce
global unseen eligibility or durable cross-session discovery priorities.

Existing recommendation unit/contract tests passed. The pre-change memory MongoDB
integration test reached 230 eligible unique clips across 23 pages and excluded
a deleted pending candidate and a private clip. The author follow-state
integration test also passed.

An additional local indexed MongoMemoryServer benchmark used 231 eligible video
posts from five authors, limit 10, and a rolling client exclusion window of 100.
It includes backend selection, formatting, and database work; it excludes mobile
rendering, network latency, CDN transfer, and production DocumentDB load:

| Pre-change surface | Returned unique records | Pages | First request | Median request | P95 request | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Home Feed | 124 / 231 | 13 | 108.47 ms | 22.52 ms | 108.47 ms | 421.33 ms |
| Clips | 231 / 231 | 24 | 35.75 ms | 14.32 ms | 35.75 ms | 408.99 ms |

Home Feed terminated before reaching all eligible records, demonstrating the
ranked-cursor candidate skip defect. These baseline timings are a local reference,
not production latency guarantees. Record updated results under equivalent
conditions and verify staging DocumentDB explain plans/index usage before rollout.

Migration regression tests run with:

```sh
node --test scripts/migrate-discovery-exposure.test.js
```

The tests cover read-only audit behavior, qualified views versus prefetched or
instant legacy views, historical actions, missing dates, orphaned references,
monotonic updates, reruns, duplicate upsert races, and index/TTL verification.

The aggregation uses basic equality `$lookup`, which is documented by
[Amazon DocumentDB](https://docs.aws.amazon.com/documentdb/latest/devguide/functional-differences.html#functional-differences.with-mongodb)
and avoids correlated subqueries. Scalar exposure keys use
[`$toString`, available in DocumentDB 4.0 and later](https://docs.aws.amazon.com/documentdb/latest/developerguide/toString.html).
Actual staging DocumentDB execution plans remain a release check.

## Validation and changed files

Backend `npm run test:discovery` passed 571 integration assertions plus the
230-unique-Clip pagination regression, canonical author follow-state test, and
three migration tests. Coverage includes all four strict tiers, the inclusive
7-day freshness boundary (and older by one millisecond), 49-hour/six-day unseen
content, 167/169-hour ordering, popularity not crossing tiers, canonical Home/Clips
identity, authenticated ownership, public-counter separation, save/unsave
history, one/two/three-second video exclusion, immediate legacy view/watch/dwell
exposure, no video recycling after refresh/session expiry/catalog exhaustion,
intentional watched-video navigation, simultaneous requests, new and newly-public uploads after exhaustion,
cursor-only session restoration, independent anonymous sessions, private/blocked/
suspended/deleted content, and finite empty catalogs. Both Home and Clips reach
all 231 seeded eligible items without repeating. A separate 20,000-row exposure
history check returned ten fresh unseen cards in 25.07 ms on local MongoDB.
This is synthetic execution time, not production latency or capacity testing.

For the one-second no-repeat update, the recommendation/engagement and privacy
suites and backend production build also passed. Web exposure tests passed 13
checks, native exposure trackers passed nine checks using
`node --experimental-strip-types --test src/services/recommendationExposure.test.mts`,
and the deployment gate passed six tests, including backfill v1-to-v2 rollout.
These are automated policy/tracker checks, not new physical-device playback
validation. No production migration or deployment was run for this update.

The existing recommendation and privacy suites and backend TypeScript build
passed. Web: 84 tests across 12 relevant suites passed, and production fixture
build passed. Native: 33 relevant tests and TypeScript passed; Android and iOS
Hermes bundles exported successfully. A final native short-loop regression is
also included in the exposure tests.

An isolated, equivalent-catalog comparison against backend commit
`f56735a05749e6f0352b40ffde86f9177b32a290` used the same 231 documents, five
authors, page size ten, 100-ID rolling exclusion window and local database
process for both implementations:

| Surface | Before unique coverage | After unique coverage | Before median | After median | Before P95 | After P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Home Feed | 121 / 231 | 231 / 231 | 23.82 ms | 18.69 ms | 110.15 ms | 42.30 ms |
| Clips | 231 / 231 | 231 / 231 | 15.99 ms | 17.12 ms | 38.80 ms | 36.64 ms |

The new policy adds a small median Clips selection cost in this synthetic run;
it is not a universal latency improvement claim. Home total run time increases
because it now reaches 231 records over 24 pages instead of stopping at 121.
See [recorded results](discovery-ranking-benchmark.json). Reproduce with
`DISCOVERY_BASELINE_REF=f56735a05749e6f0352b40ffde86f9177b32a290 npm run benchmark:discovery`.
Actual DocumentDB load and network performance remain unmeasured.

Controlled Web checks passed on desktop Chromium, mobile Chromium/WebKit, and
the connected Samsung SM-S928B running Chrome 155. Actual paused/preloaded and
rapidly skipped clips were not marked seen; visible cards and progressing Clips
reported exposure after one second. See the
[Web validation report](../../frontend/docs/recommendations/web-exposure-validation.md).
WebKit on macOS is not physical iPhone Safari validation. Native Android/iOS
runtime testing against the new backend has not been performed. Expo's existing
missing `ios.appleTeamId` warning remains relevant to signed native releases.

Known existing checks: Web has MatchInterface WebRTC/Profile type errors and
three PostDetail auth test request-count failures caused by the prior SEO GET;
native has a stale ClipsScrollPlayback contract expecting `item._id` instead of
the existing `feedInstanceKey || item._id`. These unrelated behaviors were kept.

Modified/added files for this change (mobile's pre-existing edits were preserved):

- Backend entry points: `package.json`, `src/server.ts`,
  `src/modules/posts/posts.routes.ts`, `src/legacy-src/routes/posts.js`.
- Backend controllers: `postController.js`, `authController.js`,
  `adminController.js` under `src/legacy-src/controllers/`.
- Models: `ContentExposure.js`, `RecommendationDelivery.js`,
  `RecommendationState.js`, `Post.js` under `src/legacy-src/models/`.
- Services: `contentExposureService.js`, `discoveryRankingService.js`,
  `recommendationService.js`, `discoveryRanking.integration.test.mjs`,
  `recommendationService.clipsPagination.test.mjs` under
  `src/legacy-src/services/`; `src/legacy-src/utils/ensureDiscoveryCollections.js`.
- Backend scripts: `migrate-discovery-exposure.js`, its `.test.js`, and
  `benchmark-discovery-ranking.mjs`; this report and its benchmark JSON.
- Web: `src/utils/recommendationExposure.ts` and its test;
  `src/components/PostCard.tsx` and exposure test; `src/pages/Dashboard.tsx`,
  `Clips.tsx` and exposure test, `PostDetail.tsx`, `Profile.tsx`, `TeamProfile.tsx`
  and its test; `scripts/benchmark-mobile-media.mjs` and the Web validation report.
- Native: `app/(tabs)/index.tsx`, `app/(tabs)/clips.tsx`, `app/post/[id].tsx`,
  `src/services/recommendationExposure.ts` and its `.test.mts`.

The performance skill guided bounded history reads, indexed repeat queries,
incremental exhaustion checks and the isolated local benchmark. No production
database, deployed backend, or native installation was changed. Run the migration
and verify its indexes before a coordinated backend, Web and native release.
