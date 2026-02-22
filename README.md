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
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL` (default: `http://localhost:3000/auth/google/callback`)

   Optional DB overrides (defaults already work with `npm run db:up`):
   - `DATABASE_URL` (default fallback: `postgres://postgres:postgres@localhost:5432/macro_tracker`)
   - `PGSSL` (`false` locally; set `true` in cloud environments)

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

## Cloud Setup Notes
For AWS/RDS deployments set:
- `DATABASE_URL` to your RDS connection string
- `PGSSL=true`

## Notes
- Login is required for all app/API usage.
- If Google OAuth env vars are missing, login will show an auth configuration error.
- If `OPENAI_API_KEY` is missing, parsing works in fallback mode with placeholder macros.
- Data is stored in PostgreSQL.

## API Endpoints
- `GET /api/me`
- `POST /api/parse-meal`
- `POST /api/entries/bulk`
- `PUT /api/entries/:id`
- `DELETE /api/entries/:id`
- `GET /api/saved-items`
- `POST /api/saved-items`
- `PUT /api/saved-items/:id`
- `DELETE /api/saved-items/:id`
- `POST /api/quick-add`
- `GET /api/dashboard`
