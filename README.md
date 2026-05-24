# Macro Tracker Web App

A web app for tracking macros with:
- PostgreSQL database backend
- ChatGPT natural-language meal parsing
- Barcode lookup for packaged foods via Open Food Facts
- Quick-add saved items/meals
- Daily grouping and totals
- Previous day totals
- Running 7-day average based on prior week
- Google and Apple sign-in
- Native iOS companion with HealthKit sync, first-run target setup, local reminders, pending-log retry, and diagnostic export

## Requirements
- Node.js 18+
- Docker Desktop (for local PostgreSQL)
- Google OAuth credentials (Client ID + Client Secret)
- Apple Sign-In credentials for Apple web/native sign-in
- Stripe credentials if paid subscriptions are enabled

## Local Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start local PostgreSQL:
   ```bash
   npm run db:up
   ```
3. Create env file:
   ```bash
   cp .env.example .env
   ```
4. Configure `.env` values:
   - `OPENAI_API_KEY`
   - `SESSION_SECRET`
   - `APP_BASE_URL` (your canonical app URL; used for request-origin validation)
   - `APP_BUILD` (CI sets this to the git SHA for `/version`)
   - `ADMIN_EMAILS` or `ADMIN_USER_IDS` (comma-separated accounts allowed to open `/admin`)
   - `AI_DAILY_MEAL_PARSE_LIMIT`, `AI_DAILY_WORKOUT_PARSE_LIMIT`, `AI_DAILY_PHOTO_PARSE_LIMIT`, `AI_DAILY_ANALYSIS_LIMIT`
   - `OPEN_FOOD_FACTS_USER_AGENT` (optional custom user agent for barcode lookups)
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL` (default: `http://localhost:3000/auth/google/callback`)
   - `GOOGLE_IOS_CLIENT_ID` (iOS OAuth client ID used by the native app)
   - `APPLE_BUNDLE_ID` (iOS bundle id used to verify native Sign in with Apple; defaults to `com.dailymacros.app`)
   - `SESSION_TTL_DAYS` (default: `30`)

   Optional DB overrides (defaults already work with `npm run db:up`):
   - `DATABASE_URL` (default fallback: `postgres://postgres:postgres@localhost:5432/macro_tracker`)
   - `PGSSL` (`false` locally; set `true` in cloud environments)
   - `PGSSL_REJECT_UNAUTHORIZED` (default: `true`)
   - `PGSSL_CA_CERT` or `PGSSL_CA_FILE` (recommended for strict RDS cert pinning)
   - `LOCAL_AUTH_BYPASS=true` to skip Google OAuth locally and auto-sign in as a default preview user
   - `LOCAL_DEV_USER_ID`, `LOCAL_DEV_USER_NAME`, `LOCAL_DEV_USER_EMAIL` to customize that local-only user

5. Start the app:
   ```bash
   npm start
   ```
6. Open [http://localhost:3000](http://localhost:3000)

## Useful Commands
- Start DB: `npm run db:up`
- Stop DB: `npm run db:down`
- Tail DB logs: `npm run db:logs`
- Validate DB init: `npm run check`
- Load local test data for the preview user: `npm run db:seed:local`
- Rotate prod DB password safely: `npm run ops:rotate-prod-db-password`

## Test Environment
Use a fast local test path that does **not** require Postgres or OAuth:

```bash
npm run test:check
```

What it runs:
- JS syntax checks for `public/login.js`, `public/script.js`, and `src/server.js`
- Backend, web, release, and iOS source regression tests that do not require Postgres or OAuth

If you want a full runtime test, start Postgres first (`npm run db:up`) and then run `npm start`.
For a preloaded local preview, run `npm run db:seed:local` after Postgres is up.

## Production Setup Notes

The production path is the EC2 deploy workflow in `.github/workflows/deploy.yml`. It runs automatically for backend/web deploy inputs on `main`, can be started manually from GitHub Actions, rsyncs this repository to `~/macros`, rebuilds the `macros` service from `~/deploy`, and then runs `scripts/production-smoke.sh` when `PRODUCTION_BASE_URL` is configured.

Required GitHub Actions secrets for deploy:
- `EC2_SSH_KEY`
- `EC2_USER`
- `EC2_HOST`
- `PRODUCTION_BASE_URL` (optional for deploy; enables post-deploy smoke checks)
- `PRODUCTION_SMOKE_API_TOKEN` (optional; enables authenticated deploy and scheduled smoke checks)

For AWS/RDS deployments set:
- `DATABASE_URL` to your RDS connection string
- `PGSSL=true`
- `PGSSL_REJECT_UNAUTHORIZED=true`
- `APP_BASE_URL=https://your-production-domain`
- `SESSION_SECRET` to a long random value (required in production)
- `APP_BUILD` to the deployed git SHA
- `ADMIN_EMAILS` or `ADMIN_USER_IDS` to the production admin allowlist
- AI usage limit env vars to the intended beta limits

Operational safeguards:
- `GET /healthz` performs a live `SELECT 1` against PostgreSQL and returns `503` if the database is unavailable.
- `GET /version` exposes app version, build SHA, Node version, and start time for smoke checks and support.
- The deploy workflow pins SSH host keys with `ssh-keyscan` and fails if configured post-deploy smoke checks fail.
- `.github/workflows/production-smoke.yml` runs hourly production smoke checks using `scripts/production-smoke.sh`.
- Authenticated production smoke checks use the configured smoke account to exercise disposable meal, quick-add, weight, sleep, and optional sexual-activity create/update/delete journeys, then clean up created records.
- Before wider beta pushes, confirm the latest database backup exists, restore has been tested recently, and the smoke token still reaches the intended production account.
- Elastic Beanstalk material in `docs/aws-production-security-audit.md` is legacy unless that platform is intentionally revived.
- Use `npm run ops:rotate-prod-db-password` only if the RDS/Elastic Beanstalk path is revived and verified.
- Do not enable RDS managed master-password rotation unless the app is changed to read the current secret from Secrets Manager at runtime.

Run the production release runbook in:
- `docs/ec2-release-runbook.md`

## Notes
- Login is required for all app/API usage.
- `/admin` is restricted to the `ADMIN_EMAILS`/`ADMIN_USER_IDS` allowlist; local auth bypass users are admins only outside production.
- When `LOCAL_AUTH_BYPASS=true` in a non-production environment, the app injects a local default user and skips the Google sign-in flow.
- If Google OAuth env vars are missing, login will show an auth configuration error.
- If `OPENAI_API_KEY` is missing, AI parsing and analysis are unavailable.
- Barcode lookup uses Open Food Facts product data when a UPC/EAN is scanned or entered; nutrition coverage depends on that public database.
- Data is stored in PostgreSQL.
- Native iOS users can export diagnostics from Settings. Pending log writes are queued locally after connectivity failures and retried when the app becomes active or when the user taps Sync Pending Logs.

## API Endpoints
- `GET /healthz`
- `GET /api/me`
- `POST /api/parse-meal`
- `GET /api/barcode/:barcode`
- `POST /api/parse-workout`
- `POST /api/sync-workouts`
- `POST /api/entries/bulk`
- `PUT /api/entries/:id`
- `DELETE /api/entries/:id`
- `GET /api/saved-items`
- `POST /api/saved-items`
- `PUT /api/saved-items/:id`
- `DELETE /api/saved-items/:id`
- `POST /api/quick-add`
- `GET /api/dashboard`
- `GET /api/daily-totals`
- `GET /api/weights`
- `POST /api/weights`
- `GET /api/workouts`
- `POST /api/workouts`
- `GET /api/sleep`
- `POST /api/sleep`
- `GET /api/sexual-activity`
- `POST /api/sexual-activity`
- `GET /api/account/export`
- `DELETE /api/account`
