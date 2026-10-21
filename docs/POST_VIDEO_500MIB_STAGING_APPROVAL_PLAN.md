# 500 MiB isolated staging execution and approval plan

Prepared 2026-10-20 (India). **NOT APPROVED / NOT PROVISIONED.** No command below has been used to mutate AWS. Do not run `deploy.sh`: production revision 205 is already current and must remain unchanged.

Approval update: the user explicitly approved this staging plan and $25/12-hour limit, then separately approved a temporary staging-only CodeBuild project, build role and encrypted source archive, estimated under $1 within that same limit. The original pre-approval status above records the plan's creation state, not the current approval state. Provisioning/evidence will be recorded in the execution report; approval does not itself mean a resource exists. The build stack is `squadhunt-video-staging-build`, template `infra/post-video-staging-build.yaml`, project/repository `squadhunt-video-staging-build` / `squadhunt-video-staging`, source key `staging-build-source/<archive-sha256>.zip` in the new bucket, no production secret access. Repository creation belongs to that build stack rather than the API stack. API starts at zero tasks until the candidate is actually built. A local worktree snapshot is identified by archive SHA256 + base Git revision, not falsely labelled as a committed Git revision.

## Target and resource boundary

Account `906446637180`, region `us-east-1`. Read-only discovery found one ECS cluster (`arc-cluster`), one DocumentDB 5.0.0 cluster and one Redis replication group, all production; no CloudFormation stacks, staging buckets, staging secrets or staging distributions were found. Naming discovery alone does not establish isolation; the following resources are NEW, not copies/restores of production.

| Stack / resource | Exact requested identity / count | Scope |
| --- | --- | --- |
| `squadhunt-video-staging-network` | VPC `10.248.0.0/16`, public `10.248.0.0/24`, `10.248.1.0/24`; private `10.248.10.0/24`, `10.248.11.0/24`; 2 AZs | Staging only; no peering/transit/VPN to production |
| Network resources | 1 IGW, 1 NAT + EIP, 2 route tables, associations, 1 S3 gateway endpoint, 5 security groups | New resources only; a single NAT is acceptable for disposable tests, not an HA production recommendation |
| `squadhunt-video-staging-data` | DocDB `arc-video-staging-db`, instance `arc-video-staging-db-1`, engine 5.0.0, `db.t3.medium`, TLS, encrypted storage, 1-day backup | Empty staging database only; no production snapshots/users/exposure/queues |
| Data stack | Redis OSS 7.1 `arc-video-staging-redis`, `cache.t4g.micro`, 1 node, TLS/auth, encryption | New isolated BullMQ `clip-video` queue; no production connection |
| Data secrets | `arc/staging/post-video/documentdb`, `arc/staging/post-video/redis` | Independently generated; no credentials printed in commands/reports |
| `squadhunt-video-staging-media` | Bucket `squadhunt-video-staging-906446637180-us-east-1`; 1 NEW CloudFront distribution, OAC, RSA public key/key group, response headers policy | New bucket policy and distribution only; never merge these into production |
| Media rules | All public access blocked; OAC read allowed only `post-video-playback/*`; source explicitly denied to CloudFront; restricted default behavior (no unsigned fallback); 2-day multipart abort | Live source retention stays `0` (retain originals), no automatic live-object expiry |
| `squadhunt-video-staging-api` | ECS cluster `squadhunt-video-staging`, API service `squadhunt-video-staging-api`, 0.5 vCPU/1 GiB task, internal ALB, target group/listener, CloudFront VPC origin + API distribution | New stack; HTTPS viewer endpoint, private origin connection, no DNS/certificate changes |
| API stack bootstrap | ECR repository `squadhunt-video-staging`, secret `arc/staging/post-video/backend`, task/execution roles, log group | Stage image only; API starts at desired count **0** until secrets, origin bindings, image and migration are validated |
| `squadhunt-video-staging-worker` | Existing worker template, 2 vCPU/4 GiB, 40 GiB disk, 1 job, 2 encoder threads, stage service/logs/metrics/alarms | No inbound access; stage task role and queue only; bootstrap desired count 0 |
| Monitoring | Staging-only SNS topic `squadhunt-video-staging-alerts`; worker queue/error alarms, ECS CPU/RAM/disk evidence, 7/30-day API/worker logs | No production alarms altered; no promise that billing alerts are a hard spend cap |
| Account-level AWS-managed dependency | `AWSServiceRoleForCloudFrontVPCOrigin` is currently absent; AWS creates it for the NEW VPC origin | **Shared/account-scoped addition requiring approval**; no existing production role/policy edited |
| Shared read-only dependencies | Existing AWS account/region, AWS-managed CloudFront prefix list `pl-3b927c52`, managed cache/origin policies | Read only; quotas/account bill can still be affected by staging |

CloudFormation physical IDs (subnets, roles, distributions, etc.) are allocated on create and must be recorded in a staging resource manifest. Stack names and logical resources above are the approval allowlist, not guessed AWS IDs. All stack deployments must add tags `Project=SquadHunt Environment=staging Purpose=post-video-validation` and an owner/expiry timestamp. Recheck VPC range collisions, bucket-name availability, quotas and account identity immediately before execution.

## Costs and limits proposed for approval

Read-only AWS Price List API queried on 2026-10-20; Linux/x86 on-demand us-east-1, USD, no Free Tier, credits, discounts or tax assumed:

| Component | Verified unit price | 730 hours |
| --- | --- | ---: |
| Worker 2 vCPU + 4 GiB + 20 GiB extra disk | `2×0.04048 + 4×0.004445 + 20×0.000111 = $0.10096/h` | $73.70 |
| API 0.5 vCPU + 1 GiB | $0.024685/h | $18.02 |
| DocumentDB t3.medium standard | $0.078/h, plus I/O/storage/burst credits | $56.94 |
| Redis t4g.micro | $0.016/h | $11.68 |
| NAT | $0.045/h + $0.045/GB processed | $32.85 + traffic |
| Internal ALB | $0.0225/h + $0.008/LCU-h | $16.43 + capacity |
| NAT public IPv4 (internal ALB/tasks have none) | $0.005/h | $3.65 |
| Three Secrets Manager secrets | $0.40/secret-month + $0.05/10,000 requests | $1.20 + requests |
| S3 standard | $0.023/GB-month first tier | $0.92 for 40 GB-month, plus requests |
| DocumentDB storage | $0.10/GB-month | $1 for 10 GB, plus I/O |

Fixed continuously running baseline: **about $214.47/month**, before ALB capacity, logs, requests, ECR storage, DB I/O/credits, snapshots, cross-AZ and CDN delivery. Planning allowance: **$225–250/month at low test traffic**, not a quote for unrestricted traffic. Current pricing sources: [Fargate](https://aws.amazon.com/fargate/pricing/), [DocumentDB](https://aws.amazon.com/documentdb/pricing/), [ElastiCache](https://aws.amazon.com/elasticache/pricing/), [VPC](https://aws.amazon.com/vpc/pricing/), [ALB](https://aws.amazon.com/elasticloadbalancing/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [CloudFront pay-as-you-go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/). The regional unit rates above came from the API, not old blog examples. CDN region/request cost and account pricing-plan eligibility must be confirmed before running transfers; no flat-rate/Free plan entitlement is assumed.

Proposed first window: **12 hours, spending authorization up to $25**, maximum 20 GiB source + 20 GiB derivatives retained for this run, at most 20 GiB CDN viewing/download traffic, API 1 task, worker 1 task, no autoscaling or Spot. Baseline for 12 hours ≈ $3.51; allowing for setup/image pulls, traffic, I/O, requests and logs, plan **$5–10 for the bounded window**, with $25 operational headroom. This is an estimate, not an AWS-enforced cap. Stop and request approval before extending time/traffic/resources; verify Cost Explorer later because billing metrics lag.

Worker processing-only estimate at this allocation: 10 / 30 / 60 minutes ≈ **$0.0168 / $0.0505 / $0.101**. This is not measured Fargate processing time or an all-in upload price. A 500 MiB original retained for a full month is about $0.0112 in S3 standard, before derivatives/requests/delivery. Retaining all originals causes cumulative growth; source-retention policy is a separate approval.

## IAM, network, secret and data requirements

- Provisioning principal: create only the named staging stacks, stage ECR/S3/DocDB/Redis/ECS/ALB/CloudFront resources, stage role policies, stage secrets and logs/SNS/alarms; `iam:PassRole` only new staging task/execution roles. New CloudFront service-linked role creation is an explicit account-level dependency, not concealed as staging-only IAM.
- API/worker task role: `GetSecretValue` on stage backend secret only; explicit deny other secrets, batch secrets, STS role escalation/PassRole and S3 outside stage bucket. S3 source/derivative operations remain inside that bucket. Execution role pulls only stage ECR images and writes stage log streams; authorization-token resource `*` is required by ECR but does not itself grant repository access.
- Stage tasks run in private subnets without public IPs. Internal ALB accepts CloudFront managed-prefix traffic on port 80 over the CloudFront VPC-origin connection; API port 5001 only from that ALB group. DocDB/Redis accept only stage API/worker groups on TLS ports 27017/6379. Worker has no ingress. Tighten the ALB group to the AWS-created VPC-origin service SG after its staging-only identity is recorded. No route into production VPC.
- HTTPS is required for client/API/media origins; DB/Redis use TLS and the existing image CA bundle `/app/rds-ca-bundle.pem`. S3 traffic uses the free gateway endpoint rather than NAT. The single NAT handles other HTTPS dependencies/image pulls, not upload bytes through the API.
- Backend secret is generated from new stage database/cache credentials plus new JWT/refresh/admin/encryption/playback keys and a NEW stage RSA signing key. Never copy production secret JSON, Google/APNs/SMTP/payment credentials, auth tokens, device-token tables or user data. Use synthetic stage accounts. No real emails, push recipients or payment actions. Any required startup provider key is a synthetic staging-only key, not a working production credential.
- API/worker independently receive `DEPLOYMENT_ENVIRONMENT=staging`, explicit stage secret ID, four resource guards, `STAGING_API_ORIGIN` and `STAGING_MEDIA_ORIGIN` from these stack outputs. The secret cannot supply these controls. Generated CloudFront domains must be checked against the stage distribution IDs/tags before binding them; a task binding is not external ownership proof on its own.
- Stage feature flags only: uploads true, HLS true, embedded worker false, private delivery true, source retention 0. **Do not set `VIDEO_DEPLOYMENT_MODE=compatibility` in staging's enabled topology.** Production flags remain exactly unchanged.

## Ordered pending execution (NOT executed / requires approval)

1. Review/commit local changes; build the **new staging candidate** on the Docker-equipped laptop. Local Docker is unavailable. Existing production image is immutable but predates these staging-origin fixes; do not relabel it as a new source build or redeploy production.
2. Recheck `aws sts get-caller-identity`, region, resources, current production 205 health and approved budget/window. Validate all templates; create/review staging CloudFormation change sets before executing them. A validation success is not proof of IAM/quota/resource-level deployability.
3. Create network/data/media stacks; record every output and stage resource/tag/SG identity. Generate RSA private key offline into a mode-600 local file or directly into the new stage secret; never place it in Git or command-line arguments. Media template receives only the public key.
4. Bootstrap API stack at desired 0 with a stage repository digest placeholder identifying the intended candidate; create/push the actual stage image, then update to its verified immutable digest before starting any task. Do not execute the existing production `deploy.sh`.
5. Generate/hydrate **only** stage backend secret from independently generated credentials and resolved stage outputs; API stack is reconfigured with exact API/media origin bindings. Preserve task count 0 until startup checks pass. Synthetic startup provider settings must pass the existing production-grade readiness checks; do not suppress them globally.
6. Run migration harness within a new staging task using the reviewed staging image; it loads the compiled secret/isolation modules and needs no dev-only dependencies. Command: `node scripts/validate-post-video-documentdb.mjs --run-approved-staging-test`. Record AWS DocDB engine 5.0.0 independently. This creates a new `video_staging_migration_*` database, preserves fixture records, applies/reapplies/verifies, reconnects and verifies. A reconnect is not a DB restart: separately repeat verification after an approved staging restart. Then apply/verify `scripts/migrate-video-upload-indexes.js` against the EMPTY stage application's database, never production.
7. Create/start worker with `infra/post-video-worker.yaml` and stage outputs, desired 1. Start API desired 1 only after signed delivery, source denial and worker readiness gates pass. Required worker overrides: `DeploymentEnvironment=staging`, `BackendSecretId=<stage ARN>`, four guards, two origin bindings, stage cluster/subnets/SG/roles, immutable stage image, stage SNS topic. No existing queue consumer is disabled.
8. Configure a local Web instance against the stage API. Use `localhost:3000` as S3/media CORS origin; physical Android Chrome may use temporary `adb reverse tcp:3000 tcp:3000`. QA native app must have a distinct application ID and explicit stage API before any sign-in/upload; do not reuse production account tokens. Browser, QA endpoint and token issuer checks precede publication.
9. Run real staged transfer/publication/security matrix, 10/50/100/200/300/500 MiB, actual accepted bytes, interruption/resume/retry, exact-limit metadata checks (524288000 accepted / +1 rejected). Local padded fixture harness is NOT AWS/capacity evidence. Use controlled real video plus encoded synthetic stress cases; do not label test patterns as gaming/camera recordings. Record source hashes, part/byte/retry counters, S3 HEAD, queue/worker metrics, output hashes and signed/range network results without publishing signed URLs/tokens in reports.
10. Test invalid owners, duplicate completion/publication, private owner/follower/blocked/deleted cases, worker stop/retry/duplicate/stall and cleanup 24-hour grace; measure actual ECS CPU/RAM/disk/wall time. No upload/processing/prefetch exposure records may be created. Do not seed production or reuse ContentExposure.

Prepared templates (syntax validated read-only):

```sh
aws cloudformation validate-template --template-body file://infra/post-video-staging-network.yaml
aws cloudformation validate-template --template-body file://infra/post-video-staging-data.yaml
aws cloudformation validate-template --template-body file://infra/post-video-staging-media.yaml
aws cloudformation validate-template --template-body file://infra/post-video-staging-api.yaml
aws cloudformation validate-template --template-body file://infra/post-video-worker.yaml
```

Exact stack create/change-set execution inputs must be assembled from the just-created outputs in a **local non-secret parameter manifest** and reviewed before mutation. The stack names/templates above are fixed; subnet/role/CF IDs cannot legitimately be filled in before creation. Do not substitute production IDs to make a command run. The worker template is separate from the API; no new encoding implementation was introduced.

## Cleanup and rollback requested within staging approval

At window end stop stage uploads, drain or explicitly cancel stage jobs, scale **stage only** API/worker to 0, abort stage multipart uploads, record results, disable/delete stage distributions/VPC origin and remove stage ALB/NAT/network resources in dependency order. Purge only independently verified synthetic objects/accounts/databases in the new stage resources after evidence export. Delete new stage DB instance/cluster/cache/secrets/ECR/bucket explicitly after their names/tags/account match the manifest; stateful template resources use **Retain**, so stack deletion alone does NOT stop their charges. Retained logs/evidence may also incur storage costs. Do not delete unrelated IAM roles or an AWS-managed shared service-linked role automatically.

Cleanup must never target `arc-cluster`, `arc-backend`, `arc-db`, `arc-redis-classic`, `arc/prod/backend`, any production bucket/distribution or user media. Existing production revision 205 is not a rollback target for staging failures because it was never changed. For a stage code regression restore the previously recorded stage image/task definition or leave stage desired 0. For failed stack creation stop tasks, inspect retained resources and remove only approved stage identities; no production recovery/migrations occur.

## Separate privacy and production approvals

Current grants are stable within 15-minute issuance windows and can remain usable for roughly **45–60 minutes**; direct asset URLs are bearer URLs, not instant revocation. New manifest requests recheck authorization, but already issued child URLs remain until expiry; 24-hour object-deletion grace does not revoke them immediately. This is **not yet accepted as a production privacy policy**.

Options to review in staging: (1) keep documented 1-hour maximum; (2) 5-minute renewable grants with client refresh and long-video/range recovery tests; (3) viewer/session-bound edge authorization/revocation store, more infrastructure/cost. No shorter TTL or revocation redesign has been silently applied. Keep production private-delivery flag false until an explicit policy choice and actual signed/unsigned tests pass.

Approval needed now: named staging resources including the account-level VPC-origin service role, up to $25 for a 12-hour/20-GiB-ingress-source/20-GiB-derivative/20-GiB-viewing window and stage-only cleanup above. This does **not** authorize production changes, production retention changes, a new iOS runtime download, production rollout or unbounded spending. Production activation requires a separate approval after all gates pass.
