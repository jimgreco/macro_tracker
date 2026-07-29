const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const serverPath = require.resolve(path.join(__dirname, '..', 'src', 'server.js'));

test('Stripe route verifies exact bytes and acknowledges only after durable receipt', async () => {
  const originalLoad = Module._load;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID,
    SESSION_SECRET: process.env.SESSION_SECRET
  };
  process.env.NODE_ENV = 'test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_route_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_route_fixture';
  process.env.STRIPE_PRO_PRICE_ID = 'price_route_fixture';
  process.env.SESSION_SECRET = 'stripe-route-test-session';

  let receiptMode = 'wait';
  let receiptCalls = 0;
  let exactRawBody = null;
  let releaseReceipt;
  let announceReceipt;
  let receiptStarted = new Promise((resolve) => {
    announceReceipt = resolve;
  });
  let receiptGate = new Promise((resolve) => {
    releaseReceipt = resolve;
  });

  const explicitDb = {
    receiveWebhookEvent: async (receipt) => {
      receiptCalls += 1;
      if (receiptMode === 'fail') {
        throw new Error('database unavailable');
      }
      if (receiptMode === 'wait') {
        announceReceipt();
        await receiptGate;
      }
      return {
        id: 42,
        status: 'received',
        ...receipt
      };
    },
    getPlanLimits: () => ({ dailyParses: 1 }),
    getApiTokenPolicy: () => ({ ttlDays: 90, rotateWithinDays: 14 }),
    getSubscription: async () => ({
      plan: 'free',
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null
    }),
    getUserAccountControls: async () => null,
    getSubscriptionByStripeCustomerId: async () => null,
    runDataRetentionCleanup: async () => ({
      completedAt: new Date().toISOString(),
      inventoryVersion: 'test',
      deletedTotal: 0,
      tables: {}
    }),
    checkDatabaseHealth: async () => ({ ok: true, latencyMs: 1 }),
    getPool: () => ({ end: async () => {} })
  };
  const fakeDb = new Proxy(explicitDb, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(target, property)) {
        return target[property];
      }
      return async () => null;
    }
  });

  class FakeStripe {
    constructor() {
      this.webhooks = {
        constructEvent: (rawBody, signature) => {
          assert.equal(Buffer.isBuffer(rawBody), true);
          exactRawBody = Buffer.from(rawBody);
          if (signature !== 'valid-signature') {
            throw new Error('invalid signature');
          }
          return JSON.parse(rawBody.toString('utf8'));
        }
      };
      this.subscriptions = {
        list: async () => ({ data: [], has_more: false })
      };
      this.checkout = {
        sessions: { create: async () => ({ url: 'https://example.com/checkout' }) }
      };
      this.billingPortal = {
        sessions: { create: async () => ({ url: 'https://example.com/portal' }) }
      };
    }
  }

  let httpServer;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === './db' && parent?.filename === serverPath) return fakeDb;
      if (request === 'stripe' && parent?.filename === serverPath) return FakeStripe;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[serverPath];
    const { app } = require(serverPath);
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    const rawPayload = '{ "id":"evt_route", "type":"checkout.session.completed", "created":1700000000, "data":{"object":{"mode":"subscription","client_reference_id":"route-user","customer":"cus_route","subscription":"sub_route"}} }';

    let responseSettled = false;
    const responsePromise = fetch(`${baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-signature'
      },
      body: rawPayload
    }).then(async (response) => {
      responseSettled = true;
      return {
        status: response.status,
        body: await response.json()
      };
    });
    await receiptStarted;
    await Promise.resolve();
    assert.equal(responseSettled, false);
    releaseReceipt();
    const accepted = await responsePromise;
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.received, true);
    assert.equal(exactRawBody.toString('utf8'), rawPayload);

    receiptMode = 'fail';
    const unavailable = await fetch(`${baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-signature'
      },
      body: rawPayload.replace('evt_route', 'evt_route_failure')
    });
    assert.equal(unavailable.status, 503);

    receiptMode = 'ready';
    receiptStarted = Promise.resolve();
    receiptGate = Promise.resolve();
    const callsBeforeInvalid = receiptCalls;
    const invalid = await fetch(`${baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-signature'
      },
      body: rawPayload.replace('evt_route', 'evt_route_invalid')
    });
    assert.equal(invalid.status, 400);
    assert.equal(receiptCalls, callsBeforeInvalid);
  } finally {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    Module._load = originalLoad;
    delete require.cache[serverPath];
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
