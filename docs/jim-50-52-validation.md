# JIM-50 / JIM-51 / JIM-52 local validation

September 8, 2026. Repository: Macrovana / Daily Macros. This document records validation performed before release; production deployment and TestFlight evidence are tracked separately in the release workflow.

## Implemented

- Source-specific HealthKit sleep sessions with observed source name/bundle metadata, measured awake duration, and a one-time account-scoped 90-day source-evidence pass before normal 30-day syncs.
- Transactional direct/HealthKit sleep and workout reconciliation, annotation preservation, durable user ignores, provider tombstones, and a 72-hour stale fallback grace that excludes covered history.
- Read-only direct workout projections, excluded from AI analysis/narration inputs and Apple Health exports; direct workout opt-in remains disabled by default pending real-device acceptance.
- Shared server-backed recovery values, source/day/freshness, week/month trends, read-only detail and subjective annotations on web and iOS. Naps contribute to daily sleep duration; missing metrics are not rendered as zero. Existing deterministic coaching thresholds remain unchanged.
- Copyable server sync evidence and native source diagnostics. Updated public privacy disclosure, account export/deletion inventory, and release runbook.

## Verified locally

- JavaScript syntax and suite: 292 passing, 5 opt-in tests skipped by the default command; relevant database suites were run separately below.
- Focused reconciliation/recovery suite with PostgreSQL: 6 passing, including concurrent import order, annotations, source independence, naps, DST, provider revisions, reconnects and tombstones. The Oura workout AI snapshot exclusion is exercised with a real database.
- PostgreSQL CI gate: 8 passing, including the 6 reconciliation/recovery cases; disposable legacy schema upgrade: 1 passing. The replay regression also verifies that a legacy deleted duplicate cannot hide its active neighbor while exact deleted IDs remain tombstones.
- Native build and executable simulator suite: 24 passing. A regression test checks the real recovery URL query construction and nullable metric decoding.
- Browser journeys and accessibility: 12 passing; another 4 accessibility checks passed with synthetic Oura records present.
- Visual inspection: rebuilt iPhone simulator recovery overview and detail; web at mobile width; web annotation save succeeded through the real local API. All health data used for these checks was synthetic fixture data.

Artifacts in `output/playwright/jim-50-52/`: `web-mobile.png`, `web-detail-mobile.png`, `ios-overview.png`, `ios-detail.png`.

## Still required for ticket acceptance

The connected physical iPhone's actual Oura `HKSourceRevision` identifiers and source behavior have not been observed in this task. No real ring update has been traced from signed production webhook delivery to a canonical record and matching web/iOS display. Real-device revoke/reconnect and transport fallback acceptance are also pending. JIM-50 and JIM-52 must remain open for those requirements; fixture tests, successful builds, and deployment alone cannot substitute for them.

Follow the JIM-50 / JIM-51 / JIM-52 acceptance section in `docs/ec2-release-runbook.md` after release. The new `/api/v1/oura/evidence` endpoint and Settings diagnostics provide sanitized before/after evidence without health values or credentials.
