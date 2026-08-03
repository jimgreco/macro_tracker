const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  buildOuraWebhookReceipt,
  createOuraService,
  decryptSecret,
  encryptSecret,
  normalizeOuraDocument,
  parseEncryptionKey,
  verifyOuraWebhookSignature
} = require('../src/oura');

const encryptionKeyValue = Buffer.alloc(32, 7).toString('base64');
const encryptionKey = parseEncryptionKey(encryptionKeyValue);

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(payload == null ? '' : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function makeFakeDb() {
  let oauthState = null;
  let connection = null;
  let disconnectOptions = null;
  const documents = [];
  const deletions = [];
  let integrationPermissions = [
    'sleep',
    'readiness',
    'activity',
    'stress',
    'resilience',
    'bedtime'
  ].map((dataType) => ({
    source: 'oura',
    dataType,
    readEnabled: true,
    writeEnabled: false
  }));
  return {
    documents,
    deletions,
    getStoredConnection() { return connection; },
    getDisconnectOptions() { return disconnectOptions; },
    getIntegrationPermissions() { return integrationPermissions; },
    async createOuraOauthState(stateHash, userId, returnTo, expiresAt) {
      oauthState = { stateHash, userId, returnTo, expiresAt };
    },
    async consumeOuraOauthState(stateHash) {
      if (!oauthState || oauthState.stateHash !== stateHash) return null;
      const result = oauthState;
      oauthState = null;
      return result;
    },
    async getOuraConnection(userId) {
      return connection?.userId === userId ? connection : null;
    },
    async getOuraConnectionByProviderUserId(ouraUserId) {
      return connection?.ouraUserId === ouraUserId ? connection : null;
    },
    async upsertOuraConnection(userId, next) {
      connection = {
        userId,
        ...next,
        lastSyncedAt: null,
        lastWebhookAt: null,
        lastError: null
      };
      return connection;
    },
    async rotateOuraConnectionTokens(userId, rotate) {
      assert.equal(connection.userId, userId);
      const next = await rotate(connection);
      if (next) connection = { ...connection, ...next, status: 'connected' };
      return connection;
    },
    async updateOuraConnection(userId, updates) {
      assert.equal(connection.userId, userId);
      connection = { ...connection, ...updates };
      return connection;
    },
    async listActiveOuraConnections() {
      return connection ? [connection] : [];
    },
    async upsertOuraDocument(userId, dataType, document, options) {
      documents.push({ userId, dataType, document, options });
    },
    async deleteOuraDocument(userId, dataType, providerDocumentId) {
      deletions.push({ userId, dataType, providerDocumentId });
    },
    async reconcileOuraDocuments() { return 0; },
    async listOuraDocuments() { return []; },
    async upsertOuraWebhookSubscription() {},
    async listOuraWebhookSubscriptions() { return []; },
    async deleteOuraConnection(_userId, options) {
      disconnectOptions = options;
      connection = null;
    },
    async listIntegrationDataPermissions(_userId, source) {
      return integrationPermissions.filter((permission) => !source || permission.source === source);
    },
    async replaceIntegrationDataPermissions(_userId, source, permissions) {
      integrationPermissions = permissions.map((permission) => ({ source, ...permission }));
      return integrationPermissions;
    },
    async deleteIntegrationDataPermissions(_userId, source) {
      integrationPermissions = integrationPermissions.filter((permission) => permission.source !== source);
    }
  };
}

function configuredEnv(overrides = {}) {
  return {
    APP_BASE_URL: 'https://macros.example',
    OURA_CLIENT_ID: 'client-id',
    OURA_CLIENT_SECRET: 'client-secret',
    OURA_TOKEN_ENCRYPTION_KEY: encryptionKeyValue,
    OURA_REDIRECT_URI: 'https://macros.example/auth/oura/callback',
    OURA_WEBHOOK_URL: 'https://macros.example/webhooks/oura',
    OURA_WEBHOOK_VERIFICATION_TOKEN: 'verification-token',
    ...overrides
  };
}

test('Oura credentials use authenticated encryption', () => {
  const encrypted = encryptSecret('refresh-secret', encryptionKey);
  assert.notEqual(encrypted, 'refresh-secret');
  assert.match(encrypted, /^v1:/);
  assert.equal(decryptSecret(encrypted, encryptionKey), 'refresh-secret');
  assert.throws(() => decryptSecret(`${encrypted.slice(0, -2)}aa`, encryptionKey), /could not be decrypted/);
});

test('Oura webhook signatures cover timestamp plus exact body bytes', () => {
  const now = Date.UTC(2026, 6, 20, 12, 0, 0);
  const timestamp = String(now / 1000);
  const rawBody = Buffer.from('{"event_type":"update","object_id":"sleep-1"}');
  const signature = crypto
    .createHmac('sha256', 'client-secret')
    .update(timestamp)
    .update(rawBody)
    .digest('hex')
    .toUpperCase();

  assert.equal(verifyOuraWebhookSignature({ timestamp, rawBody, signature, clientSecret: 'client-secret', now }), true);
  assert.equal(verifyOuraWebhookSignature({ timestamp, rawBody: Buffer.from('{}'), signature, clientSecret: 'client-secret', now }), false);
  assert.equal(verifyOuraWebhookSignature({ timestamp, rawBody, signature, clientSecret: 'client-secret', now: now + 10 * 60 * 1000 }), false);
});

test('Oura webhook receipts retain only durable routing metadata and deduplicate exact retries', () => {
  const payload = {
    event_type: 'update',
    data_type: 'daily_sleep',
    object_id: 'daily-sleep-1',
    user_id: 'oura-user-123'
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const first = buildOuraWebhookReceipt(payload, {
    timestamp: '1784567890',
    rawBody,
    userId: 'daily-user-1',
    maxAttempts: 6
  });
  const retry = buildOuraWebhookReceipt(payload, {
    timestamp: '1784567890',
    rawBody,
    userId: 'daily-user-1',
    maxAttempts: 6
  });
  const laterDelivery = buildOuraWebhookReceipt(payload, {
    timestamp: '1784567891',
    rawBody,
    userId: 'daily-user-1',
    maxAttempts: 6
  });

  assert.equal(first.provider, 'oura');
  assert.equal(first.deliveryKind, 'webhook');
  assert.equal(first.eventType, 'update');
  assert.equal(first.userId, 'daily-user-1');
  assert.deepEqual(first.payload, {
    ouraUserId: 'oura-user-123',
    dataType: 'daily_sleep',
    objectId: 'daily-sleep-1'
  });
  assert.equal(first.providerEventId, retry.providerEventId);
  assert.notEqual(first.providerEventId, laterDelivery.providerEventId);
  assert.equal(Object.hasOwn(first.payload, 'rawBody'), false);
  assert.equal(Object.hasOwn(first.payload, 'signature'), false);
});

test('Oura sleep normalization retains aggregates and drops high-frequency arrays', () => {
  const normalized = normalizeOuraDocument('sleep', {
    id: 'sleep-1',
    day: '2026-07-20',
    bedtime_start: '2026-07-19T23:00:00-04:00',
    bedtime_end: '2026-07-20T07:00:00-04:00',
    average_heart_rate: 52.4,
    average_hrv: 44,
    total_sleep_duration: 27000,
    heart_rate: { interval: 300, items: [50, 51, 52] },
    hrv: { interval: 300, items: [40, 44, 48] },
    movement_30_sec: '1111234',
    sleep_phase_5_min: '1234'
  });

  assert.equal(normalized.providerDocumentId, 'sleep-1');
  assert.equal(normalized.data.averageHeartRate, 52.4);
  assert.equal(normalized.data.averageHrv, 44);
  assert.equal(normalized.data.totalSleepSeconds, 27000);
  assert.equal(Object.hasOwn(normalized.data, 'heartRate'), false);
  assert.equal(Object.hasOwn(normalized.data, 'hrv'), false);
  assert.equal(Object.hasOwn(normalized.data, 'movement30Sec'), false);
});

test('Oura authorization stores only opaque identity and encrypted rotating credentials', async () => {
  const db = makeFakeDb();
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    requests.push({ url, options });
    if (url === 'https://api.ouraring.com/oauth/token') {
      return jsonResponse({
        access_token: 'oura-access-token',
        refresh_token: 'oura-refresh-token',
        expires_in: 3600
      });
    }
    if (url === 'https://api.ouraring.com/v2/usercollection/personal_info') {
      return jsonResponse({
        id: 'oura-user-123',
        age: 40,
        weight: 90,
        height: 180,
        biological_sex: 'male',
        email: 'discard@example.com'
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });

  const authorization = await service.createAuthorization('daily-user-1', 'ios');
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');
  const result = await service.completeAuthorization({
    code: 'authorization-code',
    state,
    scope: 'personal daily'
  });
  const status = await service.getStatus('daily-user-1');

  assert.equal(result.returnTo, 'ios');
  assert.equal(result.configurationRequired, true);
  assert.equal(result.shouldInitialize, false);
  assert.equal(status.connected, true);
  assert.equal(status.state, 'permissions_required');
  assert.deepEqual(status.grantedScopes, ['personal', 'daily']);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer oura-access-token');
  assert.equal(db.getStoredConnection().ouraUserId, 'oura-user-123');
  assert.equal(JSON.stringify(db.getStoredConnection()).includes('discard@example.com'), false);
  assert.notEqual(db.getStoredConnection().accessTokenEncrypted, 'oura-access-token');
});

test('Oura authorization accepts form-encoded scope separators from the callback', async () => {
  const db = makeFakeDb();
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url === 'https://api.ouraring.com/oauth/token') {
      return jsonResponse({
        access_token: 'oura-access-token',
        refresh_token: 'oura-refresh-token',
        expires_in: 3600
      });
    }
    if (url === 'https://api.ouraring.com/v2/usercollection/personal_info') {
      return jsonResponse({ id: 'oura-user-123' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });
  const authorization = await service.createAuthorization('daily-user-1', 'ios');
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');

  const result = await service.completeAuthorization({
    code: 'authorization-code',
    state,
    scope: 'daily+personal'
  });

  assert.deepEqual(result.grantedScopes, ['daily', 'personal']);
});

test('Oura authorization verifies required capabilities when grant metadata omits them', async () => {
  const db = makeFakeDb();
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url === 'https://api.ouraring.com/oauth/token') {
      return jsonResponse({
        access_token: 'oura-access-token',
        refresh_token: 'oura-refresh-token',
        expires_in: 3600
      });
    }
    if (url === 'https://api.ouraring.com/v2/usercollection/personal_info') {
      return jsonResponse({ id: 'oura-user-123' });
    }
    if (url.startsWith('https://api.ouraring.com/v2/usercollection/daily_readiness?')) {
      return jsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });
  const authorization = await service.createAuthorization('daily-user-1', 'ios');
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');

  const result = await service.completeAuthorization({ code: 'authorization-code', state });

  assert.deepEqual(result.grantedScopes, ['personal', 'daily']);
  assert.deepEqual(db.getStoredConnection().scopes, ['personal', 'daily']);
});

test('Oura authorization still fails closed when personal capability is denied', async () => {
  const db = makeFakeDb();
  let revoked = false;
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url === 'https://api.ouraring.com/oauth/token') {
      return jsonResponse({
        access_token: 'oura-access-token',
        refresh_token: 'oura-refresh-token',
        expires_in: 3600,
        scope: 'daily'
      });
    }
    if (url === 'https://api.ouraring.com/v2/usercollection/personal_info') {
      return jsonResponse({ detail: 'Forbidden' }, 403);
    }
    if (url.startsWith('https://api.ouraring.com/oauth/revoke?')) {
      revoked = true;
      return jsonResponse(null);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });
  const authorization = await service.createAuthorization('daily-user-1', 'ios');
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');

  await assert.rejects(
    service.completeAuthorization({ code: 'authorization-code', state }),
    /Oura personal access is required/
  );
  assert.equal(db.getStoredConnection(), null);
  assert.equal(revoked, true);
});

test('Oura authorization still fails closed when daily capability is denied', async () => {
  const db = makeFakeDb();
  let revoked = false;
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url === 'https://api.ouraring.com/oauth/token') {
      return jsonResponse({
        access_token: 'oura-access-token',
        refresh_token: 'oura-refresh-token',
        expires_in: 3600,
        scope: 'personal'
      });
    }
    if (url === 'https://api.ouraring.com/v2/usercollection/personal_info') {
      return jsonResponse({ id: 'oura-user-123' });
    }
    if (url.startsWith('https://api.ouraring.com/v2/usercollection/daily_readiness?')) {
      return jsonResponse({ detail: 'Forbidden' }, 403);
    }
    if (url.startsWith('https://api.ouraring.com/oauth/revoke?')) {
      revoked = true;
      return jsonResponse(null);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });
  const authorization = await service.createAuthorization('daily-user-1', 'ios');
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');

  await assert.rejects(
    service.completeAuthorization({ code: 'authorization-code', state }),
    /Oura daily access is required/
  );
  assert.equal(db.getStoredConnection(), null);
  assert.equal(revoked, true);
});

test('same-account Oura reauthorization preserves completed access choices', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('old-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('old-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'reauthorization_required'
  });
  const service = createOuraService({
    db,
    env: configuredEnv(),
    fetchImpl: async (input) => {
      if (String(input) === 'https://api.ouraring.com/oauth/token') {
        return jsonResponse({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'personal daily'
        });
      }
      if (String(input) === 'https://api.ouraring.com/v2/usercollection/personal_info') {
        return jsonResponse({ id: 'oura-user-123' });
      }
      throw new Error(`Unexpected request: ${input}`);
    }
  });

  const authorization = await service.createAuthorization('daily-user-1', 'web');
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');
  const result = await service.completeAuthorization({ code: 'new-code', state });

  assert.equal(result.configurationRequired, false);
  assert.equal(result.shouldInitialize, true);
  assert.equal(db.getIntegrationPermissions().length, 6);
  assert.equal(db.getStoredConnection().status, 'syncing');
});

test('Oura sync reads only explicitly enabled logical data types', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  await db.replaceIntegrationDataPermissions('daily-user-1', 'oura', [
    { dataType: 'sleep', readEnabled: false, writeEnabled: false },
    { dataType: 'readiness', readEnabled: true, writeEnabled: false },
    { dataType: 'activity', readEnabled: false, writeEnabled: false },
    { dataType: 'stress', readEnabled: false, writeEnabled: false },
    { dataType: 'resilience', readEnabled: false, writeEnabled: false },
    { dataType: 'bedtime', readEnabled: false, writeEnabled: false }
  ]);
  const requests = [];
  const service = createOuraService({
    db,
    env: configuredEnv(),
    fetchImpl: async (input) => {
      requests.push(String(input));
      return jsonResponse({ data: [], next_token: null });
    }
  });

  const result = await service.syncUser('daily-user-1', { days: 7 });

  assert.deepEqual(Object.keys(result.counts), ['daily_readiness']);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/usercollection\/daily_readiness\?/);
});

test('Oura workout choices are not required when the connected account did not grant workout scope', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  const requests = [];
  const service = createOuraService({
    db,
    env: configuredEnv({ OURA_INCLUDE_WORKOUTS: 'true' }),
    fetchImpl: async (input) => {
      requests.push(String(input));
      return jsonResponse({ data: [], next_token: null });
    }
  });

  const result = await service.syncUser('daily-user-1', { days: 7 });

  assert.equal(Object.hasOwn(result.counts, 'workout'), false);
  assert.equal(requests.some((url) => /\/usercollection\/workout(?:\?|$)/.test(url)), false);
  assert.equal(db.getStoredConnection().status, 'connected');
});

test('Oura sync is default-denied until every access choice is recorded', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  await db.deleteIntegrationDataPermissions('daily-user-1', 'oura');
  let providerCalls = 0;
  const service = createOuraService({
    db,
    env: configuredEnv(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({ data: [], next_token: null });
    }
  });

  await assert.rejects(
    service.syncUser('daily-user-1', { days: 7 }),
    (error) => error?.code === 'integration_access_required'
  );
  assert.equal(providerCalls, 0);
  assert.equal(db.getStoredConnection().status, 'permissions_required');
});

test('Oura webhooks do not fetch provider documents when access is disabled', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  await db.replaceIntegrationDataPermissions(
    'daily-user-1',
    'oura',
    db.getIntegrationPermissions().map((permission) => ({
      dataType: permission.dataType,
      readEnabled: false,
      writeEnabled: false
    }))
  );
  let providerCalls = 0;
  const service = createOuraService({
    db,
    env: configuredEnv(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });

  const result = await service.processWebhook({
    event_type: 'update',
    data_type: 'daily_sleep',
    object_id: 'daily-sleep-1',
    user_id: 'oura-user-123'
  });

  assert.deepEqual(result, { ignored: true, reason: 'access_disabled' });
  assert.equal(providerCalls, 0);
  assert.equal(db.documents.length, 0);
});

test('Oura disconnect always revokes access and deletes imported data', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  const requests = [];
  const service = createOuraService({
    db,
    env: configuredEnv(),
    fetchImpl: async (input) => {
      requests.push(String(input));
      return jsonResponse(null);
    }
  });

  const result = await service.disconnectUser('daily-user-1');

  assert.deepEqual(result, { ok: true, deletedData: true });
  assert.deepEqual(db.getDisconnectOptions(), { deleteData: true });
  assert.equal(db.getStoredConnection(), null);
  assert.match(requests[0], /^https:\/\/api\.ouraring\.com\/oauth\/revoke\?access_token=valid-access$/);
});

test('Oura webhook processing refreshes an expired token and ignores a stale delete when the document exists', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('expired-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('single-use-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  let refreshCalls = 0;
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    if (url === 'https://api.ouraring.com/oauth/token') {
      refreshCalls += 1;
      assert.match(String(options.body), /refresh_token=single-use-refresh/);
      return jsonResponse({
        access_token: 'fresh-access',
        refresh_token: 'next-single-use-refresh',
        expires_in: 3600,
        scope: 'personal daily'
      });
    }
    if (url.endsWith('/v2/usercollection/daily_sleep/daily-sleep-1')) {
      assert.equal(options.headers.Authorization, 'Bearer fresh-access');
      return jsonResponse({
        id: 'daily-sleep-1',
        day: '2026-07-20',
        timestamp: '2026-07-20T08:00:00-04:00',
        score: 88,
        contributors: { deep_sleep: 90 }
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });

  const result = await service.processWebhook({
    event_type: 'delete',
    data_type: 'daily_sleep',
    object_id: 'daily-sleep-1',
    user_id: 'oura-user-123'
  });

  assert.deepEqual(result, { updated: true });
  assert.equal(refreshCalls, 1);
  assert.equal(db.documents.length, 1);
  assert.equal(db.documents[0].document.providerDocumentId, 'daily-sleep-1');
  assert.equal(db.documents[0].document.data.score, 88);
  assert.deepEqual(db.documents[0].options, { resurrect: false });
  assert.equal(db.deletions.length, 0);
});

test('only a signed create or update delivery can resurrect an Oura tombstone', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  const fetchImpl = async (input) => {
    if (String(input).endsWith('/v2/usercollection/daily_sleep/daily-sleep-1')) {
      return jsonResponse({
        id: 'daily-sleep-1',
        day: '2026-07-20',
        timestamp: '2026-07-20T08:00:00-04:00',
        score: 91
      });
    }
    throw new Error(`Unexpected request: ${input}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });

  await service.processWebhookEvent({
    provider: 'oura',
    eventType: 'update',
    deliveryKind: 'webhook',
    userId: 'daily-user-1',
    payload: {
      dataType: 'daily_sleep',
      objectId: 'daily-sleep-1',
      ouraUserId: 'oura-user-123'
    }
  });

  assert.deepEqual(db.documents[0].options, { resurrect: true });
});

test('Oura backfill and reconciliation never resurrect tombstoned provider records', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('/v2/usercollection/daily_sleep?')) {
      return jsonResponse({
        data: [{
          id: 'daily-sleep-1',
          day: '2026-07-20',
          timestamp: '2026-07-20T08:00:00-04:00',
          score: 91
        }],
        next_token: null
      });
    }
    if (url.includes('/v2/usercollection/')) {
      return jsonResponse({ data: [], next_token: null });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });

  await service.syncUser('daily-user-1', { days: 7 });

  assert.equal(db.documents.length, 1);
  assert.deepEqual(db.documents[0].options, { resurrect: false });
});

test('Oura webhook processing writes a tombstone when provider state is gone', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('valid-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('valid-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  const fetchImpl = async (input) => {
    if (String(input).endsWith('/v2/usercollection/daily_sleep/deleted-document')) {
      return jsonResponse({ status: 404, title: 'Not Found' }, 404);
    }
    throw new Error(`Unexpected request: ${input}`);
  };
  const service = createOuraService({ db, env: configuredEnv(), fetchImpl });

  const result = await service.processWebhook({
    event_type: 'update',
    data_type: 'daily_sleep',
    object_id: 'deleted-document',
    user_id: 'oura-user-123'
  });

  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(db.deletions, [{
    userId: 'daily-user-1',
    dataType: 'daily_sleep',
    providerDocumentId: 'deleted-document'
  }]);
});

test('Oura does not retry a single-use refresh token and marks invalid grants for reconnection', async () => {
  const db = makeFakeDb();
  await db.upsertOuraConnection('daily-user-1', {
    ouraUserId: 'oura-user-123',
    accessTokenEncrypted: encryptSecret('expired-access', encryptionKey),
    refreshTokenEncrypted: encryptSecret('single-use-refresh', encryptionKey),
    tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    scopes: ['personal', 'daily'],
    status: 'connected'
  });
  let tokenRequests = 0;
  const service = createOuraService({
    db,
    env: configuredEnv(),
    fetchImpl: async (input) => {
      assert.equal(String(input), 'https://api.ouraring.com/oauth/token');
      tokenRequests += 1;
      return jsonResponse({
        status: 400,
        title: 'Invalid Grant',
        error: 'invalid_grant'
      }, 400);
    }
  });

  await assert.rejects(service.syncUser('daily-user-1', { days: 1 }), /Invalid Grant/);
  assert.equal(tokenRequests, 1);
  assert.equal(db.getStoredConnection().status, 'reauthorization_required');
});
