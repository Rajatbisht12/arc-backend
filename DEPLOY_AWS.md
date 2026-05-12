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
export AWS_REGION=ap-south-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/arc-modular-backend

# Create repo
aws ecr create-repository --repository-name arc-modular-backend --region $AWS_REGION

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ECR_REPO

# Build & push
docker build -t arc-modular-backend .
docker tag arc-modular-backend:latest $ECR_REPO:latest
docker tag arc-modular-backend:latest $ECR_REPO:v1.0.0
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
  "family": "arc-modular-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT>:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::<ACCOUNT>:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "arc-backend",
      "image": "<ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/arc-modular-backend:latest",
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
          "awslogs-group": "/ecs/arc-modular-backend",
          "awslogs-region": "<REGION>",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "stopTimeout": 30
    }
  ]
}
```

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
  --service-name arc-backend-service \
  --task-definition arc-modular-backend \
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
  --resource-id service/arc-backend-cluster/arc-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Scale on CPU (target 60%)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/arc-backend-cluster/arc-backend-service \
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
  --resource-id service/arc-backend-cluster/arc-backend-service \
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
aws logs create-log-group --log-group-name /ecs/arc-modular-backend

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
docker build -t arc-modular-backend .
docker tag arc-modular-backend:latest $ECR_REPO:v1.1.0
docker tag arc-modular-backend:latest $ECR_REPO:latest
docker push $ECR_REPO:v1.1.0
docker push $ECR_REPO:latest

# Force new deployment (rolling update, zero downtime)
aws ecs update-service \
  --cluster arc-backend-cluster \
  --service arc-backend-service \
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

## Estimated AWS Costs (ap-south-1)

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
