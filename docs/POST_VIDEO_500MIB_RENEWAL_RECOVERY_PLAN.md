# Five-minute grants and recovery/capacity follow-up

20 October 2026. **User approved round-2 staging and the additional $15/six-hour cap. Production activation NOT authorized.** The clock starts at the first new billable resource, recorded in the new round-2 manifest; no resources from the closed first run are reused.

## Policy decision

The user explicitly selected **five-minute renewable grants**. This is a maximum lifetime for starting new signed-media requests, not recall of downloaded data or termination of an already-authorized transfer. Renewal must use current application authentication and recheck live post/profile/follow/block/moderation/deletion access. An old media bearer is not renewal authority. CloudFront evaluates expiry at request time; an already-started transfer can finish ([AWS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html)).

Implementation scope: only `post-video-playback/*`, not legacy clips, stories, DM, avatars or global authentication. Stable 30-second issuance buckets keep lifetime at 270–300 seconds. Refresh 60 seconds early; inactive/background players must not accumulate renewal loops. Clients must retain playhead and play/pause state, bound transient retries, stop loading when authorization is denied/expires, cancel pending requests on source change/unmount, and recover on foreground/online return. Source originals remain inaccessible; source retention remains 0. No production configuration is changed.

## Local feedback loops

- A new real signing-function test reproduced the old >5-minute lifetime (red before the fix); baseline upload/publication tests: 12/12 passed.
- Check stable signatures, maximum expiry, child-asset expiry, expired/overlong/tampered grants and response-only renewal metadata.
- Exercise renewal against real isolated MongoDB fixtures: public, private owner, followers, blocked/inactive viewer, profile change, deletion/moderation, unready/unattached session and cross-session paths. No signature before ACL success; no-store responses.
- Client fake-time tests: >5-minute renewal, pause/background/foreground, delayed responses, network loss, 401/403/404, retries, stale source responses, single in-flight request, source cleanup and playhead preservation. These are NOT real CloudFront/native-runtime evidence.
- Worker tests: healthy heartbeat protects long jobs, simultaneous duplicate delivery, loss of lease during encoding/publication, crash/retry, completion acknowledgement loss, cleanup failure/retry and source preservation. Local fixtures must be explicitly distinguished from real AWS lease waiting.
- Re-run feature-disabled startup/build/typecheck, existing HLS/media-integrity/privacy/auth/recommendation/no-repeat and client regression checks. Do not modify ranking or existing preload limits.

## Round-2 AWS approval proposal

Target **906446637180 / us-east-1**. The previous six stacks are DELETE_COMPLETE; do not restore their deleted data or secrets. Reuse reviewed templates and the six stack names `squadhunt-video-staging-{network,data,media,build,api,worker}` for NEW stack IDs/physical resources, with `ValidationRound=2` and a new expiry tag/manifest. Verify name availability and account ownership before each create.

| New resource | Bound / isolation |
| --- | --- |
| Network | NEW VPC/subnets, 1 NAT/EIP, gateway endpoint, stage SGs; no production peering/routing |
| Data | NEW DocDB 5.0.0 t3.medium and Redis 7.1 t4g.micro; empty synthetic data only |
| Secrets | NEW `arc/staging/post-video-r2/{documentdb,redis,backend}`; independently generated keys; do NOT restore/overwrite the three previous recovery markers |
| Storage | NEW bucket `squadhunt-video-staging-r2-906446637180-us-east-1`; AES256/public-access block, separate source/versioned-output prefixes, no production bucket permissions |
| API/delivery | NEW private API task (0.5 vCPU/1 GiB), internal ALB, API CloudFront VPC origin/distribution and signed media distribution/OAC/key group; no DNS changes |
| Worker | At most **2** NEW workers, each 2 vCPU/4 GiB/40 GiB, **one job/container, two FFmpeg threads**; isolated queue only; no autoscaling |
| Build | Temporary NEW staging CodeBuild/ECR/logs/role and encrypted source archive, at most two bounded builds, immutable image/archive provenance; no production secrets or repository writes |
| Monitoring | Stage-only logs/metrics/alarms; no external SNS subscribers without separate approval; collect per-rendition bytes, CPU/RAM/scratch/queue times |
| Shared | Existing AWS CloudFront VPC-origin service-linked role and managed prefix list are read-only dependencies; do not edit/delete the role |

Template preparation adds a staging-only `SecretNamespace` parameter so round 2 cannot collide with scheduled-for-deletion names. API/worker start at zero until candidate build, exact origin/resource bindings and migration checks pass. This is not `deploy.sh`; production `arc-cluster/arc-backend:205`, its flags, IAM, storage, DB, queue, CDN and DNS remain untouched.

### Additional spending authorization requested

**Up to 6 hours and an additional $15 maximum authorization**, separate from the closed first run. This is not an AWS-enforced cap. Using the regional unit rates verified in the first plan on the same date, baseline with two workers is approximately `$0.292145 + $0.10096 = $0.393105/hour`, about **$2.36 for six hours**, before build, requests/I/O, transfer and retained storage. Plan **$5–10**, authorize at most $15. Recheck prices, quotas and account state before provisioning. Actual first-run billing remains unverified due to AWS reporting lag; do not count its full allowance as already spent or assume unused credit.

Bound source ingress to 10 GiB, derivative storage to 10 GiB and CDN transfer to 10 GiB. No production videos/uploads. Stop before exceeding time/traffic/budget/resources and request new approval. No large iOS runtime download is included.

If accidentally left running continuously, baseline would be about **$288.17/month**, before traffic/storage/build/logs/I/O (planning $300–325 at light use, not an unrestricted-workload quote). The approved test must instead be torn down within six hours. The two-worker cap includes deployment surge: scale staging workers to zero before changing images, then start no more than two; do not allow the template's rolling-update percentage to create a third/fourth worker during this run.

## Actual-AWS cases for the new window

1. Five-minute maximum signed request expiry, >10-minute HLS/MP4 playback with renewal, foreground after expiry, successful Range seeks and fresh authorization denial after privacy/follow/block/delete changes. Previously issued assets must fail for NEW requests after their expiry; ongoing/downloaded bytes are explicitly outside revocation.
2. Two-worker processing of representative encoded sources with a queued third job; concurrent duplicates; stop one worker mid-processing and wait the real lease/recovery path (no fixture timestamp edits for this case). Confirm one output winner, one canonical publication, bounded concurrency, cleanup and no unready recommendations.
3. Actual expired PUT URL then reauthorization/resume with accepted-part reuse; lost completion response; a failed part, network interruption and bounded retries. Count successful/failed PUTs and retain ETag/LastModified proof.
4. Preserve per-variant byte exports and source hashes; measure active/waiting job times, CPU, peak sampled cgroup RAM/scratch and API memory. No throughput SLA or higher concurrency from one passing batch.
5. Actual browser >5-minute renewal/recovery and available Samsung QA playback. Preserve production app/data; use synthetic media only. Device lock or Wi-Fi/cellular changes require the specific necessary permission. iOS remains blocked until runtime/device availability is separately resolved or explicitly excluded.

## Cleanup, rollback and approvals

Before provisioning, record NEW physical IDs, stack IDs and `Environment=staging`/round tags; never reuse the old cleanup manifest against new resources. Cleanup only new round-2 identities after sanitized evidence export: stop stage tasks, abort stage parts, disable/delete new distributions/origin, purge synthetic objects/build archives, explicitly delete retained DB/cache/bucket/ECR/logs/secrets, then network/NAT/EIP. Secrets use a seven-day recovery window. The existing shared service-linked role is preserved.

The requested round-2 cleanup approval also covers deletion of a newly created orphaned `CloudFront-VPCOrigins-Service-SG` **only** after its stage origin/distributions are gone, its exact NEW VPC is verified, and zero ENIs plus zero inbound/outbound SG references are proven; permission dry-run first. This is irreversible and AWS advises against editing active service-managed groups. Do not target the already-deleted first-run group or any production group.

For stage regression, stop new tests/scale stage desired counts to zero and restore only the recorded preceding stage image if needed. Production was not changed and is not a rollback target. No production migration, rollout, private-delivery activation, retention change or grant-policy deployment is authorized by approval of this staging plan.
