# Macro Tracker — Codex Guide

## Efficient Start

- Use supplied context once. Before code edits, inspect `git status --short --branch`,
  `git diff --stat`, and `git diff --cached --stat`, then relevant hunks. Preserve
  unrelated work and stage only the requested scope when committing.
- Start with the paths below and narrow `rg` searches. Batch independent reads;
  reuse installed dependencies and build caches unless a change invalidates them.
- Make routine reversible decisions and complete the authorized outcome. Avoid
  speculative cleanup, repeated permission questions, and unrelated work.
- Run meaningful checks for the changed surface once after edits settle, including
  the repository's required gates. Repeat only when new evidence invalidates them.
  Documentation-only edits need diff, link/path, and whitespace review.
- For requested releases, follow the current workflow and verify the final pushed
  SHA and applicable live results. Keep build, deployment, TestFlight upload, and
  physical-device evidence distinct. Report the outcome and actual verification.

## Task Routing

- Use Key Files and Testing below for entry points and existing commands.
- Detailed feature and native guidance is in
  [docs/CODEX_FEATURE_REFERENCE.md](docs/CODEX_FEATURE_REFERENCE.md). Before code
  changes, search that file for the affected feature and read the matching notes;
  do not load the entire reference for an unrelated task.
- Server/web work starts in `src/`, `public/`, and `test/`; native work starts in
  `ios/DailyMacros/`. `npm run test:check` is the existing no-database check.
- Use the database integration/upgrade checks below for persistence changes and
  the current CI/release runbooks for shipping. Preserve all required release gates.
- Keep account isolation, durable deletion tombstones, replay-safe mutations,
  and independent fail-closed integration Read/Write choices intact.
- Repeated meal entry deletes succeed for account-owned tombstones and preserve
  the original deletion timestamp; missing or other-account entries still return
  404. iOS must block overlapping entry and meal deletion actions.
- Bulk meal entries and requested Quick Adds must validate before writing and
  commit in the same transaction. Combining entries must lock and validate the
  live rows inside its transaction so overlapping requests cannot regroup them.
- Remembered nutrition corrections require matching normalized units; a generic
  serving is not interchangeable with grams or an item count.
- Oura API data and derived values must stay out of every AI/ML input, including
  OpenAI, Apple Foundation Models, narration, and ChatGPT-targeted exports.
- Progress check-in forms stage photos until Save. Preserve the returned check-in
  ID and unfinished selections on upload failure so retries cannot create another
  check-in; see the progress check-in notes in the feature reference.
- Waist readings belong in that same check-in form. Save notes and the linked waist
  reading atomically; preserve the native replayable queue and older clients that
  omit the waist payload. Clear/delete measurements with tombstones.


## Project Overview

Full-stack macro/nutrition tracking web app with iOS companion. Node.js + Express backend, vanilla JS frontend (SPA), PostgreSQL database, SwiftUI iOS app. Uses OpenAI for natural language meal/workout parsing and Open Food Facts for barcode nutrition lookup. Supports Google OAuth and Apple Sign-In for authentication. Stripe for paid subscriptions.

## Tech Stack

- **Backend**: Node.js 18+, Express.js, Passport.js (Google OAuth), Apple Sign-In (`apple-signin-auth`)
- **Frontend**: Vanilla JS, HTML5, CSS3 (no frameworks)
- **iOS App**: SwiftUI (iOS 17+), AuthenticationServices (Sign in with Apple), AVFoundation barcode scanning, Keychain token storage, HealthKit sync, local reminders, pending-log retry
- **Database**: PostgreSQL 16 (Docker locally and in the current EC2/Docker Compose production stack; RDS notes are legacy)
- **AI**: OpenAI API (`gpt-6-sol` by default) for meal/workout parsing
- **Billing**: Stripe (checkout sessions, customer portal, webhooks)
- **Deployment**: GitHub Actions to EC2/Docker Compose, with legacy Elastic Beanstalk notes retained only for historical recovery context

## Local Development

```bash
npm run db:up       # Start PostgreSQL via Docker
cp .env.example .env  # Configure env vars
npm run db:migrate  # Initialize an empty DB with MIGRATION_DATABASE_URL
npm run check       # Read-only schema compatibility check
npm run db:seed:local  # Optional: seed preview data
npm run dev         # Start with file watcher
```

Set `LOCAL_AUTH_BYPASS=true` in `.env` to skip Google/Apple OAuth setup locally.
Debug iOS builds auto-request `/auth/dev/mobile` when pointed at localhost; that endpoint is available in non-production without enabling the web `LOCAL_AUTH_BYPASS`.

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Start server |
| `npm run dev` | Start with file watcher |
| `npm test` | Run all tests |
| `npm run test:check` | Syntax check + tests (no DB needed) |
| `npm run db:up` / `db:down` | Start/stop PostgreSQL |
| `npm run db:seed:local` | Seed local preview data |
| `npm run test:db:integration` | Run PostgreSQL-backed fresh-schema integration tests |
| `npm run test:db:upgrade` | Run the supported legacy-schema upgrade test |
| `npm run test:e2e` | Run Chromium product journeys and accessibility checks |

If Docker is unavailable locally but Homebrew Postgres binaries exist, a throwaway smoke DB can be created with `initdb`, started on a high port with `pg_ctl -o "-p 55433 -k /tmp"`, and used via `DATABASE_URL=postgres://postgres@127.0.0.1:55433/postgres`. Stop it with `pg_ctl -D <dir> stop` after the smoke.

## Key Files

| File | Purpose |
|------|---------|
| `src/server.js` | Express server, all routes, auth, Stripe webhooks |
| `src/db.js` | All PostgreSQL queries |
| `src/parser.js` | OpenAI meal/workout parsing (~230 lines) |
| `public/script.js` | Frontend SPA logic (~4,800 lines) |
| `public/index.html` | Main app HTML |
| `public/login.html` | Login page (Google + Apple buttons) |
| `public/login.js` | Login page behavior |
| `docker-compose.yml` | Local PostgreSQL container |
| `.env.example` | All env vars with descriptions |
| `ios/DailyMacros/` | SwiftUI iOS app (Xcode project) |

## Required Environment Variables

```
SESSION_SECRET=          # Long random string (required in production)
DATABASE_URL=            # postgres://... connection string
OPENAI_API_KEY=          # For meal/workout parsing
OPEN_FOOD_FACTS_USER_AGENT= # Optional custom user agent for barcode lookups
GOOGLE_CLIENT_ID=        # Google OAuth
GOOGLE_CLIENT_SECRET=    # Google OAuth
APP_BASE_URL=            # Canonical URL (e.g. https://yourdomain.com)
```

### Optional Environment Variables

```
APPLE_CLIENT_ID=         # Apple Service ID for web Sign in with Apple
APPLE_TEAM_ID=           # Apple Developer Team ID
APPLE_KEY_ID=            # Key ID from Apple Developer Console
APPLE_PRIVATE_KEY=       # .p8 private key contents (use \n for newlines)
APPLE_REDIRECT_URI=      # Apple callback URL
APPLE_BUNDLE_ID=         # iOS app bundle ID (for mobile token verification)
ADMIN_EMAILS=            # Comma-separated admin email allowlist for /admin and admin-only UI details
ADMIN_USER_IDS=          # Comma-separated admin user ID allowlist
STRIPE_SECRET_KEY=       # Stripe secret key
STRIPE_WEBHOOK_SECRET=   # Stripe webhook signing secret
```

See `.env.example` for full list.

## Testing

Uses Node's built-in `node:test` module.

- `test/api-infrastructure.test.js` — API infra: soft deletes, pagination, auth, billing, GDPR, release workflow smoke checks
- `test/http-routes.test.js` — Real Express route coverage with stubbed DB/parser dependencies for timezone prefs, provenance/corrections, templates, weekly recap, and diagnostics
- `test/db-integration.test.js` — Opt-in PostgreSQL integration test for feature-foundation persistence; runs only when `TEST_DATABASE_URL` is set
- `test/webhook-inbox-db.test.js` — Opt-in PostgreSQL concurrency, lease recovery, retention, and Stripe atomicity coverage; runs only when `TEST_DATABASE_URL` is set
- `test/db-upgrade-path.test.js` — Disposable legacy-schema upgrade coverage; runs only when `TEST_UPGRADE_DATABASE_URL` is set
- `test/e2e/` — Playwright Chromium journeys and focused axe accessibility checks
- `test/ios-safari-regression.test.js` — Mobile nav regression
- `test/ui-regression.test.js` — UI component tests
- `test/workout-parse.test.js` — Workout parsing logic

Run `npm run test:check` for fast syntax + test pass (no database required).
Run `TEST_DATABASE_URL=postgres://... npm run test:db:integration` before pushing DB/schema-heavy work, and use a separate empty disposable database with `TEST_UPGRADE_DATABASE_URL=postgres://... npm run test:db:upgrade` for migration changes.
The client-mutation recovery suite terminates synthetic database connections and requires a loopback database whose name ends in `_test`; CI uses `macro_tracker_fresh_test`. Preserve that guard when updating CI database names.
Fixtures asserted through rolling analysis windows must use dates relative to the test run; fixed historical dates eventually age out. Keep explicit fixed dates for DST/travel cases that query those dates directly.

## Feature Reference

Detailed Architecture Notes and the iOS file/behavior guide live in
[docs/CODEX_FEATURE_REFERENCE.md](docs/CODEX_FEATURE_REFERENCE.md). Read the
applicable feature notes before editing that behavior; the original guidance is
preserved there.

## Production (AWS)

- Active platform: EC2 host running Docker Compose from `~/deploy`.
- Production database: shared Docker Postgres container in the remote Compose stack (`shared_db`).
- Docker build context comes from the synced `~/macros` tree. The required orchestrator runs for every `main` push, including `.dockerignore` changes; keep legacy `.elasticbeanstalk` artifacts excluded because stale EB app-version zip files on the EC2 host can otherwise break Docker builds with `no space left on device`.
- Nightly logical database backup: `dailymacros-db-backup.timer` runs `scripts/production-db-backup.sh` before the AWS DLM daily EBS snapshot window; DLM policy `policy-06a5ef1af3cbbc321` retains 7 daily off-host snapshots.
- Required CI/release orchestrator: `.github/workflows/ci.yml`. It gates JavaScript/HTTP, PostgreSQL fresh and upgrade paths, Docker, browser/accessibility, and iOS simulator tests behind the stable `Required Checks` context.
- Deploy and TestFlight implementations are reusable workflows in `.github/workflows/deploy.yml` and `.github/workflows/testflight.yml`; neither can run directly and both are called only after `Required Checks` succeeds.
- The EC2 Compose override pins `OPENAI_MODEL=gpt-6-sol`; keep it aligned with API defaults when upgrading models so a stale host environment cannot override the release.
- Canonical production auth routing is `APP_BASE_URL=https://macrovana.com`, `GOOGLE_CALLBACK_URL=https://macrovana.com/auth/google/callback`, and `APPLE_REDIRECT_URI=https://macrovana.com/auth/apple/callback`. The EC2 deploy override pins these values, and TestFlight must reject an `IOS_API_BASE_URL` other than `https://macrovana.com`.
- Release runbook: `docs/ec2-release-runbook.md`.
- Health check: `GET /healthz` (performs live DB query).
- Version check: `GET /version`.
- Authenticated smoke script: `scripts/production-smoke.sh`, which uses a smoke API token to exercise disposable meal, quick-add, weight, sleep, and optional sexual-activity write journeys before cleanup.
- Public privacy policy: `/privacy`; source copy in `docs/privacy-policy.md`, App Store privacy notes in `docs/app-store-privacy.md`.
- App Store screenshots: `bundle exec fastlane ios screenshots` drives the `DailyMacrosScreenshots` UI-test target. The app runs with `--app-store-screenshots`, uses debug-only deterministic data from `ScreenshotSeedData.swift`, and writes review assets to `fastlane/screenshots/`. The manual GitHub workflow is `.github/workflows/app-store-screenshots.yml`; leave `upload_to_app_store=false` until screenshots are reviewed.
- Public support: `/support.html` and `info@macrovana.com`; keep web/native support instructions and privacy-policy contact details consistent.
- Register the support page before `requireAuth`, so App Store visitors can open it without an account. The App Store target is iPhone-only; screenshot capture defaults to iPhone and pins a simulator runtime available on the GitHub runner.
- Do not present upgrade prompts or new Stripe checkout in web, iOS, or the API while plan gating is disabled. Preserve historical Stripe webhook processing and portal access for existing subscribers. Apple requires in-app purchase for digital upgrades in many storefronts.
- Screenshot tooling: keep the generic `ruby` platform in `Gemfile.lock` for CI portability. CFPropertyList 3.0.9 requires Ruby < 3.2, so the Ruby 3.3 workflow uses the compatible 3.0.7 pin.
- TestFlight signing: `.github/workflows/testflight.yml` verifies the App Store distribution `.p12` before import. Keep the `openssl pkcs12 -legacy` fallback because GitHub `macos-latest` OpenSSL can reject older Apple certificate bundles encrypted with legacy ciphers such as `RC2-40-CBC`.
- TestFlight uses only this repository's existing configured identity/profile. Preserve GET-only live signing/audience checks, manual archive/export without provisioning updates, internal-only export, source/artifact verification and processed-build/group verification. See [docs/native-testflight-existing-assets.md](docs/native-testflight-existing-assets.md). Missing resources or broader audiences stop the release; never repair Apple configuration or copy another app's credentials to pass a guard.
- Keep every Xcode `MARKETING_VERSION` aligned with `.github/scripts/release-policy.json`. Apple closes an approved marketing-version train: increasing only the Git-count build cannot reopen it. Verify the current version read-only and choose a higher marketing version before retrying a 90186/90062 rejection.
- Legacy Elastic Beanstalk material remains in `docs/aws-production-security-audit.md`; do not use it as the current deploy source of truth unless that platform is intentionally revived.

### Deployment Process

Deployment is automated by `.github/workflows/ci.yml`. Every push to `main` runs the full `Required Checks` aggregate. The reusable EC2 deploy and TestFlight jobs additionally require explicit `workflow_dispatch` inputs, default false; pushes never release automatically. No direct deploy/TestFlight dispatch or manual `eb deploy` step is part of the active path.

When asked to deploy or "push live", always run these steps in order — no skipping:

1. **`git status`** — identify all modified/untracked files
2. **`git add`** all changed files relevant to the work
3. **Update `AGENTS.md`** if anything was learned (new gotchas, architecture decisions, changed patterns) — then `git add AGENTS.md`
4. **`git commit`** with a clear message describing what changed and why
5. **`git push origin main`** — GitHub Actions runs all required gates; dispatch deployment and TestFlight separately only after the release safety gate and applicable approvals

The orchestrator retains diagnostics for failed gates. The reusable deploy job uses `EC2_SSH_KEY`, `EC2_USER`, and `EC2_HOST`, validates the live Compose configuration and builds/recreates only `macros` through `scripts/safe-compose-release.py` (rollback images retained; `--no-deps`; no shared config writes or image prune), and runs post-deploy `/healthz` and `/version` checks when `PRODUCTION_BASE_URL` is configured. Configure and verify strict main protection only after the `Required Checks` context has completed successfully; see `docs/ci-release-gates.md`. GitHub only enables `allow_fork_syncing` for a read-only locked branch, so the current writable protected-main policy must keep both `lock_branch` and `allow_fork_syncing` false.

## Content Security Policy

The server sets a strict CSP header. Key constraints for frontend development:

- `img-src 'self' data: https:` — **blob: URLs are NOT allowed for images**. Always use `data:` URLs (base64) for dynamically generated image previews. Do not use `URL.createObjectURL()` for `<img>` src.
- `script-src 'self'` — no inline scripts or external scripts
- `connect-src 'self'` — no external API calls from frontend

## Frontend Notes

- All state lives in the global `state` object in `public/script.js`
- The shared web visual tokens and component overrides live in the final commercial-app layer of `public/styles.css`. At mobile widths, the existing five-item `.main-nav` becomes the safe-area-aware bottom dock; do not add a second navigation implementation or change the destination data attributes.
- Web Coach Tony P. cards live in `public/index.html` slots (`macros-coach`, `workout-coach`, `weight-coach`, `sleep-coach`) and are rendered from deterministic local rules in `public/coach-rules.js`; `public/script.js` owns DOM rendering, category controls in Account & Privacy, admin-only source labels in cards and the "Why am I seeing this?" modal, and dismissal sync. Web Coach Tony P. shares `/api/coach/dismissals` today/pattern sync with iOS and must not call OpenAI for routine coaching.
- Period toggles (weekly/monthly/annual) controlled by `state.macroSnapshotPeriod`, `state.weightSnapshotPeriod`, `state.workoutSnapshotPeriod`. Switching period triggers a server request with `scope` param (e.g. `/api/daily-totals?scope=month`) to fetch the full date range.
- Charts are drawn on `<canvas>` elements with device pixel ratio scaling. All charts support tooltips on hover/click/touch.
- TDEE/energy balance feature was removed — no longer present in the codebase.
- Meal photo previews: use base64 data URLs from `state.mealImageAttachments` for `<img src>` — not blob URLs (blocked by CSP)
- OpenAI API key is required; no fallback parsing exists

## Workout period coverage

Workout responses include `daysCounted`: calendar days from the earliest non-deleted workout through today, capped at the selected 7/30/365 days. Use it for days-active denominators and weekly pace (days counted / 7), independently of paginated entries.

## Sex activity summaries

The Health subtab is labeled Sex. Keep the stored activity type `other` for compatibility and display it as Manual Stimulation. Graph category totals use the full-scope `dailyTypes[].counts` from `listSexualActivityEntries`, never the paginated recent-entry list. Filter summaries to the same 7/30/365 local-calendar days shown in the graph and use the shared response `daysCounted` for each category: calendar days since the earliest non-deleted activity across all categories, including today and quiet days, capped at 7/30/365 (zero without history).

## Waist evidence tracking

Waist measurements live in `waist_entries` (schema/store/validation in `src/waist.js`). Preserve one or two raw readings, entered unit, landmark method, timestamp and notes; average in centimeters for comparison. Never compare different landmarks as one continuous series. Web and iOS entry points are Health > Weight; iOS uses the protected replayable `.waist` mutation queue. Account export/deletion coverage is registered in `src/data-inventory.js`.

## Oura and HealthKit reconciliation

`src/health-reconciliation.js` serializes source-aware HealthKit ingestion and direct sleep/workout upserts under the same account advisory lock. New native imports include observed `HKSourceRevision` name/bundle and aggregate timing evidence; never hard-code an assumed Oura bundle identifier. Sleep sessionization groups by source before merging intervals. Awake duration is objective; perceived wake-ups, quality and notes are user annotations. Legacy rows acquire source evidence on the next native replay, with a one-time account-scoped 90-day source pass followed by normal 30-day queries.

Direct Oura workout projections use `workout_entries.source = 'oura'` and are read-only; exclude those rows from `getAnalysisSnapshot`, all model narration contexts, and HealthKit exports. Deleting a projection is a durable ignore. The 72-hour fallback grace never permits covered provider days to be reimported. `health_transport_coverage` retains only coverage days and ignore IDs across disconnect; account export/deletion includes it. `GET /oura/recovery` is the shared deterministic web/iOS display contract, and `/oura/evidence` returns only scoped timestamps/counts for operator verification. Recovery documents and derived values remain prohibited from AI inputs.

Compose 2.26.1 may hash `--no-deps` releases without external dependency edges.
The release helper accepts only the exact scoped hash after a lossless full JSON
roundtrip; preserve internal app dependencies and the effective-environment guard.

Docker builds must exclude root/nested `.env*`, private key files, credential
folders, and host `data`/`backups`. The only PEM exception is the reviewed public
`certs/us-east-2-rds-bundle.pem`; CI validates certificate-only content and exact
image bytes. `scripts/check-docker-context.sh macros` injects synthetic sentinels
only into a disposable clean Git archive and verifies real image exclusions.

## Database runtime and migration boundary

- Normal startup only checks the reviewed schema contract; it never creates or repairs tables.
- Run `npm run db:migrate` as a separate process with `MIGRATION_DATABASE_URL` supplied by the owner. It never falls back to runtime `DATABASE_URL`.
- Existing databases require reviewed `--adopt-existing` (with `--` before that flag for npm). Adoption validates structure and adds only compatibility metadata; it does not replay historical data repairs. Fresh initialization requires an empty public schema.
- See `docs/database-runtime-access.md` for the owner/runtime split, rollout ordering and rollback limits. Do not deploy this startup change before schema adoption is approved and completed.
- Runtime must not receive migration credentials or membership in its object-owner role. Schema changes require an updated contract, an explicit migration, reviewed grants and a compatible rollback floor.

## Native offline recovery

`OfflineMutationStore` preserves ownerless legacy bytes and unreadable protected files. Owned queues migrate by exact-byte rename to `pending-mutations-v3.json`, away from older clients' replay path; a post-downgrade v2 file stays quarantined. Journal replayable requests before sending, hold rejected/ambiguous requests for explicit review, and keep retry UUID/body unchanged. Set aside is a retained local archive, not irreversible deletion. Recovery exports and actions are account/session fenced. See `docs/client-mutation-recovery.md`; never infer a legacy owner or recreate an uncertain request under a new UUID.
