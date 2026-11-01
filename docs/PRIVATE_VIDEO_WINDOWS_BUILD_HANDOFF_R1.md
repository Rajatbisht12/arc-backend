# Private-video worker — clean Windows build handoff

1 November 2026. **BUILD AWAITING SEPARATE EXACT APPROVAL.** These instructions
do not grant build, AWS, deployment or eligibility authority. The immutable
[build review](LEGACY_PRIVATE_WORKER_ARTIFACT_R1_BUILD_REVIEW.md) remains the
authority specification; its plan, controller and archive were not changed.

## Smallest Git review and merge

The current backend checkout is dirty on
`feature/post-video-500mib-production-readiness`, HEAD
`e46632782682353798c1f8eecf2c07598d82b98d`. Its origin is
`git@github.com:vortica-labs/arc-backend.git`. **Do not stage the whole checkout.**
The sealed build controller instead requires the existing Windows carrier clone
of **Rajatbisht12/arc-backend**. Do not change a remote merely to bypass that guard.
No branch, commit, push, PR or merge was performed here.

1. Review the five worker overlays in `worker-artifact.PROPOSED.json`, the build
   controller and its existing intercepted-command test evidence. The separate
   source-review report covers API/mobile/Web changes; those are not prerequisites
   to constructing the worker artifact from its frozen archive.
2. In a clean review branch of the intended Windows carrier repository, import only
   the eleven paths in the generated `worker-carrier-paths.txt` and matching
   `worker-build-carrier.zip` under
   `docs/evidence/private-video-release-handoff-2026-11-01/`. The ZIP contains those
   paths relative to the backend root. Verify every byte against its carrier
   manifest before staging; no generated approval or journal belongs in Git.
3. Review `git diff --cached --name-only`, `git diff --cached --check` and the
   actual staged files. Commit only those reviewed paths, open the carrier PR and
   merge it into the carrier's `main` through normal GitHub review. Do not merge
   unrelated worker, API, ledger or scaling changes to obtain a clean status.
4. Review the source changes separately: backend API has fourteen exact paths in
   `api219-candidate/candidate.json`; worker has five paths in its artifact manifest
   (their union is sixteen runtime/migration paths). Mobile has four paths and Web
   five in `source-review.json`. Review selected hunks/dependencies, not entire
   dirty files indiscriminately. The API patch is against archived API219, not
   permission to overwrite a newer branch. Adapt only after reviewing its actual
   base; any resulting byte change invalidates the current candidate and needs
   focused checks and a new source seal. Keep the existing frozen build unchanged.

The carrier deliberately contains the original pinned `prepare.cjs` and
`controls.test.cjs`. Regeneration and the first historical-baseline test require
the earlier frozen-worker preparation tree; they are not standalone carrier
commands. **Do not run the generator on the deployment laptop.** Build and the
read-only handoff check require only the eleven carrier paths and installed Node,
Git, AWS CLI and the existing local Docker Desktop builder. No dependency install.

## Windows Git Bash: clean pull and local-only check

After that exact carrier PR has merged, run these commands separately. Stop if
the initial status has output or pull fails; do not stash, reset or discard work
automatically.

```sh
cd /c/Users/bisra/OneDrive/Desktop/arc-backend
git status --short
git remote get-url origin
git pull --ff-only origin main
git status --short
node release-tools/private-video-release-handoff-r1/check-worker.cjs
```

Both status outputs must be empty. The remote must be the reviewed
Rajatbisht12/arc-backend repository. The local checker must report:

| Binding | Exact value |
|---|---|
| Plan | `c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130` |
| Source | `8987e09a78724bd6152464ed59a444e860aeb6cc0d8b6c30f09e7e76f171bae2` |
| ZIP | `95b873a9e651c352ab56a7dc89e560625e1048b1e84e5274201e45ef4154f7ee` |

This check makes zero provider/build calls and is not approval. A clean merged
HEAD is only a provenance label; the exact archive supplies all build bytes.

## Separate owner decision, then one controller invocation

Use the full proposed wording in the linked build review. It must approve only
`pi-worker-format-legacy-r1-20261101`, all three hashes, the clean carrier-HEAD
resolver and exclusive new tag/journal window, including reviewed credential-store,
journal and registry-cost limits. No approval has been recorded for this run.

Only after that fresh matching answer, record an external local decision file:

```json
{
  "decision": "APPROVE_EXACT_NEW_WORKER_FORMAT_BUILD_PUSH_ONLY",
  "scopeSha256": "c1e3ebe8a9d7f04071338555fb14fa49b5e948fa5422398ba7db2d91f8d93130",
  "cleanMergedHeadLabelResolverAccepted": true,
  "exclusiveTagAndJournalOwner": true,
  "approvedAt": null
}
```

This is a **non-executable template**: `approvedAt` must be a safe integer Unix
millisecond timestamp of the first local observation of the actual fresh decision,
never a timestamp invented in advance or a claimed click time. Preserve the owner
answer separately. Constructing a JSON file cannot replace owner approval.

Use an owner-local, non-synced parent under `%LOCALAPPDATA%/SquadHuntRelease` for
the decision and journal. `WORKER_FORMAT_BUILD_APPROVAL` names that decision file;
`WORKER_FORMAT_BUILD_JOURNAL` names the **not-yet-existing**, absolute
`worker-format-legacy-r1-consumed` directory under that parent. Create only its
parent, never the consumed directory. Keep both outside the OneDrive checkout.
No signing key is needed or read. When approved and paths are set, invoke once:

```sh
node release-tools/legacy-private-video-release-r1/build-once.cjs
```

Do not manually run provider preflights, `deploy.sh`, a second build, a different
tag or cleanup. The controller permits three reviewed AWS reads, one existing
local Windows linux/amd64 build/push and one exact registry-index read. It enforces
fresh thirty-minute approval, a fifteen-minute build command and thirty-second
other commands. An unknown acknowledgement closes HOLD; keep the consumed journal
and context and request separate recovery review. Never delete the journal to retry.

Success must produce `artifact-receipt.json` with **actual** OCI index and amd64
child digests plus `authority-closed.json` with zero remaining authority. Report
only sanitized receipts, not credentials, Docker authentication, source/user data
or arbitrary provider errors. New digests are currently unknown. Successful
publication does not authorize worker registration, retirement, deployment, API
activation, uploads or autoscaling.
