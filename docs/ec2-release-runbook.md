# EC2 Release Runbook

This is the production release path for the friends and family beta.

## Source Of Truth
- GitHub workflow: `server` job in `.github/workflows/release.yml`, calling the
  commit-pinned `jimgreco/release-tools/.github/workflows/server-release.yml`
- Release manifest: `.github/release/server.json` (format: release-tools `server/README.md`)
- Image: `ghcr.io/jimgreco/macro_tracker:<full sha>` (ARM64, built in CI)
- Remote app checkout `~/macros`: no longer used by releases or backups
- Remote compose directory: `~/deploy`
- Remote service name: `macros`
- Production database: shared Docker Postgres container in the remote compose stack (`shared_db`)
- Logical DB backup: shared off-server backup in `jimgreco/consolidated-deploy` (timer `backup-pilot-macrovana`)
- Off-host backup layer: AWS DLM policy `policy-06a5ef1af3cbbc321` snapshots the tagged EC2 instance daily at 03:00 UTC and retains 7 snapshots.
- Smoke endpoints: `/healthz` and `/version`

## Required GitHub Secrets
- `EC2_SSH_KEY`: private key for the deploy user.
- `EC2_USER`: deploy user on the EC2 host.
- `EC2_HOST`: EC2 hostname or IP.
- `EC2_SSH_KNOWN_HOSTS`: pinned host key line(s); the release fails closed without it.

## Production Env Inventory
Set these on the remote compose environment for the `macros` service:
- `NODE_ENV=production`
- `PORT`
- `APP_BASE_URL=https://macrovana.com`
- `APP_BUILD` or `GITHUB_SHA`
- `ADMIN_EMAILS` or `ADMIN_USER_IDS`
- `SESSION_SECRET`
- `SESSION_TTL_DAYS`
- `MOBILE_TOKEN_TTL_DAYS`
- `MOBILE_TOKEN_ROTATE_WITHIN_DAYS`
- `DATABASE_URL`
- `PGSSL=false`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL=claude-opus-5-5` (pinned by the deploy Compose override)
- `OPEN_FOOD_FACTS_USER_AGENT` (optional; identifies barcode lookup traffic; use `Macrovana/1.0 (https://macrovana.com)`)
- `AI_DAILY_MEAL_PARSE_LIMIT`
- `AI_DAILY_WORKOUT_PARSE_LIMIT`
- `AI_DAILY_PHOTO_PARSE_LIMIT`
- `AI_DAILY_ANALYSIS_LIMIT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL=https://macrovana.com/auth/google/callback`
- `GOOGLE_IOS_CLIENT_ID`
- `APPLE_CLIENT_ID`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY`
- `APPLE_REDIRECT_URI=https://macrovana.com/auth/apple/callback`
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
- `STRIPE_REQUEST_TIMEOUT_MS` (optional; defaults to `15000`)
- `WEBHOOK_MAX_ATTEMPTS` (optional; defaults to `8`)
- `WEBHOOK_LEASE_MS` (optional; defaults to `120000`)
- `WEBHOOK_BATCH_SIZE` (optional; defaults to `10`)
- `WEBHOOK_POLL_INTERVAL_MS` (optional; defaults to `1000`)
- `WEBHOOK_BASE_BACKOFF_MS` (optional; defaults to `1000`)
- `WEBHOOK_MAX_BACKOFF_MS` (optional; defaults to `900000`)
- `WEBHOOK_SHUTDOWN_TIMEOUT_MS` (optional; defaults to `30000`)
- `STRIPE_RECONCILIATION_INTERVAL_HOURS` (optional; defaults to `24`)
- `INTERNAL_SYNC_SECRET`
- `WORKOUT_API_URL`

## Oura API Setup

1. Register the production OAuth redirect exactly as `https://<production-domain>/auth/oura/callback` in the Oura developer application.
2. Set `OURA_WEBHOOK_URL` to `https://<production-domain>/webhooks/oura`. The app creates and renews create/update/delete subscriptions for each enabled data type.
3. Generate separate high-entropy values for `OURA_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) and `OURA_WEBHOOK_VERIFICATION_TOKEN` (`openssl rand -hex 32`). Never reuse the Oura client secret for token encryption.
4. Confirm the Oura application is approved for the intended user count; unapproved applications have a small development-user limit.
5. After deploy, connect a test account from Settings, confirm the 90-day backfill completes, and check that `/api/v1/oura/status` reports `updateMode: webhook` and active subscriptions.

The integration requests `personal` only to obtain Oura's opaque user id for webhook routing; age, height, weight, biological sex, and Oura email are discarded. Stored Oura records contain allowlisted aggregate metrics and omit raw heart-rate, HRV, movement, phase, and MET sample arrays. Imported records remain until the user disconnects Oura or deletes the DailyMacros account. Oura aggregates may be combined with other app history only for deterministic in-app trends and coaching. Oura API data and derived values must remain outside OpenAI, Apple Foundation Models, and every other AI/ML model.

## Pre-Deploy Checks
Run locally before merging to `main`:
```bash
npm run test:check
npm audit --omit=dev
```

Confirm the app has a recent restorable database backup:
- The active production database is Dockerized Postgres on the EC2 host, not RDS.
- The shared nightly backup uploads a verified dump to S3 under `macrovana/`; its hourly freshness workflow in `consolidated-deploy` alerts if it is stale.
- From the EC2 host, run `systemctl list-timers backup-pilot-macrovana.timer` to confirm the next scheduled backup.
- If the release includes schema changes, run `sudo systemctl start backup-pilot-macrovana.service` before deploy and update `scripts/backup-pilot/tables.json` in `consolidated-deploy` if tables change.
- In AWS, confirm the DLM policy still reports completed snapshots for the consolidated EC2 volume and the most recent snapshot is less than 26 hours old.

Confirm the workflow secrets are present:
```bash
gh secret list
```

## Deploy
Push or merge to `main`. After `verify`, the workflow will:
1. Build and push `ghcr.io/jimgreco/macro_tracker:<sha>` (linux/arm64).
2. Read the live `https://macrovana.com/version` `appBuild` for the log.
3. Pipe release-tools `server/release.py` over the pinned SSH connection. It
   takes both host release locks, rebuilds the Compose invocation recorded on
   the running `macros` container (reconstructing the `APP_BUILD` interpolation
   from the live container) and refuses on any config-hash drift, pulls the
   image, writes `~/deploy/releases/macros-image-<sha>.json` (image and
   `APP_BUILD=<sha7>` only; older `app-release-*.json` overlays are dropped
   from the chain only if nothing else changes), tags the previous image
   `macros-rollback:<time>-<container>`, takes a verified `pg_dump -Fc` of
   `macro_tracker` into `~/deploy/backups/macros/macros-*-before-<sha>.dump`,
   then recreates only `macros` with `--no-deps --no-build`.
4. Require `/healthz` and `/version` `appBuild == <sha7>` inside the container,
   rolling back to the previous image on failure, then confirm the public
   `/version` reports the new build. Records: `~/deploy/release-records/macros-<sha>.json`.
5. The release itself does not run `scripts/production-smoke.sh`; run it by hand
   when needed. Uptime is monitored by the shared check in `jimgreco/consolidated-deploy`.

Releases never run migrations. A schema change is applied beforehand with the
owner-run `npm run db:migrate` (or `db:migrate:fiber`) and `MIGRATION_DATABASE_URL`,
as described in `docs/database-runtime-access.md`.

### Optional-feature schema (Apple Health daily metrics)

Some tables ship as contract `optionalFeatures` (`src/schema-contract.json`):
startup passes whether the feature's objects are entirely absent (feature off)
or exactly match; partial or drifted structure still fails startup. The first is
`health_daily_metrics` (ledger version 3; the required contract stays v2), so
the release that adds it is safe to merge before the migration:

1. Merge/release normally. Until the table exists, `GET /api/health-metrics`
   returns empty with `"enabled": false`, `POST /api/health-metrics` returns
   503, the weekly summary `health` blocks are null, and export/deletion skip
   the table. Nothing else changes for existing users.
2. When ready, on the EC2 host take a fresh backup
   (`sudo systemctl start backup-pilot-macrovana.service`) and add
   `health_daily_metrics` to `scripts/backup-pilot/tables.json` in
   `consolidated-deploy` if that list is used for verification.
3. Run the one-shot additive migration with the owner-supplied migration
   connection (never the runtime `DATABASE_URL`), from a checkout/image of the
   released commit:
   ```bash
   MIGRATION_DATABASE_URL=... npm run db:migrate:health-metrics
   ```
   It requires the v2 ledger, takes the schema advisory lock (2 s lock
   timeout, 30 s statement timeout), creates the empty table and its indexes,
   grants `macrovana_runtime` only if that role exists, validates the full
   contract and records version 3 plus `schema_migrations`
   `2026-11-15_health_daily_metrics`. Replaying it is a validated no-op. If the
   runtime connects as a role other than the table creator, grant it
   `SELECT, INSERT, UPDATE, DELETE` on the table and `USAGE` on
   `health_daily_metrics_id_seq` (see `docs/database-access-proposal.sql`).
4. No restart is needed: the running server re-probes the optional table at
   most once a minute and turns the feature on. Verify with an authenticated
   `GET /api/health-metrics?scope=week` (`"enabled": true`).

Rollback: older images ignore the extra table. Do not drop it; account
deletion removes its rows.

#### Version 4: more Apple Health metrics (`db:migrate:health-metrics-v2`)

Version 4 adds walking + running distance, flights climbed, walking speed,
walking step length, heart rate (daily average and daily minimum), respiratory
rate and blood oxygen to the same table by widening its `metric` CHECK. Nothing
else changes: same table, columns, indexes, owner (`macrovana_owner`) and grants,
so the backup's `tables.json`, owner check and ACL comparison are unaffected.

The contract lists the version-3 CHECK as an accepted `alternative` (with
`"version": 3`), so a release with this change starts on production's current
v3 table. While the table is still v3, the server keeps serving every original
metric and skips the newer ids: `POST /api/health-metrics` returns 200 with
them counted in `skipped` and named in `unsupportedMetrics` (iOS keeps its
365-day backfill pending until they are accepted). The running server re-probes
the structure at most once a minute, so it starts accepting the new ids within a
minute of the migration, without a restart.

Order matters, because images **older** than this release require the exact
version-3 CHECK and refuse to start once it is widened:

1. Merge/release this change normally and confirm `/healthz` and `/version`.
   Do not run the migration while an older image is the live or rollback
   target you intend to use.
2. Take a fresh backup: `sudo systemctl start backup-pilot-macrovana.service`.
3. From a checkout/image of the released commit, with the owner-supplied
   migration connection running as the object owner (never the runtime
   `DATABASE_URL`):
   ```bash
   MIGRATION_DATABASE_URL='postgres://...?options=-c%20role%3Dmacrovana_owner' \
     npm run db:migrate:health-metrics-v2
   ```
   In one transaction it requires the v2 ledger and a valid v3 or v4 table
   (any other CHECK is refused as drift; if the table is missing it runs the
   v3 step first), takes the schema advisory lock (2 s lock timeout, 30 s
   statement timeout), drops the v3 CHECK and adds
   `health_daily_metrics_metric_check` with the wider list, verifies the table
   owner is unchanged and the structure is now version 4, then records ledger
   version 4 and `schema_migrations` `2026-11-15_health_daily_metrics_more_metrics`.
   Existing rows are not read or rewritten (they already satisfy the wider
   CHECK); the lock is held only for the constraint swap and validation.
   A replay prints "already v4; nothing changed". The runtime role cannot run
   it (no ownership, no ledger write).
4. Within a minute, an iPhone sync uploads the new metrics; verify with an
   authenticated `GET /api/health-metrics?scope=week` (the new day fields, such
   as `walkingRunningDistanceM` and `heartRateAvgBpm`, are no longer all null).

Rollback floor: after step 3 the oldest image that can start is this release.
Rolling the image back further first needs the schema returned to v3, which
deletes the new metrics' rows. Only with explicit approval and a fresh backup,
as `macrovana_owner`:
```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
SELECT pg_advisory_xact_lock(hashtext('macros:schema'));
DELETE FROM public.health_daily_metrics
 WHERE metric NOT IN ('steps', 'active_energy_kcal', 'exercise_minutes',
                      'resting_heart_rate_bpm', 'hrv_sdnn_ms', 'vo2max_ml_kg_min');
ALTER TABLE public.health_daily_metrics DROP CONSTRAINT health_daily_metrics_metric_check;
ALTER TABLE public.health_daily_metrics ADD CONSTRAINT health_daily_metrics_metric_check
  CHECK (metric IN ('steps', 'active_energy_kcal', 'exercise_minutes',
                    'resting_heart_rate_bpm', 'hrv_sdnn_ms', 'vo2max_ml_kg_min'));
DELETE FROM public.app_schema_versions WHERE app = 'macros' AND version = 4;
DELETE FROM public.schema_migrations WHERE name = '2026-11-15_health_daily_metrics_more_metrics';
COMMIT;
```
An older image that is already running when the migration commits keeps
serving (it probed the table at startup and never re-checks); it only fails on
its next start.

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
A failed health check rolls back automatically. To return to an earlier good
commit deliberately, re-release it: its GHCR image is still tagged by SHA, and
`release.py` replaces only `macros` with the same guards. Previous images stay
tagged `macros-rollback:*` and each release record names the image it replaced.

If the database migration is the suspected cause, stop and restore from the latest verified database backup before restarting the app.

## Incident Notes
- The shared database connection limit was raised from 20 to 60 on 2026-09-23 after concurrent apps exhausted its slots and `/api/v1/today` failed. The durable host config is `~/deploy/postgresql.conf`, bind-mounted into `shared_db`; current memory settings are `shared_buffers=256MB` and `work_mem=4MB` on the 2 GiB host. Preserve these settings during host/container recreation, and budget connection pools across all shared apps before increasing individual pool limits. Verification held 25 concurrent read-only connections and rebuilt the affected account Today snapshot.
- Every API error response includes a `requestId`; ask beta users for that reference.
- Server logs are JSON lines with `requestId`, method, path, status, duration, and user id when available.
- Verified Stripe deliveries are acknowledged only after the minimized event is committed to `webhook_events`. Processing is leased from PostgreSQL and resumes after a process restart or stale lease.
- Graceful shutdown stops new provider-event claims, drains the active reconciliation/worker attempt for up to `WEBHOOK_SHUTDOWN_TIMEOUT_MS`, then closes the database pool. An attempt still running at the bound leaves its database lease behind; the next process recovers it after `WEBHOOK_LEASE_MS`.
- Run `scripts/production-smoke.sh` by hand for smoke checks; it includes authenticated checks when `API_TOKEN` is set.
- Treat `/healthz` failures and sustained 5xx spikes as beta-stopping incidents.
- The public privacy policy is served at `/privacy` and the repo copy lives in `docs/privacy-policy.md`.

## Provider Event Operations

Use an API token belonging to an account on `ADMIN_EMAILS` or `ADMIN_USER_IDS`.
The operations response contains counts and fixed failure codes, never retained
provider payloads:

```bash
BASE_URL=https://your-production-domain
ADMIN_API_TOKEN=<admin-api-token>
curl --fail --show-error \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  "$BASE_URL/api/v1/admin/webhooks"
```

Inspect `backlogCount`, `oldestBacklogAgeSeconds`, `failureCount`,
`exhaustedCount`, provider-level `lastSuccessAt`, and the bounded `failures`
list. A failed event can be reset only while it is still in `failed` state:

```bash
EVENT_ID=<failed-event-id>
curl --fail --show-error -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  "$BASE_URL/api/v1/admin/webhooks/$EVENT_ID/retry"
```

To repair one account from canonical Stripe state, enqueue a durable
reconciliation job:

```bash
USER_ID=<canonical-user-id>
curl --fail --show-error -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  "$BASE_URL/api/v1/admin/webhooks/stripe/reconcile/$USER_ID"
```

The server also scans current Stripe subscriptions once after startup and every
`STRIPE_RECONCILIATION_INTERVAL_HOURS`. Checkout-created subscriptions carry
the canonical app user id in Stripe metadata, allowing this scan and an
out-of-order subscription webhook to recover a missing local customer mapping.

Processed minimized receipts are deleted after 30 days. Retry-exhausted poison
receipts are retained for 90 days for incident analysis, then deleted. Pending
or actively leased receipts have no purge deadline: deleting one would violate
the durable-acknowledgment guarantee.

## JIM-50 / JIM-51 / JIM-52 acceptance

Local verification does not close the real-ring acceptance requirement. After releasing the native and server changes, use one connected test account:

1. In iOS, run Apple Health sync and export Settings > Diagnostics. Confirm actual source display names, bundle identifiers and sample types in `healthkit-sources` entries. The export contains query windows/counts and sanitized errors, never sample values. Oura classification uses the observed source name, with the actual bundle retained as transport evidence.
2. Copy web Account & Privacy > Oura > Copy sync diagnostics (also included in the native diagnostic export). Save the before snapshot from `/api/v1/oura/evidence`.
3. Sync the physical ring in Oura. Capture the after snapshot: a signed webhook receipt must progress to processed, canonical document update timestamps must advance, and the same provider day, source, metrics and freshness must display in web and iOS Sleep. Counts alone or a manual reconciliation are not proof of a real ring update.
4. Save a subjective annotation on web and confirm it on iOS. Replay direct sync and Apple Health sync in both orders; verify no additional biological sleep/workout and no annotation loss. Verify Apple Watch data still imports independently, including naps and a DST/travel night.
5. With the test account's agreement, exercise revoke/reconnect and disconnect. Imported direct Oura documents and workout projections are deleted on disconnect. Minimal coverage days and ignored identifiers remain so HealthKit cannot recreate covered history. A disconnected/revoked source may resume only for uncovered provider days; a transient error waits for the 72-hour last-success grace. Account deletion removes all markers.
6. Keep `OURA_INCLUDE_WORKOUTS=false` until the real-device deduplication check passes. When opted in, only direct workout calories count as workout calories; all-day activity energy never changes workouts or macro targets. Direct workout projections are excluded from AI snapshots and HealthKit exports.

Run `TEST_DATABASE_URL=... node --test test/health-reconciliation.test.js` for transactional replay/tombstone/annotation tests, in addition to the standard fresh schema, legacy upgrade and native test gates. Fixtures and simulator screenshots must be labeled as local evidence, never real-ring acceptance.

## Release safety gate

A main push runs `verify` and, when it passes, releases to EC2 and
uploads a TestFlight build. Release-tools' `release.py` performs the live-host
preflight itself and fails closed on drift, a missing Compose input, an
installed Compose version that differs from the one that created the container,
less than 1 GiB free, or an unreadable backup. It never edits `.env`, shared
Compose files, grants or credentials, and never prunes images. To re-release a
commit, dispatch `Release` on main (the `server` and `ios` inputs default
true). TestFlight upload is a separate result from an installed or App Store release.

Pre-hardening Macrovana images were confirmed to include host configuration,
key material, and data. Do not reuse them for routine rollback.

## Private build-context exclusions

The application reads public local assets, PostgreSQL data, and S3 photos; host
`data` and `backups` folders are not runtime data sources. Keep them, `.env*`,
private PEM/key files, and credential folders out of Docker contexts at every
depth. Existing host files are preserved. The reviewed public RDS CA bundle is
explicitly allowlisted for optional `PGSSL_CA_FILE` users; CI verifies it contains
only valid public certificates and is preserved byte-for-byte in the image.

The Docker gate builds an isolated clean Git archive with exclusive-created
synthetic sentinels and asserts all private paths are absent. It never injects
fixtures into the source checkout or host. Cleanup removes only its temporary
archive and disposable inspection container. Failed fixture creation/builds fail
the gate. Actual Docker exclusions require the remote CI build result, separate
from local fixture-orchestration tests.

Pre-hardening Macrovana images were confirmed to include host configuration,
key material, and data. Treat them as sensitive recovery material: do not publish,
prune indiscriminately, or reuse them for routine rollback. Prefer a clean forward
rebuild. This change neither removes existing host files nor rotates credentials.
