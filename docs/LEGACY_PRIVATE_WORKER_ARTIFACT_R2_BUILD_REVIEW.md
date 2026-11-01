# Worker private-video image R2 — existing local builder, original unused tag

1 November 2026 IST. **PREPARED, UNAPPROVED. NO R2 BUILD OR AWS REQUEST.**
R1 is permanently CLOSED_HOLD: two AWS read attempts, zero build/push invocations,
zero registry-index reads. Its exclusive journal contains no build intent. The
original source, controller, approval and consumed journal are not modified or
restarted. No new image digest exists.

The owner-supplied local check reproduces an unsupported `buildx inspect --format`
option (exit125). The original generic HOLD omitted the actual stderr. Supported
plain inspection subsequently positively reported builder desktop-linux, driver
docker-container, one node named desktop-linux, endpoint desktop-linux, running,
linux/amd64 supported. The context independently reported a Windows named pipe.
These are local Docker observations, not successful build or registry evidence.
[Docker's inspect command](https://docs.docker.com/reference/cli/docker/buildx/inspect/)
documents plain output, including separate root and node sections; no --format.

## Exact new authority and unchanged image bytes

New execution identity **pi-worker-format-legacy-r2-20261101**. Destination remains
`906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend:pi-worker-format-legacy-r1-20261101`.
This is the original unused tag, not an alternate tag or a second build attempt.
Its earlier absence is historical; fresh exact tag absence is mandatory in R2.

| Binding | SHA256 |
|---|---|
| R2 plan; JSON.stringify parsed-object convention | `3fd443a76d3da6de7f2cad2e1ce7c08d4aecd0cdddc53a7479291ce44b40bdfc` |
| Unchanged 760-file source content | `8987e09a78724bd6152464ed59a444e860aeb6cc0d8b6c30f09e7e76f171bae2` |
| Unchanged exact ZIP | `95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee` |

[Plan](../release-tools/legacy-private-video-release-r2/build-plan.json),
[fixed requests](../release-tools/legacy-private-video-release-r2/request-catalogue.json),
[local checks](../release-tools/legacy-private-video-release-r2/local.cjs),
[one-use controller](../release-tools/legacy-private-video-release-r2/build-once.cjs).
Thirteen control pins include the new implementation/tests/catalogue/offline model
check and every original carrier control/archive dependency. All build bytes still
come only from the R1 ZIP. No worker runtime patch or new source snapshot is added.
Clean merged main HEAD supplies a provenance label only; it is not the build context.

Explicitly accept both new rules before execution:

- **EXISTING_SINGLE_LOCAL_DOCKER_CONTAINER_NODE_V1**: use only the existing running
  desktop-linux/docker-container builder, exactly one desktop-linux node using
  desktop-linux endpoint, linux/amd64, with that named Docker context resolving to
  a Windows npipe endpoint. No builder creation, bootstrap, driver switch, alternate
  endpoint, replacement or cleanup. Existing local BuildKit container resource use
  is accepted. R1's docker-driver-only approval does not cover this difference.
- **EXACT_CLOSED_R1_ZERO_BUILD_UNUSED_TAG_V1**: read the exact old six-file journal,
  require the observed consumed/closure identity/times and two-read/zero-build/zero-
  registry counts, all remaining allowances zero and no build intent. Any extra
  file, altered closure or attempted build blocks reuse of the tag. Preserve the
  old journal. This check is not a fresh tag-absence assertion or old authority reuse.

## Local check before approval and provider work

After normal review/merge and clean Windows pull, run:

```bash
node release-tools/legacy-private-video-release-r2/local.cjs
```

This verifies all source/control pins, every archived file, exact prior closure,
main branch, HEAD equal to the locally fetched origin/main, clean full status,
authorized upstream repository, context and builder. It creates no journal and
makes no AWS/build/login request. It does not fetch Git or establish that a remote
main did not advance; the operator must first complete the normal fresh clean pull.
Unknown or changed inputs fail before provider work. R2 remains unapproved until
this full native local check passes and a fresh separate owner decision is recorded.

The execution entry repeats these checks before consuming a new external directory
`%LOCALAPPDATA%/SquadHuntRelease/worker-format-legacy-r2-consumed` and before any AWS
operation. Existing R2 directory rejects before commands. The old directory is
read-only. Source extraction occurs under the new consumed directory and is read
back byte-for-byte before STS. No dirty backend checkout is built.

## Exact bounded build/publication and failure behavior

AWS account906446637180/us-east-1/default/root. Three AWS attempts only: STS identity;
ECR DescribeImages for arc-backend and the original exact tag; ECR authentication.
Only explicit ImageNotFoundException qualifies absence; collision, successful empty
response or unknown error HOLDs. No pagination, retry, substitute tag or discovery.
AWS retry attempts1 and configured endpoint overrides disabled. Authentication
password stays in memory/stdin to the ordinary Docker credential store, not evidence.

One `docker --context desktop-linux buildx build --builder desktop-linux`,
linux/amd64, provenance mode=min, registry output with OCI media types, exact source
content label and original repository/tag. Metadata/context paths and reviewed
clean-main HEAD label resolve locally. Exact flags are source-pinned in the controller.
Only one subsequent imagetools raw-index read by the acknowledged digest; actual
index bytes must hash to that digest and contain exactly one linux/amd64 child.
Retain the actual index and child digests only after this positive binding.

Maximum3 AWS reads/1 build-push invocation/1 registry-index read. Fresh approval
30minutes; each command30seconds/1MiB except build900seconds. Tag evidence must be
at most300seconds old at build intent. The whole controller must finish within the
30minute authority. No exact end-to-end wall cap across power loss is claimed.
Exclusive original-tag/journal window, no competing publishers or builder/config
changes. Local checks do not implement a distributed lock or atomically freeze Docker.

Fsynced/read-back exclusive receipt and one-use operation intents precede attempts;
counters consume before submission. Windows directory power-loss durability is not
claimed. Unknown acknowledgement, timeout, metadata/index mismatch or evidence-write
failure permanently HOLDs, with fixed stage/reason and zero remaining allowances.
Retain the consumed directory/context and any image. No second registration/build,
push, index read, cleanup, tag overwrite or rollback. A failed receipt write may
leave incomplete closure evidence; retain consumption and obtain separate recovery
review, never restart. Ordinary registry storage/transfer/scanning and local Docker
resource costs apply; no hard billing cap. A successful image publication is not
worker deployment, native codec/HLS qualification or production eligibility.

Future entry requires WORKER_FORMAT_BUILD_R2_APPROVAL naming the separate JSON
decision and WORKER_FORMAT_BUILD_R2_JOURNAL naming the new absolute external directory.
Do not invoke it before the exact approval. Never run deploy.sh for this operation.

## Focused checks and separate owner wording

Thirteen focused local tests pass, including the actual ZIP verifier, strict plain-
output parser, malformed/multiple nodes, local failures before AWS/consumption,
prior-build rejection, collision/unknown error, single build/index read, unknown
acknowledgement and consumed-directory rejection before commands. Three botocore
input models pass offline with no client or credential loading. These fixtures do
not qualify actual Docker build/push, native permissions or deployed media handling.

Proposed wording — **not approval**:

> Approve only R2 worker image build/push pi-worker-format-legacy-r2-20261101,
> plan3fd443a76d3da6de7f2cad2e1ce7c08d4aecd0cdddc53a7479291ce44b40bdfc,
> source8987e09a78724bd6152464ed59a444e860aeb6cc0d8b6c30f09e7e76f171bae2,
> ZIP95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee.
> Explicitly accept EXISTING_SINGLE_LOCAL_DOCKER_CONTAINER_NODE_V1 and
> EXACT_CLOSED_R1_ZERO_BUILD_UNUSED_TAG_V1: the existing local desktop-linux
> docker-container builder only, and the untouched original tag
> pi-worker-format-legacy-r1-20261101 only after fresh exact absence. Accept
> CLEAN_MERGED_CARRIER_HEAD_LABEL_ONLY_V1 and exclusive tag/journal/builder window.
> AWS906446637180/us-east-1/default/root, arc-backend: maximum3 exact AWS reads,
> 1linux/amd64 local build/push and1resulting exact OCI-index read. Fresh30minutes,
> build900seconds/other commands30seconds/1MiB/tag evidence300seconds. One-use
> fsynced/read-back intents, no retries/alternate tag/builder/replacement/cleanup.
> Unknown acknowledgement HOLDs permanently; retain evidence/image, all remaining
> allowances0. Accept reviewed Windows journal, credential-store, local BuildKit
> resource and ordinary registry costs with no hard billing cap. R1 remains closed.
> Zero deployment/registration/service/retirement/Q0/data/queue/IAM/network/CFN/
> protection/capacity/scaling/upload/API/index/ledger/eligibility authority.

Smallest next action: merge this isolated carrier correction normally, then run
the local-only Windows check. Only its pass permits requesting fresh R2 build approval.
