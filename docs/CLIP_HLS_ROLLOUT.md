# Clip HLS rollout

SquadHunt keeps the existing progressive MP4 URL playable throughout this
rollout. New clients select `playback.hlsUrl` only when
`playback.status === "ready"`; processing and failed records use the MP4
fallback.

## Required services and configuration

Deploy the HTTP service and `arc-clip-hls-worker` from `render.yaml` together.
The HTTP service enqueues jobs and runs recovery; only the worker runs FFmpeg.
Use one worker initially and increase `CLIP_HLS_WORKER_CONCURRENCY` only after
CPU, memory, S3 request rate, and queue latency have been measured.

Both services need the same MongoDB and Redis configuration. The worker also
needs the S3 bucket and credentials. Set `AWS_S3_CDN_URL` to the HTTPS base URL
of the configured distribution when a CDN is available. Leave it unset for
local development or direct-S3 delivery.

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
