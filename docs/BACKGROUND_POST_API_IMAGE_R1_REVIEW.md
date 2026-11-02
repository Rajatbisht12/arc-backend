# Background Post bootstrap correction — new API image, no deployment authority

The current published API's `src/config/secrets.ts:loadSecretsManagerEnv` refuses background publication in production `task-bound-api-v1`, even when that feature is explicitly chosen in the task definition. API224 changed only the feature flag and therefore could not bootstrap. A deliberate recovery reselected API223; native reads subsequently found a sole COMPLETED healthy223replacement and healthy target, while old-task terminal/final checks remain incomplete. No background Samsung Post has been submitted.

This candidate changes ONE predicate in that exact published source: require `POST_VIDEO_BACKGROUND_PUBLISH_ENABLED` to be explicitly `true` or `false`, instead of requiring only `false`. Missing/malformed values still fail before secret retrieval; shared secrets cannot select the task's feature value. Global atomic admission, limits, manual hold, private legacy disabled, fair scheduling disabled, worker disabled, all-mode/empty-canary and isolation controls remain unchanged. Every other one of the759source files, Dockerfile and dependency locks matches the published source. The dirty primary checkout is not a production build input.

| Binding | Value |
|---|---|
| Candidate source | `e753a460c3b3576be6d4b1c975b6bbab806203a6664c5a958712984b67f49fb2` |
| Source ZIP | `3ec0cb59c876533f995026663c3a760ca17aa01f5bd450da157b9ee3e03b8dde` |
| Parent published source | `d328315d548254f7b51cff001c64e8d931fa8da2f4a4a6d30803be9864617f21` |
| New tag/run | `pi-background-post-api-r1-20261102` |
| Build plan | `d7ee7d8012197a560e0b9e8146daa43a767a7f37b0bcc11b25195c032f108787` |
| Repository/platform | existing `906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend`; linux/amd64 |

Source carrier must be reviewed/merged into the existing `Rajatbisht12/arc-backend` main. The exact archive supplies application source; the clean merged HEAD supplies only its provenance label, matching the prior carrier contract. Do not rebuild the old API or protected worker image. No image has yet been built or published for this candidate.

The new Windows one-use publication controller preserves the prior bounded mechanism: existing desktop-linux named-pipe context and single running docker/docker-container builder, no builder creation/bootstrap; STS root identity, positive exact NEW tag absence, ECR authentication (three AWS attempts), password-stdin Docker login, one900second linux/amd64 build/push, one exact acknowledged OCI-index read/hash match and exactly one amd64child. All14control pins/sourceZIP must match. New external `background-post-api-r1-consumed` journal, fsynced/readback exclusive attempts; no retry after unknown, alternate tag/builder, overwrite, rollback or cleanup; every outcome closes allowances0. Accept Windows directory power-loss durability limitations, ordinary registry/dependency/Docker resource/credential-store behavior and costs without hard billing/internal-transfer cap.

Publication needs a fresh exact owner decision after source review. The plan grants ZERO ECS/worker/ledger/feature/device/Post authority. A new API223-derived definition must subsequently use the acknowledged new immutable image and explicit background=true; registration and deployment each need separate approval. Do not reuse incompatible224with the old image or consumed authorities.

Version27 already implements the video-only durable handoff: complete-upload ACK plus exact persisted PendingVideoPost ACK before leaving; Pending Posts observes independently, accepted work survives composer exit and restart, and existing deduplicated notification/reconciliation follows actual publication/failure. Direct/prepared sources converge. Rich mixed/music/custom-cover/achievement Posts retain foreground behavior to preserve payload. No Android build/version28or worker change is required by this correction.

Local verification: npm build, official-copy and compiled-runtime-import checks pass.22source/bootstrap/controller tests pass on Node22and26, including published-loader failure reproduction, exact predicate diff, missing/malformed safety controls, no secret override, bounded publication/unknown-ACK/permanent closure. Nine cross-component local Mongo/loopback HTTP handoff cases per Node version pass against the compiled candidate and exact version27engine/policy/parser. These use synthetic accepted/READYfixtures and no production Google/S3/FFmpeg/push/device operations. Existing45focused mobile cases/typecheck pass; broader mobile remains59pass/one unrelated Web/native playback-type parity failure, untouched.

After a compatible deployment, genuine background navigation/restart/Pending Posts/notification behavior still needs a separately approved Samsung Zoro Post. Earlier185MBforeground playback is not background UX proof. No APK install, production test Post, task registration/service update, budget/manual-hold/history/scaling change or deploy.sh is authorized here.
