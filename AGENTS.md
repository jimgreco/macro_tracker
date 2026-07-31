# Macro Tracker — Codex Guide

## Project Overview

Full-stack macro/nutrition tracking web app with iOS companion. Node.js + Express backend, vanilla JS frontend (SPA), PostgreSQL database, SwiftUI iOS app. Uses OpenAI for natural language meal/workout parsing and Open Food Facts for barcode nutrition lookup. Supports Google OAuth and Apple Sign-In for authentication. Stripe for paid subscriptions.

## Tech Stack

- **Backend**: Node.js 18+, Express.js, Passport.js (Google OAuth), Apple Sign-In (`apple-signin-auth`)
- **Frontend**: Vanilla JS, HTML5, CSS3 (no frameworks)
- **iOS App**: SwiftUI (iOS 17+), AuthenticationServices (Sign in with Apple), AVFoundation barcode scanning, Keychain token storage, HealthKit sync, local reminders, pending-log retry
- **Database**: PostgreSQL 16 (Docker locally and in the current EC2/Docker Compose production stack; RDS notes are legacy)
- **AI**: OpenAI API (`gpt-4.1-mini` by default) for meal/workout parsing
- **Billing**: Stripe (checkout sessions, customer portal, webhooks)
- **Deployment**: GitHub Actions to EC2/Docker Compose, with legacy Elastic Beanstalk notes retained only for historical recovery context

## Local Development

```bash
npm run db:up       # Start PostgreSQL via Docker
cp .env.example .env  # Configure env vars
npm run check       # Initialize DB schema
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
STRIPE_PRO_PRICE_ID=     # Stripe Price ID for the Pro plan
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

## Architecture Notes

- **Authentication**: Google OAuth + Apple Sign-In. Session-based via `express-session` for web. Bearer token auth for iOS/API.
- **Apple Sign-In**: Web flow uses form POST callback (`/auth/apple/callback`). iOS flow uses `/auth/apple/mobile` endpoint that verifies the Apple identity token and returns an API token. Apple user IDs are prefixed with `apple_` to avoid collision with Google IDs.
- **Users table**: Central `users` table with upsert on every OAuth login. Supports `google`, `apple`, and `local-dev` providers.
- **API versioning**: Routes on `express.Router()` mounted at both `/api/v1/` and `/api/` (backward compat).
- **Soft deletes**: All data tables have `deleted_at TIMESTAMPTZ`. DELETE operations do `UPDATE SET deleted_at = NOW()`. All user-facing SELECTs filter `AND deleted_at IS NULL`. Synced workout deletes are durable tombstones: `addWorkoutEntry()` deduplication by `(user_id, source, external_id)` must include soft-deleted rows so Apple Health or Workout Planner sync cannot recreate a workout the user deleted.
- **Bearer tokens**: `api_tokens` stores only SHA-256 token hashes. `bearerTokenAuth` checks before session auth on `/api` routes. New device credentials default to 90 days (`MOBILE_TOKEN_TTL_DAYS`) and iOS rotates them online inside the configured renewal window while retaining the still-valid prior credential so a lost rotation response cannot break offline access.
- **Shared auth state**: Express web sessions use the PostgreSQL-backed `web_sessions` store; Passport serializes only the canonical user id and rehydrates current account controls on each request. `rate_limit_counters` provides atomic, shared per-user/IP limits across processes with expired-row cleanup. Credential inventory exposes public session UUIDs and token metadata only, never session ids, hashes, or credential values. Sign out everywhere atomically revokes web sessions and mobile tokens.
- **Replay-safe mutations**: iOS assigns one stable `X-Client-Mutation-Id` UUID before the first attempt for queued meal, Quick Add, weight, workout, sleep, and sexual-activity creates/updates/deletes. `client_mutations` is keyed by `(user_id, client_mutation_id)`, stores only a request hash plus the completed response, and makes timeouts/concurrent replays return one logical result. Never log pending request bodies or user-entered summaries.
- **Per-user rate limiting**: Rate limiter keys on a SHA-256 bucket derived from `req.user.id` when available and falls back to IP; counters live in PostgreSQL so multiple app processes enforce one window.
- **Audit logging**: `audit_log` table. `logAudit()` wraps in try/catch to never break main operations.
- **GDPR**: `GET /api/v1/account/export` (full data dump), `DELETE /api/v1/account` (hard delete all data).
- **Pagination**: `getDashboard()` and `listWorkoutEntries()` accept `{ limit, offset }`, responses include `pagination` object.
- **Stripe billing**: Webhook signature verification runs against the exact raw bytes before `express.json()`. Verified deliveries persist only a minimal receipt in `webhook_events` before acknowledgment; a database-claimed worker applies current Stripe provider truth idempotently with bounded retries, leases, reconciliation, and graceful shutdown. Checkout writes the app user id into subscription metadata so missed checkout processing can recover the customer mapping. Plan gating infrastructure exists but is currently disabled (no upgrade restrictions).
- **Database**: Schema auto-created on startup. `schema_migrations` records feature/schema markers while legacy startup repair SQL remains in `initDb()`. Tables include `users`, `user_identities`, `entries`, `saved_items`, `food_corrections`, `macro_targets`, `weight_entries`, `workout_entries`, `sexual_activity_entries`, `sleep_entries`, `weight_targets`, `analysis_reports`, `api_tokens`, `web_sessions`, `rate_limit_counters`, `audit_log`, `client_diagnostics`, `client_mutations`, `subscriptions`, `billing_events`, `webhook_events`, `coach_dismissals`, `daily_usage_counts`, `oura_connections`, `oura_oauth_states`, `oura_documents`, and `oura_webhook_subscriptions`.
- **Oura Cloud**: `src/oura.js` owns server-side authorization-code OAuth, AES-256-GCM credential encryption, atomic single-use refresh rotation, 90-day backfill, signed create/update/delete webhook processing, subscription renewal, and hourly reconciliation. Verified notifications persist a minimal receipt in `webhook_events` before acknowledgment and are applied by the shared database-claimed worker. Reconciliation and backfill cannot resurrect tombstones; only a later verified signed provider create/update event may do so. The required `personal` scope is used only to retain Oura's opaque user id for webhook routing; discard the remaining profile response. Persist only allowlisted aggregate fields in `oura_documents`, never raw heart-rate, HRV, movement, phase, or MET sample arrays. Oura document keys and delete tombstones are `(user_id, data_type, provider_document_id)`. Imported records persist while the connection is active and are deleted when the user disconnects Oura or deletes the DailyMacros account. Web/iOS clients use `/api/v1/oura/*`; credentials never leave the server. Oura aggregates may be combined with other app history only for deterministic in-app trends and coaching. Under Oura's current API agreement, API data and derived values must never be supplied to OpenAI, Apple Foundation Models, or any other AI/ML model; keep `getAnalysisSnapshot()` and Coach narration inputs Oura-free.
- **API**: REST endpoints under `/api/v1/`. Rate-limited parse endpoints (15 req/min). See `src/server.js` for full route list.
- **Today and primary navigation**: iOS and web share five primary destinations only: Today, Macros, Workouts, Health, and Insights. Settings / Account & Privacy lives behind the account avatar. Health owns internal Weight, Sleep, and optional Sexual Activity navigation so enabling the feature never creates an iOS More tab. `GET /api/today` returns one bounded, timezone-aware snapshot plus the supporting dashboard/workout/weight/sleep context used by both clients. Today may present source/freshness supplied by the canonical recovery contract, but JIM-51 remains responsible for Oura calculations and connection truth; do not infer an Oura connection state from manual or HealthKit sleep.
- **Durable provider handoff**: `webhook_events` is the provider-neutral receipt/job boundary for Stripe today and direct Oura when JIM-52 is integrated. Reconciliation and backfill may repair missed provider state but must never clear a durable local tombstone; only a later verified signed provider `create` or `update` delivery may explicitly resurrect that record.
- **Frontend**: Single HTML page (`public/index.html`) with all state in `public/script.js`.
- **Modal-based editing**: All editing (entries, meals, quick adds, weight, workouts) uses modal popups (`showEntryModal`, `showCombineModal`, `showWeightEditModal`, `showWorkoutEditModal`). Target editing also uses modals: `showEditTargetsModal` (macro targets), `showWeightTargetModal` (weight target + date), `showWorkoutTargetModal` (workouts/week + calories/week). Each is accessed via "(edit targets)" or "(edit target)" links in the Logged Entries heading of each tab. No inline edit rows remain.
- **Macro targets**: Stored historically in `macro_targets` by `(user_id, macro, effective_date)`. New edits are effective for the current local date going forward until another target row is set; old dates should compare against the targets effective on those dates. Valid macros: `calories`, `protein`, `carbs`, `fat`, `workouts`, `workout_calories`, `sleep_hours`. Defaults via `getMacroTargets()`.
- **Weight targets**: Stored historically in `weight_targets` by `(user_id, effective_date)`. `target_date` remains the goal deadline; `effective_date` is when that target started applying to logged weight history.
- **Timezone**: Users have a persisted `users.timezone`. Request timezone resolution is explicit `tz`, then saved user timezone, then `America/New_York`. All date grouping should use the resolved timezone with `AT TIME ZONE`. Web Account & Privacy timezone editing uses a dropdown of IANA timezones, and iOS Settings uses a native menu picker backed by `/api/account/preferences`; do not use free-text timezone entry.
- **Nutrition quality loop**: Meal entries carry `source`, `source_detail`, `confidence`, `needs_review`, and `correction_key`. User edits mark entries as `manual_correction` and upsert `food_corrections`; AI/photo/barcode rows apply remembered corrections before persistence by scaling the remembered macros to the requested quantity. Manual and Quick Add rows are already user-approved and must not be rewritten by remembered corrections.
- **Nutrition day completeness**: `nutrition_day_completeness` is keyed by `(user_id, local_date)` and stores explicit `complete` or `partial` state plus the timezone used when it was set; no row means `unknown`. Dashboard, daily totals, weekly recap, analysis, web coaching, iOS coaching, and future Oura paired-history analysis must treat only explicitly complete days as eligible nutrition evidence and must report complete/partial/unknown coverage counts. Pattern-based completion is suggestion-only, copied entries never copy completeness, reopening immediately removes the day from eligible comparisons, and later edits never silently change the explicit state.
- **Templates and retention**: Starter Quick Adds are created by `POST /api/starter-quick-adds`; expose this as a first-run setup/tutorial option and later from Settings/Account & Privacy, not as an everyday Quick Add panel shortcut. Day copying is `POST /api/entries/copy-day` and preserves local times/meal groups. Previous-day item/meal detail sheets can copy to today via `POST /api/entries/copy-to-today`; item copies become standalone entries, meal copies preserve the meal as a new group, and both preserve the original local clock time. Weekly recap is deterministic via `GET /api/coach/weekly-recap` and is separate from OpenAI analysis generation.
- **Data inventory and retention**: `src/data-inventory.js` is the authoritative registry for every database table. Every account-scoped table must declare safe export fields and account-deletion coverage there. Retention cleanup runs at server startup and every 24 hours: optional client diagnostics age out after 30 days, daily usage counters after 90 days, and audit events after 365 days; `/healthz` exposes the last cleanup state without record contents.
- **Client diagnostics**: Browser/API client diagnostics post to `POST /api/diagnostics/client`; admins can inspect recent diagnostics with `GET /api/admin/accounts/:userId/diagnostics`. `src/client-diagnostics.js` replaces client-supplied messages/details with fixed categories and an allowlist of generic route/status/request-reference/build/script metadata. Never store raw URLs or queries, bodies, meal/workout/health values, tokens, secrets, stacks, full user agents, or submitted identifiers. `users.optional_diagnostics_enabled` controls future nonessential browser uploads across web/iOS settings; essential server audit/security records are independent.
- **Chart tooltips**: All charts (macros trend, weight, workout calories) support hover/click/touch tooltips via `bindSimpleChartTooltip()`. Tooltip threshold is 40px for hover, 42px for click/touch.
- **Weight chart**: `drawSimpleLineChart` on `#weight-canvas` shows weight trend with average and target lines. Weight page has period toggles (week/month/year).
- **Workout stats**: Workout page shows stats chips (workouts/week, active cal/week) with target values and a data source note. Workout graphs (occurrence + calories) have been removed. Workout calories should mean active calories burned only, not total/resting calories; OpenAI workout parsing should estimate conservatively and assume normal rest periods for low/light or medium/moderate strength training unless circuit/HIIT/minimal-rest wording is explicit. Web and iOS workout screens should label these values as active calories.
- **Tab order**: Macros, Workouts, Weight, Health.
- **Branding**: App name is "DailyMacros" with an abstract macro plate logo icon.
- **Meal grouping**: Entries can be combined into meals via `meal_group` UUID. API endpoints: `POST /api/entries/combine`, `POST /api/meal-group/:id/split`, `POST /api/entries/:id/remove-from-group`, `PUT /api/meal-group/:id/scale`. Parsed repeated multi-item meals keep the repetition on `mealQuantity` and display child components per meal unit; `/api/entries/bulk` accepts `itemsAreMealUnit: true` and scales those unit-level rows back to consumed totals before persistence so dashboard totals remain additive.
- **Health tab**: Contains two sub-sections separated by `health-section-divider` headings: "Sexual Activity" (log activity type, logged entries, weekly snapshot graph) and "Sleep" (log hours + wake-ups, sleep log, weekly snapshot graph with average line). Sleep entries store `duration_hours` (decimal), `wake_ups` (integer), optional `quality` (1-5), and optional `notes` text. Both sections have week/month/year period toggles. Sleep data is included in the Analysis section. Edit modals: `showHealthEditModal` (sexual activity), `showSleepEditModal` (sleep — date/time on row 1, hours + wake-ups on row 2). HealthKit sleep uses a stable start-anchored external id; the server transactionally reconciles later duration/wake-up revisions into the same session while preserving annotations and separate naps. Never include mutable end time or duration in the session identity. Sexual Activity visibility is two-layered: the admin-controlled account feature from `/api/me` must be enabled, then the user can show/hide the page locally from Settings / Account & Privacy.
- **Macro display format**: Logged entries show explicit labels: `28g protein · 12g carbs · 6g fat`. Calories shown as `220 cal`. Quick Add dropdown uses abbreviated format: `260cal/24P/12C/6F` (compact for space).
- **Web Quick Add picker**: The web Quick Add search and dropdown are one combined searchable picker (`#quick-entry-combobox`), not separate controls. Keep Add/Edit wired to the selected picker key.
- **Entry multi-select**: Custom-styled checkboxes (neon accent, `appearance: none`) hidden by default behind "(edit)" link in table header. Toggle adds `.editing` class to `#entries-by-day`. Sub-item checkboxes are indented within meal groups. Mobile-friendly tap targets for both edit link and checkboxes. Selection modes: meals, items, sub-items (no mixing). Action bar appears with context-sensitive buttons (Edit, Delete, Combine, Split, Remove).

## iOS App (`ios/DailyMacros/`)

SwiftUI app targeting iOS 17+. Uses token-based auth (either via Sign in with Apple or manual API token entry).

| File | Purpose |
|------|---------|
| `AppVisualSystem.swift` | Shared semantic colors, spacing, radii, surfaces, status pills, metric tiles, and section headers for the iOS visual system |
| `DailyMacrosApp.swift` | App entry point, auth routing, onboarding routing, pending-log retry, dark mode |
| `AuthManager.swift` | Auth state, Sign in with Apple, token auth |
| `APIClient.swift` | Singleton API client, all REST endpoints, Keychain, offline mutation queue flushing |
| `Models.swift` | Codable response types |
| `LoginView.swift` | Sign in with Apple + token-based login |
| `MainTabView.swift` | Five-destination navigation for Today, Macros, Workouts, Health, and Insights; settings remains behind the account avatar |
| `OnboardingView.swift` | First-run target setup and reminder opt-in |
| `MacrosView.swift` | Meal logging, parsing, barcode lookup, dashboard with macro progress bars |
| `BarcodeScannerView.swift` | AVFoundation barcode scanner used by meal logging |
| `WeightView.swift` | Weight logging, Canvas trend chart, history |
| `WorkoutsView.swift` | Workout logging/parsing, intensity cards |
| `AICoach.swift` | Shared iOS Coach Tony P. suggestion model, deterministic candidate rules, dismissals, settings keys, and coach card UI |
| `SettingsView.swift` | Account, Oura OAuth/status/sync/disconnect, subscription, timezone picker, reminder controls, optional Sexual Activity page toggle when admin-enabled, pending-log sync, data and diagnostics export, delete account |
| `ReminderScheduler.swift` | Local daily log notification scheduling |
| `OfflineMutationStore.swift` | File-protected, account-scoped pending mutation queue |
| `Diagnostics.swift` | Local diagnostic event log and export text |

The iOS app communicates with the backend via Bearer token auth. Sign in with Apple sends the identity token to `/auth/apple/mobile` which verifies it and returns an API token stored in Keychain.
iOS visual work should use the semantic primitives in `AppVisualSystem.swift`, reserve macro colors for nutrition data, keep content on restrained solid/material surfaces, and leave platform glass treatments to navigation and controls.
iOS pending mutations are stored in an excluded-from-backup Application Support file using complete file protection, never in shared `UserDefaults`. Every record owns an account user id and only the currently authenticated matching account can see or flush it. Legacy unowned `pending_mutations_v1` data is discarded rather than assigned. Ordinary sign-out and sign-out-everywhere preserve but hide that account's protected queue; account deletion wipes it before the server delete request.
iOS Settings exposes the saved account timezone as a native menu picker and saves it through `/api/account/preferences`; do not replace it with free-text timezone entry.
iOS Quick Add in `MacrosView.swift` queues items locally until the user saves the draft meal with `saveMealEntries(...)`; queued items appear in a screen-level floating tray pinned with the add sheet geometry safe-area inset, not as a scroll/tab section. Quick Add row buttons should remain add affordances: after a tap, show the green check/Added feedback only briefly, then return to the plus button so adding another of the same item still looks available.
iOS day complete/reopen actions use the replay-safe `/api/day-completeness/:day` mutation and the saved account timezone. The UI must keep entries editable after completion, show partial/unknown days neutrally, and never recreate the old calorie-percentage heuristic in client code.
Onboarding tutorial previews live in `OnboardingView.swift`; keep the first-run tour focused on scrollable sample-data page concepts rather than top-toolbar buttons because empty accounts do not yet have real history to teach from, and toolbar measurement can drift across TestFlight/device chrome states.

The iOS coach is named Coach Tony P. It starts from deterministic local candidate rules in `AICoach.swift`; those rules compute confidence, evidence, priority, dismissal keys, and page actions. Macro missed-meal prompts use learned `CoachDaypart` windows, end-of-day protein steering compares current macro pace against calorie pace, habitual quick-add suggestions pass reconstructed meal payloads through `CoachAction`, workout trend cards compare recent duration/calories/intensity against the prior baseline, Workouts can load recent sleep totals for a recovery guardrail when sleep is under target and recent workout days are high-intensity, repeat-workout suggestions can pass reconstructed workout payloads for direct logging, Weight can load month macro totals for a multi-week macro-consistency card when the weight trend is not moving toward target, weight maintenance cards require repeated in-band weigh-ins before congratulating, weight plateau cards require a multi-week flat trend while the target still needs movement, and sleep streak cards require consecutive target nights. iOS pages should rebuild Coach Tony P. candidates through `CoachCandidateWorker` after data loads instead of calling `CoachCandidateEngine.*` from SwiftUI `body`; local-model narration should stay behind `CoachNarrationWorker` so AFM work does not run on the main actor. When multiple high-confidence cards survive confidence, expiry, and dismissal filtering, `AICoachSlot` may expose up to the top three as a swipeable single-card viewport with dots; do not show extra cards by weakening relevance gates. Keep `AICoachSlot` and its host vertical scroll stacks width-bound and clipped so swiping between suggestions cannot widen the page into horizontal scrolling; the card swipe gesture should take priority over the parent scroll view rather than run as a simultaneous gesture. `CoachNarrator` is an optional Foundation Models layer on iOS 26+ that sees only already-eligible rule candidates and acts as the final local judgment layer: it may hide all candidates as awkward/low-value/tone-deaf, or choose one candidate and rewrite only title/message; it must not replace numeric calculations, confidence gates, evidence, actions, expiry, or dismissal keys. Settings exposes Coach Tony P. modes for On, Rules Only, Local AI Only, and Off only to `ADMIN_EMAILS` / `ADMIN_USER_IDS` admins; non-admins see only a Show cards toggle plus category controls, and non-admin card/source UI should not display Local rules or Local AI labels. Coach dismissals live locally first and also sync through `/api/coach/dismissals` as user-scoped `today` and `pattern` records; keep the offline local path intact when changing sync. Coach cards record local diagnostics for shown/dismissed/acted-on/not-useful/local-AI/fallback/veto/sync events, expose a "Why am I seeing this?" sheet with evidence and confidence details, and keep explicit VoiceOver labels for the suggestion icon, dismiss menu, and evidence text.
Coach Tony P. category controls are local user preferences layered after confidence/dismissal filtering; keep category gates separate from candidate generation. Alcohol cards should use specific local tagging with non-alcohol false-positive exclusions, habitual quick-add cards must exclude alcohol-tagged entries, and saved-item cleanup cards should require duplicate or unused Quick Add evidence. Foundation Models narration must remain globally serialized and independent of view-task cancellation: tab changes may cancel callers, but must never cancel or overlap active `LanguageModelSession` generation because the framework can trap before returning a Swift error. Known-trapping iOS beta builds should be quarantined to the local rule-card fallback until a later OS build is verified. Pull dismissal state once at the authenticated app-navigation level, do not advance dismissal revision for a no-op merge, and run narration only for the visible destination.

## Production (AWS)

- Active platform: EC2 host running Docker Compose from `~/deploy`.
- Production database: shared Docker Postgres container in the remote Compose stack (`shared_db`).
- Docker build context comes from the synced `~/macros` tree. The required orchestrator runs for every `main` push, including `.dockerignore` changes; keep legacy `.elasticbeanstalk` artifacts excluded because stale EB app-version zip files on the EC2 host can otherwise break Docker builds with `no space left on device`.
- Nightly logical database backup: `dailymacros-db-backup.timer` runs `scripts/production-db-backup.sh` before the AWS DLM daily EBS snapshot window; DLM policy `policy-06a5ef1af3cbbc321` retains 7 daily off-host snapshots.
- Required CI/release orchestrator: `.github/workflows/ci.yml`. It gates JavaScript/HTTP, PostgreSQL fresh and upgrade paths, Docker, browser/accessibility, and iOS simulator tests behind the stable `Required Checks` context.
- Deploy and TestFlight implementations are reusable workflows in `.github/workflows/deploy.yml` and `.github/workflows/testflight.yml`; neither can run directly and both are called only after `Required Checks` succeeds.
- Canonical production auth routing is `APP_BASE_URL=https://macrovana.com`, `GOOGLE_CALLBACK_URL=https://macrovana.com/auth/google/callback`, and `APPLE_REDIRECT_URI=https://macrovana.com/auth/apple/callback`. The EC2 deploy override pins these values, and TestFlight must reject an `IOS_API_BASE_URL` other than `https://macrovana.com`.
- Release runbook: `docs/ec2-release-runbook.md`.
- Health check: `GET /healthz` (performs live DB query).
- Version check: `GET /version`.
- Authenticated smoke script: `scripts/production-smoke.sh`, which uses a smoke API token to exercise disposable meal, quick-add, weight, sleep, and optional sexual-activity write journeys before cleanup.
- Public privacy policy: `/privacy`; source copy in `docs/privacy-policy.md`, App Store privacy notes in `docs/app-store-privacy.md`.
- App Store screenshots: `bundle exec fastlane ios screenshots` drives the `DailyMacrosScreenshots` UI-test target. The app runs with `--app-store-screenshots`, uses debug-only deterministic data from `ScreenshotSeedData.swift`, and writes review assets to `fastlane/screenshots/`. The manual GitHub workflow is `.github/workflows/app-store-screenshots.yml`; leave `upload_to_app_store=false` until screenshots are reviewed.
- TestFlight signing: `.github/workflows/testflight.yml` verifies the App Store distribution `.p12` before import. Keep the `openssl pkcs12 -legacy` fallback because GitHub `macos-latest` OpenSSL can reject older Apple certificate bundles encrypted with legacy ciphers such as `RC2-40-CBC`.
- Legacy Elastic Beanstalk material remains in `docs/aws-production-security-audit.md`; do not use it as the current deploy source of truth unless that platform is intentionally revived.

### Deployment Process

Deployment is automated by `.github/workflows/ci.yml`. Every push to `main` must pass the full `Required Checks` aggregate before the reusable EC2 deploy and TestFlight jobs can run. No direct deploy/TestFlight dispatch or manual `eb deploy` step is part of the active path.

When asked to deploy or "push live", always run these steps in order — no skipping:

1. **`git status`** — identify all modified/untracked files
2. **`git add`** all changed files relevant to the work
3. **Update `AGENTS.md`** if anything was learned (new gotchas, architecture decisions, changed patterns) — then `git add AGENTS.md`
4. **`git commit`** with a clear message describing what changed and why
5. **`git push origin main`** — GitHub Actions runs all required gates, then deploys to EC2 and uploads TestFlight only after the aggregate succeeds

The orchestrator retains diagnostics for failed gates. The reusable deploy job uses `EC2_SSH_KEY`, `EC2_USER`, and `EC2_HOST`, builds the `macros` service through the remote Compose project, and runs post-deploy `/healthz` and `/version` checks when `PRODUCTION_BASE_URL` is configured. Configure and verify strict main protection only after the `Required Checks` context has completed successfully; see `docs/ci-release-gates.md`. GitHub only enables `allow_fork_syncing` for a read-only locked branch, so the current writable protected-main policy must keep both `lock_branch` and `allow_fork_syncing` false.

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
