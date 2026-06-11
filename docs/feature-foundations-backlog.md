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
  - Added web Account & Privacy timezone setting.
  - Remaining future hardening: iOS settings UI for explicit timezone override; API clients already receive saved timezone and can omit `tz`.
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
  - Added web setup shortcuts in Quick Add and Account & Privacy.
  - Remaining future hardening: goal-specific onboarding presets and iOS parity for starter templates.
- [x] 8. Food and meal templates.
  - Existing state: saved items/meals and Quick Add.
  - Added copy-day backend endpoint that preserves meal groups and local times.
  - Added starter templates backend endpoint.
  - Added web Copy Yesterday control.
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
