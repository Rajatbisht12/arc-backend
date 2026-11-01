# Session-only all-user API candidate — image publication only, unapproved

1 November 2026 IST. **SOURCE PREPARED/COMPILED; NO API IMAGE BUILD OR PUSH.**
New run/tag `pi-all-user-session-api-r1-20261101`, repository
`906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend`, linux/amd64.
This is an API-only image. It must never replace a worker image or launch a worker.

Fresh separately approved metadata observations confirmed arc-backend:219 and
indexc6e1708fdc0b05a4a56105759200f517cc906611b1692a0cf37691dcd4ecc9c1.
The source ZIP for that image is the exact sealed API219 archive, SHA256
42b7180b971262fa154571fa975db4f9ecc8387fea2abb80d926b10a9ea8210a.
Both API/worker services were stable desired/running1,pending0. That read authority
is permanently closed. No metadata receipt authorizes this image publication.

## Exact eight-file source delta; retain worker7 for session-only delivery

| File | Sole intended change |
|---|---|
| src/legacy-src/services/androidVideoAdmission.js | Add existing reviewed request-bound Google verdict validation |
| src/legacy-src/utils/postVideoPolicy.js | Export the existing50MiB Web ceiling alongside500MiB Android ceiling |
| src/legacy-src/services/videoUploadService.js | Advertise correct limits/proof capability; require proof before new larger admission; compare filename on exact session reuse; retain exact accepted-session recovery with new intake closed |
| src/legacy-src/config/postVideoRolloutPolicy.js | Invalid/missing owner identity is never eligible |
| src/legacy-src/controllers/postController.js | After existing committed-Post recovery, reject all new legacy video files with VIDEO_UPLOAD_PATH_REQUIRED |
| src/legacy-src/utils/postVideoFormatGate.js | Select only bounded trusted HLS rungs; match full master; deny direct oversized children and foreign segment paths; fallback-only if none |
| src/legacy-src/controllers/videoUploadController.js | Apply the guard after current viewer authorization and before manifest object reads/signing; renew fallback-only grants safely |
| src/legacy-src/services/videoPostPublicationService.js | Publish only selected HLS rendition metadata or the existing private verified fallback; preserve READY ownership/claims |

The legacy-file guard is unconditional in this session-only candidate: toggling a legacy
flag cannot turn an old public/remux path into the new private pipeline. Images,
existing committed owner/client Posts, source/session recovery and normal video
session publication remain in their old paths. No new private-legacy storage/
schema/index feature is included. No early original HEVC/4K publication is opened.

Original API219 admission hook/queue producer, owner quota, claims/leases, database
setup, migrations, private signing/authorization implementation and pending-intent code are unchanged. Private manifest selection and published rendition metadata change only through the new bounded-delivery guard.
No new CAS/ledger policy is silently introduced; existing native admission/cost/
capacity behavior still needs qualification before widening intake. The old fair-
scheduling hook is conditional; this source preservation is not proof global
capacity protection exists or is enabled. No admission guard may be disabled to
make rollout succeed. Source preparation adds no eligibility environment change.
Normal Web no-token intake stays≤50MiB; valid verified Android may use≤500MiB.
Larger new intake fails closed if native verifier configuration is unavailable.
Before API replacement, qualify existing large-upload resumption against the new
policy as part of accepted-work preservation; do not strand saved sources.

| Binding | SHA256 |
|---|---|
| Build-only plan | `71f8d48f435708a77d01bcdbf5194505ba6b405f70ae0611d542a020a2f8a097` |
| 757-file source content | `974adec2225d0d2f7ec75f6a7f75c2dd8221e1929ecdc0a483dddec810149300` |
| Source ZIP | `5ceeba08a499e88730c62ac3550c41556fb50b1064bf61e9810f889c908fda4a` |

[Eight-file patch](../release-tools/all-user-session-api-r1/release/session-only-api.patch),
[candidate](../release-tools/all-user-session-api-r1/release/candidate.json),
[plan](../release-tools/all-user-session-api-r1/build-plan.json),
[controller](../release-tools/all-user-session-api-r1/build-once.cjs),
[archive verifier](../release-tools/all-user-session-api-r1/verify.cjs).
Fifteen control pins bind the controller/local parser/verifier/tests, artifact,
manifest/archive, patch and deterministic preparation/model source. Every757file
and internal manifest is independently hashed on extraction; no dirty checkout
supplies image bytes. Dependencies and Dockerfile are the native-matched parent.
Full source compilation and runtime-import verification pass locally. Seven exact candidate source tests cover proof rejection, non-canary acceptance, retained larger-session recovery, legacy rejection and existing Post acknowledgement. Eleven delivery tests cover full-master/rendition binding, unauthorized viewers, direct oversized-child denial before object reads, segment path isolation, real private signing, fallback-only selection and READY publication. Five actual frozen-worker7 FFmpeg integration tests measure H264/yuv420p/AAC, dimensions/aspect, no upscaling and full decode. Fourteen intercepted build-controller tests and three offline input models pass.
These establish no production/Play Integrity/Fargate/API rollout permission.

## Normal carrier integration, then separate exact build-only approval

Review/merge only this carrier through the authorized fork/upstream workflow.
Clean Windows main must equal freshly pulled origin/main and all source/control
pins must match. Before requesting approval, run:

```bash
node release-tools/all-user-session-api-r1/local.cjs
```

This uses built-in Node only, verifies the exact757file ZIP, Git identity/clean main
and existing local desktop-linux builder; no AWS/build/journal/login request.
Accept CLEAN_MERGED_CARRIER_HEAD_LABEL_ONLY_V1: merged HEAD is a provenance label,
not the build context. Accept EXISTING_SINGLE_LOCAL_DOCKER_DRIVER_ALLOWLIST_V1:
only current desktop-linux context on a Windows named pipe, one running desktop-linux
node/endpoint, driver docker or docker-container, linux/amd64. No builder creation,
bootstrap, configuration change, remote driver or replacement. Reserve an exclusive
new-tag/journal/builder window; the journal is not a distributed lock.

After fresh exact approval only: AWS906446637180/us-east-1/default/root, exact STS;
ECR DescribeImages for arc-backend and the new tag requiring explicit absence;
ECR authentication. Maximum3 AWS attempts,1local Windows build/push invocation,
1resulting exact imagetools OCI-index read. Exact image tag is the new run above;
no alternate, overwrite or replacement. The source-pinned build args fix amd64,
provenance mode=min, OCI registry output, source-content label and GitHub source
identity. Only extraction/metadata paths and clean merged HEAD label resolve locally.
Actual index bytes must hash to the acknowledged index digest with exactly one
linux/amd64 child. Neither digest exists until successful native publication.

Fresh approval30minutes, build command900seconds, other commands30seconds/1MiB,
tag-absence evidence≤300seconds before build. All local readiness checks precede
new authority consumption and AWS. New external directory
`%LOCALAPPDATA%/SquadHuntRelease/all-user-session-api-r1-consumed`; fsynced/read-back
exclusive receipt and per-operation intents before attempt1. Windows directory
power-loss durability is not claimed. Token stays in memory/stdin to the normal
Docker credential store. Ordinary local BuildKit resource use and registry storage,
transfer/scanning costs apply; no hard billing cap or provider-outage termination
guarantee. Maximum output bound can itself cause an unknown/HOLD result.

No retries, second build/push/index read, alternate builder/tag, rollback or cleanup.
Unknown acknowledgement permanently HOLDs; retain context/journal/any image. Every
outcome closes all remaining allowances0. Consumed directory rejects before
commands. Evidence-write failure retains consumption; do not restart to repair it.
Success is CLOSED_API_IMAGE_PUBLISHED_NO_DEPLOYMENT. No registration, API/service/
worker stop/update, eligibility, private-legacy activation, DB/Redis/index/ledger,
queue/pause/upload, IAM/network/CFN/protection/capacity/scaling or deploy.sh operation.
All older worker/API/native read/build authorities remain closed.

Entry variables SESSION_API_IMAGE_BUILD_APPROVAL and SESSION_API_IMAGE_BUILD_JOURNAL
must name the separate exact decision and new external directory. Do not run
build-once.cjs until normal carrier integration/local check and fresh approval.

## Separate owner wording — no approval inferred

> Approve only session-only API image publication pi-all-user-session-api-r1-20261101,
> plan71f8d48f435708a77d01bcdbf5194505ba6b405f70ae0611d542a020a2f8a097,
> source974adec2225d0d2f7ec75f6a7f75c2dd8221e1929ecdc0a483dddec810149300,
> ZIP5ceeba08a499e88730c62ac3550c41556fb50b1064bf61e9810f889c908fda4a.
> Accept the exact clean-merged-HEAD label and existing single-local-driver rules,
> exclusive new API tag/journal/builder ownership. AWS906446637180/us-east-1/default/
> root: only3exact AWS attempts,1Windows amd64 build/push to the exact new API tag,
> 1resulting exact OCI-index read; fresh30minutes/build900seconds/other30seconds/
> 1MiB/tag evidence300seconds. One-use fsynced/read-back intents, attempt1, no retry/
> alternate tag/builder/cleanup. Unknown acknowledgement HOLDs permanently; every
> allowance0. Accept reviewed local-journal/credential-store/registry-cost limits,
> no hard billing cap. Zero deployment/eligibility/worker/Q0/data/index/ledger/queue/
> upload/IAM/network/protection/scaling authority; no deploy.sh. Old scopes stay closed.

**Current gate: source review/merge and Windows local check, then exact API image
publication approval. This image alone cannot enable all users.** Fresh accepted-
work and actual Task/Service configuration, native bounded private playback using the retained worker7,
native Integrity/private-HLS/client tests and separate eligibility approval remain.
The archived API task proposal does not match the fresh opaque configuration hash;
no old environment/role settings are authorized to overwrite the current task.

The merged five-delta PR163 candidate is superseded before any build approval. This revised unapproved package adds API delivery selection instead of requiring worker7 retirement. Existing worker7 still creates some oversized private rungs; they are neither advertised nor signed through this API. Current worker H264 bitrate pruning and lossy encoding are unchanged; no perceptual-quality equivalence is claimed. Q0/protection/signed-drain are later worker-replacement gates, not prerequisites added to this initial session-only route. No source, Post or historical rendition is deleted or reclassified. Unknown/malformed retained output fails closed and needs separate review. An older API image without the delivery guard is not a safe rollback while new-cohort media relies on filtering; rollback must close new admission while retaining the guard and access to accepted work.

Admission rollback keeps rollout mode/all-user Post visibility and the bounded-delivery guard intact, sets POST_VIDEO_UPLOADS_ENABLED=false and keeps background publishing disabled. Only NEW sessions are denied; exact previously accepted owner/session recovery, parts/complete/status/retry and READY foreground publication remain available. The new source regression proves disabled intake denies new acceptance but preserves an exact retained100MiB session without a new proof/reservation. Any production rollback still needs its own exact approval and native accepted-work readback.
