# Macro Tracker — Claude Code Guide

## Project Overview

Full-stack macro/nutrition tracking web app with iOS companion. Node.js + Express backend, vanilla JS frontend (SPA), PostgreSQL database, SwiftUI iOS app. Uses OpenAI for natural language meal/workout parsing. Supports Google OAuth and Apple Sign-In for authentication. Stripe for paid subscriptions.

## Tech Stack

- **Backend**: Node.js 18+, Express.js, Passport.js (Google OAuth), Apple Sign-In (`apple-signin-auth`)
- **Frontend**: Vanilla JS, HTML5, CSS3 (no frameworks)
- **iOS App**: SwiftUI (iOS 17+), AuthenticationServices (Sign in with Apple), Keychain token storage
- **Database**: PostgreSQL 16 (Docker locally, AWS RDS in production)
- **AI**: OpenAI API (`gpt-4.1-mini` by default) for meal/workout parsing
- **Billing**: Stripe (checkout sessions, customer portal, webhooks)
- **Deployment**: AWS Elastic Beanstalk (Node.js 22, Amazon Linux 2023)

## Local Development

```bash
npm run db:up       # Start PostgreSQL via Docker
cp .env.example .env  # Configure env vars
npm run check       # Initialize DB schema
npm run db:seed:local  # Optional: seed preview data
npm run dev         # Start with file watcher
```

Set `LOCAL_AUTH_BYPASS=true` in `.env` to skip Google/Apple OAuth setup locally.

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
| `src/server.js` | Express server, all routes, auth, Stripe webhooks (~2,000 lines) |
| `src/db.js` | All PostgreSQL queries (~1,600 lines) |
| `src/parser.js` | OpenAI meal/workout parsing (~230 lines) |
| `public/script.js` | Frontend SPA logic (~4,030 lines) |
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
STRIPE_SECRET_KEY=       # Stripe secret key
STRIPE_WEBHOOK_SECRET=   # Stripe webhook signing secret
STRIPE_PRO_PRICE_ID=     # Stripe Price ID for the Pro plan
```

See `.env.example` for full list.

## Testing

Uses Node's built-in `node:test` module.

- `test/api-infrastructure.test.js` — API infra: soft deletes, pagination, auth, billing, GDPR (36 tests)
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
- **Database**: Schema auto-created on startup. Tables: `users`, `entries`, `saved_items`, `macro_targets`, `weight_entries`, `workout_entries`, `weight_targets`, `analysis_reports`, `api_tokens`, `audit_log`, `subscriptions`, `billing_events`.
- **API**: REST endpoints under `/api/v1/`. Rate-limited parse endpoints (15 req/min). See `src/server.js` for full route list.
- **Frontend**: Single HTML page (`public/index.html`) with all state in `public/script.js`.
- **Modal-based editing**: All editing (entries, meals, quick adds, weight, workouts) uses modal popups (`showEntryModal`, `showCombineModal`, `showWeightEditModal`, `showWorkoutEditModal`). Target editing also uses modals: `showEditTargetsModal` (macro targets), `showWeightTargetModal` (weight target + date), `showWorkoutTargetModal` (workouts/week + calories/week). Each is accessed via "(edit targets)" or "(edit target)" links in the Logged Entries heading of each tab. No inline edit rows remain.
- **Macro targets**: Stored in `macro_targets` table. Valid macros: `calories`, `protein`, `carbs`, `fat`, `workouts`, `workout_calories`. Defaults via `getMacroTargets()`.
- **Timezone**: All database date grouping uses `AT TIME ZONE 'America/New_York'` (Eastern time) so daily boundaries align with the user's local day.
- **Chart tooltips**: All charts (macros trend, weight, workout calories) support hover/click/touch tooltips via `bindSimpleChartTooltip()`. Tooltip threshold is 40px for hover, 42px for click/touch.
- **Weight chart**: `drawSimpleLineChart` on `#weight-canvas` shows weight trend with average and target lines. Weight page has period toggles (week/month/year).
- **Workout stats**: Workout page shows stats chips (workouts/week, cal burned/week) with target values and a data source note. Workout graphs (occurrence + calories) have been removed.
- **Tab order**: Macros, Workouts, Weight, Analysis.
- **Branding**: App name is "DailyMacros" with "DM" logo icon.
- **Meal grouping**: Entries can be combined into meals via `meal_group` UUID. API endpoints: `POST /api/entries/combine`, `POST /api/meal-group/:id/split`, `POST /api/entries/:id/remove-from-group`, `PUT /api/meal-group/:id/scale`.
- **Entry multi-select**: Custom-styled checkboxes (neon accent, `appearance: none`) hidden by default behind "(edit)" link in table header. Toggle adds `.editing` class to `#entries-by-day`. Sub-item checkboxes are indented within meal groups. Mobile-friendly tap targets for both edit link and checkboxes. Selection modes: meals, items, sub-items (no mixing). Action bar appears with context-sensitive buttons (Edit, Delete, Combine, Split, Remove).

## iOS App (`ios/DailyMacros/`)

SwiftUI app targeting iOS 17+. Uses token-based auth (either via Sign in with Apple or manual API token entry).

| File | Purpose |
|------|---------|
| `DailyMacrosApp.swift` | App entry point, auth routing, dark mode |
| `AuthManager.swift` | Auth state, Sign in with Apple, token auth |
| `APIClient.swift` | Singleton API client, all REST endpoints, Keychain |
| `Models.swift` | Codable response types |
| `LoginView.swift` | Sign in with Apple + token-based login |
| `MainTabView.swift` | 4-tab navigation (Macros, Weight, Workouts, Settings) |
| `MacrosView.swift` | Meal logging, parsing, dashboard with macro progress bars |
| `WeightView.swift` | Weight logging, Canvas trend chart, history |
| `WorkoutsView.swift` | Workout logging/parsing, intensity cards |
| `SettingsView.swift` | Account, subscription, data export, delete account |

The iOS app communicates with the backend via Bearer token auth. Sign in with Apple sends the identity token to `/auth/apple/mobile` which verifies it and returns an API token stored in Keychain.

## Production (AWS)

- Platform: Elastic Beanstalk (`macro-tracker-prod`, us-east-2)
- Deploy: `eb deploy macro-tracker-prod` from project root
- Health check: `GET /healthz` (performs live DB query)
- Max upload: 12MB (Nginx config in `.platform/`)
- SSL: Auto-enabled for RDS. Pin cert via `PGSSL_CA_FILE`.
- Password rotation: `npm run ops:rotate-prod-db-password`
- Security checklist: `docs/aws-production-security-audit.md`

> **Critical deploy gotcha**: `eb deploy` packages via `git archive` and only includes **committed** files. Uncommitted changes to `public/script.js`, `src/server.js`, or any other file will be silently ignored and the old version ships. Always `git add` + `git commit` before deploying.

### Deployment Process

Deployment is automated via GitHub Actions (`.github/workflows/deploy.yml`). Every push to `main` automatically deploys to production on AWS Elastic Beanstalk. No manual `eb deploy` step is needed.

When asked to deploy or "push live", always run these steps in order — no skipping:

1. **`git status`** — identify all modified/untracked files
2. **`git add`** all changed files relevant to the work
3. **Update `CLAUDE.md`** if anything was learned (new gotchas, architecture decisions, changed patterns) — then `git add CLAUDE.md`
4. **`git commit`** with a clear message describing what changed and why
5. **`git push origin main`** — GitHub Actions will automatically deploy to `macro-tracker-prod`

The workflow uses `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` GitHub secrets and deploys to the `macro-tracker` EB application, `macro-tracker-prod` environment in `us-east-2`.

## Content Security Policy

The server sets a strict CSP header. Key constraints for frontend development:

- `img-src 'self' data: https:` — **blob: URLs are NOT allowed for images**. Always use `data:` URLs (base64) for dynamically generated image previews. Do not use `URL.createObjectURL()` for `<img>` src.
- `script-src 'self'` — no inline scripts or external scripts
- `connect-src 'self'` — no external API calls from frontend

## Frontend Notes

- All state lives in the global `state` object in `public/script.js`
- Period toggles (weekly/monthly/annual) controlled by `state.macroSnapshotPeriod`, `state.weightSnapshotPeriod`, `state.workoutSnapshotPeriod`. Switching period triggers a server request with `scope` param (e.g. `/api/daily-totals?scope=month`) to fetch the full date range.
- Charts are drawn on `<canvas>` elements with device pixel ratio scaling. All charts support tooltips on hover/click/touch.
- TDEE/energy balance feature was removed — no longer present in the codebase.
- Meal photo preview: uses base64 data URL (`state.mealImageDataUrl`) for `<img src>` — not blob URLs (blocked by CSP)
- OpenAI API key is required; no fallback parsing exists
