# Deploy `modular-backend` on AWS (ECS Fargate)

> **⚠️ Why Not Lambda?**
> This backend uses WebSockets (Socket.IO), BullMQ background workers, persistent
> MongoDB/Redis connections, and in-process cron jobs — all of which require a
> long-running process. Lambda's cold starts, 15-min timeout, and lack of TCP
> connections make it incompatible. **ECS Fargate is the right choice.**

## Architecture

```
                         ┌──────────────────────────────────────────┐
                         │              AWS Cloud                   │
                         │                                          │
  Internet ──► Route 53  │   ┌───────┐    ┌─────────────────────┐  │
              (DNS)      │   │  ALB  │───►│   ECS Fargate        │  │
                         │   │ (443) │    │  ┌───────────────┐   │  │
                         │   │  WSS  │    │  │ Task 1        │   │  │
                         │   └───────┘    │  │ (modular-     │   │  │
                         │               │  │  backend)      │   │  │
                         │               │  └───────────────┘   │  │
                         │               │  ┌───────────────┐   │  │
                         │               │  │ Task 2        │   │  │
                         │               │  │ (replica)     │   │  │
                         │               │  └───────────────┘   │  │
                         │               └──────────┬──────────┘   │
                         │                          │               │
                         │              ┌───────────┼───────────┐  │
                         │              │           │           │   │
                         │         ┌────▼───┐  ┌───▼──────┐        │
                         │         │ Redis  │  │ MongoDB  │        │
                         │         │ Elasti │  │ Atlas /  │        │
                         │         │ Cache  │  │ DocDB    │        │
                         │         └────────┘  └──────────┘        │
                         └──────────────────────────────────────────┘
```

## 1) Prerequisites

- AWS CLI configured (`aws configure`)
- Docker installed locally
- Domain name + ACM TLS certificate
- MongoDB Atlas cluster (or DocumentDB)

---

## 2) Create ECR Repository & Push Image

```bash
# Set variables
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/arc-backend

# Create repo
aws ecr create-repository --repository-name arc-backend --region $AWS_REGION

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ECR_REPO

# Build & push
docker build -t arc-backend .
docker tag arc-backend:latest $ECR_REPO:latest
docker tag arc-backend:latest $ECR_REPO:v1.0.0
docker push $ECR_REPO:latest
docker push $ECR_REPO:v1.0.0
```

---

## 3) Provision Data Services

### Redis (ElastiCache)
```bash
# Create a Redis cluster (r6g.large for 50K+ users)
aws elasticache create-replication-group \
  --replication-group-id arc-redis \
  --replication-group-description "ARC Backend Redis" \
  --engine redis \
  --cache-node-type cache.r6g.large \
  --num-cache-clusters 2 \
  --automatic-failover-enabled \
  --cache-subnet-group-name <your-private-subnet-group> \
  --security-group-ids <redis-sg-id>
```

### MongoDB Atlas
- Create M10+ cluster in the same AWS region
- Whitelist the ECS VPC CIDR or use VPC peering
- Store connection string in AWS Secrets Manager:
```bash
aws secretsmanager create-secret \
  --name arc/mongodb-uri \
  --secret-string "mongodb+srv://user:pass@cluster.mongodb.net/arc-db"
```

---

## 4) Create ECS Cluster & Task Definition

### Create Cluster
```bash
aws ecs create-cluster --cluster-name arc-backend-cluster
```

### Create Task Definition

Save as `task-definition.json`:
```json
{
  "family": "arc-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT>:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::<ACCOUNT>:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "arc-backend",
      "image": "<ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/arc-backend:latest",
      "portMappings": [
        { "containerPort": 5001, "protocol": "tcp" }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "5001" },
        { "name": "CORS_ORIGIN", "value": "https://your-frontend.com" }
      ],
      "secrets": [
        {
          "name": "MONGODB_URI",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:arc/mongodb-uri"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:arc/redis-url"
        },
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:arc/jwt-secret"
        },
        {
          "name": "ADMIN_JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:arc/admin-jwt-secret"
        },
        {
          "name": "BANK_DETAILS_ENCRYPTION_KEY",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:arc/bank-details-encryption-key"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -qO- http://localhost:5001/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/arc-backend",
          "awslogs-region": "<REGION>",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "stopTimeout": 30
    }
  ]
}
```

`BANK_DETAILS_ENCRYPTION_KEY` must be a stable printable-ASCII secret of at least
32 characters. If bank rows were previously encrypted through the legacy
`ENCRYPTION_KEY` fallback, provision the dedicated key with that same material
for the first deployment. Changing it requires a controlled decrypt/re-encrypt
rotation; replacing it directly makes existing payout details unreadable.

`ADMIN_JWT_SECRET` must be a separate random secret and must never equal
`JWT_SECRET`. Admin tokens are restricted to the `squadhunt-admin` issuer and
`squadhunt-admin-panel` audience. Rotating this secret intentionally signs out
all current Admin Panel sessions.

Configure the creator-monetization runtime values in the ECS task environment
or the `arc/prod/backend` Secrets Manager JSON consumed by the application:

| Variable | Meaning | Default / constraint |
|---|---|---|
| `PLATFORM_DEFAULT_CPM` | INR per 1,000 eligible unique organic clip views | `50`, positive |
| `MAX_PAYOUT_PER_CREATOR` | INR cap per creator per payout cycle | `10000`, positive |
| `MONETIZATION_CLOSE_LEASE_MS` | Exclusive monthly-close lease duration | `1800000`, 60,000–86,400,000 ms |

`deploy.sh` manages two compatibility markers in the new task revision:
`BANK_DETAILS_SCHEMA_VERSION=3` and
`MONETIZATION_ADMIN_SCHEMA_VERSION=1`. Do not advance either marker manually.
The script deploys the marked revision only after its audit, migration, and
verification gates succeed.

The deployment preflight connects to the primary, performs a rollback-only
transaction probe, audits decryption and financial bank bindings without
writes to financial records, applies additive migrations, redacts any legacy
plaintext identifiers from immutable bank-history snapshots, and then verifies
indexes/hashes/locks. Its monetization audit additionally checks integer minor
units, immutable payout history, source snapshots, cross-collection
disbursement reservations, creator referential integrity, and the analytics
indexes (including privacy-bounded daily profile visits). Use an Amazon
DocumentDB 4.0+ cluster with transactions enabled. The release is intentionally
blocked if it finds orphan bank or creator financial rows, incomplete
reservations, or an active legacy payout whose historical source/destination
cannot be proven. Reconcile the reported IDs with Finance rather than deleting
records or guessing their ownership.

The first deployment carrying the financial schema pair
`BANK_DETAILS_SCHEMA_VERSION=3` and
`MONETIZATION_ADMIN_SCHEMA_VERSION=1` must prevent old ECS tasks from creating
legacy payout, withdrawal, snapshot, reservation, or bank records while the
migration is running. `deploy.sh` compares both markers on the active service,
performs an early readiness audit, and then requires an explicit maintenance
window:

```bash
ALLOW_FINANCIAL_MAINTENANCE_WINDOW=1 \
CONFIRM_FINANCIAL_SCHEDULES_PAUSED=1 \
bash deploy.sh
```

During that first cutover the service desired count is temporarily set to zero,
Application Auto Scaling is suspended, and the script verifies that no running
or pending task from the legacy task family remains. Before setting
`CONFIRM_FINANCIAL_SCHEDULES_PAUSED=1`, manually disable any EventBridge
scheduled tasks or standalone worker services capable of creating payouts,
withdrawals, earnings snapshots, disbursement reservations, or bank updates.
The migration and verification then run, and only the task revision carrying
both verified schema markers is restored.
If a failure occurs after migration writes may have started, the script leaves
the service at zero rather than restarting incompatible legacy tasks. Resolve
the reported migration/deployment failure and complete the financial schema-pair
deployment before restoring traffic. Later deployments inherit both markers,
run verification-only financial preflight, and do not rewrite live financial
rows or require this maintenance cutover.

If verification later detects repairable financial drift while both schema
markers are already active, do not run row migrations alongside live writers.
Schedule the same maintenance window and rerun with
`FORCE_FINANCIAL_MIGRATION=1` plus both maintenance confirmations; this reuses
the quiesced migration path.

### Recover a failed first cutover

Do **not** manually scale the service back up after a mutating preflight failure:
the service may still reference the legacy task definition even though financial
records have already been migrated. Leave all financial EventBridge schedules
and standalone tasks paused, determine the service's normal positive desired
count, and run the guarded recovery mode:

```bash
RECOVER_FINANCIAL_CUTOVER=1 \
RECOVERY_DESIRED_COUNT=2 \
ALLOW_FINANCIAL_MAINTENANCE_WINDOW=1 \
CONFIRM_FINANCIAL_SCHEDULES_PAUSED=1 \
RECOVERY_RESUME_AUTOSCALING=1 \
bash deploy.sh
```

Recovery mode is accepted only when the ECS service is already at desired count
zero. It immediately suspends Application Auto Scaling, verifies that no running
or pending task in the backend task family can write financial data, reruns the
idempotent migration and verification, and registers a fresh task definition.
The service is scaled to `RECOVERY_DESIRED_COUNT` only after that task definition
is verified to contain both expected schema markers and the newly built image.
Running tasks are then checked against both the exact task-definition ARN and
ECR image digest. Any recovery failure leaves desired count at zero and never
restores the legacy task definition.

Set `RECOVERY_RESUME_AUTOSCALING=1` only when the prior failed cutover is what
left scaling suspended. Without it, the script preserves the currently captured
suspension state and scaling can be re-enabled separately after verification.

### Inspect or run the monetization migration manually

The standard release path is `bash deploy.sh`; it runs the audit before
quiescing, applies the migration only in the guarded maintenance window, and
then verifies the result. For diagnosis, the same phases can be invoked from an
ECS one-off task with the production Secrets Manager environment:

```bash
# Read-only integrity/index audit. Exit code 2 means reconciliation is required.
npm run audit:monetization-admin

# Mutating, idempotent backfill plus index creation. Run only with every
# financial writer quiesced as described above.
npm run migrate:monetization-admin

# Read-only post-migration gate; all reported failures must be empty.
npm run verify:monetization-admin
```

Do not run `migrate:monetization-admin` from a developer workstation against
production or while ECS/EventBridge financial writers are active. Preserve the
JSON audit output with the release evidence, including the `blockers`,
`changes`, and final `failures` arrays.

Register it:
```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

---

## 5) Application Load Balancer (ALB)

```bash
# Create ALB
aws elbv2 create-load-balancer \
  --name arc-backend-alb \
  --subnets <public-subnet-1> <public-subnet-2> \
  --security-groups <alb-sg-id> \
  --scheme internet-facing

# Create target group (IP type for Fargate)
aws elbv2 create-target-group \
  --name arc-backend-tg \
  --protocol HTTP \
  --port 5001 \
  --vpc-id <vpc-id> \
  --target-type ip \
  --health-check-path /api/health \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3

# Create HTTPS listener (requires ACM cert)
aws elbv2 create-listener \
  --load-balancer-arn <alb-arn> \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=<acm-cert-arn> \
  --default-actions Type=forward,TargetGroupArn=<tg-arn>

# CRITICAL: Increase idle timeout for WebSocket connections
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn <alb-arn> \
  --attributes Key=idle_timeout.timeout_seconds,Value=300
```

### Enable Sticky Sessions (required for Socket.IO with multiple tasks)
```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn <tg-arn> \
  --attributes \
    Key=stickiness.enabled,Value=true \
    Key=stickiness.type,Value=app_cookie \
    Key=stickiness.app_cookie.cookie_name,Value=io \
    Key=stickiness.app_cookie.duration_seconds,Value=86400
```

---

## 6) Create ECS Service

```bash
aws ecs create-service \
  --cluster arc-backend-cluster \
  --service-name arc-backend \
  --task-definition arc-backend \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={
    subnets=[<private-subnet-1>,<private-subnet-2>],
    securityGroups=[<ecs-sg-id>],
    assignPublicIp=DISABLED
  }" \
  --load-balancers "targetGroupArn=<tg-arn>,containerName=arc-backend,containerPort=5001" \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=100" \
  --health-check-grace-period-seconds 120
```

---

## 7) Security Groups

| Resource | Inbound | From |
|---|---|---|
| ALB | TCP 443 | 0.0.0.0/0 (internet) |
| ECS Tasks | TCP 5001 | ALB security group |
| Redis | TCP 6379 | ECS security group |
| MongoDB | TCP 27017 | ECS security group / Atlas whitelist |

---

## 8) Auto Scaling

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/arc-backend-cluster/arc-backend \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Scale on CPU (target 60%)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/arc-backend-cluster/arc-backend \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-target-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 60.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'

# Scale on memory (target 70%)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/arc-backend-cluster/arc-backend \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name memory-target-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageMemoryUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

---

## 9) Observability

```bash
# Create CloudWatch log group
aws logs create-log-group --log-group-name /ecs/arc-backend

# Create alarms
aws cloudwatch put-metric-alarm \
  --alarm-name arc-backend-5xx \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions <sns-topic-arn>
```

---

## 10) Deploy Updates (CI/CD)

```bash
# Build new version
docker build -t arc-backend .
docker tag arc-backend:latest $ECR_REPO:v1.1.0
docker tag arc-backend:latest $ECR_REPO:latest
docker push $ECR_REPO:v1.1.0
docker push $ECR_REPO:latest

# Force new deployment (rolling update, zero downtime)
aws ecs update-service \
  --cluster arc-backend-cluster \
  --service arc-backend \
  --force-new-deployment
```

---

## 11) Frontend Integration

Update frontend environment:

```env
VITE_API_URL=https://api.yourdomain.com
VITE_SOCKET_URL=https://api.yourdomain.com
```

Point `api.yourdomain.com` → ALB DNS name in Route 53 (CNAME or Alias record).

---

## Estimated AWS Costs (us-east-1)

| Service | Config | Monthly Cost |
|---|---|---|
| ECS Fargate (2 tasks) | 1 vCPU / 2 GB | ~$60 |
| ElastiCache Redis | cache.r6g.large × 2 | ~$180 |
| ALB | Standard | ~$20 |
| CloudWatch Logs | 10 GB | ~$5 |
| MongoDB Atlas | M10 | ~$57 |
| **Total** | | **~$322/month** |

> Scale up: Each additional Fargate task adds ~$30/month. Auto-scaling handles
> traffic spikes automatically.
