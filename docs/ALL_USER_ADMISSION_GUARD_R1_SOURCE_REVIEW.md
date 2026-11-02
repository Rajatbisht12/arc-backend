# All-user admission guard — five-path source carrier

2 November 2026 IST. SOURCE REVIEW COMPLETE; MERGE AND IMAGE PUBLICATION PENDING.
No production operation occurred in this preparation. API220 remains the deployed
API; this packet does not alter its registered definition or running task.

The sealed candidate keeps source manifest
`d328315d548254f7b51cff001c64e8d931fa8da2f4a4a6d30803be9864617f21`.
It derives from the published API220 archive and changes exactly five paths:

| Application path | Reviewed behavior |
|---|---|
| src/legacy-src/services/videoUploadService.js | Reserve global capacity before new Session/S3 acceptance, after existing authentication, Integrity and owner checks. Accepted-session replay/recovery remains available when new intake is closed. |
| src/legacy-src/services/videoGlobalAdmission.js | Atomic durable single-document capacity and owner enforcement; exact retries charge once; unknown writes fail closed. Persisted manualHold skips reconciliation/release; malformed hold metadata blocks. A local telemetry hold clears only after a positively matched healthy native telemetry update. |
| src/infrastructure/jobs/videoQueueMetrics.js | Typed readonly Redis depth/age/paused telemetry; unknown, stale, future, missing, paused or unavailable observations cannot become healthy empty capacity. No Queue/Worker creation. |
| src/infrastructure/jobs/queue.ts | Independent bounded ten-second telemetry/reconciliation loop without enabling fair scheduling or an API encoding consumer. Normal ledger heartbeat writes need explicit later deployment authority. |
| src/config/secrets.ts | Explicit task-bound-api-v1 bootstrap allows all-mode/empty canary only for the opted-in API. Secret content cannot opt a process in. Other isolation checks and worker7's original bootstrap remain unchanged. |

The complete ZIP, human-readable patch and byte-identical five overlays are in
[the carrier](../release-tools/all-user-admission-api-r1/release/candidate.json).
All other API220 application paths, Dockerfile and dependencies are unchanged,
including Play Integrity, rollout eligibility checks, accepted background-intent
recovery and the tested private bounded-H264 delivery guard. No new legacy or
background acceptance path is enabled. This carrier deliberately does not copy
the dirty backend tree into the main application tree. Review the overlays/patch
and build the sealed archive only; the merged carrier HEAD is a provenance label.

## Targeted checks

23 outer tests pass on Node22 and26, with no failures/skips. Each run includes
TypeScript compilation of the exact ZIP and34 real isolated Mongo/HTTP cases:
concurrent distinct-owner admission, saturation, owner count/byte limits, exact
retry, failed/unknown reservation outcomes, database failure, pre-source/S3
rejection, manual-hold preservation and telemetry recovery. Six bootstrap tests
verify task/secret disagreement, all/empty compatibility, no secret opt-in and
closed stage flags. One actual local Redis ACL/outage test verifies the readonly
metric path. Controller tests verify strict builder parsing, tag collision,
wrong caller, dirty carrier, unknown build, bad index and consumed-journal guards.
Three offline AWS input models create no clients. These are local checks, not a
new native runtime certificate.

[Summary](evidence/all-user-admission-api-r1-preparation-2026-11-02/validation-summary.json),
[Node22](evidence/all-user-admission-api-r1-preparation-2026-11-02/focused-tests-node22.txt),
[Node26](evidence/all-user-admission-api-r1-preparation-2026-11-02/focused-tests-node26.txt).

## Preserved native accounting and staged release

Reuse the owner's closed-ledger and isolated atomicity findings; do not repeat
those investigations. The production ledger has one manual-held reservation of
1,800 work-seconds under the14,400-second budget. Its12,600 unreserved seconds do
not authorize admission. The fifteen-source interpretation applies only to
encoding accounting; source/Post/private media and independent historical holds
remain preserved. The new guard must retain the charged manual hold.

[Staged controls](../release-tools/all-user-admission-api-r1/staged-controls.PROPOSAL_ONLY.json)
select all-mode and empty canary for bootstrap qualification while explicitly
keeping POST_VIDEO_UPLOADS_ENABLED=false. GLOBAL_ADMISSION_ENABLED=true,
ADMISSION_BOOTSTRAP_MODE=task-bound-api-v1, BACKGROUND_PUBLISH_ENABLED=false,
PRIVATE_LEGACY_ENABLED=false and FAIR_SCHEDULING_ENABLED=false. The full JSON uses
the exact POST_VIDEO_ names. CLIP_HLS_WORKER_ENABLED=false;
POST_VIDEO_PRIVATE_DELIVERY_ENABLED=true. Ledger admissionOpen/costOpen remain
false; no cost expiry or budget is changed.

After separately approved image publication and actual digest readback, derive
one new task definition from the complete fresh live API220 configuration. Preserve
roles, secrets, network, logging, operational settings and accepted access; use
only the actual new immutable image and reviewed stage controls. Registration and
UpdateService each require their own exact approval. No new ARN, runtime digest
or service request is invented in this packet. No worker7 modification is needed.

The later guarded deployment approval must explicitly cover normal telemetry and
reconciliation writes while cost/intake are closed. Its runtime qualification must
bind actual image/boot, manual hold and exact counter membership, live heartbeat
and fail-closed behavior, all/empty bootstrap, unchanged worker7, accepted-session
and26intent preservation, authentication/private H264 playback and closed gates.
Only then prepare a separate finite cost/intake opening with exact capacity,
expiry and positive readback. Unknown outcomes HOLD without automatic rollback.
SamsungAPK26/non-xyz real upload and original1080pHEVC/4KHEVC/portrait qualification
remain subsequent approved acceptance checks; no device/camera result is inferred
here. Web release remains separate. No worker rebuild, Q0 or autoscaling operation
belongs to this build-only carrier.

## Immediate handoff

Review/merge the carrier through the normal upstream PR controls, verify its exact
merged bytes and run the Windows local checker in the build review. The next
production decision is solely the new image build/push; it grants no deployment or
upload opening. See [exact publication review](ALL_USER_ADMISSION_API_R1_BUILD_REVIEW.md).
