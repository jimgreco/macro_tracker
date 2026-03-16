# Macro Tracker — Claude Code Guide

## Project Overview

Full-stack macro/nutrition tracking web app. Node.js + Express backend, vanilla JS frontend (SPA), PostgreSQL database. Uses OpenAI for natural language meal/workout parsing and Google OAuth for authentication.

## Tech Stack

- **Backend**: Node.js 18+, Express.js, Passport.js (Google OAuth)
- **Frontend**: Vanilla JS, HTML5, CSS3 (no frameworks)
- **Database**: PostgreSQL 16 (Docker locally, AWS RDS in production)
- **AI**: OpenAI API (`gpt-4.1-mini` by default) for meal/workout parsing
- **Deployment**: AWS Elastic Beanstalk (Node.js 22, Amazon Linux 2023)

## Local Development

```bash
npm run db:up       # Start PostgreSQL via Docker
cp .env.example .env  # Configure env vars
npm run check       # Initialize DB schema
npm run db:seed:local  # Optional: seed preview data
npm run dev         # Start with file watcher
```

Set `LOCAL_AUTH_BYPASS=true` in `.env` to skip Google OAuth setup locally.

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
| `src/server.js` | Express server, all routes, auth (~1,340 lines) |
| `src/db.js` | All PostgreSQL queries (~1,030 lines) |
| `src/parser.js` | OpenAI meal/workout parsing (371 lines) |
| `public/script.js` | Frontend SPA logic (~3,185 lines) |
| `public/index.html` | Main app HTML |
| `docker-compose.yml` | Local PostgreSQL container |
| `.env.example` | All env vars with descriptions |

## Required Environment Variables

```
SESSION_SECRET=          # Long random string (required in production)
DATABASE_URL=            # postgres://... connection string
OPENAI_API_KEY=          # For meal/workout parsing
GOOGLE_CLIENT_ID=        # Google OAuth
GOOGLE_CLIENT_SECRET=    # Google OAuth
APP_BASE_URL=            # Canonical URL (e.g. https://yourdomain.com)
```

See `.env.example` for full list including optional vars.

## Testing

Uses Node's built-in `node:test` module.

- `test/ios-safari-regression.test.js` — Mobile nav regression
- `test/ui-regression.test.js` — UI component tests
- `test/workout-parse.test.js` — Workout parsing logic

Run `npm run test:check` for fast syntax + test pass (no database required).

## Architecture Notes

- **Authentication**: Google OAuth only (no local accounts). Session-based via `express-session`.
- **Database**: Schema auto-created on startup (`npm run check` calls `initDB()`). Tables: `entries`, `saved_items`, `macro_targets`, `weight_entries`, `workout_entries`, `weight_targets`, `analysis_reports`.
- **API**: REST endpoints under `/api/`. Rate-limited parse endpoints (15 req/min). See `src/server.js` for full route list.
- **Frontend**: Single HTML page (`public/index.html`) with all state in `public/script.js`.

## Production (AWS)

- Platform: Elastic Beanstalk (`macro-tracker-prod`, us-east-2)
- Deploy: `eb deploy macro-tracker-prod` from project root
- Health check: `GET /healthz` (performs live DB query)
- Max upload: 12MB (Nginx config in `.platform/`)
- SSL: Auto-enabled for RDS. Pin cert via `PGSSL_CA_FILE`.
- Password rotation: `npm run ops:rotate-prod-db-password`
- Security checklist: `docs/aws-production-security-audit.md`

> **Critical deploy gotcha**: `eb deploy` packages via `git archive` and only includes **committed** files. Uncommitted changes to `public/script.js`, `src/server.js`, or any other file will be silently ignored and the old version ships. Always `git add` + `git commit` before deploying.

## Content Security Policy

The server sets a strict CSP header. Key constraints for frontend development:

- `img-src 'self' data: https:` — **blob: URLs are NOT allowed for images**. Always use `data:` URLs (base64) for dynamically generated image previews. Do not use `URL.createObjectURL()` for `<img>` src.
- `script-src 'self'` — no inline scripts or external scripts
- `connect-src 'self'` — no external API calls from frontend

## Frontend Notes

- All state lives in the global `state` object in `public/script.js`
- Period toggles (weekly/monthly/annual) controlled by `state.macroSnapshotPeriod`, `state.weightSnapshotPeriod`, `state.workoutSnapshotPeriod`
- Charts are drawn on `<canvas>` elements with device pixel ratio scaling
- Meal photo preview: uses base64 data URL (`state.mealImageDataUrl`) for `<img src>` — not blob URLs (blocked by CSP)
- OpenAI API key is required; no fallback parsing exists
