#!/usr/bin/env bash
set -euo pipefail

repository="${1:-jimgreco/macro_tracker}"
branch="${2:-main}"
required_context="Required Checks"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required to verify GitHub branch protection." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required to verify the branch-protection response." >&2
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
  echo "Latest ${branch} commit does not have a successful '${required_context}' check." >&2
  exit 1
fi

protection="$(
  gh api \
    -H "Accept: application/vnd.github+json" \
    "repos/${repository}/branches/${branch}/protection"
)"
PROTECTION_JSON="$protection" REQUIRED_CONTEXT="$required_context" node - <<'NODE'
const protection = JSON.parse(process.env.PROTECTION_JSON);
const requiredContext = process.env.REQUIRED_CONTEXT;
const statusChecks = protection.required_status_checks || {};
const contexts = new Set([
  ...(statusChecks.contexts || []),
  ...(statusChecks.checks || []).map((check) => check.context)
]);
const requirements = [
  [statusChecks.strict === true, 'strict/up-to-date status checks are not enabled'],
  [contexts.has(requiredContext), `required context '${requiredContext}' is missing`],
  [protection.enforce_admins?.enabled === true, 'admin enforcement is not enabled'],
  [protection.required_linear_history?.enabled === true, 'linear history is not required'],
  [protection.allow_force_pushes?.enabled !== true, 'force pushes are allowed'],
  [protection.allow_deletions?.enabled !== true, 'branch deletion is allowed'],
  [
    protection.required_conversation_resolution?.enabled === true,
    'conversation resolution is not required'
  ],
  [
    protection.required_pull_request_reviews == null,
    'a pull-request review policy was added unexpectedly'
  ],
  [protection.restrictions == null, 'push restrictions were added unexpectedly'],
  [protection.lock_branch?.enabled !== true, 'the branch is locked unexpectedly'],
  [
    protection.allow_fork_syncing?.enabled !== true,
    'fork syncing is enabled even though the branch is not locked'
  ]
];
const failures = requirements.filter(([satisfied]) => !satisfied);
if (failures.length) {
  for (const [, message] of failures) console.error(`Branch protection mismatch: ${message}.`);
  process.exit(1);
}
NODE

echo "${repository}:${branch} requires a successful, up-to-date '${required_context}' check."
echo "Latest verified SHA: ${head_sha}"
