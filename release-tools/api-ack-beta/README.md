# Build-only API acknowledgement candidate

This handoff builds the DocumentDB5-compatible acknowledgement route on top of
the exact API217/worker6 source archive. Only one runtime file changes. It is NOT
an approval to push an image, run deploy.sh, register a task, migrate a database,
restart a worker or send a notification.

On the Docker laptop, fetch/switch to the separately approved handoff branch,
verify its exact commit, and use Node22 with Linux/amd64 Docker:

```
node release-tools/api-ack-beta/prepare-image.cjs --preview-only
node release-tools/api-ack-beta/prepare-image.cjs --build-only
```

The helper verifies 755 source files, pinned archive/content hashes and the
production import smoke test using `--network none`. The frozen ZIP is the build
input; the surrounding checkout is not silently substituted. No credentials or
local environment files enter the ZIP or Docker build arguments. Keep the exact
build-receipt.json and send its final JSON, not any credentials. A local image ID
is not an ECR digest. No new immutable image exists until that build succeeds.

Do not run deploy.sh for this handoff. ECR publication and an API-only ECS update
need separate exact approvals after the Docker receipt and registry verification.
Worker6, video processing, Web, Android24 and all runtime flags remain unchanged.
The first deployed acknowledgement and typed timestamp readback are still required
to establish success on actual Amazon DocumentDB5.
