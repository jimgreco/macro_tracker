const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PostgresSessionStore,
  sessionExpiresAt,
  sessionUserId
} = require('../src/postgres-session-store');

function createSharedAdapter() {
  const records = new Map();
  return {
    records,
    loadSession: async (sessionId) => {
      const record = records.get(sessionId);
      if (!record) return null;
      if (new Date(record.expiresAt).getTime() <= Date.now()) {
        records.delete(sessionId);
        return null;
      }
      return record;
    },
    saveSession: async (sessionId, sessionData, metadata) => {
      const existing = records.get(sessionId);
      const record = {
        sessionData,
        ...metadata,
        publicId: existing?.publicId || metadata.publicId
      };
      records.set(sessionId, record);
      return record;
    },
    touchSession: async (sessionId, sessionData, metadata) => {
      const existing = records.get(sessionId);
      if (!existing) return null;
      const record = { ...existing, sessionData, ...metadata };
      records.set(sessionId, record);
      return record;
    },
    destroySession: async (sessionId) => Number(records.delete(sessionId)),
    clearSessions: async () => {
      const count = records.size;
      records.clear();
      return count;
    },
    countSessions: async () => records.size,
    listSessions: async () => [...records.values()]
  };
}

function storeCall(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

test('two session-store instances share login state across restarts', async () => {
  const adapter = createSharedAdapter();
  const options = { ...adapter, ttlMs: 30 * 24 * 60 * 60 * 1000 };
  const firstProcess = new PostgresSessionStore(options);
  const restartedProcess = new PostgresSessionStore(options);
  const sessionData = {
    cookie: { expires: new Date(Date.now() + 60_000).toISOString() },
    passport: { user: 'user-123' },
    appleAuthState: 'opaque-state'
  };

  await storeCall(firstProcess, 'set', 'private-session-id', sessionData);
  const restored = await storeCall(restartedProcess, 'get', 'private-session-id');

  assert.deepEqual(restored, sessionData);
  assert.equal(adapter.records.get('private-session-id').userId, 'user-123');
  assert.notEqual(
    adapter.records.get('private-session-id').publicId,
    'private-session-id',
    'inventory id must not expose the session credential'
  );
});

test('expired and revoked sessions cannot be revived', async () => {
  const adapter = createSharedAdapter();
  const store = new PostgresSessionStore({ ...adapter, ttlMs: 60_000 });

  await storeCall(store, 'set', 'expired-session', {
    cookie: { expires: new Date(Date.now() - 1_000).toISOString() },
    passport: { user: 'user-123' }
  });
  assert.equal(await storeCall(store, 'get', 'expired-session'), null);

  await storeCall(store, 'set', 'revoked-session', {
    cookie: { expires: new Date(Date.now() + 60_000).toISOString() },
    passport: { user: 'user-123' }
  });
  await storeCall(store, 'destroy', 'revoked-session');
  assert.equal(await storeCall(store, 'get', 'revoked-session'), null);
});

test('session helpers retain only canonical ownership and bounded expiry', () => {
  assert.equal(sessionUserId({ passport: { user: 'user-123' } }), 'user-123');
  assert.equal(sessionUserId({ passport: { user: { id: 'legacy-user' } } }), 'legacy-user');
  assert.equal(sessionUserId({ passport: {} }), null);

  const expiresAt = sessionExpiresAt({ cookie: {} }, 5_000);
  assert.ok(expiresAt.getTime() > Date.now());
  assert.ok(expiresAt.getTime() <= Date.now() + 5_100);
});
