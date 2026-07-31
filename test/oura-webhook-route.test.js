const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');

const serverPath = require.resolve(path.join(__dirname, '..', 'src', 'server.js'));

function ouraSignature(timestamp, rawBody, secret = 'oura-route-secret') {
  return crypto
    .createHmac('sha256', secret)
    .update(String(timestamp))
    .update(rawBody)
    .digest('hex')
    .toUpperCase();
}

test('Oura route verifies fresh exact bytes and acknowledges only after durable receipt', async () => {
  const originalLoad = Module._load;
  const envKeys = [
    'NODE_ENV',
    'SESSION_SECRET',
    'APP_BASE_URL',
    'OURA_CLIENT_ID',
    'OURA_CLIENT_SECRET',
    'OURA_REDIRECT_URI',
    'OURA_WEBHOOK_URL',
    'OURA_WEBHOOK_VERIFICATION_TOKEN',
    'OURA_TOKEN_ENCRYPTION_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    SESSION_SECRET: 'oura-route-test-session',
    APP_BASE_URL: 'https://macrovana.example',
    OURA_CLIENT_ID: 'oura-route-client',
    OURA_CLIENT_SECRET: 'oura-route-secret',
    OURA_REDIRECT_URI: 'https://macrovana.example/auth/oura/callback',
    OURA_WEBHOOK_URL: 'https://macrovana.example/webhooks/oura',
    OURA_WEBHOOK_VERIFICATION_TOKEN: 'oura-route-verification',
    OURA_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: ''
  });

  let receiptMode = 'wait';
  let receiptCalls = 0;
  let storedReceipt = null;
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
      storedReceipt = receipt;
      if (receiptMode === 'fail') throw new Error('database unavailable');
      if (receiptMode === 'wait') {
        announceReceipt();
        await receiptGate;
      }
      return { id: 84, status: 'received', ...receipt };
    },
    getOuraConnectionByProviderUserId: async (ouraUserId) => (
      ouraUserId === 'oura-user-123'
        ? { userId: 'daily-user-1', ouraUserId }
        : null
    ),
    getPlanLimits: () => ({ dailyParses: 1 }),
    getApiTokenPolicy: () => ({ ttlDays: 90, rotateWithinDays: 14 }),
    getSubscription: async () => ({
      plan: 'free',
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null
    }),
    getUserAccountControls: async () => null,
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
      if (Object.prototype.hasOwnProperty.call(target, property)) return target[property];
      return async () => null;
    }
  });

  let httpServer;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === './db' && parent?.filename === serverPath) return fakeDb;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[serverPath];
    const { app } = require(serverPath);
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

    const challenge = await fetch(`${baseUrl}/webhooks/oura?verification_token=oura-route-verification&challenge=route-challenge`);
    assert.equal(challenge.status, 200);
    assert.deepEqual(await challenge.json(), { challenge: 'route-challenge' });

    const payload = {
      event_type: 'update',
      data_type: 'daily_sleep',
      object_id: 'daily-sleep-1',
      user_id: 'oura-user-123'
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    let responseSettled = false;
    const responsePromise = fetch(`${baseUrl}/webhooks/oura`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-oura-timestamp': timestamp,
        'x-oura-signature': ouraSignature(timestamp, rawBody)
      },
      body: rawBody
    }).then(async (response) => {
      responseSettled = true;
      return { status: response.status, body: await response.json() };
    });

    await receiptStarted;
    await Promise.resolve();
    assert.equal(responseSettled, false);
    releaseReceipt();
    const accepted = await responsePromise;
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.received, true);
    assert.equal(storedReceipt.provider, 'oura');
    assert.equal(storedReceipt.userId, 'daily-user-1');
    assert.deepEqual(storedReceipt.payload, {
      ouraUserId: 'oura-user-123',
      dataType: 'daily_sleep',
      objectId: 'daily-sleep-1'
    });
    assert.equal(Object.hasOwn(storedReceipt.payload, 'rawBody'), false);

    receiptMode = 'fail';
    const failedPayload = Buffer.from(JSON.stringify({ ...payload, object_id: 'daily-sleep-2' }));
    const failedTimestamp = String(Math.floor(Date.now() / 1000));
    const unavailable = await fetch(`${baseUrl}/webhooks/oura`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-oura-timestamp': failedTimestamp,
        'x-oura-signature': ouraSignature(failedTimestamp, failedPayload)
      },
      body: failedPayload
    });
    assert.equal(unavailable.status, 503);

    receiptMode = 'ready';
    const callsBeforeStale = receiptCalls;
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const stale = await fetch(`${baseUrl}/webhooks/oura`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-oura-timestamp': staleTimestamp,
        'x-oura-signature': ouraSignature(staleTimestamp, rawBody)
      },
      body: rawBody
    });
    assert.equal(stale.status, 401);
    assert.equal(receiptCalls, callsBeforeStale);
  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    Module._load = originalLoad;
    delete require.cache[serverPath];
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
