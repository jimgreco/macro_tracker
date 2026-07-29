#!/usr/bin/env bash
set -euo pipefail

mode="dry-run"
if [ "${1:-}" = "--apply" ]; then
  mode="apply"
  shift
fi

repository="${1:-jimgreco/macro_tracker}"
branch="${2:-main}"
required_context="Required Checks"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required to inspect or configure GitHub branch protection." >&2
  exit 1
fi

head_sha="$(gh api "repos/${repository}/commits/${branch}" --jq .sha)"
check_state="$(
  gh api "repos/${repository}/commits/${head_sha}/check-runs?per_page=100" \
    --jq '
      [.check_runs[] | select(.name == "Required Checks")]
      | sort_by([(.started_at // .created_at // ""), (.id // 0)])
      | last
      | [.status, .conclusion]
      | @tsv
    '
)"
if [ "$check_state" != $'completed\tsuccess' ]; then
  echo "Required Checks has not completed successfully on ${branch} (${head_sha})." >&2
  echo "Land the workflow and wait for its first successful main run before applying protection." >&2
  exit 1
fi

payload="$(mktemp)"
trap 'rm -f "$payload"' EXIT
cat > "$payload" <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["${required_context}"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON

if [ "$mode" != "apply" ]; then
  echo "Dry run only. This would protect ${repository}:${branch} with context '${required_context}'."
  echo "Re-run with --apply after reviewing docs/ci-release-gates.md:"
  echo "  scripts/configure-required-checks.sh --apply ${repository} ${branch}"
  exit 0
fi

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${repository}/branches/${branch}/protection" \
  --input "$payload" \
  >/dev/null

echo "Configured ${repository}:${branch} to require '${required_context}'."
scripts/verify-required-checks.sh "$repository" "$branch"
