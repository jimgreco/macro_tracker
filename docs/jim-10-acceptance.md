# JIM-10 production acceptance

Production and device evidence captured September 8, 2026 (America/New_York; evidence timestamps below are UTC). Linear status refreshed September 9, 2026. Operational values below describe that captured snapshot.

JIM-10 is the umbrella for JIM-50, JIM-51, and JIM-52. Its September 8 scope supersedes the older design draft: no new AI recovery/association engine, no Oura API data in model inputs, and disconnect deletes imported Oura data. The implementation is deployed as `23a58422811745ebe2e3d8bed14cb726510e32ad` through [PR #15](https://github.com/jimgreco/macro_tracker/pull/15). [Required CI and Release](https://github.com/jimgreco/macro_tracker/actions/runs/34298275837) passed, including EC2 smoke checks and successful upload of TestFlight build 250.

## Verified in this acceptance pass

- Linear: JIM-10 and JIM-52 are In Progress; JIM-50 was reopened to In Progress for its remaining physical-device acceptance; JIM-51 remains Done for the shipped recovery UI. Ticket status is not physical-device acceptance evidence.
- Production has one connected Oura account. Personal, daily, and stress scope grants are present. All 21 create/update/delete subscriptions for the seven enabled data types are registered and expire December 8, 2026. Direct workout import remains disabled.
- Canonical records exist for detailed sleep, daily sleep/readiness/activity/stress/resilience, and sleep-time recommendations. These checks read only source types, counts, and operational timestamps; no health measurements or credentials were copied into this report.
- The retained webhook inbox contained 3,667 processed Oura deliveries and no other status groups at the captured snapshot. This describes retained receipts, not lifetime delivery history.
- Three recent webhook deliveries join to their exact canonical provider record, with the canonical write between receipt and processing completion:

| Type | Received (UTC) | Canonical write (UTC) | Processed (UTC) |
| --- | --- | --- | --- |
| daily_activity update | 2026-09-09 01:55:15.654 | 2026-09-09 01:55:16.772 | 2026-09-09 01:55:16.776 |
| daily_stress update | 2026-09-09 01:45:35.513 | 2026-09-09 01:45:36.607 | 2026-09-09 01:45:36.611 |
| daily_stress update | 2026-09-09 01:45:34.521 | 2026-09-09 01:45:35.396 | 2026-09-09 01:45:35.404 |

The production receipt route verifies timestamp plus exact raw body signature before writing the inbox. An unsigned POST to the live webhook endpoint returned HTTP 401. The existing receipts establish real signed provider delivery to canonical storage; they do not establish when the physical ring synced or that both clients displayed the result.

- The paired physical iPhone reports Macrovana version 1.0, build 250 installed.
- At the captured snapshot, Apple Health sleep and workout Read/Write choices were off on the connected account. No source metadata rows had arrived for those types. Preferences were left as chosen.
- No previously exported diagnostic file was available at the app's temporary export path. Actual Oura HealthKit source identifiers and native display parity have therefore not been captured.

## Remaining physical-device acceptance

1. Sync the ring in the Oura app and note when it completes. Compare before/after sanitized sync evidence with a new signed receipt and matching canonical write; a manual Macrovana reconciliation alone is not a webhook test.
2. Open Macrovana Health > Sleep on the iPhone and web. Confirm matching provider day, source, recovery values, and freshness. Save a subjective annotation in one client and confirm it in the other without copying provider measurements into an AI review.
3. To exercise HealthKit reconciliation, enable Apple Health Read for sleep/workouts in Settings > Data Sources only if the account owner chooses to test those transports, and grant the corresponding system access. Run Health > Sleep's sync button, then Workouts sync. Export Settings > Diagnostics to capture actual source names/bundles and sample types/counts. Replay both transport orders and verify annotation/deletion preservation and independent non-Oura sources. Return access choices to the owner's preferred values after the test.
4. Revoke/reconnect and disconnect/delete acceptance must use a test account whose owner agrees to the data removal. Do not disconnect the current account merely to collect evidence. Verify retained coverage prevents historical reimport, then reconnect and confirm current data and annotations follow the documented rules.
5. Keep direct workout import off until physical-device deduplication passes. The broader JIM-10/JIM-52 acceptance remains incomplete until these device-dependent checks are recorded.

See [the release runbook](ec2-release-runbook.md#jim-50--jim-51--jim-52-acceptance) for the test sequence and [local validation](jim-50-52-validation.md) for fixture, database, native, and browser evidence.
