# New worker format/private-source artifact — build/push only, unapproved

1 November 2026 IST. **PREPARED; NOT BUILT/PUSHED.** New run/tag
`pi-worker-format-legacy-r1-20261101`, repository
`906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend`, linux/amd64.
No old image/build authority is reused.

| Binding | SHA256 |
|---|---|
| New build plan (JSON.stringify object convention) | `c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130` |
| 760-file source content | `8987e09a78724bd6152464ed59a444e860aeb6cc0d8b6c30f09e7e76f171bae2` |
| Exact new source ZIP | `95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee` |

[Plan](../release-tools/legacy-private-video-release-r1/build-plan.json),
[artifact proposal and five changed files](../release-tools/legacy-private-video-release-r1/worker-artifact.PROPOSED.json),
[one-use controller](../release-tools/legacy-private-video-release-r1/build-once.cjs),
[archive verifier](../release-tools/legacy-private-video-release-r1/verify.cjs).
The context starts from the already-frozen published protected-worker source and
overlays clipHlsProcessing, videoProcessing, clipTranscodingService, Post schema and
new legacyVideoPlayback helper only. No full dirty checkout is built. Source
content hashes are not OCI digests; actual index/child remain null.

Execution requires a **new exact owner decision** and exclusive ownership of this
new tag/journal window. Run on the Windows Docker laptop after reviewed source is
merged and pulled clean. Accept CLEAN_MERGED_CARRIER_HEAD_LABEL_ONLY_V1: native
clean HEAD supplies a provenance label only; all build bytes come from the exact
verified ZIP. The controller verifies the expected GitHub repository, source and
control pins before operations. No private signing key is accessed.

Allowed future operation: exact STS root/account906446637180 read, one ECR
DescribeImages for only arc-backend/new tag requiring positive absence, one ECR
authentication request, one existing local desktop-linux/docker-driver build/push
and one resulting exact OCI-index registry read. Regionus-east-1/profiledefault.
Maximum3 AWS reads/1 build-push invocation/1 registry-index read. Native Docker
context/builder inspection must show a local Windows endpoint; no paid/new builder.
Registry layer/base-image requests are inherent to that one invocation, not an
assertion of one underlying network request. No pagination or alternate tag.

Fresh30minute authority, build command≤900seconds, other commands≤30seconds/1MiB.
Exclusive consumed directory and fsynced/read-back intent files precede attempts.
Windows directory power-loss durability is not claimed. ECR token stays in process
memory/stdin to normal Docker login; ordinary credential-store behavior remains.
No secrets/config or raw provider errors are exported. Ordinary registry storage,
transfer/scanning costs remain applicable; no hard billing cap.

Unknown/lost build acknowledgement permanently HOLDs without retry, replacement
tag, deletion or cleanup. Preserve consumed evidence/context and any image.
Native registry bytes must hash to the returned OCI index and identify exactly one
amd64 child. All allowances close permanently. No ECS/IAM/CFN/network/DB/Redis/
queue/source/protection/capacity/scaling/API/ledger/eligibility operation is allowed.

Future entry point, **do not execute without that separate approval**:

```sh
node release-tools/legacy-private-video-release-r1/build-once.cjs
```

`WORKER_FORMAT_BUILD_APPROVAL` must name the exact separate decision file;
`WORKER_FORMAT_BUILD_JOURNAL` must be a new absolute local non-synced path outside
the checkout. Four focused tests use intercepted commands and temporary journals;
no actual Docker/AWS/registry command ran during preparation. Node performs ZIP
verification/extraction on Windows; no Python/dependency installation is required
for execution. Python was used only for local deterministic preparation.

Proposed wording, **not approval**:

> Approve only new worker artifact build/push pi-worker-format-legacy-r1-20261101,
> plan c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130,
> source8987e09a78724bd6152464ed59a444e860aeb6cc0d8b6c30f09e7e76f171bae2,
> ZIP95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee.
> Accept the exact clean merged carrier-HEAD label resolver and exclusive tag/
> journal window. Only3 reviewed AWS reads, one local Windows linux/amd64 build/
> push to the exact new tag and one exact resulting registry-index read. No retry,
> replacement tag or cleanup; unknown acknowledgement HOLDs; permanent closure.
> Accept reviewed local-journal/credential-store/registry-cost limits. Zero worker,
> API, deployment, native data/queue, protection/scaling or eligibility authority.
> All older authorities remain closed.

Previous protected indexffff210127eb3512a0a7f5967a6a28e08dbd5a10e3c0d8745a234ee5bece2e8a
and child0e0c1b9a1cc850a2d9100b6a7245e324d95b93ec879388d4e27315b7952821da
remain unchanged. They are references, not an automatic rollback for newly accepted
private-legacy work. The generated Task proposal stays **UNBOUND** until real new
digests and separate native deployment approval exist. This image is worker-only;
do not use it as an API219 replacement.
