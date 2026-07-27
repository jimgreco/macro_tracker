const crypto = require('crypto');
const session = require('express-session');

function sessionUserId(sessionData) {
  const serializedUser = sessionData?.passport?.user;
  if (typeof serializedUser === 'string' || typeof serializedUser === 'number') {
    const value = String(serializedUser).trim();
    return value || null;
  }
  if (serializedUser && typeof serializedUser === 'object') {
    const value = String(serializedUser.id || '').trim();
    return value || null;
  }
  return null;
}

function sessionExpiresAt(sessionData, fallbackTtlMs) {
  const cookieExpiration = sessionData?.cookie?.expires;
  if (cookieExpiration) {
    const expiresAt = new Date(cookieExpiration);
    if (!Number.isNaN(expiresAt.getTime())) {
      return expiresAt;
    }
  }
  return new Date(Date.now() + fallbackTtlMs);
}

class PostgresSessionStore extends session.Store {
  constructor({
    loadSession,
    saveSession,
    touchSession,
    destroySession,
    clearSessions,
    countSessions,
    listSessions,
    ttlMs,
    onError = () => {}
  }) {
    super();
    this.loadSession = loadSession;
    this.saveSession = saveSession;
    this.touchSession = touchSession;
    this.destroySession = destroySession;
    this.clearSessions = clearSessions;
    this.countSessions = countSessions;
    this.listSessions = listSessions;
    this.ttlMs = ttlMs;
    this.onError = onError;
  }

  get(sessionId, callback) {
    this.loadSession(sessionId)
      .then((record) => callback(null, record?.sessionData || null))
      .catch((error) => this.handleError(error, callback));
  }

  set(sessionId, sessionData, callback = () => {}) {
    this.saveSession(sessionId, sessionData, {
      publicId: crypto.randomUUID(),
      userId: sessionUserId(sessionData),
      expiresAt: sessionExpiresAt(sessionData, this.ttlMs)
    })
      .then(() => callback(null))
      .catch((error) => this.handleError(error, callback));
  }

  touch(sessionId, sessionData, callback = () => {}) {
    this.touchSession(sessionId, sessionData, {
      userId: sessionUserId(sessionData),
      expiresAt: sessionExpiresAt(sessionData, this.ttlMs)
    })
      .then(() => callback(null))
      .catch((error) => this.handleError(error, callback));
  }

  destroy(sessionId, callback = () => {}) {
    this.destroySession(sessionId)
      .then(() => callback(null))
      .catch((error) => this.handleError(error, callback));
  }

  clear(callback = () => {}) {
    this.clearSessions()
      .then(() => callback(null))
      .catch((error) => this.handleError(error, callback));
  }

  length(callback) {
    this.countSessions()
      .then((count) => callback(null, count))
      .catch((error) => this.handleError(error, callback));
  }

  all(callback) {
    this.listSessions()
      .then((records) => callback(null, records.map((record) => record.sessionData)))
      .catch((error) => this.handleError(error, callback));
  }

  handleError(error, callback) {
    this.onError(error);
    callback(error);
  }
}

module.exports = {
  PostgresSessionStore,
  sessionExpiresAt,
  sessionUserId
};
