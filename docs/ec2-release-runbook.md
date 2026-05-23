# EC2 Release Runbook

This is the production release path for the friends and family beta.

## Source Of Truth
- GitHub workflow: `.github/workflows/deploy.yml`
- Remote app checkout: `~/macros`
- Remote compose directory: `~/deploy`
- Remote service name: `macros`
- Smoke endpoints: `/healthz` and `/version`

## Required GitHub Secrets
- `EC2_SSH_KEY`: private key for the deploy user.
- `EC2_USER`: deploy user on the EC2 host.
- `EC2_HOST`: EC2 hostname or IP.
- `PRODUCTION_BASE_URL`: optional canonical HTTPS origin, without a trailing slash; enables post-deploy smoke checks.
- `PRODUCTION_SMOKE_API_TOKEN`: optional API token for authenticated scheduled smoke checks.

## Production Env Inventory
Set these on the remote compose environment for the `macros` service:
- `NODE_ENV=production`
- `PORT`
- `APP_BASE_URL`
- `APP_BUILD` or `GITHUB_SHA`
- `ADMIN_EMAILS` or `ADMIN_USER_IDS`
- `SESSION_SECRET`
- `SESSION_TTL_DAYS`
- `DATABASE_URL`
- `PGSSL=true`
- `PGSSL_REJECT_UNAUTHORIZED=true`
- `PGSSL_CA_CERT` or `PGSSL_CA_FILE`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `AI_DAILY_MEAL_PARSE_LIMIT`
- `AI_DAILY_WORKOUT_PARSE_LIMIT`
- `AI_DAILY_PHOTO_PARSE_LIMIT`
- `AI_DAILY_ANALYSIS_LIMIT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `GOOGLE_IOS_CLIENT_ID`
- `APPLE_CLIENT_ID`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY`
- `APPLE_REDIRECT_URI`
- `APPLE_BUNDLE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `INTERNAL_SYNC_SECRET`
- `WORKOUT_API_URL`

## Pre-Deploy Checks
Run locally before merging to `main`:
```bash
npm run test:check
npm audit --omit=dev
```

Confirm the app has a recent restorable database backup:
- Identify the latest automated RDS snapshot or manual backup for the production database.
- Confirm a restore drill has succeeded recently enough to trust the runbook.
- If the release includes schema changes, take a fresh manual snapshot before deploy.

Confirm the workflow secrets are present:
```bash
gh secret list
```

## Deploy
Push or merge to `main`. The workflow will:
1. Validate required deploy secrets.
2. Install the SSH key and add the EC2 host key to `known_hosts`.
3. Rsync the repository to `~/macros`.
4. Rebuild and restart the `macros` service from `~/deploy`.
5. Smoke `PRODUCTION_BASE_URL/healthz` and `PRODUCTION_BASE_URL/version`.

## Manual Smoke
After deploy, run:
```bash
BASE_URL=https://your-production-domain
curl --fail --show-error "$BASE_URL/healthz"
curl --fail --show-error "$BASE_URL/version"
```

Or run the bundled smoke script:
```bash
PRODUCTION_BASE_URL=https://your-production-domain scripts/production-smoke.sh
PRODUCTION_BASE_URL=https://your-production-domain API_TOKEN=<beta-test-api-token> scripts/production-smoke.sh
```

Then verify:
- Web login completes.
- Dashboard loads.
- One meal or workout parse succeeds.
- iOS TestFlight token auth reaches the same backend.
- Settings shows matching app/API build metadata.
- Account export returns a JSON file for the smoke account.
- Account deletion is tested only with a disposable beta account.

## TestFlight Verification
For beta-facing iOS releases, verify on a real device after the TestFlight build processes:
- Google and Apple sign-in both reach the production backend.
- Macro logging, workout logging/sync, Health sleep logging, Settings export, and build metadata load.
- Previously fixed scrolling paths remain usable in meal, workout, weight, and health lists.
- Any API error shown to a tester includes a request reference that appears in server logs.

## Rollback
From the EC2 host:
```bash
cd ~/macros
git log --oneline -5
git checkout <last-known-good-sha>
cd ~/deploy
APP_BUILD=<last-known-good-sha> docker-compose build macros
APP_BUILD=<last-known-good-sha> docker-compose up -d macros
curl --fail --show-error "$PRODUCTION_BASE_URL/healthz"
curl --fail --show-error "$PRODUCTION_BASE_URL/version"
```

If the database migration is the suspected cause, stop and restore from the latest verified database backup before restarting the app.

## Incident Notes
- Every API error response includes a `requestId`; ask beta users for that reference.
- Server logs are JSON lines with `requestId`, method, path, status, duration, and user id when available.
- `.github/workflows/production-smoke.yml` runs hourly and can include authenticated checks when `PRODUCTION_SMOKE_API_TOKEN` is set.
- Treat `/healthz` failures and sustained 5xx spikes as beta-stopping incidents.
