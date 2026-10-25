# Fiber tracking and Quick Add backfill

Fiber is nullable grams for the stated consumed amount. Null means unknown, 0 means an explicit zero estimate/reading. It is already part of carbohydrates; do not count its calories again. Entry validation rejects negative, infinite, boolean and over-5000 g values. Older clients may omit fiber; editing an existing item must preserve its fiber in that case. An explicit null clears it.

All new food parsing requests include estimated fiber or null. Barcode lookup reads Open Food Facts fiber for the corresponding serving or 100 g basis; absent fiber remains unknown. Remembered corrections scale known fiber using matching quantity units and retain a parsed estimate when the old correction has none.

Daily aggregates are independent of entry pagination. `fiber` is null if any food lacks it; `fiberKnownGrams`, `fiberKnownCount`, `fiberItemCount` describe partial coverage. A day marked Complete can still have incomplete fiber evidence. Web fiber averages require both Complete and full fiber coverage. Account exports include fiber in entries, saved items and corrections; scoped downstream consumers must retain these fields rather than coerce null to zero.

Saved multi-item Quick Adds contain per-meal-unit component fiber. Their stored parent total is the component sum times saved quantity, and logging applies the requested multiplier once. The parent fiber editor is derived for these meals; edit individual component food values in the meal queue before saving a new template. The backfill script writes each component and recomputes parent totals.

## Upgrade and rollback

Fresh schema initialization includes nullable `fiber DOUBLE PRECISION` on `entries`, `saved_items`, and `food_corrections`. Runtime schema contract is v2. Existing databases must already have the compatibility ledger (adopted v1) before the explicit upgrade:

```sh
npm run db:migrate:fiber
```

The owner must securely supply `MIGRATION_DATABASE_URL` to this one-shot process. It never falls back to runtime credentials. The transaction uses the schema advisory lock, 2-second lock timeout and 30-second statement timeout, adds only the three nullable columns, validates the full contract and records v2. Existing nutrition rows remain null. No role/credential or shared-stack changes are part of this migration. Existing table-level DML grants cover the additive columns; column-specific grants require owner review. Runtime receives no migration credentials.

Run the existing Required Checks and approved release workflow for web/native deployment. Retain v1 ledger and the prior separation-aware image; v1 ignores added columns. Do not drop columns on rollback. The additive migration does not authorize broader ownership/credential cutover.

## Account-specific backfill

Personal plans belong outside the repo. The October 25 plan/snapshot/review are in `~/code/macros-analysis/checkins/2026-10-25/fiber-backfill/`. It covers 41 live saved Quick Adds, preserves their current calorie/protein/carbohydrate/fat values, and includes a 30 g fiber target effective October 25. All estimates and assumptions are recorded; uncertain brands/recipes need label verification. No historical consumed entries are backfilled.

After migration, securely supply the normal app DML connection as `FIBER_BACKFILL_DATABASE_URL`. Review the JSON first. Run dry-run validation, then apply the same plan:

```sh
node scripts/backfill-quick-add-fiber.js /absolute/path/reviewed-plan.json
node scripts/backfill-quick-add-fiber.js /absolute/path/reviewed-plan.json --apply
```

The script locks only the account's listed live saved rows, aborts the whole transaction on stale snapshots or existing conflicting fiber, marks `source_detail` with `fiber_estimate:<date>`, and is replay-safe for an identical applied plan. It rejects changes to non-fiber component fields. It preserves historical entries, IDs, usage counts and existing non-fiber targets. The JSON before snapshot is the recovery record; do not revert without checking for subsequent user edits.

Verify through the app: list the 41 items, inspect component totals and the 30 g target. Report preparation, migration, backfill, web deployment and TestFlight separately. Do not call a prepared plan applied.

## Local verification (October 25, 2026)

- No-database checks: 391 passed, 9 intentionally skipped.
- PostgreSQL integration suite: 37 passed; focused fiber lifecycle also passed after adding target-history and legacy component-edit checks.
- Disposable v1-to-v2 additive migration and replay passed, retaining v1 compatibility metadata and existing nutrition values.
- All 41 proposed Quick Adds passed a local dry-run/apply/replay rehearsal, including the 30 g target. Production has not been mutated.
- iOS simulator build passed; web and simulator daily fiber/target screens were visually inspected. No physical-device, CI, deployment, or TestFlight claim.

The user explicitly approved clearly marked estimates for unlabeled foods. The remaining live dependency is securely supplied migration access, followed by the existing release workflow and account-specific backfill verification.
