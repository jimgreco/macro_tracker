#!/usr/bin/env bash

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-2}"
EB_APPLICATION_NAME="${EB_APPLICATION_NAME:-macro-tracker}"
EB_ENVIRONMENT_NAME="${EB_ENVIRONMENT_NAME:-macro-tracker-prod}"
RDS_INSTANCE_ID="${RDS_INSTANCE_ID:-macro-tracker-1}"
DB_HOST="${DB_HOST:-macro-tracker-1.cxiuc24oixo3.us-east-2.rds.amazonaws.com}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"
APP_BASE_URL="${APP_BASE_URL:-https://macro-tracker.jim-greco.com}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command aws
require_command openssl
require_command node
require_command curl

managed_password="$(
  aws rds describe-db-instances \
    --db-instance-identifier "$RDS_INSTANCE_ID" \
    --region "$AWS_REGION" \
    --query 'DBInstances[0].ManageMasterUserPassword' \
    --output text
)"

if [ "$managed_password" = "True" ]; then
  echo "Refusing to rotate: RDS ManageMasterUserPassword is enabled." >&2
  echo "Either switch the app to read the live secret from Secrets Manager, or disable managed rotation before using this script." >&2
  exit 1
fi

new_password="${NEW_DB_PASSWORD:-}"
if [ -z "$new_password" ]; then
  new_password="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
fi

if [ "${#new_password}" -lt 24 ]; then
  echo "Password must be at least 24 characters." >&2
  exit 1
fi

encoded_password="$(node -p "encodeURIComponent(process.argv[1])" "$new_password")"
database_url="postgres://${DB_USER}:${encoded_password}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "Updating RDS password for ${RDS_INSTANCE_ID} in ${AWS_REGION}..."
aws rds modify-db-instance \
  --db-instance-identifier "$RDS_INSTANCE_ID" \
  --region "$AWS_REGION" \
  --master-user-password "$new_password" \
  --apply-immediately \
  --query 'DBInstance.[DBInstanceIdentifier,DBInstanceStatus]' \
  --output table

echo "Updating Elastic Beanstalk DATABASE_URL for ${EB_ENVIRONMENT_NAME}..."
aws elasticbeanstalk update-environment \
  --environment-name "$EB_ENVIRONMENT_NAME" \
  --region "$AWS_REGION" \
  --option-settings "Namespace=aws:elasticbeanstalk:application:environment,OptionName=DATABASE_URL,Value=${database_url}" \
  --query '[Status,Health,DateUpdated]' \
  --output table

echo "Waiting for Elastic Beanstalk to return to Ready..."
while true; do
  status="$(
    aws elasticbeanstalk describe-environments \
      --application-name "$EB_APPLICATION_NAME" \
      --region "$AWS_REGION" \
      --query "Environments[?EnvironmentName==\`${EB_ENVIRONMENT_NAME}\`].Status | [0]" \
      --output text
  )"
  health="$(
    aws elasticbeanstalk describe-environments \
      --application-name "$EB_APPLICATION_NAME" \
      --region "$AWS_REGION" \
      --query "Environments[?EnvironmentName==\`${EB_ENVIRONMENT_NAME}\`].Health | [0]" \
      --output text
  )"
  echo "  status=${status} health=${health}"
  if [ "$status" = "Ready" ]; then
    break
  fi
  sleep 5
done

echo "Verifying app health..."
curl --fail --silent --show-error "${APP_BASE_URL}/healthz"
echo
echo "Rotation complete."
