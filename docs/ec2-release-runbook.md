# EC2 Release Runbook

This is the production release path for the friends and family beta.

## Source Of Truth
- GitHub workflow: `.github/workflows/deploy.yml`
- Remote app checkout: `~/macros`
- Remote compose directory: `~/deploy`
- Remote service name: `macros`
- Production database: shared Docker Postgres container in the remote compose stack (`shared_db`)
- Logical DB backup timer: `dailymacros-db-backup.timer`
- Off-host backup layer: AWS DLM policy `policy-06a5ef1af3cbbc321` snapshots the tagged EC2 instance daily at 03:00 UTC and retains 7 snapshots.
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
- `PGSSL=false`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPEN_FOOD_FACTS_USER_AGENT` (optional; identifies barcode lookup traffic)
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
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `OURA_REDIRECT_URI`
- `OURA_TOKEN_ENCRYPTION_KEY`
- `OURA_WEBHOOK_URL`
- `OURA_WEBHOOK_VERIFICATION_TOKEN`
- `OURA_INCLUDE_WORKOUTS=false` (optional; keep off until direct/HealthKit workout reconciliation is enabled)
- `OURA_RECONCILIATION_MINUTES=60` (optional)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `INTERNAL_SYNC_SECRET`
- `WORKOUT_API_URL`

## Oura API Setup

1. Register the production OAuth redirect exactly as `https://<production-domain>/auth/oura/callback` in the Oura developer application.
2. Set `OURA_WEBHOOK_URL` to `https://<production-domain>/webhooks/oura`. The app creates and renews create/update/delete subscriptions for each enabled data type.
3. Generate separate high-entropy values for `OURA_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) and `OURA_WEBHOOK_VERIFICATION_TOKEN` (`openssl rand -hex 32`). Never reuse the Oura client secret for token encryption.
4. Confirm the Oura application is approved for the intended user count; unapproved applications have a small development-user limit.
5. After deploy, connect a test account from Settings, confirm the 90-day backfill completes, and check that `/api/v1/oura/status` reports `updateMode: webhook` and active subscriptions.

The integration requests `personal` only to obtain Oura's opaque user id for webhook routing; age, height, weight, biological sex, and Oura email are discarded. Stored Oura records contain allowlisted aggregate metrics and omit raw heart-rate, HRV, movement, phase, and MET sample arrays. Imported records remain until the user disconnects Oura or deletes the DailyMacros account. Oura aggregates may be combined with other app history for trends, coaching, and user-requested analysis under the app's normal AI disclosures.

## Pre-Deploy Checks
Run locally before merging to `main`:
```bash
npm run test:check
npm audit --omit=dev
```

Confirm the app has a recent restorable database backup:
- The active production database is Dockerized Postgres on the EC2 host, not RDS.
- The nightly systemd timer runs `scripts/production-db-backup.sh` at 02:35 UTC so a logical dump exists before the 03:00 UTC DLM EBS snapshot window.
- From the EC2 host, run `systemctl list-timers dailymacros-db-backup.timer` to confirm the next scheduled logical backup.
- For a manual proof, run `cd ~/macros && RESTORE_DRILL=true DEPLOY_DIR=~/deploy scripts/production-db-backup.sh`.
- Confirm the script reports a successful restore drill and retains a fresh dump under `~/deploy/backups/macros/`.
- If the release includes schema changes, run a fresh logical backup with `RESTORE_DRILL=true` before deploy.
- In AWS, confirm the DLM policy still reports completed snapshots for the consolidated EC2 volume and the most recent snapshot is less than 26 hours old.

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
5. Run `scripts/production-smoke.sh` against `PRODUCTION_BASE_URL`.

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

With `API_TOKEN`, the smoke script now creates disposable meal, saved quick-add, weight, sleep, and optional sexual-activity records, updates the editable records, verifies dashboard visibility where applicable, and deletes the created records before exit. Use a dedicated smoke account so any interrupted cleanup is isolated from real beta-user data.

Then verify:
- Web login completes.
- Dashboard loads.
- One meal or workout parse succeeds.
- A known packaged-food barcode lookup returns a product, or a missing barcode shows a clear not-found error.
- iOS TestFlight token auth reaches the same backend.
- iOS onboarding can be skipped or saved, daily reminders can be toggled, pending-log sync shows zero after a clean online run, and Settings shows matching app/API build metadata.
- Account export returns a JSON file for the smoke account.
- Account deletion is tested only with a disposable beta account.

## TestFlight Verification
For beta-facing iOS releases, verify on a real device after the TestFlight build processes:
- Google and Apple sign-in both reach the production backend.
- Macro logging, workout logging/sync, Health sleep logging, Settings export, and build metadata load.
- Daily log reminder scheduling, pending-log retry, first-run target setup, and diagnostics export work on device.
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
- Deploy and `.github/workflows/production-smoke.yml` run `scripts/production-smoke.sh`; both include authenticated checks when `PRODUCTION_SMOKE_API_TOKEN` is set.
- Treat `/healthz` failures and sustained 5xx spikes as beta-stopping incidents.
- The public privacy policy is served at `/privacy` and the repo copy lives in `docs/privacy-policy.md`.
