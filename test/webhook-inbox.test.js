const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canResurrectProviderRecord,
  createWebhookWorker,
  retryDelayMs
} = require('../src/webhook-inbox');
const {
  buildStripeWebhookReceipt,
  createStripeWebhookHandler
} = require('../src/stripe-webhooks');

test('webhook retry delay uses bounded exponential backoff', () => {
  assert.equal(retryDelayMs(1, { baseBackoffMs: 1_000, maxBackoffMs: 8_000 }), 1_000);
  assert.equal(retryDelayMs(2, { baseBackoffMs: 1_000, maxBackoffMs: 8_000 }), 2_000);
  assert.equal(retryDelayMs(4, { baseBackoffMs: 1_000, maxBackoffMs: 8_000 }), 8_000);
  assert.equal(retryDelayMs(20, { baseBackoffMs: 1_000, maxBackoffMs: 8_000 }), 8_000);
});

test('only signed create or update deliveries may resurrect provider tombstones', () => {
  assert.equal(canResurrectProviderRecord({
    deliveryKind: 'webhook',
    eventType: 'create'
  }), true);
  assert.equal(canResurrectProviderRecord({
    deliveryKind: 'webhook',
    eventType: 'update'
  }), true);
  assert.equal(canResurrectProviderRecord({
    deliveryKind: 'webhook',
    eventType: 'delete'
  }), false);
  assert.equal(canResurrectProviderRecord({
    deliveryKind: 'reconciliation',
    eventType: 'update'
  }), false);
});

test('poison events stop after the configured attempt budget', async () => {
  const event = {
    id: 1,
    provider: 'stripe',
    providerEventId: 'evt_poison',
    eventType: 'customer.subscription.updated',
    attemptCount: 0,
    maxAttempts: 3
  };
  let status = 'received';
  let exhausted = false;
  let handlerCalls = 0;
  const worker = createWebhookWorker({
    workerId: 'poison-worker',
    handlers: {
      stripe: async () => {
        handlerCalls += 1;
        const error = new Error('bad fixture');
        error.code = 'poison_fixture';
        throw error;
      }
    },
    claimEvents: async () => {
      if (exhausted || !['received', 'failed'].includes(status)) return [];
      status = 'processing';
      event.attemptCount += 1;
      return [{ ...event }];
    },
    markProcessed: async () => {
      throw new Error('unexpected success');
    },
    markFailed: async (_id, _workerId, failure) => {
      status = 'failed';
      exhausted = event.attemptCount >= event.maxAttempts;
      assert.equal(failure.errorCode, 'poison_fixture');
      return { exhausted };
    }
  });

  await worker.runOnce();
  await worker.runOnce();
  await worker.runOnce();
  assert.equal(await worker.runOnce(), 0);
  assert.equal(handlerCalls, 3);
  assert.equal(exhausted, true);
});

test('a crash after application but before acknowledgment safely replays', async () => {
  const logicalApplications = new Set();
  let handlerCalls = 0;
  let claims = 0;
  let settlementAvailable = false;
  const worker = createWebhookWorker({
    workerId: 'crash-worker',
    handlers: {
      stripe: async (event) => {
        handlerCalls += 1;
        logicalApplications.add(event.providerEventId);
      }
    },
    claimEvents: async () => {
      if (claims >= 2) return [];
      claims += 1;
      return [{
        id: 7,
        provider: 'stripe',
        providerEventId: 'evt_crash_window',
        eventType: 'checkout.session.completed',
        attemptCount: claims,
        maxAttempts: 5
      }];
    },
    markProcessed: async () => {
      if (!settlementAvailable) {
        throw new Error('database connection dropped after application');
      }
    },
    markFailed: async () => {
      if (!settlementAvailable) {
        settlementAvailable = true;
        throw new Error('process died before failure settlement');
      }
      return { exhausted: false };
    }
  });

  await worker.runOnce();
  await worker.runOnce();
  assert.equal(handlerCalls, 2);
  assert.equal(logicalApplications.size, 1);
});

test('concurrent workers claim separate events', async () => {
  const queued = [
    { id: 1, provider: 'stripe', providerEventId: 'evt_1', eventType: 'one' },
    { id: 2, provider: 'stripe', providerEventId: 'evt_2', eventType: 'two' }
  ];
  const processed = [];
  const claimEvents = async ({ workerId }) => {
    const event = queued.shift();
    return event ? [{ ...event, attemptCount: 1, maxAttempts: 3, claimedBy: workerId }] : [];
  };
  const buildWorker = (workerId) => createWebhookWorker({
    workerId,
    batchSize: 1,
    claimEvents,
    handlers: {
      stripe: async (event) => {
        processed.push(`${event.id}:${event.claimedBy}`);
      }
    },
    markProcessed: async () => {},
    markFailed: async () => ({ exhausted: false })
  });

  await Promise.all([
    buildWorker('worker-a').runOnce(),
    buildWorker('worker-b').runOnce()
  ]);
  assert.equal(new Set(processed.map((entry) => entry.split(':')[0])).size, 2);
  assert.equal(new Set(processed.map((entry) => entry.split(':')[1])).size, 2);
});

test('a worker with no registered provider never claims persisted work', async () => {
  let claimCalls = 0;
  const worker = createWebhookWorker({
    handlers: {},
    claimEvents: async () => {
      claimCalls += 1;
      return [];
    },
    markProcessed: async () => {},
    markFailed: async () => ({ exhausted: false })
  });
  assert.equal(await worker.runOnce(), 0);
  assert.equal(claimCalls, 0);
});

test('worker stop drains in-flight settlement and schedules no later poll', async () => {
  let releaseHandler;
  let announceHandler;
  const handlerStarted = new Promise((resolve) => {
    announceHandler = resolve;
  });
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  let claimCalls = 0;
  let settlements = 0;
  const worker = createWebhookWorker({
    workerId: 'graceful-worker',
    pollIntervalMs: 5,
    setTimer: (callback, delayMs) => ({
      handle: setTimeout(callback, delayMs)
    }),
    clearTimer: (timer) => clearTimeout(timer.handle),
    handlers: {
      stripe: async () => {
        announceHandler();
        await handlerGate;
      }
    },
    claimEvents: async () => {
      claimCalls += 1;
      return claimCalls === 1
        ? [{
            id: 11,
            provider: 'stripe',
            providerEventId: 'evt_graceful',
            eventType: 'customer.subscription.updated',
            attemptCount: 1,
            maxAttempts: 3
          }]
        : [];
    },
    markProcessed: async () => {
      settlements += 1;
    },
    markFailed: async () => ({ exhausted: false })
  });

  worker.start();
  await handlerStarted;
  let stopped = false;
  const stopping = worker.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  releaseHandler();
  await stopping;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settlements, 1);
  assert.equal(claimCalls, 1);
});

test('worker stop times out cleanly and leaves the leased attempt replayable', async () => {
  let releaseHandler;
  let announceHandler;
  const handlerStarted = new Promise((resolve) => {
    announceHandler = resolve;
  });
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  let claimCalls = 0;
  const worker = createWebhookWorker({
    workerId: 'bounded-stop-worker',
    setTimer: (callback, delayMs) => ({
      handle: setTimeout(callback, delayMs)
    }),
    clearTimer: (timer) => clearTimeout(timer.handle),
    handlers: {
      stripe: async () => {
        announceHandler();
        await handlerGate;
      }
    },
    claimEvents: async () => {
      claimCalls += 1;
      return claimCalls === 1
        ? [{
            id: 13,
            provider: 'stripe',
            providerEventId: 'evt_bounded_stop',
            eventType: 'customer.subscription.updated',
            attemptCount: 1,
            maxAttempts: 3
          }]
        : [];
    },
    markProcessed: async () => {},
    markFailed: async () => ({ exhausted: false })
  });

  worker.start();
  await handlerStarted;
  const result = await worker.stop({ timeoutMs: 10 });
  assert.deepEqual(result, { drained: false });
  assert.equal(worker.running, false);
  assert.equal(claimCalls, 1);

  // Let the attempt finish so the test itself leaves no pending work. In a
  // terminated process the database lease would instead expire and replay.
  releaseHandler();
  assert.deepEqual(await worker.stop(), { drained: true });
});

test('Stripe receipt keeps only the minimum verified fields', () => {
  const receipt = buildStripeWebhookReceipt({
    id: 'evt_minimum',
    type: 'checkout.session.completed',
    created: 1_700_000_000,
    data: {
      object: {
        mode: 'subscription',
        client_reference_id: 'user-123',
        customer: 'cus_123',
        subscription: 'sub_123',
        customer_details: {
          email: 'private@example.com',
          address: { line1: 'not retained' }
        }
      }
    }
  });
  assert.deepEqual(receipt.payload, {
    mode: 'subscription',
    userId: 'user-123',
    customerId: 'cus_123',
    subscriptionId: 'sub_123'
  });
  assert.equal(JSON.stringify(receipt).includes('private@example.com'), false);
  assert.equal(receipt.occurredAt, '2023-11-14T22:13:20.000Z');
});

test('out-of-order Stripe deliveries apply current provider truth', async () => {
  const applied = [];
  const currentProviderSubscription = {
    id: 'sub_latest',
    customer: 'cus_current',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    created: 1_699_000_000,
    metadata: { app_user_id: 'user-current' }
  };
  const handler = createStripeWebhookHandler({
    stripe: {
      subscriptions: {
        list: async () => ({ data: [currentProviderSubscription] })
      }
    },
    getSubscriptionByStripeCustomerId: async () => null,
    getUserAccountControls: async () => ({ id: 'user-current' }),
    applyStripeBillingEvent: async (userId, application) => {
      applied.push({ userId, ...application });
      return { applied: true };
    },
    upsertSubscription: async () => {}
  });
  const common = {
    provider: 'stripe',
    userId: 'user-current',
    payload: {
      customerId: 'cus_current',
      subscriptionId: 'sub_old'
    },
    attemptCount: 1
  };

  await handler({
    ...common,
    id: 1,
    providerEventId: 'evt_newer_delete_delivered_first',
    eventType: 'customer.subscription.deleted'
  });
  await handler({
    ...common,
    id: 2,
    providerEventId: 'evt_older_update_delivered_later',
    eventType: 'customer.subscription.updated'
  });

  assert.equal(applied.length, 2);
  assert.deepEqual(
    applied.map((entry) => ({
      userId: entry.userId,
      plan: entry.subscription.plan,
      status: entry.subscription.status,
      subscriptionId: entry.subscription.stripeSubscriptionId
    })),
    [
      {
        userId: 'user-current',
        plan: 'pro',
        status: 'active',
        subscriptionId: 'sub_latest'
      },
      {
        userId: 'user-current',
        plan: 'pro',
        status: 'active',
        subscriptionId: 'sub_latest'
      }
    ]
  );
});

test('Stripe subscription metadata recovers a missing checkout mapping', async () => {
  let appliedUserId = null;
  const handler = createStripeWebhookHandler({
    stripe: {
      subscriptions: {
        list: async () => ({
          data: [{
            id: 'sub_recovered',
            customer: 'cus_recovered',
            status: 'active',
            created: 2,
            metadata: { app_user_id: 'user-recovered' }
          }]
        })
      }
    },
    getSubscriptionByStripeCustomerId: async () => null,
    getUserAccountControls: async (userId) => ({ id: userId }),
    applyStripeBillingEvent: async (userId) => {
      appliedUserId = userId;
      return { applied: true };
    },
    upsertSubscription: async () => {}
  });

  await handler({
    id: 9,
    provider: 'stripe',
    providerEventId: 'evt_update_before_checkout',
    eventType: 'customer.subscription.updated',
    userId: null,
    payload: {
      customerId: 'cus_recovered',
      subscriptionId: 'sub_recovered'
    },
    attemptCount: 1
  });
  assert.equal(appliedUserId, 'user-recovered');
});

test('provider metadata cannot recreate billing state after account deletion', async () => {
  let applications = 0;
  const handler = createStripeWebhookHandler({
    stripe: {
      subscriptions: {
        list: async () => ({
          data: [{
            id: 'sub_deleted_account',
            customer: 'cus_deleted_account',
            status: 'active',
            metadata: { app_user_id: 'deleted-user' }
          }]
        })
      }
    },
    getSubscriptionByStripeCustomerId: async () => null,
    getUserAccountControls: async () => null,
    applyStripeBillingEvent: async () => {
      applications += 1;
      return { applied: true };
    },
    upsertSubscription: async () => {}
  });
  await handler({
    id: 10,
    provider: 'stripe',
    providerEventId: 'evt_deleted_account',
    eventType: 'customer.subscription.updated',
    payload: {
      customerId: 'cus_deleted_account',
      subscriptionId: 'sub_deleted_account'
    }
  });
  assert.equal(applications, 0);
});

test('conflicting Stripe customer metadata fails closed', async () => {
  const handler = createStripeWebhookHandler({
    stripe: {
      subscriptions: {
        list: async () => ({
          data: [{
            id: 'sub_conflict',
            customer: 'cus_conflict',
            status: 'active',
            metadata: { app_user_id: 'metadata-user' }
          }]
        })
      }
    },
    getSubscriptionByStripeCustomerId: async () => ({ user_id: 'stored-user' }),
    getUserAccountControls: async () => ({ id: 'metadata-user' }),
    applyStripeBillingEvent: async () => ({ applied: true }),
    upsertSubscription: async () => {}
  });
  await assert.rejects(
    handler({
      id: 12,
      provider: 'stripe',
      providerEventId: 'evt_conflict',
      eventType: 'customer.subscription.updated',
      payload: {
        customerId: 'cus_conflict',
        subscriptionId: 'sub_conflict'
      }
    }),
    (error) => error.code === 'stripe_user_mapping_conflict'
  );
});

test('conflicting Stripe receipt and subscription metadata fail closed', async () => {
  const handler = createStripeWebhookHandler({
    stripe: {
      subscriptions: {
        list: async () => ({
          data: [{
            id: 'sub_receipt_conflict',
            customer: 'cus_receipt_conflict',
            status: 'active',
            metadata: { app_user_id: 'metadata-user' }
          }]
        })
      }
    },
    getSubscriptionByStripeCustomerId: async () => null,
    getUserAccountControls: async () => ({ id: 'receipt-user' }),
    applyStripeBillingEvent: async () => ({ applied: true }),
    upsertSubscription: async () => {}
  });
  await assert.rejects(
    handler({
      id: 13,
      provider: 'stripe',
      providerEventId: 'evt_receipt_conflict',
      eventType: 'checkout.session.completed',
      userId: 'receipt-user',
      payload: {
        mode: 'subscription',
        userId: 'receipt-user',
        customerId: 'cus_receipt_conflict',
        subscriptionId: 'sub_receipt_conflict'
      }
    }),
    (error) => error.code === 'stripe_user_mapping_conflict'
  );
});
