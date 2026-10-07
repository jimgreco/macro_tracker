# Client mutation receipt recovery

Replayable database routes with `X-Client-Mutation-Id` use `runClientMutation`. All SQL effects and the completed receipt commit in the same PostgreSQL transaction. The HTTP response is withheld until commit. The existing `(user_id, client_mutation_id)` key and request hash remain the replay identity; no schema or data rewrite is required.

The transaction advisory lock is a database-owned, fenced lease. A competing retry waits up to five seconds, then receives a retryable “still processing” response. Statements renew database activity; the 30-second idle transaction timeout ends a stalled lease without needing a separate persisted heartbeat. Each statement is limited to 15 seconds and the request transaction to 60 seconds. Connection loss rolls back the effects and claim, releases the lock, and lets the same id retry. A lost response after commit replays the completed receipt. Never steal an old claim based only on its age.

Existing transaction helpers receive scoped clients: `BEGIN`, `COMMIT`, and `ROLLBACK` use savepoints, so a nested helper cannot commit ahead of the receipt. SQL attempted by a callback after completion, deadline, or rollback is rejected rather than routed to a fresh connection. Error responses roll back their effects and claim. Keep replayable handlers on the JSON-response contract; external upload/auth/payment operations are excluded.

Check-in deletion still includes idempotent S3 object deletion. PostgreSQL cannot undo an object deletion after rollback. Retrying deletion is safe, but this change does not provide an S3 transactional outbox or restore a deleted photo.

## Existing processing receipts

A committed `processing` row predating this protocol has an unknown outcome: its original health record may already exist. It returns `MUTATION_RECOVERY_REQUIRED` with `recoveryRequired: true`. The message retains “still processing” so existing iOS versions keep the queued change instead of discarding it. The row and client work remain preserved; automatic expiry, receipt deletion, or resubmission with a new UUID could duplicate health records and are forbidden recovery shortcuts.

Before any separately authorized repair, establish the exact account, request identity, original effect and response from trustworthy evidence. Reconstruct a completed receipt only if the effect is proved; re-execute only if absence of the effect is proved. Otherwise retain the quarantine. Request bodies are not stored in the receipt, so some historical cases may require the user's retained client data and explicit reconciliation. This patch performs no historical repair.

Roll out all mutation writers before treating the new atomicity guarantee as fleet-wide. An old instance can still create a pre-atomic receipt during a mixed deployment. No database migration is needed; old completed receipts continue to replay. Retain ordinary database backup/recovery and receipt-retention policies.

## Validation

`test/client-mutation-transaction.test.js` requires a loopback `TEST_DATABASE_URL` whose database name ends in `_test`. It tests concurrent retries, partial-write and receipt failures, actual PostgreSQL connection termination, idle lease expiry, late callback fencing, real bulk nutrition savepoints, HTTP commit ordering and legacy quarantine. It uses only synthetic records. Run it through `npm run test:db:integration`; the normal suite runs its non-database tests too.

## Native review and preservation (October 7)

Settings → Review & Recover Offline Work (also in Account → Sync) shows only the active account's protected requests. Requests are now journaled before the first network attempt. A late response from another sign-in generation cannot revoke the new credential, clear current work, or update the new session. Rejected/ambiguous requests are held for review, rather than silently discarded; an automatic flush skips them. Retry explicitly releases the exact original UUID/body for another attempt. The server still refuses unknown legacy processing receipts, so this control cannot authorize a historical repair or manufacture a new UUID.

Set aside removes a request from retry eligibility while preserving its recoverable local copy. The same screen can explicitly retry it later. An in-flight success cannot erase a copy that was set aside during the request. Local recovery export contains this account's requests only. Legacy ownerless contents require a typed canonical account ID and explicit original-account confirmation before local review/export; this assertion is not independent proof. They cannot be adopted or replayed through this screen. No support upload or irreversible deletion happens automatically.

The old `pending_mutations_v1` UserDefaults value is now retained. Earlier releases removed it on initialization; already-deleted bytes cannot be reconstructed by this feature. Unreadable protected files are likewise retained and block overwriting writes until reviewed. Existing owned v2 files are moved by exact-byte rename to `pending-mutations-v3.json`; their ownership and UUIDs are unchanged. Held/archive state lives only at that new path so older clients cannot silently replay it. A later v2 file produced after a downgrade stays quarantined and is not merged. Do not downgrade native clients as a recovery procedure.

This lane leaves the atomic receipt implementation and restricted-runtime startup/schema preparation boundary unchanged. It requires no database migration, credential change or provider configuration. Deploy only after the parent coordinates the exact release and shared-host slot; retain all existing checks and native release gates.

Synthetic coverage lives in `OfflineMutationStoreTests`: malformed/legacy preservation, account changes including A→B→A, exact-byte migration, archive/late-ack safety, duplicate UUIDs, ambiguous receipt holding and same-ID retry through an intercepted real API client. `test/client-mutation-transaction.test.js` covers the real PostgreSQL receipt contract using only a loopback `_test` database.

Physical acceptance remains: on a disposable account/device fixture, inspect Settings/Account entry points, Dynamic Type and VoiceOver, protected-file behavior after locking/unlocking, app relaunch, export/share cancellation, account changes during requests, and retained legacy/ambiguous cases. Production/TestFlight success does not complete those checks. Before any real historical repair, review original account, exact request ID/body, trustworthy evidence of the existing effect or its absence, and the precise proposed repair. Unsupported/unproven cases remain quarantined. Actual recovery/deletion or sharing of real records needs that separately approved decision bundle.

Local validation of the October 7 candidate: 308 JavaScript checks passed (8 database opt-ins skipped there); all 14 focused PostgreSQL receipt checks passed on a disposable loopback `_test` database; 11 focused native recovery XCTest cases passed. The native tests include set-aside while a prior flush item is in flight, exact-request duplicate identity, initial check-in journaling and account-cancellation callbacks. Native visual interaction could not be completed because the Mac was locked; retain that acceptance item. Run the normal protected CI/release gates on the final integrated SHA before publishing.
