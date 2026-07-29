# CI and Release Gates

`Required CI and Release` is the only pull-request and `main` orchestrator. Its
stable branch-protection context is **Required Checks**.

The context aggregates five independent jobs:

- JavaScript syntax, unit, HTTP-route, and source-regression tests.
- PostgreSQL 16 fresh-schema integration and supported legacy-schema upgrade.
- The production Dockerfile build.
- Chromium browser journeys plus critical axe accessibility checks.
- A signing-disabled iOS simulator build with executable Swift unit tests.

Every job uploads failure diagnostics for 14 days. On `main`, the EC2 deploy and
TestFlight reusable workflows run only after `Required Checks` succeeds. They no
longer expose direct `push` or `workflow_dispatch` triggers, so a release cannot
bypass the orchestrator. A manual run of `Required CI and Release` on `main`
still reruns all gates before either release job.

## Enable main protection after the workflow lands

GitHub cannot require a check context until that context has appeared at least
once. The repository currently has no branch protection or ruleset, so use this
one-time sequence:

1. Land the workflow while `main` is still unprotected.
2. Wait for the `Required Checks` job on that exact SHA to finish successfully.
3. Review the dry run:

   ```bash
   scripts/configure-required-checks.sh jimgreco/macro_tracker main
   ```

4. Apply branch protection:

   ```bash
   scripts/configure-required-checks.sh --apply jimgreco/macro_tracker main
   ```

5. Verify both the latest check and protection configuration:

   ```bash
   scripts/verify-required-checks.sh jimgreco/macro_tracker main
   ```

The setup enables strict/up-to-date required checks, linear history, admin
enforcement, conversation resolution, and force-push/deletion protection. It
does not impose an approval-count policy. Review the JSON in
`scripts/configure-required-checks.sh` before applying if repository governance
needs a required-review policy too.

Do not rename the `Required Checks` job without updating protection and these
scripts. Individual implementation job names may change without changing the
stable required context.

## Oura coverage boundary

Main currently exposes the bounded Today recovery status (`unavailable` or
`disconnected`) but not JIM-52's direct Oura client models and endpoints. The
Swift and browser gates exercise the current Today API/status contract without
copying off-main JIM-52 code. When JIM-52 lands, extend
`OuraAPIContractTests.swift` and the browser status journey to cover its
connection, decoding, refresh, and error cases; keep those product changes in
JIM-52.
