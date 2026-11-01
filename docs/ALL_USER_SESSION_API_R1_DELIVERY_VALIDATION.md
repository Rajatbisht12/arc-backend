# Session-only all-user release — retain worker7 with bounded private playback

1 November2026 IST. **LOCAL IMPLEMENTATION PASS; ALL-USER PRODUCTION STILL OFF.**
The separately approved eight native metadata reads established API219 and worker7,
stable1/1/0, and permanently closed. No additional AWS/data/HTTP call was used to
prepare this API-only route. Q0 OptionB is unchanged; worker7 is not retired here.

The API219 image lacks the larger Android Integrity module and allows old legacy
video files under all-mode, so a flag-only rollout is unsafe. The revised API source
adds the reviewed Integrity/limit/owner/legacy guards and a private-session output
selection gate. Worker7 already normalizes HEVC and generates a bounded MP4 fallback.
Its oversized ultrawide/tall HLS rungs remain private and unused. The API validates the
complete server-generated rendition map/master, emits only short-edge≤1080/long-edge
≤1920 rungs and denies direct oversized child requests before object read/signing.
Child references stay within their own rendition; external/original/cross-rung/key
references fail closed. Current Post/viewer authorization still precedes media reads.
If no HLS rung fits, new publication and grant renewal use the private H264 fallback.
No source/derivative/Post is deleted, and no historical identity is declared complete.

Five0.8second generated SDR/AAC sources ran through the actual frozen worker7 function,
actual FFmpeg9.0.1/ffprobe and the exact API guard. Every delivered asset was fully
decoded and measured as H264/yuv420p/AAC, bounded, aspect-preserving and not upscaled.

| Actual source | Highest delivered HLS | Private MP4 |
|---|---|---|
| 1920×1080 HEVC | 1920×1080 | 1280×720 |
| 3840×2160 HEVC | 1920×1080 | 1280×720 |
| 3840×1080 H264 | 1920×540 | 1280×360 |
| 1080×3840 HEVC | 540×1920 | 360×1280 |
| 7680×360 H264 | None; all HLS rungs denied | 1280×60 |

The first extreme fixture used12000pixels and hit worker7's existing8192 source limit;
that rejection is retained. The valid7680fixture tests fallback-only delivery. Resource
limits were not raised. No perceptual-quality equivalence, HDR tone mapping, full camera
matrix, device decoder or native CloudFront playback is established by these fixtures.
Existing H264 bitrate pruning/lossy worker behavior is unchanged.

Seven source tests preserve protected identity/owner flow, quota/admission order,
legacy rejection/idempotency and exact accepted-session recovery with new intake off.
Eleven guard/controller tests include malformed maps, unauthorized viewers, unknown/
oversized direct children, URI isolation, actual private signing, fallback-only and
READY publication. Fourteen one-use build-controller tests pass. These37checks are
local fixtures/intercepted dependencies, not production qualification. Exact candidate
TypeScript compilation/runtime imports pass. Three existing offline publication input
models are unchanged; no native client is instantiated.

The native fair-scheduling flag was false; preserving its existing conditional admission
hook does not prove global budget safety. Before API/service or eligibility mutation,
qualify current accepted sessions/jobs/claims/leases/Post/HLS and independent holds plus
actual admission/capacity bounds. No queue-empty or owner-inactivity substitution.
Keep private legacy disabled; its new worker/index is not needed for session uploads.
Use API all-mode with an empty canary list and background publication off so unchanged
worker7 cannot reapply canary privacy to new intents. Existing intents remain preserved.
All existing authentication, user/profile restrictions, size/ownership/rate controls and
request-bound Android proof requirements remain. Non-xyz native Android/Web intake and
original1080p/4K HEVC/private playback still require separately approved real tests.

Rollback closes NEW admission while retaining this delivery guard, all-mode Post
visibility and already-accepted session/publication recovery. An old API without the
guard is not a safe image rollback for new-cohort media. The production operation must
bind an actual guarded recovery configuration and preserve native obligations.

**Smallest next step:** merge the bounded-delivery carrier follow-up, run its local-only
Windows check, then approve only exact API image publication under the revised build
review. No image build, API deployment, rollout-mode change, worker replacement, Q0,
index, autoscaling or media upload is authorized by these tests.
