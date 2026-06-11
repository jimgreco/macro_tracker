# Feature Foundations Backlog

Last updated: 2026-06-11

## Scope

Implementation pass for requested items 1-3, 5, 6, 7, 8, and 9 from the product/engineering recommendation list:

- 1. User-specific timezone
- 2. Nutrition data quality loop
- 3. Retention loop / weekly recap
- 5. Real migration discipline
- 6. Crash/error observability
- 7. Better onboarding
- 8. Food and meal templates
- 9. Admin/support tools

## Current Status

- [x] Map current backend schema, API routes, and frontend settings/logging flows.
  - Existing state: request IDs and structured HTTP logging already exist; web already sends `tz` query params from `Intl.DateTimeFormat`; analysis already has weekly auto-generation logic; non-meal logs already include source metadata.
- [x] 1. User-specific timezone.
  - Added backend schema column for `users.timezone`.
  - Threaded timezone through public/admin account rows and bearer-token users.
  - Added validated account preference update endpoint.
  - Added request timezone fallback helper: explicit request `tz`, saved user timezone, then `America/New_York`.
  - Fixed dashboard default day and analysis weight-target lookup to use the selected timezone.
  - Added web Account & Privacy timezone setting as an IANA timezone dropdown.
  - Added iOS Settings timezone picker backed by the same account preference endpoint.
- [x] 2. Nutrition data quality loop.
  - Added meal entry source/review/confidence/correction metadata and `food_corrections`.
  - Bulk saves and parse responses now apply remembered corrections.
  - Entry edits now mark rows as trusted corrections after a successful update.
  - Account export/deletion now includes correction/provenance data.
  - Added source/review labels on parsed/logged meal UI.
  - Remaining future hardening: richer serving-size/unit normalization and more regression coverage.
- [x] 3. Retention loop / weekly recap.
  - Existing analysis page supports generated reports and weekly due checks.
  - Added deterministic `/api/coach/weekly-recap` endpoint from the analysis snapshot/metrics path.
  - Added web Weekly Recap surface on the Analysis tab.
- [x] 5. Migration discipline.
  - Added `schema_migrations` table and feature migration marker while preserving current startup schema repair flow.
  - Future hardening: move historical `ALTER TABLE` repair steps into ordered migration files.
- [x] 6. Crash/error observability.
  - Existing state: request ID header, structured request logs, API error references.
  - Added `client_diagnostics` table and authenticated `/api/diagnostics/client` intake.
  - Added admin diagnostics lookup endpoint.
  - Added browser error, unhandled promise rejection, and failed API request capture.
  - Added admin UI rendering for diagnostics.
  - Remaining future hardening: external crash/error service integration if beta volume grows.
- [x] 7. Better onboarding.
  - Existing state: iOS first-run target setup and tutorial preview.
  - Added starter Quick Adds backend endpoint.
  - Added Starter Quick Adds as an iOS first-run setup option and kept the post-setup action in Settings / Account & Privacy.
  - Removed Starter Quick Adds from the everyday web Quick Add panel.
  - Remaining future hardening: goal-specific onboarding presets.
- [x] 8. Food and meal templates.
  - Existing state: saved items/meals and Quick Add.
  - Added copy-day backend endpoint that preserves meal groups and local times.
  - Added previous-day item/meal detail "Copy to Today" actions on web and iOS, backed by `POST /api/entries/copy-to-today`.
  - Added starter templates backend endpoint.
  - Added web Copy Yesterday control.
  - Replaced the separate web Quick Add search input and dropdown with one searchable picker.
- [x] 9. Admin/support tools.
  - Started admin account payload expansion for timezone and client diagnostic stats.
  - Added admin diagnostics API endpoint.
  - Added admin UI fields for timezone, diagnostics count, last client error, and recent diagnostics modal.

## Verification Log

- 2026-06-11: `node --check src/db.js` passed.
- 2026-06-11: `node --check src/server.js` passed.
- 2026-06-11: `node --check public/script.js` passed.
- 2026-06-11: `node --check public/admin.js` passed.
- 2026-06-11: `npm run test:check` passed, 153 tests.
- 2026-06-11: Added HTTP route coverage in `test/http-routes.test.js` for timezone preferences, dashboard timezone fallback, entry provenance/corrections, copy-day, starter Quick Adds, weekly recap, and client diagnostics.
- 2026-06-11: Added opt-in PostgreSQL integration coverage in `test/db-integration.test.js`; it runs only when `TEST_DATABASE_URL` is set.
- 2026-06-11: After `npm ci`, `npm run test:check` passed with 159 tests and 1 skipped opt-in DB integration test.
- 2026-06-11: Local browser smoke was blocked because Docker is not running, `npm run db:up` could not connect to the Docker daemon, and no Postgres/app server was already listening locally.
- 2026-06-11: Retried smoke with a temporary local Postgres cluster on port 55432 because Docker was still unavailable. `healthz`, `version`, `/`, `/api/me`, timezone preferences, starter Quick Adds, bulk entry save, copy-day, weekly recap, client diagnostics, and CSP header checks passed.
- 2026-06-11: Smoke surfaced and fixed two local hardening issues: local auth bypass now materializes the dev user before account preference writes, and CSP `img-src` no longer allows `blob:`. `npm run test:check` passed afterward with 160 passing tests and 1 skipped opt-in DB integration test.
- 2026-06-11: Pre-push suite ran against a temporary local Postgres cluster on port 55433 with `TEST_DATABASE_URL` set. `npm run test:check` passed with 161 passing tests and 0 skipped tests.
- 2026-06-11: Starter Quick Adds placement update verified with `node --check public/script.js`, `npm run test:check` (162 passing, 1 skipped opt-in DB integration), `git diff --check`, and `xcodebuild -project ios/DailyMacros/DailyMacros.xcodeproj -scheme DailyMacros -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`.
- 2026-06-11: Added previous-day "Copy to Today" actions for meal/item detail sheets across web and iOS. Verified with `npm run test:check` (164 passing, 1 skipped opt-in DB integration), `xcodebuild -project ios/DailyMacros/DailyMacros.xcodeproj -scheme DailyMacros -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`, and a throwaway PostgreSQL `TEST_DATABASE_URL` `npm run test:check` run (165 passing, 0 skipped).
- 2026-06-11: Changed web Account & Privacy timezone editing from free text to an IANA timezone dropdown. Verified with `node --check public/script.js`, `npm run test:check` (164 passing, 1 skipped opt-in DB integration), and `git diff --check`.
- 2026-06-11: Combined web Quick Add search and dropdown into one searchable picker. Verified with `node --check public/script.js`, `npm run test:check` (164 passing, 1 skipped opt-in DB integration), `git diff --check`, and a local browser smoke against a throwaway PostgreSQL database.
- 2026-06-11: Added iOS Settings support for the saved account timezone via a native picker and `/api/account/preferences`. Verified with `node --check test/ui-regression.test.js`, `npm run test:check` (165 passing, 1 skipped opt-in DB integration), `git diff --check`, and `xcodebuild -project ios/DailyMacros/DailyMacros.xcodeproj -scheme DailyMacros -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`.
