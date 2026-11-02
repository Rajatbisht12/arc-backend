# All-user admission guard API — exact build-only review

2 November 2026 IST. LOCAL PREPARATION; PUBLICATION NOT AUTHORIZED.

This review publishes a new API artifact containing the five-path global admission
guard. It does not rebuild API220 or the protected worker. It permits no task
registration, service rollout, ledger write, intake opening or eligibility change.
The carrier must first be reviewed and merged through Rajatbisht12/arc-backend's
normal controls. The owner then verifies clean merged main on the Windows Docker
laptop before giving a fresh exact build-only decision.

| Binding | Exact value |
|---|---|
| Run and new tag | `pi-all-user-admission-api-r1-20261102` |
| Plan SHA256 (canonical JSON) | `11a8e2b56cefafb8406f13eb9584ce3b9e5b42de3ea140bb4a0b190faa269e67` |
| Source content SHA256 | `d328315d548254f7b51cff001c64e8d931fa8da2f4a4a6d30803be9864617f21` |
| Source ZIP SHA256 | `9573270f913ae2a549d21635841b77400f1707801e545bb7d4f48adc9d9ddf39` |
| Source files / pinned control files | 759 / 23 |
| Repository | `906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend` |
| Account / region / profile / caller | `906446637180` / `us-east-1` / `default` / exact account root |
| Image platform | `linux/amd64` |
| Actual index / child digest | UNKNOWN; never substitute either existing published image |

[Plan](../release-tools/all-user-admission-api-r1/build-plan.json),
[one-use controller](../release-tools/all-user-admission-api-r1/build-once.cjs),
[archive verifier](../release-tools/all-user-admission-api-r1/verify.cjs),
[reviewable five-path patch](../release-tools/all-user-admission-api-r1/release/guard-api.patch).

## Source and build provenance

Build only from the verified ZIP, extracted into a new external consumed directory;
never from the dirty application checkout. Its manifest binds every source byte.
All unmodified files derive from the published API220 source content
`974adec2225d0d2f7ec75f6a7f75c2dd8221e1929ecdc0a483dddec810149300`.
The five overrides and complete archive are committed for review together.

Accept CLEAN_MERGED_CARRIER_HEAD_LABEL_ONLY_V1: Windows must be on clean main,
HEAD must equal origin/main, and origin must be the approved Rajatbisht12 repository.
That actual merged HEAD supplies the OCI source revision label. It identifies the
carrier commit; the separate source-content label identifies the application
archive. It does not claim the checkout's ordinary application tree equals the ZIP.
Any changed source/control byte blocks this plan and requires review/resealing.

Unchanged Dockerfile SHA256:
`6f26ef93336be4d14f00bd23bf2353ae8e3d00b384f7dbe697dcabac3e36aeed`.
Unchanged package-lock SHA256:
`71939d2237a8b20704503a9a04e8dc270a5f907003c3c87ad25cb1fb698fd7b1`.
The plan also binds package.json and .dockerignore. Both build stages use
`node:22.23.4-alpine3.23@sha256:9fee3a1d85a49993660c8ffc774ceafadc0b52eda69b4c981f6b6a1cfabcfe98`;
FFmpeg package is `8.0.1-r1`. The existing Dockerfile downloads the RDS global CA
bundle from its existing truststore URL. Dependency/CA/package retrieval and
BuildKit behavior remain build inputs; source equality is not a reproducible-image
claim. Capture actual resulting digests and minimal BuildKit provenance.

## Exact execution envelope requiring fresh owner approval

Accept EXISTING_SINGLE_LOCAL_DOCKER_DRIVER_ALLOWLIST_V1: only the existing Windows
named-pipe desktop-linux context, existing desktop-linux builder, driver docker or
docker-container, exactly one running desktop-linux node/endpoint supporting
linux/amd64. No builder creation, bootstrap, replacement or configuration change.
Reserve exclusive ownership of the new tag, builder and journal window.

After exact local/source/Git/builder checks and durable one-use consumption:

1. One STS get-caller-identity attempt; require exact account/root.
2. One ECR describe-images attempt for only the new exact tag; require explicit
   ImageNotFoundException. Empty/failed/ambiguous output is not absence.
3. One ECR get-login-password attempt and one Docker password-stdin login.
4. One buildx build invocation with registry output, linux/amd64 and minimal
   provenance. Use only the pinned extracted context and actual merged label.
5. One imagetools raw index read at the digest acknowledged by the build metadata.
   Independently hash the actual index bytes and require exactly one amd64 child.
   Retain actual index/child, source/carrier/build-input and build-intent hashes.

At most three AWS read attempts, one build/push invocation and one resulting index
read. AWS CLI retries disabled. These invocation bounds do not claim a hard bound
on Docker's internal registry/package transfers or BuildKit resources/costs.
No overwrite, alternate tag/builder, second submission or unknown-ACK discovery.

Fresh approval: 30 minutes; build command: 900 seconds; other commands: 30 seconds,
1 MiB output each; tag-absence evidence: 300 seconds. No hard billing cap.
Accept ordinary Docker credential-store behavior, Windows local BuildKit resource
use and normal registry transfer/storage/scanning costs. Approval also accepts the
reviewed Windows file-fsync/readback journal durability limitation: directory
power-loss durability is not asserted.

External one-use directory:
`%LOCALAPPDATA%/SquadHuntRelease/all-user-admission-api-r1-consumed`.
Approval file is supplied through ADMISSION_API_IMAGE_BUILD_APPROVAL; directory
through ADMISSION_API_IMAGE_BUILD_JOURNAL. The exact decision is
APPROVE_EXACT_ADMISSION_GUARD_API_IMAGE_BUILD_PUSH_ONLY, binding the plan hash and
explicit driver/tag/head/exclusive-window acceptance booleans. No approval receipt
or production execution journal has been created by this preparation.

Fsync and read back exclusive intents before attempts. Success permanently closes
CLOSED_API_IMAGE_PUBLISHED_NO_DEPLOYMENT. Any failure/unknown outcome permanently
closes HOLD with all remaining reads/builds/pushes/index reads zero. Retain context,
metadata, any image and journal. No retry, rollback, cleanup or deletion.

## Windows handoff after normal review and merge

Run only this local check, then provide its JSON. Do not run build-once.cjs yet.

```bash
cd /c/Users/bisra/OneDrive/Desktop/arc-backend
if [ -z "$(git status --porcelain --untracked-files=all)" ]; then
  git pull --ff-only origin main &&
  node release-tools/all-user-admission-api-r1/local.cjs
else
  echo "DIRTY_CHECKOUT_STOP"
fi
```

Expected source count759, scope11a8e2b5… and clean main; zero provider calls/builds.
Exact frozen release bytes are marked -text to prevent Git CRLF rewriting. Never
repair a failed pin by editing a control or accepting normalized-but-different
content. A failure must be diagnosed before any publication decision.

## Local verification and authority exclusions

[Validation summary](evidence/all-user-admission-api-r1-preparation-2026-11-02/validation-summary.json):
23 outer checks pass on both Node22 and26. Each run compiles the exact archived
TypeScript source and executes34 isolated Mongo/HTTP cases, six offline bootstrap
cases and one real Unix-socket Redis ACL/outage case. Three botocore input models
validate without client/network access. No production build or runtime is implied.

ZERO ECS/API/worker deployment, registration/launch/stop, eligibility/cost/intake
opening, production ledger/data/queue/history/secret/index write, IAM/network/CFN,
protection/capacity/scaling, source upload/enqueue or deploy.sh authority. Previous
build/data/deployment scopes remain closed. A successful receipt only makes the
new immutable API image available for later separately approved release operations.
