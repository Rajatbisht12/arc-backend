# Direct AWS beta release: second-laptop handoff

26 October 2026. R10 stays unexecuted. No production service, migration, audience or worker-capacity change is approved or applied.

The owner will run CI/CD on the second laptop after the release inputs are committed/pushed and pulled there. **Do not run the current deploy.sh for this release.** It intentionally rejects the current dedicated/private-video topology in scripts/lib/video-release.js. Do not bypass that guard or use its compatibility flags; it also invokes unrelated financial/discovery/registry preflights.

## Verified now

- API arc-backend:214 and dedicated worker squadhunt-prod-video-worker-worker:3 are healthy, each desired/running one. Both run immutable image sha256:a29b5385cb74a688d4ca15eb6f32f58d7bda0f7f3c2bd4610ddc57107aaed8de. [Read-only evidence](evidence/video30-beta-direct-2026-10-26/rapid-preflight.json).
- DocumentDB reports engine 5.0.0, encrypted storage, one-day backup retention and a recent restorable point. This is metadata evidence, not a restore test.
- Recent sampled worker logs show waiting/active/delayed zero and 352 historical failed entries. They have not been retried, removed or assumed harmless; a fresh queue audit remains required at cutover. A limited log sample cannot prove all accepted-session states.
- Existing API ECS Exec returns TargetNotConnectedException; no audit code ran. Live indexes, accepted uploads/intents and effective secret/queue configuration are **NOT VERIFIED** yet.
- Frozen backend ZIP 145becc71228b4ea4eaeb391c2c0f5dad61afc19461d7729cc52fc1b80df63fa and its 746 source files were verified. The Linux/amd64 packaging build passed npm ci, TypeScript build and runtime-import verification after one local-emulation ETXTBSY failure/retry. The image contains FFmpeg 8.0.1; this is local emulation, **not measured Fargate throughput**. The local packaging image's source-repository label used an unverified alternate remote, so it is not proposed as a release artifact. The new build helper derives and sanitizes the actual Git origin instead.

## Build-only handoff prepared

release-tools/video30-beta/ contains the exact frozen backend.zip, a portable prepare-image.cjs, three passing focused packaging tests, and the reviewed runtime-readonly.cjs. No frozen application, video encoder, ordinary deployment guard or unrelated worktree change was modified. The handoff is prepared on the isolated local branch `release/video30-beta-build-20261026`; it has **not been pushed**. Unrelated working changes are preserved.

After the reviewed handoff branch is committed, pushed and pulled on the second laptop, use:

```bash
node --test release-tools/video30-beta/prepare-image.test.cjs
node release-tools/video30-beta/prepare-image.cjs --preview-only
node release-tools/video30-beta/prepare-image.cjs --build-only
```

The build-only command verifies the pinned archive and every source file, extracts a fresh temporary context, uses its pinned Node22/FFmpeg Dockerfile, builds Linux/amd64 and checks runtime imports with networking disabled. It requires clean committed release inputs. Windows uses PowerShell Expand-Archive; Mac/Linux uses unzip. It does **not** push an image, register tasks, run migrations, change flags or deploy. Its local image ID is explicitly not labeled an ECR digest. The actual second-laptop ECR image digest must be recorded before final deployment approval. Do not run the ordinary deploy.sh afterward yet; an exact drain-aware release is still being prepared.

## Minimal live preflight approval needed

One short-lived **read-only diagnostic task** using the existing API214 image, role, 0.5-vCPU/1-GiB resources and existing API network can inspect live index metadata, accepted-session/publication counts, Redis queue counts and private-delivery readiness. No new VPC, database, cache, CDN, build project or encoding worker is proposed. No database/queue writes, role/secret/storage changes or service updates are allowed.

Exact script SHA256: `925ff0d84b9b364890b58af6850791c5f74f0dc26ebb7e6b4f3089bd63091aec`.

Exact approval-plan SHA256: `2cd78f2e396dba84ec05bc7b0185424389f22c798f1f6bb856757c6e9583dbf0`.

Full request: [readonly-preflight-approval.json](evidence/video30-beta-direct-2026-10-26/readonly-preflight-approval.json). Maximum one diagnostic, 180 seconds then stop only that diagnostic if necessary; expected cost below $0.01, proposed operational authorization $0.10, not a billing hard cap. The fixed client token and exact task/script provenance must be reconciled after any lost response, never blindly repeated. This is a separately scoped preflight approval because the owner's instructions require approval before AWS mutations. It is **not approval to deploy or migrate**.

## Proposed release scope after that audit and image build

- Preserve current users, data, queue names and accepted jobs; preserve the xyz-only upload allowlist and private five-minute grant policy.
- Reuse the existing API and one 2-vCPU/4-GiB/40-GiB dedicated worker. No autoscaling or fair-scheduler service initially. Keep fair scheduling, source reuse, optional intermediate and experimental reduced ladders off. Enable the tested 30 FPS/four-rendition/veryfast path and MP4 reuse in the new worker. The FPS cap affects all eligible jobs consumed by that shared worker, not only xyz's new uploads.
- Background publication is video-only; it requires the four additive PendingVideoPost indexes and validated canonical publication uniqueness. Do not apply them or enable acceptance until the audit and exact release approval. Scheduling indexes are unnecessary while fair scheduling stays off. Inspect existing upload indexes instead of blindly rerunning migrations.
- Prepare the in-place release by cloning current task definitions, changing only the approved digest/explicit flags and preserving every other setting. New task family revisions/digests and exact diffs will be presented before registration/service mutation.
- Pause new queue claims briefly, let active work finish, replace the idle worker without losing accepted queued work, verify API/worker health, then resume. No force-killing encodes. A pause/resume is itself an approval-bound queue mutation; it has not occurred.
- Verify one approved gameplay and one camera upload on AWS, HLS/MP4/audio/FPS/private denial/renewal, publication, cancel/retry and recovery; then several concurrent uploads. No isolated R10 experiment, mandatory staff-only encoding canary or large load cohort is required by this beta plan.

Rollback targets remain API214/worker3 and their immutable image above. Do not delete additive indexes or data. If background-publication intents have been accepted, reconcile/drain them before rolling back the only compatible publication/recovery path. Exact flags, migration list, resource ceiling, monitoring, costs and rollback gates require final deployment approval after live audit and actual release digests exist.

**AWS BETA DEPLOYMENT BLOCKED** pending the small live preflight authorization, committed build handoff/actual ECR release digest, and separate exact in-place deployment approval. Production remains unchanged; this is not a public-launch readiness claim.
