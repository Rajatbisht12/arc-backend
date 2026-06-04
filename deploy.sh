#!/usr/bin/env bash
# Usage: bash deploy.sh
# Builds, pushes to ECR, registers a new task definition, and deploys to ECS.

set -euo pipefail

ACCOUNT_ID="906446637180"
REGION="us-east-1"
REPO="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/arc-backend"
CLUSTER="arc-cluster"
SERVICE="arc-backend"
TASK_FAMILY="arc-backend"

# Git short SHA as image tag (fallback: timestamp)
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
IMAGE="$REPO:$TAG"

echo "==> Tag: $TAG"

# 1. ECR login
echo "==> ECR login..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# 2. Build
echo "==> Building image..."
docker build --platform linux/amd64 -t "$IMAGE" .

# 3. Push
echo "==> Pushing to ECR..."
docker push "$IMAGE"

# 4. Fetch latest task definition, swap image, strip read-only fields
echo "==> Registering new task definition..."
aws ecs describe-task-definition --task-definition "$TASK_FAMILY" \
  --query 'taskDefinition' --output json | \
  node -e "
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      const td = JSON.parse(chunks.join(''));
      td.containerDefinitions[0].image = process.argv[1];
      ['taskDefinitionArn','revision','status','requiresAttributes',
       'compatibilities','registeredAt','registeredBy'].forEach(k => delete td[k]);
      process.stdout.write(JSON.stringify(td));
    });
  " "$IMAGE" > ./arc-task-def.json

NEW_REV=$(aws ecs register-task-definition \
  --cli-input-json file://./arc-task-def.json \
  --query 'taskDefinition.revision' --output text)
echo "==> Task definition: $TASK_FAMILY:$NEW_REV"

# 5. Deploy
echo "==> Updating ECS service..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$TASK_FAMILY:$NEW_REV" \
  --force-new-deployment \
  --output table \
  --query 'service.{taskDef:taskDefinition,running:runningCount,pending:pendingCount}'

# 6. Wait
echo "==> Waiting for stable deployment (~2 min)..."
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"

echo ""
rm -f ./arc-task-def.json
echo "Done! Image=$IMAGE  TaskDef=$TASK_FAMILY:$NEW_REV"
echo "Health: https://api.squadhunt.in/health"
