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
TASK_DEF_FILE="./arc-task-def.json"
TARGET_BANK_SCHEMA_VERSION="3"
TARGET_MONETIZATION_SCHEMA_VERSION="1"
QUIESCED=0
MUTATING_PREFLIGHT_STARTED=0
AUTOSCALING_SUSPENDED=0
RECOVERY_MODE=0
SCALABLE_RESOURCE_ID="service/$CLUSTER/$SERVICE"
ORIGINAL_SCALING_STATE='{"DynamicScalingInSuspended":false,"DynamicScalingOutSuspended":false,"ScheduledScalingSuspended":false}'

ORIGINAL_TASK_DEF=$(aws ecs describe-services \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text)
ORIGINAL_DESIRED_COUNT=$(aws ecs describe-services \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].desiredCount' --output text)
NETWORK_CONFIGURATION=$(aws ecs describe-services \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].networkConfiguration' --output json)
if [[ -z "$ORIGINAL_TASK_DEF" || "$ORIGINAL_TASK_DEF" == "None" || ! "$ORIGINAL_DESIRED_COUNT" =~ ^[0-9]+$ ]]; then
  echo "Could not read the active ECS service configuration" >&2
  exit 1
fi
RESTORE_DESIRED_COUNT="$ORIGINAL_DESIRED_COUNT"
if [[ "$ORIGINAL_DESIRED_COUNT" == "0" ]]; then
  if [[ "${RECOVER_FINANCIAL_CUTOVER:-0}" != "1" ]]; then
    echo "The ECS service is already at desired count zero." >&2
    echo "If this is a failed financial cutover, rerun with RECOVER_FINANCIAL_CUTOVER=1 and RECOVERY_DESIRED_COUNT=<positive count>." >&2
    exit 1
  fi
  if [[ ! "${RECOVERY_DESIRED_COUNT:-}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Recovery requires a positive RECOVERY_DESIRED_COUNT; the previous desired count cannot be inferred safely." >&2
    exit 1
  fi
  RECOVERY_MODE=1
  RESTORE_DESIRED_COUNT="$RECOVERY_DESIRED_COUNT"
fi
ORIGINAL_SCHEMA_VERSION=$(aws ecs describe-task-definition \
  --task-definition "$ORIGINAL_TASK_DEF" \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='BANK_DETAILS_SCHEMA_VERSION'].value | [0]" \
  --output text)
ORIGINAL_MONETIZATION_SCHEMA_VERSION=$(aws ecs describe-task-definition \
  --task-definition "$ORIGINAL_TASK_DEF" \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='MONETIZATION_ADMIN_SCHEMA_VERSION'].value | [0]" \
  --output text)
REQUIRES_FINANCIAL_QUIESCE=0
if [[ "$ORIGINAL_SCHEMA_VERSION" != "$TARGET_BANK_SCHEMA_VERSION" || "$ORIGINAL_MONETIZATION_SCHEMA_VERSION" != "$TARGET_MONETIZATION_SCHEMA_VERSION" || "$RECOVERY_MODE" == "1" || "${FORCE_FINANCIAL_MIGRATION:-0}" == "1" ]]; then
  REQUIRES_FINANCIAL_QUIESCE=1
  if [[ "${ALLOW_FINANCIAL_MAINTENANCE_WINDOW:-0}" != "1" ]]; then
    echo "This bank-details schema-$TARGET_BANK_SCHEMA_VERSION rollout must quiesce legacy financial writers." >&2
    echo "Schedule a maintenance window, then rerun with ALLOW_FINANCIAL_MAINTENANCE_WINDOW=1." >&2
    exit 1
  fi
  if [[ "${CONFIRM_FINANCIAL_SCHEDULES_PAUSED:-0}" != "1" ]]; then
    echo "Disable all EventBridge/scheduled/standalone financial writer tasks first." >&2
    echo "Then rerun with CONFIRM_FINANCIAL_SCHEDULES_PAUSED=1." >&2
    exit 1
  fi
fi

SCALING_TARGET_COUNT=$(aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --resource-ids "$SCALABLE_RESOURCE_ID" \
  --scalable-dimension ecs:service:DesiredCount \
  --query 'length(ScalableTargets)' --output text)
if [[ "$SCALING_TARGET_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  ORIGINAL_SCALING_STATE=$(aws application-autoscaling describe-scalable-targets \
    --service-namespace ecs \
    --resource-ids "$SCALABLE_RESOURCE_ID" \
    --scalable-dimension ecs:service:DesiredCount \
    --query 'ScalableTargets[0].SuspendedState' --output json)
  if [[ -z "$ORIGINAL_SCALING_STATE" || "$ORIGINAL_SCALING_STATE" == "null" || "$ORIGINAL_SCALING_STATE" == "{}" ]]; then
    ORIGINAL_SCALING_STATE='{"DynamicScalingInSuspended":false,"DynamicScalingOutSuspended":false,"ScheduledScalingSuspended":false}'
  fi
  if [[ "$RECOVERY_MODE" == "1" && "${RECOVERY_RESUME_AUTOSCALING:-0}" == "1" ]]; then
    # A failed first cutover intentionally leaves scaling suspended. Operators
    # may explicitly restore the normal active state, but only after the new schema
    # revision and digest have passed the gates below.
    ORIGINAL_SCALING_STATE='{"DynamicScalingInSuspended":false,"DynamicScalingOutSuspended":false,"ScheduledScalingSuspended":false}'
  fi
fi

restore_autoscaling() {
  if [[ "$AUTOSCALING_SUSPENDED" != "1" ]]; then return; fi
  if ! aws application-autoscaling register-scalable-target \
    --service-namespace ecs \
    --resource-id "$SCALABLE_RESOURCE_ID" \
    --scalable-dimension ecs:service:DesiredCount \
    --suspended-state "$ORIGINAL_SCALING_STATE" \
    --output text >/dev/null; then
    echo "Failed to restore the original Application Auto Scaling suspension state." >&2
    return 1
  fi
  AUTOSCALING_SUSPENDED=0
}

suspend_autoscaling() {
  if [[ ! "$SCALING_TARGET_COUNT" =~ ^[1-9][0-9]*$ ]]; then return; fi
  aws application-autoscaling register-scalable-target \
    --service-namespace ecs \
    --resource-id "$SCALABLE_RESOURCE_ID" \
    --scalable-dimension ecs:service:DesiredCount \
    --suspended-state DynamicScalingInSuspended=true,DynamicScalingOutSuspended=true,ScheduledScalingSuspended=true \
    --output text >/dev/null
  AUTOSCALING_SUSPENDED=1
}

assert_task_family_quiesced() {
  local running_tasks
  local pending_tasks
  running_tasks=$(aws ecs list-tasks \
    --cluster "$CLUSTER" \
    --family "$TASK_FAMILY" \
    --desired-status RUNNING \
    --query 'taskArns' --output text)
  pending_tasks=$(aws ecs list-tasks \
    --cluster "$CLUSTER" \
    --family "$TASK_FAMILY" \
    --desired-status PENDING \
    --query 'taskArns' --output text)
  if [[ ( -n "$running_tasks" && "$running_tasks" != "None" ) || ( -n "$pending_tasks" && "$pending_tasks" != "None" ) ]]; then
    echo "Standalone, scheduled, or service tasks are still using the financial task family; migration aborted." >&2
    return 1
  fi
}

on_exit() {
  local status=$?
  rm -f "$TASK_DEF_FILE"
  if [[ "$status" -ne 0 && "$QUIESCED" == "1" ]]; then
    if [[ "$RECOVERY_MODE" == "1" ]]; then
      echo "==> Recovery failed; the service will remain at zero and legacy tasks will not be restarted." >&2
      aws ecs update-service \
        --cluster "$CLUSTER" \
        --service "$SERVICE" \
        --desired-count 0 \
        --output text >/dev/null || true
    elif [[ "$MUTATING_PREFLIGHT_STARTED" == "0" ]]; then
      echo "==> Failure occurred before migration writes; restoring the original ECS service..." >&2
      aws ecs update-service \
        --cluster "$CLUSTER" \
        --service "$SERVICE" \
        --task-definition "$ORIGINAL_TASK_DEF" \
        --desired-count "$ORIGINAL_DESIRED_COUNT" \
        --output text >/dev/null || true
      restore_autoscaling || true
    else
      echo "==> Financial migration may have changed data; legacy tasks will NOT be restarted automatically." >&2
      echo "==> Keep maintenance mode active and complete/recover the schema-$TARGET_BANK_SCHEMA_VERSION deployment before restoring traffic." >&2
      aws ecs update-service \
        --cluster "$CLUSTER" \
        --service "$SERVICE" \
        --desired-count 0 \
        --output text >/dev/null || true
    fi
  fi
  trap - EXIT
  exit "$status"
}
trap on_exit EXIT

# A recovery starts from a service already left at zero by a previous failed
# mutating cutover. Suspend scaling and prove that no task in the financial
# family is running before spending time building or launching preflight tasks.
# The old task definition is never restored in this mode.
if [[ "$RECOVERY_MODE" == "1" ]]; then
  echo "==> Entering financial cutover recovery with ECS traffic kept at zero..."
  suspend_autoscaling
  QUIESCED=1
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --desired-count 0 \
    --output text >/dev/null
  aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
  assert_task_family_quiesced
fi

# Git short SHA as image tag (fallback: timestamp)
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
IMAGE="$REPO:$TAG"

echo "==> Tag: $TAG"

# 1. Fail before publishing an image if channel policy or notification
# producers regress. The artifact check runs after compilation and compares
# canonical source with the generated worker tree used by the image.
echo "==> Running notification and email policy release gates..."
npm run test:notification-policy
npm run test:notification-producers
npm run test:bank-details
npm run test:monetization
npm run typecheck
npm run build
npm run verify:email-policy-release

# 2. ECR login
echo "==> ECR login..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# 3. Build
echo "==> Building image..."
docker build --platform linux/amd64 -t "$IMAGE" .

# 4. Push
echo "==> Pushing to ECR..."
docker push "$IMAGE"

# 5. Fetch latest task definition, swap image, strip read-only fields
echo "==> Registering new task definition..."
aws ecs describe-task-definition --task-definition "$ORIGINAL_TASK_DEF" \
  --query 'taskDefinition' --output json | \
  node -e "
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      const td = JSON.parse(chunks.join(''));
      td.containerDefinitions[0].image = process.argv[1];
      const env = td.containerDefinitions[0].environment ||= [];
      const marker = env.find(item => item.name === 'BANK_DETAILS_SCHEMA_VERSION');
      if (marker) marker.value = process.argv[2];
      else env.push({ name: 'BANK_DETAILS_SCHEMA_VERSION', value: process.argv[2] });
      const monetizationMarker = env.find(item => item.name === 'MONETIZATION_ADMIN_SCHEMA_VERSION');
      if (monetizationMarker) monetizationMarker.value = process.argv[3];
      else env.push({ name: 'MONETIZATION_ADMIN_SCHEMA_VERSION', value: process.argv[3] });
      ['taskDefinitionArn','revision','status','requiresAttributes',
       'compatibilities','registeredAt','registeredBy'].forEach(k => delete td[k]);
      process.stdout.write(JSON.stringify(td));
    });
  " "$IMAGE" "$TARGET_BANK_SCHEMA_VERSION" "$TARGET_MONETIZATION_SCHEMA_VERSION" > "$TASK_DEF_FILE"

NEW_REV=$(aws ecs register-task-definition \
  --cli-input-json "file://$TASK_DEF_FILE" \
  --query 'taskDefinition.revision' --output text)
echo "==> Task definition: $TASK_FAMILY:$NEW_REV"
NEW_TASK_DEF="$TASK_FAMILY:$NEW_REV"
NEW_SCHEMA_VERSION=$(aws ecs describe-task-definition \
  --task-definition "$NEW_TASK_DEF" \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='BANK_DETAILS_SCHEMA_VERSION'].value | [0]" \
  --output text)
NEW_MONETIZATION_SCHEMA_VERSION=$(aws ecs describe-task-definition \
  --task-definition "$NEW_TASK_DEF" \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='MONETIZATION_ADMIN_SCHEMA_VERSION'].value | [0]" \
  --output text)
NEW_TASK_IMAGE=$(aws ecs describe-task-definition \
  --task-definition "$NEW_TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].image' \
  --output text)
if [[ "$NEW_SCHEMA_VERSION" != "$TARGET_BANK_SCHEMA_VERSION" || "$NEW_MONETIZATION_SCHEMA_VERSION" != "$TARGET_MONETIZATION_SCHEMA_VERSION" || "$NEW_TASK_IMAGE" != "$IMAGE" ]]; then
  echo "Registered task definition failed the bank-schema/image verification gate." >&2
  exit 1
fi

# 6. Run provider credential verification, email-policy artifact verification,
# and a primary-only financial audit (plus additive index preparation) before
# entering maintenance. A schema-version rollout then stops all older writers
# before any record migration can mutate data.
CONTAINER_NAME=$(aws ecs describe-task-definition \
  --task-definition "$TASK_FAMILY:$NEW_REV" \
  --query 'taskDefinition.containerDefinitions[0].name' --output text)
run_preflight() {
  local mode="$1"
  local overrides
  if [[ "$mode" == "audit" ]]; then
    overrides=$(node -e "process.stdout.write(JSON.stringify({containerOverrides:[{name:process.argv[1],command:['node','scripts/preflight-push-release.js','--audit-only']}]}))" "$CONTAINER_NAME")
  elif [[ "$mode" == "verify" ]]; then
    overrides=$(node -e "process.stdout.write(JSON.stringify({containerOverrides:[{name:process.argv[1],command:['node','scripts/preflight-push-release.js','--verify-only']}]}))" "$CONTAINER_NAME")
  else
    overrides=$(node -e "process.stdout.write(JSON.stringify({containerOverrides:[{name:process.argv[1],command:['node','scripts/preflight-push-release.js']}]}))" "$CONTAINER_NAME")
  fi
  local task
  task=$(aws ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$TASK_FAMILY:$NEW_REV" \
    --launch-type FARGATE \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --overrides "$overrides" \
    --query 'tasks[0].taskArn' --output text)
  if [[ -z "$task" || "$task" == "None" ]]; then
    echo "$mode preflight task could not be started" >&2
    return 1
  fi
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task"
  local task_exit
  task_exit=$(aws ecs describe-tasks \
    --cluster "$CLUSTER" --tasks "$task" \
    --query 'tasks[0].containers[0].exitCode' --output text)
  if [[ "$task_exit" != "0" ]]; then
    local reason
    reason=$(aws ecs describe-tasks \
      --cluster "$CLUSTER" --tasks "$task" \
      --query 'tasks[0].containers[0].reason' --output text)
    echo "$mode preflight failed (exit=$task_exit): $reason" >&2
    return 1
  fi
}

echo "==> Running non-destructive provider and database readiness audit..."
run_preflight audit

if [[ "$REQUIRES_FINANCIAL_QUIESCE" == "1" ]]; then
  echo "==> Quiescing ECS financial writers for the schema-$TARGET_BANK_SCHEMA_VERSION migration..."
  suspend_autoscaling
  QUIESCED=1
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --desired-count 0 \
    --output text >/dev/null
  aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
  assert_task_family_quiesced
fi

if [[ "$REQUIRES_FINANCIAL_QUIESCE" == "1" ]]; then
  echo "==> Running mutating database preflight and post-migration verification..."
  MUTATING_PREFLIGHT_STARTED=1
  run_preflight apply
else
  echo "==> Schema $TARGET_BANK_SCHEMA_VERSION is already active; verifying without rewriting live bank rows..."
  run_preflight verify
fi

# 7. Deploy
echo "==> Updating ECS service..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$NEW_TASK_DEF" \
  --desired-count "$RESTORE_DESIRED_COUNT" \
  --force-new-deployment \
  --output table \
  --query 'service.{taskDef:taskDefinition,running:runningCount,pending:pendingCount}'

# 8. Wait
echo "==> Waiting for stable deployment (~2 min)..."
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"

# 9. A healthy rolling deployment is not sufficient for an email-policy
# release: every queue consumer must be on the new revision and image digest.
echo "==> Verifying running ECS tasks use the new policy revision..."
RUNNING_TASKS=$(aws ecs list-tasks \
  --cluster "$CLUSTER" \
  --service-name "$SERVICE" \
  --desired-status RUNNING \
  --query 'taskArns' --output text)
if [[ -z "$RUNNING_TASKS" || "$RUNNING_TASKS" == "None" ]]; then
  echo "No running ECS service tasks were found after deployment" >&2
  exit 1
fi
EXPECTED_TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition "$NEW_TASK_DEF" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
EXPECTED_DIGEST=$(aws ecr describe-images \
  --repository-name arc-backend \
  --image-ids imageTag="$TAG" \
  --query 'imageDetails[0].imageDigest' --output text)
RUNNING_TASK_DEFS=$(aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks $RUNNING_TASKS \
  --query 'tasks[].taskDefinitionArn' --output text)
RUNNING_DIGESTS=$(aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks $RUNNING_TASKS \
  --query 'tasks[].containers[0].imageDigest' --output text)
for task_def in $RUNNING_TASK_DEFS; do
  if [[ "$task_def" != "$EXPECTED_TASK_DEF" ]]; then
    echo "Old ECS task revision is still consuming queues: $task_def" >&2
    exit 1
  fi
done
for digest in $RUNNING_DIGESTS; do
  if [[ "$digest" != "$EXPECTED_DIGEST" ]]; then
    echo "Unexpected ECS image digest is still running: $digest" >&2
    exit 1
  fi
done
echo "==> Verified task revision $TASK_FAMILY:$NEW_REV and digest $EXPECTED_DIGEST"

QUIESCED=0
MUTATING_PREFLIGHT_STARTED=0
restore_autoscaling

echo ""
rm -f "$TASK_DEF_FILE"
echo "Done! Image=$IMAGE  TaskDef=$TASK_FAMILY:$NEW_REV"
echo "Health: https://api.squadhunt.in/health"
