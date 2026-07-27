const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
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
  return {
    documents,
    deletions,
    getStoredConnection() { return connection; },
    getDisconnectOptions() { return disconnectOptions; },
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
  const timestamp = '1784567890';
  const rawBody = Buffer.from('{"event_type":"update","object_id":"sleep-1"}');
  const signature = crypto
    .createHmac('sha256', 'client-secret')
    .update(timestamp)
    .update(rawBody)
    .digest('hex')
    .toUpperCase();

  assert.equal(verifyOuraWebhookSignature({ timestamp, rawBody, signature, clientSecret: 'client-secret' }), true);
  assert.equal(verifyOuraWebhookSignature({ timestamp, rawBody: Buffer.from('{}'), signature, clientSecret: 'client-secret' }), false);
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
  assert.equal(status.connected, true);
  assert.deepEqual(status.grantedScopes, ['personal', 'daily']);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer oura-access-token');
  assert.equal(db.getStoredConnection().ouraUserId, 'oura-user-123');
  assert.equal(JSON.stringify(db.getStoredConnection()).includes('discard@example.com'), false);
  assert.notEqual(db.getStoredConnection().accessTokenEncrypted, 'oura-access-token');
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
  assert.deepEqual(db.documents[0].options, { resurrect: true });
  assert.equal(db.deletions.length, 0);
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
