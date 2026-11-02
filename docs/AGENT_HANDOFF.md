# Macrovana — coding handoff

Snapshot: **2026-11-02 UTC**. This is a takeover map, not release authorization. Recheck Git status, the requested scope and current runtime before acting. Existing AGENTS.md and linked contract/runbooks remain applicable. Older dated status notes are evidence from their stated date, not current permissions.

## Purpose and architecture

Macrovana tracks nutrition, meals, body measurements and selected health data on web and iPhone.

Express/Node API and PostgreSQL; a vanilla JavaScript browser client and SwiftUI DailyMacros client share account-owned records. Provider processing, replay receipts and background webhook handling are server-owned.

## Locations and current work

- Usual local workspace: `/Users/jgreco/code/macros`.
- Source inspected for this handoff: `/Users/jgreco/Documents/Codex/2026-10-25/task/integration-2026-10-30/macros`.
- Existing repository: [jimgreco/macro_tracker](https://github.com/jimgreco/macro_tracker); default branch `main`, verified source head `c35f304ac3219b9fc6c0b5a7b600f060c63982e0`.
- Documentation branch: `docs/agent-handoff-2026-11-02`, based on that head; application code was not changed.
- Primary checkout is at `983d27aacd04ad8fe8423dd75a78aa34137bc0d7` on `main` and differs from remote main. Do not reset it or assume it contains released features; use the inspected source or a new isolated checkout.

## Code and guide map

- [src/server.js](../src/server.js)
- [src/db.js](../src/db.js)
- [public/script.js](../public/script.js)
- [public/index.html](../public/index.html)
- [ios/DailyMacros](../ios/DailyMacros)
- [test](../test)
- [scripts](../scripts)

Read the relevant existing guide before changing its contract:

- [docs/CODEX_FEATURE_REFERENCE.md](CODEX_FEATURE_REFERENCE.md)
- [docs/ci-release-gates.md](ci-release-gates.md)
- [docs/ec2-release-runbook.md](ec2-release-runbook.md)
- [docs/database-runtime-access.md](database-runtime-access.md)
- [docs/client-mutation-recovery.md](client-mutation-recovery.md)
- [docs/fiber-tracking.md](fiber-tracking.md)

## Local setup and dependencies

Commands below are source-verified entry points, **not commands executed during this documentation pass**. Use disposable local data. Read the command comments and linked setup guide before running migrations, creating fixtures or starting listeners. Reuse prepared environments where suitable.

- `npm ci`
- `npm run db:up`
- `cp .env.example .env  # use a disposable local database and local-only auth`
- `npm run db:migrate  # requires separately supplied local MIGRATION_DATABASE_URL`
- `npm run db:migrate:fiber  # additive fiber schema, owner connection only`
- `npm run check`
- `npm run dev`

Configuration names/locations only; never copy secret values into source, terminal output or handoff documents:

- `DATABASE_URL`
- `MIGRATION_DATABASE_URL`
- `SESSION_SECRET`
- `APP_BASE_URL`
- `LOCAL_AUTH_BYPASS`
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID`
- `OURA_TOKEN_ENCRYPTION_KEY`
- `STRIPE_SECRET_KEY`

Use existing lockfiles/manifests; do not upgrade dependencies to perform a handoff. For native work, select an actually installed Xcode SDK/simulator from the checked-in project configuration.

## Tests and verification

- `npm run test:check`
- `npm run test:db:integration  # TEST_DATABASE_URL: isolated loopback *_test database`
- `npm run test:db:upgrade  # separate empty TEST_UPGRADE_DATABASE_URL`
- `npm run test:e2e`
- `Native changes: follow ios project targets and the current CI simulator gate; inspect affected screens.`

Documentation-only changes require path/link, accuracy, diff and secret-exclusion review; do not run heavyweight builds or production smoke mutations for prose changes. Application tests were not rerun in this pass. Past test/release evidence below retains its original date. UI changes still require actual rendered inspection, and synthetic tests do not prove real provider/device acceptance.

## Decisions and constraints

- Unknown fiber stays null, not zero; full-coverage totals and historical targets matter. Manual nutrition, Quick Add search and historical meal copying are already implemented.
- Preserve account-scoped offline queues, tombstones, exact retry identity and transaction boundaries. Oura API data and derivatives must never enter AI inputs.
- Runtime startup validates schema; it must not own DDL. Current CI Required Checks aggregate gates JavaScript/HTTP, fresh/upgrade PostgreSQL, browser/accessibility, Docker and native tests.

## Release state and workflow effects

- Web/API: deployed and verified **2026-11-02**, source `6aedf580c88392c3cd427f7fd9bd2fe28a9166c9`. Exact revision/readiness and scoped activation were recorded; this documentation pass did not redeploy.
- Web run: [recorded workflow](https://github.com/jimgreco/macro_tracker/actions/runs/41443834185); result `success`.
- Native: version **1.3.0**, build **312**, source `6aedf580c88392c3cd427f7fd9bd2fe28a9166c9`. **Available in TestFlight**, processing/audience verified November 2 for exactly **1 existing internal tester**; external/public distribution excluded. [Verification evidence](https://github.com/jimgreco/macro_tracker/actions/runs/41467360030). No public App Store release was performed.
- The newer main commit is a release-verification-only change; app source/build SHA differs intentionally.
- Main push runs Required Checks. Web deploy/native upload require explicit manual orchestrator inputs, default false. After an upload, verify-testflight.yml repeats GET-only status/audience checks without another upload.

Recent exact-source GitHub results observed November 2 (workflow purpose matters):

- [Verify existing TestFlight build run 41467360030](https://github.com/jimgreco/macro_tracker/actions/runs/41467360030): `completed` / `success`.
- [Required CI and Release run 41467238979](https://github.com/jimgreco/macro_tracker/actions/runs/41467238979): `completed` / `success`.

The handoff is published on a documentation feature branch, not main. Current checked-in GitHub push triggers are main-only (or absent). Blog hosting branch settings were separately checked. No native release, image publication or server deployment is intended from this documentation push.

## Known gaps and next safe work

- October 23 completion-guard extra dd093e4 remains paused; do not integrate it based on old manifests.
- The November 2 web release skipped an authenticated production smoke because no smoke API token was configured; public/version/DB and CI checks passed. Physical-device acceptance is separate.

Before the next task, verify source HEAD, dirty/staged work and the selected subsystem; read only the relevant guide. Check whether a listed idea is already implemented in another branch before rebuilding it. Preserve unrelated work and paused experiments. Release/permission/data changes require the applicable current authorization.
