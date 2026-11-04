# Worker9 two-task qualification tooling — source preparation only

This directory changes no application, worker image, deployment or production resource. Do not merge it to deploy a worker. No production execution is authorized by downloading, importing or testing this source.

## Prepared components

- `collector.cjs`, `native-entry.cjs`, `package.cjs`: a serialized private diagnostic observer; exact two worker/process identities; normal newly approved Post-intent/session correlation; sequential fresh signed operational OBSERVEs; bounded real PID/progress records and conservative common-clock overlap proof. The helper uses existing diagnostic image/source manifest, narrow mailbox role and separately approved one-key MongoDB boot injection. It does not launch workers or upload/modify Posts.
- `database.cjs`: exact users/intents/sessions/canonical-Post single-batch read-only queries. Session lease tokens and output references leave memory only as hashes. Stable lease token/increasing expiry, first processing attempt, one canonical Post and stable READY output/complete timestamp are checked. Mongo has no ECS task-owner field. A Post/session snapshot plus source CAS contract does not audit every internal settlement attempt. Original selected bytes versus Android prepared bytes remains a separate client handoff/source-contract boundary.
- `control-contract.cjs`, `progress-proof.cjs`, `proof.cjs`: strict process/job/source/claim/protection classification; one live FFmpeg child per worker; exact-child advancing frame/output-time points mapped by age to ONE observer monotonic clock. A >2second conservative overlap does not mean CPU instruction simultaneity. BullMQ ownership-qualified TTL renewal and Mongo heartbeat/expiry renewal are distinct checks. Unknown/unrelated work stops; no extra job is manufactured.
- `pair-metrics.cjs`, `native-samples.cjs`: BOTH exact-task dimensions and actual postboot memory/disk datapoints; native ECS protection; bounded exact-worker job-filtered CPU/cgroup memory/scratch logs. Native A metric template is retained in `contracts/metric-template.json`. Missing B data blocks uploads. Scratch is not total disk free space. CloudWatch60second Maximum is an interval sample, not an exact disk high-water mark. Real loaded measurements and native protection release remain future evidence.
- `windows-signer.cjs`, `windows-local.cjs`, `protocol.cjs`: original Windows-local Ed25519 key/ACL/fingerprint/possession checks; fresh per-request envelopes bound to helper/scope/target/process/sequence. The key stays Windows-local. Signed envelopes are protected local/private-mailbox material; never paste them. OBSERVE-only mode rejects DRAIN. Loaded-DRAIN mode targets ONLY B and permits ONE DRAIN signature, with fresh later OBSERVEs for progress/reconciliation; no presigned reconcile envelope expires while a long encode runs.
- `permission.cjs`: draft independent mailbox-policy requests. No IAM call occurs on import. See `MAILBOX_REVIEW.md`.

The helper never writes DB/history/admission/queue state, reads source/output media, issues playback grants, modifies service/capacity/protection, or stops tasks. Only the already-deployed signed worker protocol may release protection under a separately approved loaded-DRAIN run. Native ECSfalse must be independently observed; local worker-reported release alone is insufficient. Capacity2→1 is a later separate approval after safe B release. All autoscaling stays suspended.

READY output rung count is validated as1–4, not assumed4: the frozen worker ladder may omit redundant higher H264 bitrates. Historical four-rung HEVC evidence is not a template for every new input. Actual codec/segment validation is outside this observer's DB metadata proof.

## Windows source preparation

Use ONLY the generated, exact-commit/hash-bound WINDOWS_PRECLONE command provided beside the PR. It creates a NEW source-only clone and verifies every delivered file plus local AWS CLI version/input models. It performs ZERO provider calls, key reads, signatures, control requests, helpers or production mutations. Preserve all existing clones/receipts/consumed journals. Do not run `windows-signer.cjs` after cloning.

Production signing requires fresh explicit operation-specific authority and an actual verified-running-helper/actualA+B/process/scope/expiry-bound approval-stdin command. No such command is included in source preparation. Exact future source scopes must name two normal uploads and their actor/submission windows; caption templates are not submission authority.

## Tests and limits

Run focused tests with Node22/26: `node --test observer.test.cjs windows.test.cjs pair-metrics.test.cjs real-ffmpeg.test.cjs`.

The serialized bootstrap test uses fake AWS/DB/HTTP adapters and an ephemeral test signing key; it exercises the actual packed source and correctly returns NO_OVERLAP for nonadvancing fixture samples. It proves transport/validation behavior only. Windows tests exercise actual signer code with ephemeral local test keys and temporary test files; no production key is used. The real FFmpeg test uses two local synthetic6second streams and the exact published runner/witness/control sources from the approved worker archive; it checks actual progressing child overlap and source-contract loaded drain. Its claims/protection are local fixtures, not native BullMQ/Mongo/ECS evidence.

No passed local test establishes production two-worker overlap, loaded DRAIN, resource safety or autoscaling readiness. The source is prepared before paid capacity; Windows source readiness must be returned before a short helper/signing window. Phase2 fresh precheck, exact capacity1→2, each real upload/Post, observation helper/credential/data/control scope, loaded DRAIN and return2→1 remain separately bounded approvals. No blind retry after unknown outcomes; no cleanup or rollback of production artifacts.
