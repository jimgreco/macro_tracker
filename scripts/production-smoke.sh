#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${PRODUCTION_BASE_URL:-}}"
API_TOKEN="${API_TOKEN:-${PRODUCTION_SMOKE_API_TOKEN:-}}"
SMOKE_RUN_ID="${SMOKE_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
SMOKE_CURL_RETRIES="${SMOKE_CURL_RETRIES:-12}"
SMOKE_CURL_RETRY_DELAY_SECONDS="${SMOKE_CURL_RETRY_DELAY_SECONDS:-5}"

if [ -z "$BASE_URL" ]; then
  echo "Set BASE_URL or PRODUCTION_BASE_URL."
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "Checking public health endpoints..."
curl --fail --show-error --silent --retry "$SMOKE_CURL_RETRIES" --retry-delay "$SMOKE_CURL_RETRY_DELAY_SECONDS" --retry-connrefused "$BASE_URL/healthz" >/dev/null
curl --fail --show-error --silent --retry "$SMOKE_CURL_RETRIES" --retry-delay "$SMOKE_CURL_RETRY_DELAY_SECONDS" --retry-connrefused "$BASE_URL/version" >/dev/null

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

json_value() {
  python3 -c '
import json
import sys

data = json.load(sys.stdin)
value = data
for part in sys.argv[1].split("."):
    if isinstance(value, list):
        value = value[int(part)]
    elif isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
    if value is None:
        sys.exit(1)
print(value)
' "$1"
}

dashboard_entry_id() {
  python3 -c '
import json
import sys

data = json.load(sys.stdin)
target = sys.argv[1]
for entry in data.get("entries", []):
    if entry.get("itemName") == target:
        print(entry.get("id", ""))
        sys.exit(0)
sys.exit(1)
' "$1"
}

created_entry_ids=()
created_weight_ids=()
created_sleep_ids=()
created_health_ids=()
created_saved_item_ids=()

cleanup_created_records() {
  for id in "${created_entry_ids[@]}"; do
    auth_curl -X DELETE "$BASE_URL/api/entries/$id" >/dev/null 2>&1 || true
  done
  for id in "${created_weight_ids[@]}"; do
    auth_curl -X DELETE "$BASE_URL/api/weights/$id" >/dev/null 2>&1 || true
  done
  for id in "${created_sleep_ids[@]}"; do
    auth_curl -X DELETE "$BASE_URL/api/sleep/$id" >/dev/null 2>&1 || true
  done
  for id in "${created_health_ids[@]}"; do
    auth_curl -X DELETE "$BASE_URL/api/sexual-activity/$id" >/dev/null 2>&1 || true
  done
  for id in "${created_saved_item_ids[@]}"; do
    auth_curl -X DELETE "$BASE_URL/api/saved-items/$id" >/dev/null 2>&1 || true
  done
}

trap cleanup_created_records EXIT

echo "Checking authenticated API endpoints..."
me_json="$(auth_curl "$BASE_URL/api/me")"
auth_curl "$BASE_URL/api/dashboard?limit=5" >/dev/null
auth_curl "$BASE_URL/api/account/export" >/dev/null
auth_curl -X POST "$BASE_URL/api/parse-workout" --data '{"text":"20 minute brisk walk"}' >/dev/null

echo "Checking authenticated write journeys..."
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

meal_name="smoke-meal-$SMOKE_RUN_ID"
auth_curl -X POST "$BASE_URL/api/entries/bulk" \
  --data "{\"items\":[{\"itemName\":\"$meal_name\",\"quantity\":1,\"unit\":\"serving\",\"calories\":123,\"protein\":12,\"carbs\":13,\"fat\":4}],\"consumedAt\":\"$timestamp\"}" >/dev/null
meal_dashboard="$(auth_curl "$BASE_URL/api/dashboard?limit=100")"
meal_entry_id="$(printf '%s' "$meal_dashboard" | dashboard_entry_id "$meal_name")"
created_entry_ids+=("$meal_entry_id")
auth_curl -X PUT "$BASE_URL/api/entries/$meal_entry_id" \
  --data "{\"itemName\":\"$meal_name\",\"quantity\":1.25,\"unit\":\"serving\",\"calories\":130,\"protein\":13,\"carbs\":14,\"fat\":4,\"consumedAt\":\"$timestamp\"}" >/dev/null
auth_curl -X DELETE "$BASE_URL/api/entries/$meal_entry_id" >/dev/null

quick_name="smoke-quick-$SMOKE_RUN_ID"
saved_json="$(auth_curl -X POST "$BASE_URL/api/saved-items" \
  --data "{\"name\":\"$quick_name\",\"quantity\":1,\"unit\":\"serving\",\"calories\":90,\"protein\":8,\"carbs\":9,\"fat\":3}")"
saved_item_id="$(printf '%s' "$saved_json" | json_value id)"
created_saved_item_ids+=("$saved_item_id")
auth_curl -X POST "$BASE_URL/api/quick-add" \
  --data "{\"savedItemId\":$saved_item_id,\"multiplier\":1,\"consumedAt\":\"$timestamp\"}" >/dev/null
quick_dashboard="$(auth_curl "$BASE_URL/api/dashboard?limit=100")"
quick_entry_id="$(printf '%s' "$quick_dashboard" | dashboard_entry_id "$quick_name")"
created_entry_ids+=("$quick_entry_id")
auth_curl -X DELETE "$BASE_URL/api/entries/$quick_entry_id" >/dev/null
auth_curl -X DELETE "$BASE_URL/api/saved-items/$saved_item_id" >/dev/null

weight_json="$(auth_curl -X POST "$BASE_URL/api/weights" \
  --data "{\"weight\":199.4,\"loggedAt\":\"$timestamp\"}")"
weight_id="$(printf '%s' "$weight_json" | json_value id)"
created_weight_ids+=("$weight_id")
auth_curl -X PUT "$BASE_URL/api/weights/$weight_id" \
  --data "{\"weight\":199.2,\"loggedAt\":\"$timestamp\"}" >/dev/null
auth_curl -X DELETE "$BASE_URL/api/weights/$weight_id" >/dev/null

sleep_json="$(auth_curl -X POST "$BASE_URL/api/sleep" \
  --data "{\"durationHours\":7.5,\"wakeUps\":1,\"loggedAt\":\"$timestamp\"}")"
sleep_id="$(printf '%s' "$sleep_json" | json_value id)"
created_sleep_ids+=("$sleep_id")
auth_curl -X PUT "$BASE_URL/api/sleep/$sleep_id" \
  --data "{\"durationHours\":7.25,\"wakeUps\":1,\"loggedAt\":\"$timestamp\"}" >/dev/null
auth_curl -X DELETE "$BASE_URL/api/sleep/$sleep_id" >/dev/null

if printf '%s' "$me_json" | python3 -c 'import json,sys; data=json.load(sys.stdin); sys.exit(0 if data.get("user", {}).get("features", {}).get("sexualActivity") is True else 1)'; then
  health_json="$(auth_curl -X POST "$BASE_URL/api/sexual-activity" \
    --data "{\"type\":\"masturbation\",\"loggedAt\":\"$timestamp\"}")"
  health_id="$(printf '%s' "$health_json" | json_value id)"
  created_health_ids+=("$health_id")
  auth_curl -X PUT "$BASE_URL/api/sexual-activity/$health_id" \
    --data "{\"type\":\"other\",\"loggedAt\":\"$timestamp\"}" >/dev/null
  auth_curl -X DELETE "$BASE_URL/api/sexual-activity/$health_id" >/dev/null
else
  echo "Skipping sexual-activity write journey because the smoke account feature flag is off."
fi

echo "Production smoke checks passed."
