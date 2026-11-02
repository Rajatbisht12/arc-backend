# Story overlays v2: API-only deployment

This change accepts and persists the Android28 text/link overlay metadata and adds
`data.overlayVersion: 2` to the authenticated user Story response. Existing
unversioned text remains supported. No Story migration or new index is needed.

The three application changes are `src/legacy-src/utils/storyOverlays.js`,
`src/legacy-src/models/Story.js`, and `src/legacy-src/controllers/storyController.js`.
The web renderer is in Rajat's frontend commit `26e70b5`.

## Prepare and validate locally

Use a clean checkout of the merged Story commit, with LF checkout bytes
(`git clone --config core.autocrlf=false ...` on Windows). The production API225
source was sealed inside the previous release archive. Do not build the root
Dockerfile directly: that would not preserve the qualified API source baseline.

From the backend repository root, with Node22 and an installed local MongoDB:

```sh
npm ci
# Set this to your installed local mongod executable; no production DB URI is used.
MONGOMS_SYSTEM_BINARY=/path/to/mongod MONGOMS_VERSION=8.3.7 node --test --test-timeout=60000 \
  src/legacy-src/utils/storyOverlays.test.js \
  src/legacy-src/utils/storyOverlays.integration.test.js \
  src/legacy-src/utils/storyMusicPolicy.test.js \
  src/legacy-src/models/StoryMusicSerialization.test.js

node scripts/prepare-story-overlays-api.cjs ../arc-story-api-context
cd ../arc-story-api-context
npm ci
npm run build
```

Use the actual installed MongoDB version for `MONGOMS_VERSION`. Without an explicit
local binary, the two database integration cases are reported skipped; that is not
a database round-trip PASS. Integration uses synthetic local media/auth fixtures;
cloud media transfer is stubbed. It preserves production indexes and tests serial
idempotent replay, not concurrent index enforcement.

The materializer verifies every source byte from the API225 archive, then changes
only the three Story files. It refuses an existing output directory or changed
input pins. Expected source-content SHA256:
`7210a79c3c4b7ed4d46ccecdfa58f8f89c2c55bf8328d08c30d6ec182cdff86f`.
It never calls AWS, Docker, a database or a production endpoint.

## Publish the image and roll out the API

These are separate production operations requiring fresh exact authorization.
This source push performs none of them. Do not reuse the consumed background-Post
build/deployment controllers or run `deploy.sh`.

1. After build/push approval, authenticate Docker to the existing ECR repository
   `906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend`. Use a new, verified
   unused Story tag. Build **the generated context** for `linux/amd64`, push once,
   and record the actual acknowledged index/amd64 digests. Example build shape:

   ```sh
   # From the clean repository root; replace the tag after its exact approval.
   STORY_API_IMAGE=906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend:YOUR_APPROVED_NEW_STORY_TAG
   docker buildx build --platform linux/amd64 --provenance=mode=min \
     --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" \
     --build-arg SOURCE_REPOSITORY=https://github.com/Rajatbisht12/arc-backend \
     --tag "$STORY_API_IMAGE" --push ../arc-story-api-context
   ```

2. After registration approval, freshly verify the running API definition and
   service. The last qualified baseline is `arc-backend:225`, published index
   `sha256:21217d162b0bc362c35d0aab4cc0abcfadb8653129a1dbc9c8ddc0364e301d6f`.
   If the live baseline differs, stop and review it. In ECS/us-east-1, create a new
   revision from that actual API definition, changing **only the image** to the
   newly acknowledged digest. Preserve every role, exact versioned secret
   reference, environment record, command, resource, log and network setting.
   In particular retain background publication, upload/Integrity/private delivery
   controls; never replace the environment with a local `.env` file. Independently
   read back the acknowledged revision; do not guess its revision number.
3. After service-rollout approval, update only `arc-cluster` → `arc-backend` to that
   new revision. Preserve desired count, rolling/drain/health settings, network,
   roles, secret references and rollback policy. Worker8 and its suspended scaling
   remain untouched. A definition registration or Git push alone does not deploy.
4. Verify the actual new API task image, healthy target, completed deployment,
   normal retirement of the prior owned API task, and unchanged fixed settings.
   Unknown acknowledgements require reconciliation, not blind retries or a second
   update. No automatic rollback is authorized by this guide.
5. With the appropriate authenticated-read authority, verify the existing
   `/api/stories/user/:userId` response includes `data.overlayVersion === 2` and
   legacy overlays are still returned. Android28 uses this capability before
   submitting v2 metadata. A genuine Story create/playback test still requires its
   own explicit approval; no Story is posted by these instructions.

No admission/ledger/budget/manual-hold, worker, scaling, original media, Post or
historical Story changes are part of this release. Android28 is an internal Play
release; retain normal Play upgrades and app data. Older Android clients retain
their existing renderer and do not gain the v2 renderer from this server update.

AWS procedure references: [create a task definition revision](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/update-task-definition-console-v2.html)
and [update a service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/update-service-console-v2.html).
