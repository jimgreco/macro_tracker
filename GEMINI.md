# Macro Tracker — Gemini Code Guide

## Deployment (EC2 + Docker)
The production environment has been migrated from Elastic Beanstalk to a consolidated EC2 instance to reduce costs.

### Tech Stack Changes
- **Database**: Migrated from AWS RDS to a local Dockerized PostgreSQL 16 instance.
- **Hosting**: Now running as a Docker container on a shared `t4g.small` instance.
- **SSL**: Managed by Nginx Proxy Manager + Cloudflare (Full Strict).

### Auto-Deployment
Pushes to the `main` branch automatically deploy to the EC2 instance via GitHub Actions.
- **Workflow**: `.github/workflows/deploy.yml`
- **Mechanism**: `rsync` syncs code → `docker-compose build` rebuilds the app container.

## Key Architecture Notes
- **Workout Sync**: Integrates with the Workout Planner app via an internal API. 
  - **Logic**: Fetches logs from `WORKOUT_API_URL`, uses OpenAI to categorize them, and saves them to PostgreSQL.
  - **Authentication**: Uses a shared `INTERNAL_SYNC_SECRET` for service-to-service communication.
- **SSL Logic**: `src/db.js` has been patched to respect `PGSSL=false` for local Docker connections, even when `NODE_ENV=production`.
- **Internal Networking**: Connects to the database via `postgresql://admin:${DB_PASSWORD}@db:5432/macro_tracker`.

## Development Commands
| Command | Purpose |
|:---|:---|
| `npm run dev` | Local development with file watcher |
| `npm test` | Run test suite (Node built-in test runner) |
| `docker build -t macros .` | Test production Docker build locally |

## Production Secrets
Ensure the following are set in the server's `~/deploy/.env` file:
- `MACROS_OPENAI_API_KEY`
- `MACROS_GOOGLE_CLIENT_ID / SECRET`
- `MACROS_SESSION_SECRET`
- `DB_PASSWORD` (Master password for Docker DB)
- `INTERNAL_SYNC_SECRET` (Shared secret for Workout Planner sync)
- `WORKOUT_API_URL` (Defaults to `http://workout_api:3001` in Docker)
