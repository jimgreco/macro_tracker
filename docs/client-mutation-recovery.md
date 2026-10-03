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
