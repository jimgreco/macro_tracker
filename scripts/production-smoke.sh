#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${PRODUCTION_BASE_URL:-}}"
API_TOKEN="${API_TOKEN:-${PRODUCTION_SMOKE_API_TOKEN:-}}"

if [ -z "$BASE_URL" ]; then
  echo "Set BASE_URL or PRODUCTION_BASE_URL."
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "Checking public health endpoints..."
curl --fail --show-error --silent "$BASE_URL/healthz" >/dev/null
curl --fail --show-error --silent "$BASE_URL/version" >/dev/null

if [ -z "$API_TOKEN" ]; then
  echo "Skipping authenticated smoke checks because API_TOKEN is not set."
  exit 0
fi

auth_curl() {
  curl --fail --show-error --silent \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    "$@"
}

echo "Checking authenticated API endpoints..."
auth_curl "$BASE_URL/api/me" >/dev/null
auth_curl "$BASE_URL/api/dashboard?limit=5" >/dev/null
auth_curl "$BASE_URL/api/account/export" >/dev/null
auth_curl -X POST "$BASE_URL/api/parse-workout" --data '{"text":"20 minute brisk walk"}' >/dev/null

echo "Production smoke checks passed."
