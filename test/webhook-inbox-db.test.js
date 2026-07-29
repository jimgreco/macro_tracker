const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

test('PostgreSQL webhook inbox deduplicates, leases, recovers, and applies billing atomically', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  delete require.cache[dbPath];
  const db = require(dbPath);
  const runId = crypto.randomUUID();
  const userId = `webhook-integration-${runId}`;
  const providerPrefix = `integration-${runId}`;

  try {
    await db.initDb();
    await db.upsertUser({
      id: userId,
      provider: 'local-dev',
      providerUserId: userId,
      email: `${userId}@example.com`,
      name: 'Webhook Integration'
    });

    const duplicateReceipts = await Promise.all(
      Array.from({ length: 12 }, () => db.receiveWebhookEvent({
        provider: 'stripe',
        providerEventId: `${providerPrefix}-duplicate`,
        eventType: 'checkout.session.completed',
        userId,
        payload: {
          customerId: `cus-${runId}`,
          subscriptionId: `sub-${runId}`
        }
      }))
    );
    assert.equal(new Set(duplicateReceipts.map((event) => event.id)).size, 1);
    const duplicateCount = await db.getPool().query(
      `SELECT COUNT(*)::int AS count
       FROM webhook_events
       WHERE provider = 'stripe' AND provider_event_id = $1`,
      [`${providerPrefix}-duplicate`]
    );
    assert.equal(duplicateCount.rows[0].count, 1);

    for (let index = 0; index < 4; index += 1) {
      await db.receiveWebhookEvent({
        provider: 'stripe',
        providerEventId: `${providerPrefix}-concurrent-${index}`,
        eventType: 'customer.subscription.updated',
        userId,
        payload: { customerId: `cus-${runId}` }
      });
    }
    await db.receiveWebhookEvent({
      provider: 'oura',
      providerEventId: `${providerPrefix}-oura`,
      eventType: 'update',
      userId,
      payload: { dataType: 'sleep', objectId: `oura-${runId}` }
    });

    const [workerA, workerB] = await Promise.all([
      db.claimWebhookEvents({
        workerId: `${providerPrefix}-worker-a`,
        providers: ['stripe'],
        limit: 3,
        leaseMs: 60_000
      }),
      db.claimWebhookEvents({
        workerId: `${providerPrefix}-worker-b`,
        providers: ['stripe'],
        limit: 3,
        leaseMs: 60_000
      })
    ]);
    const concurrentClaims = [...workerA, ...workerB].filter(
      (event) => event.providerEventId.startsWith(providerPrefix)
    );
    assert.equal(new Set(concurrentClaims.map((event) => event.id)).size, 5);
    assert.equal(concurrentClaims.some((event) => event.provider === 'oura'), false);

    for (const event of concurrentClaims) {
      await db.markWebhookEventProcessed(event.id, event.workerId);
    }

    const ouraStillReceived = await db.getPool().query(
      `SELECT status
       FROM webhook_events
       WHERE provider = 'oura' AND provider_event_id = $1`,
      [`${providerPrefix}-oura`]
    );
    assert.equal(ouraStillReceived.rows[0].status, 'received');

    const staleReceipt = await db.receiveWebhookEvent({
      provider: 'stripe',
      providerEventId: `${providerPrefix}-stale`,
      eventType: 'invoice.payment_failed',
      userId,
      payload: { customerId: `cus-${runId}` },
      maxAttempts: 3
    });
    const [firstLease] = await db.claimWebhookEvents({
      workerId: `${providerPrefix}-crashed-worker`,
      providers: ['stripe'],
      limit: 1,
      leaseMs: 60_000
    });
    assert.equal(firstLease.id, staleReceipt.id);
    await db.getPool().query(
      `UPDATE webhook_events
       SET lease_expires_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [staleReceipt.id]
    );
    const [recoveredLease] = await db.claimWebhookEvents({
      workerId: `${providerPrefix}-recovery-worker`,
      providers: ['stripe'],
      limit: 1,
      leaseMs: 60_000
    });
    assert.equal(recoveredLease.id, staleReceipt.id);
    assert.equal(recoveredLease.attemptCount, 2);
    await db.markWebhookEventProcessed(recoveredLease.id, recoveredLease.workerId);

    const poisonReceipt = await db.receiveWebhookEvent({
      provider: 'stripe',
      providerEventId: `${providerPrefix}-poison`,
      eventType: 'customer.subscription.updated',
      userId,
      payload: { customerId: `cus-${runId}` },
      maxAttempts: 1
    });
    const [poisonLease] = await db.claimWebhookEvents({
      workerId: `${providerPrefix}-poison-worker`,
      providers: ['stripe'],
      limit: 1,
      leaseMs: 60_000
    });
    assert.equal(poisonLease.id, poisonReceipt.id);
    const exhausted = await db.markWebhookEventFailed(
      poisonLease.id,
      poisonLease.workerId,
      {
        errorCode: 'poison_fixture',
        retryDelayMs: 1_000
      }
    );
    assert.equal(exhausted.exhausted, true);
    assert.ok(new Date(exhausted.purgeAfter).getTime() > Date.now() + 89 * 24 * 60 * 60 * 1000);

    const firstApplication = await db.applyStripeBillingEvent(userId, {
      stripeEventId: `${providerPrefix}-billing`,
      eventType: 'customer.subscription.updated',
      payload: { customerId: `cus-${runId}` },
      subscription: {
        stripeCustomerId: `cus-${runId}`,
        stripeSubscriptionId: `sub-${runId}`,
        plan: 'pro',
        status: 'active',
        cancelAtPeriodEnd: false,
        providerObservedAt: '2030-01-01T00:00:00.000Z'
      }
    });
    const replayApplication = await db.applyStripeBillingEvent(userId, {
      stripeEventId: `${providerPrefix}-billing`,
      eventType: 'customer.subscription.deleted',
      payload: { customerId: `cus-${runId}` },
      subscription: {
        stripeCustomerId: `cus-${runId}`,
        stripeSubscriptionId: `sub-${runId}`,
        plan: 'free',
        status: 'canceled',
        cancelAtPeriodEnd: false,
        providerObservedAt: '2040-01-01T00:00:00.000Z'
      }
    });
    assert.equal(firstApplication.applied, true);
    assert.equal(replayApplication.applied, false);

    const staleDistinctApplication = await db.applyStripeBillingEvent(userId, {
      stripeEventId: `${providerPrefix}-billing-stale-distinct`,
      eventType: 'customer.subscription.deleted',
      payload: { customerId: `cus-${runId}` },
      subscription: {
        stripeCustomerId: `cus-${runId}`,
        stripeSubscriptionId: `sub-${runId}`,
        plan: 'free',
        status: 'canceled',
        cancelAtPeriodEnd: false,
        providerObservedAt: '2020-01-01T00:00:00.000Z'
      }
    });
    assert.equal(staleDistinctApplication.applied, true);
    const subscription = await db.getSubscription(userId);
    assert.equal(subscription.plan, 'pro');
    assert.equal(subscription.status, 'active');
    const billingReceipt = await db.getPool().query(
      `SELECT applied_at IS NOT NULL AS applied
       FROM billing_events
       WHERE stripe_event_id = $1`,
      [`${providerPrefix}-billing`]
    );
    assert.equal(billingReceipt.rows[0].applied, true);

    const retainedPending = await db.receiveWebhookEvent({
      provider: 'oura',
      providerEventId: `${providerPrefix}-pending-retained`,
      eventType: 'delete',
      userId,
      payload: { dataType: 'sleep', objectId: `pending-${runId}` }
    });
    const processedForPurge = concurrentClaims[0];
    await db.getPool().query(
      `UPDATE webhook_events
       SET purge_after = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [processedForPurge.id]
    );
    const cleanup = await db.runDataRetentionCleanup();
    assert.equal(cleanup.tables.webhook_events.retentionMode, 'deadline');
    const retentionRows = await db.getPool().query(
      `SELECT id
       FROM webhook_events
       WHERE id = ANY($1::bigint[])`,
      [[processedForPurge.id, retainedPending.id]]
    );
    assert.deepEqual(
      retentionRows.rows.map((row) => Number(row.id)),
      [retainedPending.id]
    );

    const operations = await db.getWebhookOperationsSummary();
    assert.ok(operations.failureCount >= 1);
    assert.equal(
      operations.failures.some((failure) =>
        Object.prototype.hasOwnProperty.call(failure, 'payload')
      ),
      false
    );

    await db.deleteUserAccount(userId);
    await assert.rejects(
      db.applyStripeBillingEvent(userId, {
        stripeEventId: `${providerPrefix}-after-account-delete`,
        eventType: 'customer.subscription.updated',
        payload: {},
        subscription: {
          stripeCustomerId: `cus-${runId}`,
          stripeSubscriptionId: `sub-${runId}`,
          plan: 'pro',
          status: 'active',
          providerObservedAt: '2040-01-01T00:00:00.000Z'
        }
      }),
      /foreign key constraint|violates foreign key/i
    );
    assert.equal((await db.getSubscription(userId)).stripeCustomerId, null);
  } finally {
    await db.getPool().query(
      `DELETE FROM webhook_events WHERE provider_event_id LIKE $1`,
      [`${providerPrefix}%`]
    ).catch(() => {});
    await db.getPool().query(
      `DELETE FROM billing_events WHERE stripe_event_id LIKE $1`,
      [`${providerPrefix}%`]
    ).catch(() => {});
    await db.deleteUserAccount(userId).catch(() => {});
    await db.getPool().end().catch(() => {});
    delete require.cache[dbPath];
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
