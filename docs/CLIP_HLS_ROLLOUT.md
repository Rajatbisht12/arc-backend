# Clip HLS rollout

SquadHunt keeps the existing progressive MP4 URL playable throughout this
rollout. New clients select `playback.hlsUrl` only when
`playback.status === "ready"`; processing and failed records use the MP4
fallback.

## CloudFront media delivery

Clip delivery is configured independently from upload storage. S3 remains the
upload/source-of-truth origin; the API emits CloudFront URLs only when
`AWS_S3_CDN_URL` is set. Existing MongoDB URLs are not rewritten. Instead,
`formatPostDTO` rewrites only public `gaming-social/posts/` and
`gaming-social/clips/` S3 URLs at response time. Query-bearing (potentially
signed) URLs, private prefixes, and third-party URLs are deliberately left
unchanged.

The production distribution uses:

- the existing S3 REST origin and Origin Access Control (SigV4, always sign);
- AWS managed `CachingOptimized` (one-day default, one-year maximum, no query
  strings/cookies/headers in the cache key);
- AWS managed `CORS-S3Origin` to forward only the three CORS negotiation
  headers to S3;
- a bounded viewer-response CloudFront Function that emits CORS only for the
  configured allowlist, exposes Range/cache headers, and prevents one cached
  origin response from poisoning another origin;
- HTTP/2 and HTTP/3, HTTPS redirect, byte-range delivery, and the distribution's
  existing WAF/OAC configuration.

CloudFront Free does not support custom cache or response-header policies. The
viewer-response function is intentional: it preserves the Free pricing plan,
keeps one shared immutable media cache, and avoids wildcard CORS. Do not replace
it with a custom response-header policy without first changing the pricing plan
and explicitly approving the billing impact.

Run the audit from a shell whose AWS CLI identity is authorized. The script
intentionally does not load application credentials from `.env`:

```bash
AWS_S3_BUCKET=arc-gaming-media-906446637180 \
AWS_REGION=us-east-1 \
npm run audit:clip-cloudfront
```

Provision/reconcile the existing distribution, then wait for deployment and
run strict validation:

```bash
AWS_S3_BUCKET=arc-gaming-media-906446637180 \
AWS_REGION=us-east-1 \
npm run configure:clip-cloudfront

AWS_S3_BUCKET=arc-gaming-media-906446637180 \
AWS_REGION=us-east-1 \
npm run verify:clip-cloudfront
```

Verification performs two real 1 MiB `Range` requests plus alternate-origin,
blocked-origin, and OPTIONS probes. It fails unless CloudFront returns a valid
`206`, exact `Content-Range`/length/type, `Accept-Ranges: bytes`, correct CORS,
and no CORS access for the blocked origin.

Deploy the backend version containing `mediaDelivery.js` before relying on CDN
rewrites for legacy database records. Activating the variable against an older
compatible backend is safe, but that older version only uses it for newly
generated upload URLs. Only after verification succeeds, activate the CDN URL
in ECS:

```bash
AWS_S3_BUCKET=arc-gaming-media-906446637180 \
AWS_REGION=us-east-1 \
npm run activate:clip-cloudfront
```

The activation command verifies the distribution again, registers a new task
definition containing the non-secret `AWS_S3_CDN_URL`, and starts a normal ECS
rolling deployment. `deploy.sh` copies the active task definition, so later
application deployments preserve the CDN setting.

Rollback is configuration-only: remove `AWS_S3_CDN_URL` from a new ECS task
revision and redeploy. Stored object keys and database URLs remain untouched.
The legacy public bucket policy is retained during this compatibility phase so
old clients/direct URLs continue to work. Remove public S3 read access only
after old clients and all non-post media paths have been migrated and verified.

## Required services and configuration

Deploy the HTTP service and `arc-clip-hls-worker` from `render.yaml` together.
The HTTP service enqueues jobs and runs recovery; only the worker runs FFmpeg.
Use one worker initially and increase `CLIP_HLS_WORKER_CONCURRENCY` only after
CPU, memory, S3 request rate, and queue latency have been measured.

Both services need the same MongoDB and Redis configuration. The worker also
needs the S3 bucket and credentials. Set `AWS_S3_CDN_URL` to the HTTPS base URL
of the configured distribution when a CDN is available. Leave it unset for
local development or direct-S3 delivery.

The worker task role must have object Put/Get/Delete access and prefix-scoped
`s3:ListBucket` access. Retry cleanup calls `ListObjectsV2` before publishing a
version; without this permission every job fails before FFmpeg starts. Apply
the checked-in least-privilege policy to the ECS task role, then verify it:

```sh
aws iam put-role-policy \
  --role-name arc-ecs-task-role \
  --policy-name arc-s3-access \
  --policy-document file://s3policy.json

aws iam get-role-policy \
  --role-name arc-ecs-task-role \
  --policy-name arc-s3-access
```

Required feature values:

```text
CLIP_HLS_ENABLED=true
CLIP_HLS_WORKER_ENABLED=false       # HTTP service
CLIP_HLS_WORKER_ENABLED=true        # dedicated worker
CLIP_HLS_WORKER_CONCURRENCY=1
CLIP_HLS_JOB_ATTEMPTS=3
```

The worker image must contain `ffmpeg` and `ffprobe`; the checked-in Dockerfile
installs both.

## Pre-deploy checks

Run from the backend directory:

```sh
npm run test:clip-hls
npm run typecheck
npm run build
npm run audit:clip-hls-cors
npm run audit:clip-hls-indexes
npm run audit:clip-hls
```

The audit commands are read-only. Confirm that the configured database is the
intended environment before any apply command.

Create and verify the recovery index before enabling the minute-by-minute
recovery scan:

```sh
npm run migrate:clip-hls-indexes
npm run verify:clip-hls-indexes
```

## Storage and CDN

Apply the bucket CORS rule once, then verify it:

```sh
npm run configure:clip-hls-cors
npm run verify:clip-hls-cors
```

HLS objects use versioned paths under
`gaming-social/clips/<post>/<media>/<version>/`. Playlists, initialization
objects, segments, and the fast-start fallback are immutable for one year.
The master playlist is uploaded last, so clients cannot observe a partially
published rendition set.

Configure the CDN to pass GET, HEAD, Range, Origin, and CORS response headers.
It must preserve the manifest and segment MIME types. Do not rewrite query or
path components inside HLS playlists. Cache immutable version paths at the
edge; changing an asset creates a new version path rather than invalidating an
existing one.

## Smoke test

After the HTTP service and worker are healthy:

1. Upload a short portrait Clip and a landscape Clip.
2. Confirm the request returns without waiting for transcoding.
3. Observe `processing`, then `ready`, in the media playback field.
4. Fetch the master manifest and every referenced playlist, init object, and
   segment from the public URL.
5. Confirm the master has at least two variants when the source supports them,
   no variant exceeds the source dimensions, segments are about two seconds,
   and the fallback MP4 has `moov` before `mdat`.
6. Play the master URL in App and Web. Verify rendition-change logs while
   throttling bandwidth and verify that playback time does not reset.
7. Force one processing failure and confirm clients keep playing the fallback
   MP4 and a retry can later reach `ready`.

## Legacy backfill

Run the audit first. Queue a bounded batch, wait for the worker to drain it,
then verify before raising the limit:

```sh
npm run audit:clip-hls
node scripts/backfill-clip-hls.js --apply --limit=100
npm run verify:clip-hls
```

Failed jobs remain visible and retain MP4 playback. Retry them with a new,
idempotent processing version:

```sh
node scripts/backfill-clip-hls.js --apply --retry-failed --limit=100
```

Repeated runs skip completed media. Keep the old MP4 objects until rollout and
backfill verification are complete.

## Rollback

Stop the Clip worker and set `CLIP_HLS_ENABLED=false` to stop new jobs. Existing
API fields remain additive, old clients keep using `media.url`, and new clients
fall back to `playback.fallbackMp4Url` when HLS is absent or fails. Do not delete
completed HLS objects during an application rollback.
