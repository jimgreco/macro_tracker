# Macro Tracker Web App

A web app for tracking macros with:
- PostgreSQL database backend
- ChatGPT natural-language meal parsing
- Quick-add saved items/meals
- Daily grouping and totals
- Previous day totals
- Running 7-day average based on prior week
- Google-only login

## Requirements
- Node.js 18+
- Docker Desktop (for local PostgreSQL)
- Google OAuth credentials (Client ID + Client Secret)

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
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL` (default: `http://localhost:3000/auth/google/callback`)
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
- JS syntax checks for `public/script.js` and `src/server.js`
- Regression tests that verify the removed mobile bottom nav does not reappear in markup, styles, or script wiring

If you want a full runtime test, start Postgres first (`npm run db:up`) and then run `npm start`.
For a preloaded local preview, run `npm run db:seed:local` after Postgres is up.

## Cloud Setup Notes
For AWS/RDS deployments set:
- `DATABASE_URL` to your RDS connection string
- `PGSSL=true`
- `PGSSL_REJECT_UNAUTHORIZED=true`
- `APP_BASE_URL=https://your-production-domain`
- `SESSION_SECRET` to a long random value (required in production)

Operational safeguards:
- `GET /healthz` performs a live `SELECT 1` against PostgreSQL and returns `503` if the database is unavailable.
- Elastic Beanstalk is configured to use `/healthz` for the default process health check.
- Use `npm run ops:rotate-prod-db-password` to rotate the RDS password and update Elastic Beanstalk `DATABASE_URL` in one run.
- Do not enable RDS managed master-password rotation unless the app is changed to read the current secret from Secrets Manager at runtime.

Run the infrastructure hardening checklist in:
- `docs/aws-production-security-audit.md`

## Notes
- Login is required for all app/API usage.
- When `LOCAL_AUTH_BYPASS=true` in a non-production environment, the app injects a local default user and skips the Google sign-in flow.
- If Google OAuth env vars are missing, login will show an auth configuration error.
- If `OPENAI_API_KEY` is missing, parsing works in fallback mode with placeholder macros.
- Data is stored in PostgreSQL.

## API Endpoints
- `GET /healthz`
- `GET /api/me`
- `POST /api/parse-meal`
- **`POST /api/parse-workout`**
- **`POST /api/sync-workouts`**
- `POST /api/entries/bulk`
- `PUT /api/entries/:id`
- `DELETE /api/entries/:id`
- `GET /api/saved-items`
- `POST /api/saved-items`
- `PUT /api/saved-items/:id`
- `DELETE /api/saved-items/:id`
- `POST /api/quick-add`
- `GET /api/dashboard`
UT /api/saved-items/:id`
- `DELETE /api/saved-items/:id`
- `POST /api/quick-add`
- `GET /api/dashboard`
