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
- `test/ios-safari-regression.test.js` — Mobile nav regression
- `test/ui-regression.test.js` — UI component tests
- `test/workout-parse.test.js` — Workout parsing logic

Run `npm run test:check` for fast syntax + test pass (no database required).

## Architecture Notes

- **Authentication**: Google OAuth + Apple Sign-In. Session-based via `express-session` for web. Bearer token auth for iOS/API.
- **Apple Sign-In**: Web flow uses form POST callback (`/auth/apple/callback`). iOS flow uses `/auth/apple/mobile` endpoint that verifies the Apple identity token and returns an API token. Apple user IDs are prefixed with `apple_` to avoid collision with Google IDs.
- **Users table**: Central `users` table with upsert on every OAuth login. Supports `google`, `apple`, and `local-dev` providers.
- **API versioning**: Routes on `express.Router()` mounted at both `/api/v1/` and `/api/` (backward compat).
- **Soft deletes**: All data tables have `deleted_at TIMESTAMPTZ`. DELETE operations do `UPDATE SET deleted_at = NOW()`. All SELECTs filter `AND deleted_at IS NULL`.
- **Bearer tokens**: `api_tokens` table with SHA-256 hashed tokens. `bearerTokenAuth` middleware checks before session auth on `/api` routes.
- **Per-user rate limiting**: Rate limiter keys on `req.user.id` when available, falls back to IP.
- **Audit logging**: `audit_log` table. `logAudit()` wraps in try/catch to never break main operations.
- **GDPR**: `GET /api/v1/account/export` (full data dump), `DELETE /api/v1/account` (hard delete all data).
- **Pagination**: `getDashboard()` and `listWorkoutEntries()` accept `{ limit, offset }`, responses include `pagination` object.
- **Stripe billing**: Webhook registered BEFORE `express.json()` for raw body access. Handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Plan gating infrastructure exists but is currently disabled (no upgrade restrictions).
- **Database**: Schema auto-created on startup. Tables include `users`, `user_identities`, `entries`, `saved_items`, `macro_targets`, `weight_entries`, `workout_entries`, `sexual_activity_entries`, `sleep_entries`, `weight_targets`, `analysis_reports`, `api_tokens`, `audit_log`, `subscriptions`, `billing_events`, and `daily_usage_counts`.
- **API**: REST endpoints under `/api/v1/`. Rate-limited parse endpoints (15 req/min). See `src/server.js` for full route list.
- **Frontend**: Single HTML page (`public/index.html`) with all state in `public/script.js`.
- **Modal-based editing**: All editing (entries, meals, quick adds, weight, workouts) uses modal popups (`showEntryModal`, `showCombineModal`, `showWeightEditModal`, `showWorkoutEditModal`). Target editing also uses modals: `showEditTargetsModal` (macro targets), `showWeightTargetModal` (weight target + date), `showWorkoutTargetModal` (workouts/week + calories/week). Each is accessed via "(edit targets)" or "(edit target)" links in the Logged Entries heading of each tab. No inline edit rows remain.
- **Macro targets**: Stored historically in `macro_targets` by `(user_id, macro, effective_date)`. New edits are effective for the current local date going forward until another target row is set; old dates should compare against the targets effective on those dates. Valid macros: `calories`, `protein`, `carbs`, `fat`, `workouts`, `workout_calories`, `sleep_hours`. Defaults via `getMacroTargets()`.
- **Weight targets**: Stored historically in `weight_targets` by `(user_id, effective_date)`. `target_date` remains the goal deadline; `effective_date` is when that target started applying to logged weight history.
- **Timezone**: All database date grouping uses `AT TIME ZONE 'America/New_York'` (Eastern time) so daily boundaries align with the user's local day.
- **Chart tooltips**: All charts (macros trend, weight, workout calories) support hover/click/touch tooltips via `bindSimpleChartTooltip()`. Tooltip threshold is 40px for hover, 42px for click/touch.
- **Weight chart**: `drawSimpleLineChart` on `#weight-canvas` shows weight trend with average and target lines. Weight page has period toggles (week/month/year).
- **Workout stats**: Workout page shows stats chips (workouts/week, cal burned/week) with target values and a data source note. Workout graphs (occurrence + calories) have been removed.
- **Tab order**: Macros, Workouts, Weight, Health.
- **Branding**: App name is "DailyMacros" with an abstract macro plate logo icon.
- **Meal grouping**: Entries can be combined into meals via `meal_group` UUID. API endpoints: `POST /api/entries/combine`, `POST /api/meal-group/:id/split`, `POST /api/entries/:id/remove-from-group`, `PUT /api/meal-group/:id/scale`. Parsed repeated multi-item meals keep the repetition on `mealQuantity` and display child components per meal unit; `/api/entries/bulk` accepts `itemsAreMealUnit: true` and scales those unit-level rows back to consumed totals before persistence so dashboard totals remain additive.
- **Health tab**: Contains two sub-sections separated by `health-section-divider` headings: "Sexual Activity" (log activity type, logged entries, weekly snapshot graph) and "Sleep" (log hours + wake-ups, sleep log, weekly snapshot graph with average line). Sleep entries store `duration_hours` (decimal), `wake_ups` (integer), optional `quality` (1-5), and optional `notes` text. Both sections have week/month/year period toggles. Sleep data is included in the Analysis section. Edit modals: `showHealthEditModal` (sexual activity), `showSleepEditModal` (sleep — date/time on row 1, hours + wake-ups on row 2). Sexual Activity visibility is two-layered: the admin-controlled account feature from `/api/me` must be enabled, then the user can show/hide the page locally from Settings / Account & Privacy.
- **Macro display format**: Logged entries show explicit labels: `28g protein · 12g carbs · 6g fat`. Calories shown as `220 cal`. Quick Add dropdown uses abbreviated format: `260cal/24P/12C/6F` (compact for space).
- **Entry multi-select**: Custom-styled checkboxes (neon accent, `appearance: none`) hidden by default behind "(edit)" link in table header. Toggle adds `.editing` class to `#entries-by-day`. Sub-item checkboxes are indented within meal groups. Mobile-friendly tap targets for both edit link and checkboxes. Selection modes: meals, items, sub-items (no mixing). Action bar appears with context-sensitive buttons (Edit, Delete, Combine, Split, Remove).

## iOS App (`ios/DailyMacros/`)

SwiftUI app targeting iOS 17+. Uses token-based auth (either via Sign in with Apple or manual API token entry).

| File | Purpose |
|------|---------|
| `DailyMacrosApp.swift` | App entry point, auth routing, onboarding routing, pending-log retry, dark mode |
| `AuthManager.swift` | Auth state, Sign in with Apple, token auth |
| `APIClient.swift` | Singleton API client, all REST endpoints, Keychain, offline mutation queue flushing |
| `Models.swift` | Codable response types |
| `LoginView.swift` | Sign in with Apple + token-based login |
| `MainTabView.swift` | Tab navigation (Macros, Workouts, Weight, Sleep, optional Sexual Activity, Analysis, Settings) |
| `OnboardingView.swift` | First-run target setup and reminder opt-in |
| `MacrosView.swift` | Meal logging, parsing, barcode lookup, dashboard with macro progress bars |
| `BarcodeScannerView.swift` | AVFoundation barcode scanner used by meal logging |
| `WeightView.swift` | Weight logging, Canvas trend chart, history |
| `WorkoutsView.swift` | Workout logging/parsing, intensity cards |
| `AICoach.swift` | Shared iOS Coach Tony P. suggestion model, deterministic candidate rules, dismissals, settings keys, and coach card UI |
| `SettingsView.swift` | Account, subscription, reminder controls, optional Sexual Activity page toggle when admin-enabled, pending-log sync, data and diagnostics export, delete account |
| `ReminderScheduler.swift` | Local daily log notification scheduling |
| `OfflineMutationStore.swift` | UserDefaults-backed pending mutation queue |
| `Diagnostics.swift` | Local diagnostic event log and export text |

The iOS app communicates with the backend via Bearer token auth. Sign in with Apple sends the identity token to `/auth/apple/mobile` which verifies it and returns an API token stored in Keychain.
iOS Quick Add in `MacrosView.swift` queues items locally until the user saves the draft meal with `saveMealEntries(...)`; queued items appear in a screen-level floating tray pinned with the add sheet geometry safe-area inset, not as a scroll/tab section. Quick Add row buttons should remain add affordances: after a tap, show the green check/Added feedback only briefly, then return to the plus button so adding another of the same item still looks available.
Onboarding tutorial spotlight geometry lives in `OnboardingView.swift`; clamp reported safe-area insets before positioning highlights because embedded `NavigationStack` backgrounds can report toolbar-inflated values.

The iOS coach is named Coach Tony P. It starts from deterministic local candidate rules in `AICoach.swift`; those rules compute confidence, evidence, priority, dismissal keys, and page actions. Macro missed-meal prompts use learned `CoachDaypart` windows, end-of-day protein steering compares current macro pace against calorie pace, habitual quick-add suggestions pass reconstructed meal payloads through `CoachAction`, workout trend cards compare recent duration/calories/intensity against the prior baseline, Workouts can load recent sleep totals for a recovery guardrail when sleep is under target and recent workout days are high-intensity, repeat-workout suggestions can pass reconstructed workout payloads for direct logging, Weight can load month macro totals for a multi-week macro-consistency card when the weight trend is not moving toward target, weight maintenance cards require repeated in-band weigh-ins before congratulating, weight plateau cards require a multi-week flat trend while the target still needs movement, and sleep streak cards require consecutive target nights. iOS pages should rebuild Coach Tony P. candidates through `CoachCandidateWorker` after data loads instead of calling `CoachCandidateEngine.*` from SwiftUI `body`; local-model narration should stay behind `CoachNarrationWorker` so AFM work does not run on the main actor. When multiple high-confidence cards survive confidence, expiry, and dismissal filtering, `AICoachSlot` may expose up to the top three as a swipeable single-card viewport with dots; do not show extra cards by weakening relevance gates. Keep `AICoachSlot` and its host vertical scroll stacks width-bound and clipped so swiping between suggestions cannot widen the page into horizontal scrolling; the card swipe gesture should take priority over the parent scroll view rather than run as a simultaneous gesture. `CoachNarrator` is an optional Foundation Models layer on iOS 26+ that sees only already-eligible rule candidates and acts as the final local judgment layer: it may hide all candidates as awkward/low-value/tone-deaf, or choose one candidate and rewrite only title/message; it must not replace numeric calculations, confidence gates, evidence, actions, expiry, or dismissal keys. Settings exposes Coach Tony P. modes for On, Rules Only, Local AI Only, and Off only to `ADMIN_EMAILS` / `ADMIN_USER_IDS` admins; non-admins see only a Show cards toggle plus category controls, and non-admin card/source UI should not display Local rules or Local AI labels. Coach dismissals live locally first and also sync through `/api/coach/dismissals` as user-scoped `today` and `pattern` records; keep the offline local path intact when changing sync. Coach cards record local diagnostics for shown/dismissed/acted-on/not-useful/local-AI/fallback/veto/sync events, expose a "Why am I seeing this?" sheet with evidence and confidence details, and keep explicit VoiceOver labels for the suggestion icon, dismiss menu, and evidence text.
Coach Tony P. category controls are local user preferences layered after confidence/dismissal filtering; keep category gates separate from candidate generation. Alcohol cards should use specific local tagging with non-alcohol false-positive exclusions, habitual quick-add cards must exclude alcohol-tagged entries, and saved-item cleanup cards should require duplicate or unused Quick Add evidence.

## Production (AWS)

- Active platform: EC2 host running Docker Compose from `~/deploy`.
- Production database: shared Docker Postgres container in the remote Compose stack (`shared_db`).
- Nightly logical database backup: `dailymacros-db-backup.timer` runs `scripts/production-db-backup.sh` before the AWS DLM daily EBS snapshot window; DLM policy `policy-06a5ef1af3cbbc321` retains 7 daily off-host snapshots.
- Deploy workflow: `.github/workflows/deploy.yml`.
- Release runbook: `docs/ec2-release-runbook.md`.
- Health check: `GET /healthz` (performs live DB query).
- Version check: `GET /version`.
- Authenticated smoke script: `scripts/production-smoke.sh`, which uses a smoke API token to exercise disposable meal, quick-add, weight, sleep, and optional sexual-activity write journeys before cleanup.
- Public privacy policy: `/privacy`; source copy in `docs/privacy-policy.md`, App Store privacy notes in `docs/app-store-privacy.md`.
- Legacy Elastic Beanstalk material remains in `docs/aws-production-security-audit.md`; do not use it as the current deploy source of truth unless that platform is intentionally revived.

### Deployment Process

Deployment is automated via GitHub Actions (`.github/workflows/deploy.yml`). Every qualifying push to `main` deploys backend/web assets to the EC2/Docker Compose production service. No manual `eb deploy` step is part of the active path.

When asked to deploy or "push live", always run these steps in order — no skipping:

1. **`git status`** — identify all modified/untracked files
2. **`git add`** all changed files relevant to the work
3. **Update `AGENTS.md`** if anything was learned (new gotchas, architecture decisions, changed patterns) — then `git add AGENTS.md`
4. **`git commit`** with a clear message describing what changed and why
5. **`git push origin main`** — GitHub Actions will automatically deploy when the changed paths match `.github/workflows/deploy.yml`

The workflow uses `EC2_SSH_KEY`, `EC2_USER`, and `EC2_HOST` secrets, builds the `macros` service through the remote Compose project, and runs post-deploy `/healthz` and `/version` checks when `PRODUCTION_BASE_URL` is configured.

## Content Security Policy

The server sets a strict CSP header. Key constraints for frontend development:

- `img-src 'self' data: https:` — **blob: URLs are NOT allowed for images**. Always use `data:` URLs (base64) for dynamically generated image previews. Do not use `URL.createObjectURL()` for `<img>` src.
- `script-src 'self'` — no inline scripts or external scripts
- `connect-src 'self'` — no external API calls from frontend

## Frontend Notes

- All state lives in the global `state` object in `public/script.js`
- Web Coach Tony P. cards live in `public/index.html` slots (`macros-coach`, `workout-coach`, `weight-coach`, `sleep-coach`) and are rendered from deterministic local rules in `public/coach-rules.js`; `public/script.js` owns DOM rendering, category controls in Account & Privacy, admin-only source labels in cards and the "Why am I seeing this?" modal, and dismissal sync. Web Coach Tony P. shares `/api/coach/dismissals` today/pattern sync with iOS and must not call OpenAI for routine coaching.
- Period toggles (weekly/monthly/annual) controlled by `state.macroSnapshotPeriod`, `state.weightSnapshotPeriod`, `state.workoutSnapshotPeriod`. Switching period triggers a server request with `scope` param (e.g. `/api/daily-totals?scope=month`) to fetch the full date range.
- Charts are drawn on `<canvas>` elements with device pixel ratio scaling. All charts support tooltips on hover/click/touch.
- TDEE/energy balance feature was removed — no longer present in the codebase.
- Meal photo previews: use base64 data URLs from `state.mealImageAttachments` for `<img src>` — not blob URLs (blocked by CSP)
- OpenAI API key is required; no fallback parsing exists
