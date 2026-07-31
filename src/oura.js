const crypto = require('crypto');
const {
  SOURCE_IDS,
  enabledOuraProviderDataTypes,
  sourceCatalog,
  sourceConfigurationRequired
} = require('./integration-access');

const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_REVOKE_URL = 'https://api.ouraring.com/oauth/revoke';
const OURA_API_BASE_URL = 'https://api.ouraring.com/v2';
const OURA_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OURA_ACCESS_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const OURA_WEBHOOK_RENEWAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const OURA_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const OURA_DEFAULT_BACKFILL_DAYS = 90;
const OURA_DEFAULT_RECONCILIATION_DAYS = 7;

const BASE_DATA_TYPES = Object.freeze([
  'sleep',
  'daily_sleep',
  'daily_readiness',
  'daily_activity',
  'daily_stress',
  'daily_resilience',
  'sleep_time'
]);

const DATA_TYPE_PATHS = Object.freeze({
  sleep: 'sleep',
  daily_sleep: 'daily_sleep',
  daily_readiness: 'daily_readiness',
  daily_activity: 'daily_activity',
  daily_stress: 'daily_stress',
  daily_resilience: 'daily_resilience',
  sleep_time: 'sleep_time',
  workout: 'workout'
});

const DATA_TYPE_FIELDS = Object.freeze({
  sleep: [
    'average_breath', 'average_heart_rate', 'average_hrv', 'awake_time', 'bedtime_end',
    'bedtime_start', 'day', 'deep_sleep_duration', 'efficiency', 'latency',
    'light_sleep_duration', 'lowest_heart_rate', 'period', 'readiness_score_delta',
    'rem_sleep_duration', 'restless_periods', 'sleep_score_delta', 'time_in_bed',
    'total_sleep_duration', 'type'
  ],
  daily_sleep: ['contributors', 'day', 'score', 'timestamp'],
  daily_readiness: [
    'contributors', 'day', 'score', 'temperature_deviation',
    'temperature_trend_deviation', 'timestamp'
  ],
  daily_activity: [
    'active_calories', 'average_met_minutes', 'contributors', 'day',
    'equivalent_walking_distance', 'high_activity_time', 'inactivity_alerts',
    'low_activity_time', 'medium_activity_time', 'non_wear_time', 'resting_time',
    'score', 'sedentary_time', 'steps', 'target_calories', 'timestamp', 'total_calories'
  ],
  daily_stress: ['day', 'day_summary', 'recovery_high', 'stress_high'],
  daily_resilience: ['contributors', 'day', 'level'],
  sleep_time: ['day', 'optimal_bedtime', 'recommendation', 'status'],
  workout: [
    'activity', 'calories', 'day', 'distance', 'end_datetime', 'intensity',
    'label', 'source', 'start_datetime'
  ]
});

const WEBHOOK_EVENT_TYPES = Object.freeze(['create', 'update', 'delete']);

class OuraApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = 'OuraApiError';
    this.status = status;
    this.payload = payload;
  }
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseEncryptionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== 32) {
    throw new Error('OURA_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return key;
}

function encryptSecret(value, key) {
  if (!key) {
    throw new Error('Oura token encryption is not configured.');
  }
  const plaintext = String(value || '');
  if (!plaintext) {
    throw new Error('Cannot encrypt an empty Oura credential.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value, key) {
  if (!key) {
    throw new Error('Oura token encryption is not configured.');
  }
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Stored Oura credential has an unsupported format.');
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (_error) {
    throw new Error('Stored Oura credential could not be decrypted.');
  }
}

function secureStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyOuraWebhookSignature({
  timestamp,
  rawBody,
  signature,
  clientSecret,
  now = Date.now(),
  toleranceSeconds = OURA_WEBHOOK_TOLERANCE_SECONDS
}) {
  const timestampValue = String(timestamp || '');
  const signatureValue = String(signature || '').replace(/^sha256=/i, '').toUpperCase();
  if (!timestampValue || !clientSecret || !/^[0-9A-F]{64}$/.test(signatureValue)) {
    return false;
  }
  const timestampNumber = Number(timestampValue);
  const webhookTimeMs = timestampNumber < 1e12
    ? timestampNumber * 1000
    : timestampNumber;
  const allowedSkewMs = Math.max(1, Number(toleranceSeconds) || OURA_WEBHOOK_TOLERANCE_SECONDS) * 1000;
  if (
    !Number.isFinite(webhookTimeMs)
    || webhookTimeMs <= 0
    || Math.abs(Number(now) - webhookTimeMs) > allowedSkewMs
  ) {
    return false;
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = crypto
    .createHmac('sha256', String(clientSecret))
    .update(timestampValue, 'utf8')
    .update(body)
    .digest('hex')
    .toUpperCase();
  return secureStringEqual(expected, signatureValue);
}

function buildOuraWebhookReceipt(payload, {
  timestamp,
  rawBody,
  userId = null,
  maxAttempts = 8
} = {}) {
  const eventType = String(payload?.event_type || '').trim().toLowerCase();
  const dataType = String(payload?.data_type || '').trim().toLowerCase();
  const objectId = String(payload?.object_id || '').trim();
  const ouraUserId = String(payload?.user_id || '').trim();
  const timestampValue = String(timestamp || '').trim();
  const supportedDataTypes = new Set([...BASE_DATA_TYPES, 'workout']);
  if (
    !WEBHOOK_EVENT_TYPES.includes(eventType)
    || !supportedDataTypes.has(dataType)
    || !objectId
    || objectId.length > 500
    || !ouraUserId
    || ouraUserId.length > 500
    || !timestampValue
  ) {
    const error = new Error('Oura webhook payload is missing required routing metadata.');
    error.code = 'invalid_oura_webhook';
    throw error;
  }

  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(JSON.stringify(payload), 'utf8');
  const providerEventId = crypto
    .createHash('sha256')
    .update(timestampValue, 'utf8')
    .update(body)
    .digest('hex');
  const timestampNumber = Number(timestampValue);
  const occurredAt = Number.isFinite(timestampNumber) && timestampNumber > 0
    ? new Date(timestampNumber < 1e12 ? timestampNumber * 1000 : timestampNumber)
    : null;

  return {
    provider: 'oura',
    providerEventId,
    eventType,
    deliveryKind: 'webhook',
    userId: String(userId || '').trim() || null,
    payload: {
      ouraUserId,
      dataType,
      objectId
    },
    occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
    maxAttempts
  };
}

function normalizeScopes(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  return [...new Set(input.map((scope) => String(scope || '').trim()).filter(Boolean))];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeAggregateObject(value, depth = 0) {
  if (!isPlainObject(value) || depth > 2) return null;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child) || child === undefined) continue;
    if (child === null || typeof child === 'string' || typeof child === 'boolean') {
      result[key] = child;
    } else if (typeof child === 'number' && Number.isFinite(child)) {
      result[key] = child;
    } else if (isPlainObject(child)) {
      const nested = sanitizeAggregateObject(child, depth + 1);
      if (nested && Object.keys(nested).length) result[key] = nested;
    }
  }
  return result;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function normalizedFields(document, mapping) {
  const normalized = {};
  for (const [target, source] of Object.entries(mapping)) {
    const value = document[source];
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      normalized[target] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[target] = value;
    }
  }
  return normalized;
}

function normalizeOuraDocument(dataType, document) {
  if (!isPlainObject(document) || !document.id) {
    throw new Error(`Oura ${dataType} document is missing an id.`);
  }

  let data;
  switch (dataType) {
    case 'daily_sleep':
      data = {
        ...normalizedFields(document, { score: 'score' }),
        contributors: sanitizeAggregateObject(document.contributors)
      };
      break;
    case 'daily_readiness':
      data = {
        ...normalizedFields(document, {
          score: 'score',
          temperatureDeviationCelsius: 'temperature_deviation',
          temperatureTrendDeviationCelsius: 'temperature_trend_deviation'
        }),
        contributors: sanitizeAggregateObject(document.contributors)
      };
      break;
    case 'daily_activity':
      data = {
        ...normalizedFields(document, {
          activeCalories: 'active_calories',
          averageMetMinutes: 'average_met_minutes',
          equivalentWalkingDistanceMeters: 'equivalent_walking_distance',
          highActivitySeconds: 'high_activity_time',
          inactivityAlerts: 'inactivity_alerts',
          lowActivitySeconds: 'low_activity_time',
          mediumActivitySeconds: 'medium_activity_time',
          nonWearSeconds: 'non_wear_time',
          restingSeconds: 'resting_time',
          score: 'score',
          sedentarySeconds: 'sedentary_time',
          steps: 'steps',
          targetCalories: 'target_calories',
          totalCalories: 'total_calories'
        }),
        contributors: sanitizeAggregateObject(document.contributors)
      };
      break;
    case 'daily_stress':
      data = normalizedFields(document, {
        daySummary: 'day_summary',
        recoveryHighSeconds: 'recovery_high',
        stressHighSeconds: 'stress_high'
      });
      break;
    case 'daily_resilience':
      data = {
        ...normalizedFields(document, { level: 'level' }),
        contributors: sanitizeAggregateObject(document.contributors)
      };
      break;
    case 'sleep_time':
      data = {
        ...normalizedFields(document, {
          recommendation: 'recommendation',
          status: 'status'
        }),
        optimalBedtime: sanitizeAggregateObject(document.optimal_bedtime)
      };
      break;
    case 'sleep':
      data = normalizedFields(document, {
        averageBreath: 'average_breath',
        averageHeartRate: 'average_heart_rate',
        averageHrv: 'average_hrv',
        awakeSeconds: 'awake_time',
        bedtimeEnd: 'bedtime_end',
        bedtimeStart: 'bedtime_start',
        deepSleepSeconds: 'deep_sleep_duration',
        efficiency: 'efficiency',
        latencySeconds: 'latency',
        lightSleepSeconds: 'light_sleep_duration',
        lowestHeartRate: 'lowest_heart_rate',
        period: 'period',
        readinessScoreDelta: 'readiness_score_delta',
        remSleepSeconds: 'rem_sleep_duration',
        restlessPeriods: 'restless_periods',
        sleepScoreDelta: 'sleep_score_delta',
        timeInBedSeconds: 'time_in_bed',
        totalSleepSeconds: 'total_sleep_duration',
        type: 'type'
      });
      break;
    case 'workout':
      data = normalizedFields(document, {
        activity: 'activity',
        calories: 'calories',
        distanceMeters: 'distance',
        endDateTime: 'end_datetime',
        intensity: 'intensity',
        label: 'label',
        source: 'source',
        startDateTime: 'start_datetime'
      });
      if (data.startDateTime && data.endDateTime) {
        const durationSeconds = (new Date(data.endDateTime).getTime() - new Date(data.startDateTime).getTime()) / 1000;
        if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
          data.durationSeconds = durationSeconds;
        }
      }
      break;
    default:
      throw new Error(`Unsupported Oura data type: ${dataType}`);
  }

  return {
    providerDocumentId: String(document.id),
    day: typeof document.day === 'string' ? document.day : null,
    recordedAt:
      document.timestamp ||
      document.start_datetime ||
      document.bedtime_start ||
      null,
    data: compactObject(data)
  };
}

function isoDayOffset(daysFromToday) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'Unknown Oura error').slice(0, 500);
}

function requiresOuraReauthorization(error) {
  if (!(error instanceof OuraApiError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  return ['invalid_grant', 'invalid_token'].includes(String(error.payload?.error || ''));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(fetchImpl, url, options = {}, retryCount = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      const raw = await response.text();
      let payload = null;
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch (_error) {
          payload = null;
        }
      }

      if (response.ok) return payload;

      const detail = payload?.detail || payload?.error_description || payload?.title;
      const error = new OuraApiError(
        detail ? `Oura API request failed: ${detail}` : `Oura API request failed with status ${response.status}.`,
        response.status,
        payload
      );
      if ((response.status === 429 || response.status >= 500) && attempt < retryCount) {
        const retryAfterSeconds = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfterSeconds)
          ? Math.min(Math.max(retryAfterSeconds * 1000, 250), 3000)
          : 250 * (2 ** attempt);
        await wait(delay);
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error;
      if (error instanceof OuraApiError || attempt >= retryCount) throw error;
      await wait(250 * (2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Oura API request failed.');
}

function createOuraService({ db, env = process.env, fetchImpl = globalThis.fetch, logger = () => {} }) {
  if (!db) throw new Error('Oura service requires database methods.');
  if (typeof fetchImpl !== 'function') throw new Error('Oura service requires fetch support.');

  const clientId = String(env.OURA_CLIENT_ID || '').trim();
  const clientSecret = String(env.OURA_CLIENT_SECRET || '').trim();
  const appBaseUrl = String(env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const redirectUri = String(env.OURA_REDIRECT_URI || `${appBaseUrl}/auth/oura/callback`).trim();
  const webhookUrl = String(env.OURA_WEBHOOK_URL || `${appBaseUrl}/webhooks/oura`).trim();
  const webhookVerificationToken = String(env.OURA_WEBHOOK_VERIFICATION_TOKEN || '').trim();
  const encryptionKey = parseEncryptionKey(env.OURA_TOKEN_ENCRYPTION_KEY);
  const includeWorkouts = parseBoolean(env.OURA_INCLUDE_WORKOUTS, false);
  const dataTypes = includeWorkouts ? [...BASE_DATA_TYPES, 'workout'] : [...BASE_DATA_TYPES];
  const requestedScopes = includeWorkouts ? ['personal', 'daily', 'workout'] : ['personal', 'daily'];
  const inFlightSyncs = new Map();
  let backgroundJobs = null;

  async function loadAccessPermissions(userId) {
    if (typeof db.listIntegrationDataPermissions !== 'function') return [];
    return db.listIntegrationDataPermissions(userId, SOURCE_IDS.OURA);
  }

  async function getAccessPlan(userId, { workoutsEnabled = includeWorkouts } = {}) {
    const permissions = await loadAccessPermissions(userId);
    const ouraWorkoutsEnabled = includeWorkouts && workoutsEnabled;
    const catalog = sourceCatalog(SOURCE_IDS.OURA, { ouraWorkoutsEnabled });
    return {
      permissions,
      configurationRequired: sourceConfigurationRequired(catalog, permissions, { connected: true }),
      enabledProviderDataTypes: enabledOuraProviderDataTypes(permissions, {
        includeWorkouts: ouraWorkoutsEnabled
      })
    };
  }

  function accessRequiredError() {
    const error = new Error('Choose which Oura data Macrovana may read before syncing.');
    error.code = 'integration_access_required';
    return error;
  }

  const missingConfiguration = [];
  if (!clientId) missingConfiguration.push('OURA_CLIENT_ID');
  if (!clientSecret) missingConfiguration.push('OURA_CLIENT_SECRET');
  if (!redirectUri) missingConfiguration.push('OURA_REDIRECT_URI');
  if (!encryptionKey) missingConfiguration.push('OURA_TOKEN_ENCRYPTION_KEY');
  const oauthConfigured = missingConfiguration.length === 0;

  let webhookUsesHttps = false;
  try {
    webhookUsesHttps = new URL(webhookUrl).protocol === 'https:';
  } catch (_error) {
    webhookUsesHttps = false;
  }
  if (!webhookVerificationToken) missingConfiguration.push('OURA_WEBHOOK_VERIFICATION_TOKEN');
  if (!webhookUsesHttps) missingConfiguration.push('OURA_WEBHOOK_URL (public HTTPS URL)');
  const webhookConfigured = oauthConfigured && webhookVerificationToken && webhookUsesHttps;

  function assertOAuthConfigured() {
    if (!oauthConfigured) {
      throw new Error(`Oura integration is not configured (${missingConfiguration.join(', ')}).`);
    }
  }

  async function tokenRequest(parameters) {
    const body = new URLSearchParams({
      ...parameters,
      client_id: clientId,
      client_secret: clientSecret
    });
    // Authorization codes and Oura refresh tokens are single-use. A retry after
    // an ambiguous network failure could consume the same credential twice and
    // destroy the only valid refresh path, so token exchanges are never retried.
    return requestJson(fetchImpl, OURA_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    }, 0);
  }

  function tokenExpiration(tokenPayload) {
    const expiresInSeconds = Math.max(60, Number(tokenPayload?.expires_in) || 30 * 24 * 60 * 60);
    return new Date(Date.now() + expiresInSeconds * 1000);
  }

  async function apiRequestWithToken(accessToken, path, { method = 'GET', query, body } = {}) {
    const url = new URL(`${OURA_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    return requestJson(fetchImpl, url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  async function getAccessToken(userId, { forceRefresh = false } = {}) {
    assertOAuthConfigured();
    const connection = await db.getOuraConnection(userId);
    if (!connection) throw new Error('Oura is not connected.');
    const accessTokenVersion = connection.accessTokenEncrypted;

    const expiresAt = new Date(connection.tokenExpiresAt || 0).getTime();
    if (!forceRefresh && expiresAt > Date.now() + OURA_ACCESS_TOKEN_REFRESH_SKEW_MS) {
      return decryptSecret(connection.accessTokenEncrypted, encryptionKey);
    }

    const rotated = await db.rotateOuraConnectionTokens(userId, async (lockedConnection) => {
      const lockedExpiresAt = new Date(lockedConnection.tokenExpiresAt || 0).getTime();
      if (forceRefresh && lockedConnection.accessTokenEncrypted !== accessTokenVersion) {
        return null;
      }
      if (!forceRefresh && lockedExpiresAt > Date.now() + OURA_ACCESS_TOKEN_REFRESH_SKEW_MS) {
        return null;
      }

      const refreshToken = decryptSecret(lockedConnection.refreshTokenEncrypted, encryptionKey);
      const tokenPayload = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });
      if (!tokenPayload?.access_token || !tokenPayload?.refresh_token) {
        throw new Error('Oura returned an incomplete refresh response.');
      }

      return {
        accessTokenEncrypted: encryptSecret(tokenPayload.access_token, encryptionKey),
        refreshTokenEncrypted: encryptSecret(tokenPayload.refresh_token, encryptionKey),
        tokenExpiresAt: tokenExpiration(tokenPayload),
        scopes: normalizeScopes(tokenPayload.scope).length
          ? normalizeScopes(tokenPayload.scope)
          : lockedConnection.scopes
      };
    });

    return decryptSecret(rotated.accessTokenEncrypted, encryptionKey);
  }

  async function userApiRequest(userId, path, options = {}) {
    let accessToken = await getAccessToken(userId);
    try {
      return await apiRequestWithToken(accessToken, path, options);
    } catch (error) {
      if (!(error instanceof OuraApiError) || error.status !== 401) throw error;
      accessToken = await getAccessToken(userId, { forceRefresh: true });
      return apiRequestWithToken(accessToken, path, options);
    }
  }

  async function createAuthorization(userId, returnTo = 'web') {
    assertOAuthConfigured();
    const normalizedReturnTo = returnTo === 'ios' ? 'ios' : 'web';
    const state = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    await db.createOuraOauthState(
      stateHash,
      userId,
      normalizedReturnTo,
      new Date(Date.now() + OURA_OAUTH_STATE_TTL_MS)
    );

    const url = new URL(OURA_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', requestedScopes.join(' '));
    url.searchParams.set('state', state);
    return { authorizationUrl: url.toString() };
  }

  async function revokeAccessToken(accessToken) {
    if (!accessToken || !clientId) return;
    const url = new URL(OURA_REVOKE_URL);
    url.searchParams.set('access_token', accessToken);
    try {
      await requestJson(fetchImpl, url, { method: 'GET', headers: { Accept: 'application/json' } }, 0);
    } catch (error) {
      logger('warn', 'oura_token_revoke_failed', { message: safeErrorMessage(error) });
    }
  }

  async function completeAuthorization({ code, state, error: oauthError, scope }) {
    assertOAuthConfigured();
    const stateHash = crypto.createHash('sha256').update(String(state || '')).digest('hex');
    const oauthState = await db.consumeOuraOauthState(stateHash);
    if (!oauthState) {
      throw new Error('Oura authorization expired or could not be verified.');
    }
    let issuedAccessToken = null;
    let connectionStored = false;
    try {
      if (oauthError) {
        throw new Error(oauthError === 'access_denied' ? 'Oura access was not granted.' : 'Oura authorization failed.');
      }
      if (!code) {
        throw new Error('Oura did not return an authorization code.');
      }

      const tokenPayload = await tokenRequest({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri
      });
      issuedAccessToken = tokenPayload?.access_token || null;
      if (!tokenPayload?.access_token || !tokenPayload?.refresh_token) {
        throw new Error('Oura returned an incomplete authorization response.');
      }

      const grantedScopes = normalizeScopes(tokenPayload.scope || scope);
      for (const requiredScope of ['personal', 'daily']) {
        if (grantedScopes.includes(requiredScope)) continue;
        throw new Error(`Oura ${requiredScope} access is required for this integration.`);
      }

      const personalInfo = await apiRequestWithToken(tokenPayload.access_token, '/usercollection/personal_info');
      const ouraUserId = String(personalInfo?.id || '').trim();
      if (!ouraUserId) {
        throw new Error('Oura did not return a user identifier.');
      }

      const previousConnection = await db.getOuraConnection(oauthState.userId);
      const existingConnection = await db.getOuraConnectionByProviderUserId(ouraUserId);
      if (existingConnection && existingConnection.userId !== oauthState.userId) {
        throw new Error('This Oura account is already connected to another Macrovana account.');
      }

      const isNewOrDifferentConnection = !previousConnection || previousConnection.ouraUserId !== ouraUserId;
      if (isNewOrDifferentConnection && typeof db.deleteIntegrationDataPermissions === 'function') {
        await db.deleteIntegrationDataPermissions(oauthState.userId, SOURCE_IDS.OURA);
      }
      const accessPlan = isNewOrDifferentConnection
        ? { configurationRequired: true }
        : await getAccessPlan(oauthState.userId, {
          workoutsEnabled: grantedScopes.includes('workout')
        });

      await db.upsertOuraConnection(oauthState.userId, {
        ouraUserId,
        accessTokenEncrypted: encryptSecret(tokenPayload.access_token, encryptionKey),
        refreshTokenEncrypted: encryptSecret(tokenPayload.refresh_token, encryptionKey),
        tokenExpiresAt: tokenExpiration(tokenPayload),
        scopes: grantedScopes,
        status: accessPlan.configurationRequired ? 'permissions_required' : 'syncing'
      });
      connectionStored = true;

      if (previousConnection && previousConnection.ouraUserId !== ouraUserId) {
        try {
          await revokeAccessToken(decryptSecret(previousConnection.accessTokenEncrypted, encryptionKey));
        } catch (error) {
          logger('warn', 'oura_previous_connection_revoke_skipped', {
            userId: oauthState.userId,
            message: safeErrorMessage(error)
          });
        }
      }

      return {
        userId: oauthState.userId,
        returnTo: oauthState.returnTo,
        grantedScopes,
        configurationRequired: accessPlan.configurationRequired,
        shouldInitialize: !accessPlan.configurationRequired
      };
    } catch (error) {
      if (issuedAccessToken && !connectionStored) {
        await revokeAccessToken(issuedAccessToken);
      }
      error.returnTo = error.returnTo || oauthState.returnTo;
      throw error;
    }
  }

  async function fetchDocumentCollection(userId, dataType, startDate, endDate) {
    const path = DATA_TYPE_PATHS[dataType];
    if (!path) throw new Error(`Unsupported Oura data type: ${dataType}`);

    const reconciliationStartedAt = new Date();
    const seenIds = [];
    let nextToken = null;
    let pageCount = 0;
    do {
      const payload = await userApiRequest(userId, `/usercollection/${path}`, {
        query: {
          start_date: startDate,
          end_date: endDate,
          next_token: nextToken,
          fields: DATA_TYPE_FIELDS[dataType].join(',')
        }
      });
      if (!payload || !Array.isArray(payload.data)) {
        throw new Error(`Oura ${dataType} returned an invalid collection response.`);
      }
      const documents = payload.data;
      for (const document of documents) {
        const normalized = normalizeOuraDocument(dataType, document);
        seenIds.push(normalized.providerDocumentId);
        // Reconciliation and backfill can update active records, but cannot
        // clear a durable tombstone. Only a later verified signed create/update
        // delivery may explicitly resurrect the provider record.
        await db.upsertOuraDocument(userId, dataType, normalized, { resurrect: false });
      }
      nextToken = payload?.next_token || null;
      pageCount += 1;
      if (pageCount > 100) throw new Error(`Oura ${dataType} pagination exceeded the safety limit.`);
    } while (nextToken);

    await db.reconcileOuraDocuments(
      userId,
      dataType,
      startDate,
      endDate,
      seenIds,
      reconciliationStartedAt
    );
    return seenIds.length;
  }

  async function runSync(userId, days) {
    const normalizedDays = Math.min(Math.max(Number(days) || OURA_DEFAULT_RECONCILIATION_DAYS, 1), OURA_DEFAULT_BACKFILL_DAYS);
    const startDate = isoDayOffset(-(normalizedDays - 1));
    const endDate = isoDayOffset(1);
    const connection = await db.getOuraConnection(userId);
    if (!connection) throw new Error('Oura is not connected.');
    const accessPlan = await getAccessPlan(userId, {
      workoutsEnabled: connection.scopes.includes('workout')
    });
    if (accessPlan.configurationRequired) {
      await db.updateOuraConnection(userId, { status: 'permissions_required', lastError: null });
      throw accessRequiredError();
    }
    await db.updateOuraConnection(userId, { status: 'syncing', lastError: null });

    try {
      const enabledDataTypes = accessPlan.enabledProviderDataTypes.filter((dataType) =>
        dataType !== 'workout' || (includeWorkouts && connection.scopes.includes('workout'))
      );
      const counts = {};
      for (const dataType of enabledDataTypes) {
        counts[dataType] = await fetchDocumentCollection(userId, dataType, startDate, endDate);
      }
      const syncedAt = new Date();
      await db.updateOuraConnection(userId, {
        status: 'connected',
        lastSyncedAt: syncedAt,
        lastError: null
      });
      return { syncedAt: syncedAt.toISOString(), counts };
    } catch (error) {
      if (error?.code === 'integration_access_required') throw error;
      const status = requiresOuraReauthorization(error) ? 'reauthorization_required' : 'error';
      await db.updateOuraConnection(userId, { status, lastError: safeErrorMessage(error) });
      throw error;
    }
  }

  async function syncUser(userId, { days = OURA_DEFAULT_RECONCILIATION_DAYS } = {}) {
    if (inFlightSyncs.has(userId)) return inFlightSyncs.get(userId);
    const promise = runSync(userId, days).finally(() => inFlightSyncs.delete(userId));
    inFlightSyncs.set(userId, promise);
    return promise;
  }

  async function initializeConnection(userId) {
    const results = await Promise.allSettled([
      syncUser(userId, { days: OURA_DEFAULT_BACKFILL_DAYS }),
      ensureWebhookSubscriptions()
    ]);
    const syncResult = results[0];
    if (syncResult.status === 'rejected') throw syncResult.reason;
    if (results[1].status === 'rejected') {
      logger('warn', 'oura_webhook_setup_failed', { message: safeErrorMessage(results[1].reason) });
    }
    return syncResult.value;
  }

  async function fetchSingleDocument(userId, dataType, objectId, { resurrect = false } = {}) {
    const path = DATA_TYPE_PATHS[dataType];
    if (!path) return { ignored: true };
    try {
      const document = await userApiRequest(
        userId,
        `/usercollection/${path}/${encodeURIComponent(String(objectId))}`
      );
      const normalized = normalizeOuraDocument(dataType, document);
      await db.upsertOuraDocument(userId, dataType, normalized, { resurrect });
      return { updated: true };
    } catch (error) {
      if (error instanceof OuraApiError && error.status === 404) {
        await db.deleteOuraDocument(userId, dataType, String(objectId));
        return { deleted: true };
      }
      throw error;
    }
  }

  async function processWebhookEvent(event) {
    const eventType = String(event?.eventType || '').trim().toLowerCase();
    const dataType = String(event?.payload?.dataType || '').trim().toLowerCase();
    const objectId = String(event?.payload?.objectId || '').trim();
    const ouraUserId = String(event?.payload?.ouraUserId || '').trim();
    if (!WEBHOOK_EVENT_TYPES.includes(eventType) || !dataTypes.includes(dataType) || !objectId || !ouraUserId) {
      return { ignored: true };
    }

    const connection = event?.userId
      ? await db.getOuraConnection(event.userId)
      : await db.getOuraConnectionByProviderUserId(ouraUserId);
    if (!connection) return { ignored: true };
    if (connection.ouraUserId !== ouraUserId) return { ignored: true };
    if (dataType === 'workout' && !connection.scopes.includes('workout')) {
      return { ignored: true };
    }
    const accessPlan = await getAccessPlan(connection.userId, {
      workoutsEnabled: connection.scopes.includes('workout')
    });
    if (
      accessPlan.configurationRequired
      || !accessPlan.enabledProviderDataTypes.includes(dataType)
    ) {
      return { ignored: true, reason: 'access_disabled' };
    }
    const receivedAt = event?.receivedAt ? new Date(event.receivedAt) : new Date();
    await db.updateOuraConnection(connection.userId, { lastWebhookAt: receivedAt });

    try {
      // Always read current provider state. This makes stale/out-of-order delete
      // notifications harmless when the object still exists, while a 404 writes
      // a durable tombstone for any event type. Only signed create/update
      // notifications can clear an existing tombstone.
      const resurrect = event?.deliveryKind === 'webhook'
        && (eventType === 'create' || eventType === 'update');
      const result = await fetchSingleDocument(connection.userId, dataType, objectId, { resurrect });
      await db.updateOuraConnection(connection.userId, { status: 'connected', lastError: null });
      return result;
    } catch (error) {
      await db.updateOuraConnection(connection.userId, {
        status: requiresOuraReauthorization(error) ? 'reauthorization_required' : 'error',
        lastError: safeErrorMessage(error)
      });
      throw error;
    }
  }

  async function processWebhook(payload) {
    return processWebhookEvent({
      provider: 'oura',
      eventType: payload?.event_type,
      deliveryKind: 'webhook',
      payload: {
        dataType: payload?.data_type,
        objectId: payload?.object_id,
        ouraUserId: payload?.user_id
      }
    });
  }

  async function webhookRequest(path, { method = 'GET', body } = {}) {
    return requestJson(fetchImpl, `${OURA_API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  async function ensureWebhookSubscriptions() {
    if (!webhookConfigured) return { configured: false, count: 0 };
    const remoteSubscriptions = await webhookRequest('/webhook/subscription');
    const subscriptions = Array.isArray(remoteSubscriptions) ? remoteSubscriptions : [];
    let count = 0;

    for (const dataType of dataTypes) {
      for (const eventType of WEBHOOK_EVENT_TYPES) {
        let subscription = subscriptions.find((candidate) =>
          candidate.callback_url === webhookUrl &&
          candidate.data_type === dataType &&
          candidate.event_type === eventType
        );
        const expiration = new Date(subscription?.expiration_time || 0).getTime();
        if (subscription && expiration < Date.now() + OURA_WEBHOOK_RENEWAL_WINDOW_MS) {
          subscription = await webhookRequest(`/webhook/subscription/renew/${encodeURIComponent(subscription.id)}`, {
            method: 'PUT'
          });
        } else if (!subscription) {
          subscription = await webhookRequest('/webhook/subscription', {
            method: 'POST',
            body: {
              callback_url: webhookUrl,
              verification_token: webhookVerificationToken,
              event_type: eventType,
              data_type: dataType
            }
          });
        }

        if (subscription?.id) {
          await db.upsertOuraWebhookSubscription(subscription);
          count += 1;
        }
      }
    }
    return { configured: true, count };
  }

  async function getStatus(userId) {
    const connection = await db.getOuraConnection(userId);
    const subscriptions = webhookConfigured && db.listOuraWebhookSubscriptions
      ? await db.listOuraWebhookSubscriptions(webhookUrl)
      : [];
    const expectedWebhookSubscriptions = dataTypes.length * WEBHOOK_EVENT_TYPES.length;
    const activeSubscriptionKeys = new Set(subscriptions.map((subscription) =>
      `${subscription.data_type || subscription.dataType}:${subscription.event_type || subscription.eventType}`
    ));
    const webhooksActive = webhookConfigured && dataTypes.every((dataType) =>
      WEBHOOK_EVENT_TYPES.every((eventType) => activeSubscriptionKeys.has(`${dataType}:${eventType}`))
    );
    return {
      configured: oauthConfigured,
      webhookConfigured: Boolean(webhookConfigured),
      connected: Boolean(connection),
      state: connection?.status || (oauthConfigured ? 'disconnected' : 'not_configured'),
      requestedScopes,
      grantedScopes: connection?.scopes || [],
      lastSyncedAt: connection?.lastSyncedAt || null,
      lastWebhookAt: connection?.lastWebhookAt || null,
      lastError: connection?.lastError || null,
      updateMode: webhooksActive ? 'webhook' : 'reconciliation',
      expectedUpdateDelaySeconds: webhooksActive ? 30 : null,
      webhookSubscriptions: subscriptions.length,
      expectedWebhookSubscriptions,
      missingConfiguration: [...new Set(missingConfiguration)]
    };
  }

  async function listDocuments(userId, options = {}) {
    return db.listOuraDocuments(userId, options);
  }

  async function disconnectUser(userId) {
    const connection = await db.getOuraConnection(userId);
    if (connection && encryptionKey) {
      try {
        await revokeAccessToken(decryptSecret(connection.accessTokenEncrypted, encryptionKey));
      } catch (error) {
        logger('warn', 'oura_disconnect_revoke_skipped', { userId, message: safeErrorMessage(error) });
      }
    }
    await db.deleteOuraConnection(userId, { deleteData: true });
    return { ok: true, deletedData: true };
  }

  function verifyChallenge(verificationToken) {
    return Boolean(webhookVerificationToken) && secureStringEqual(verificationToken, webhookVerificationToken);
  }

  function verifyWebhook({ timestamp, rawBody, signature }) {
    return verifyOuraWebhookSignature({ timestamp, rawBody, signature, clientSecret });
  }

  function startBackgroundJobs() {
    if (backgroundJobs) return;
    if (!oauthConfigured) {
      logger('warn', 'oura_provider_sync_disabled', {
        missingConfiguration: [...new Set(missingConfiguration)]
      });
      return;
    }

    const reconciliationMinutes = Math.max(5, Number(env.OURA_RECONCILIATION_MINUTES) || 60);
    const state = {
      stopped: false,
      running: false,
      currentRun: null,
      initialTimer: null,
      interval: null
    };
    const run = async () => {
      if (state.stopped || state.running) return state.currentRun;
      state.running = true;
      state.currentRun = (async () => {
        try {
          await ensureWebhookSubscriptions();
          const connections = await db.listActiveOuraConnections();
          for (const connection of connections) {
            if (state.stopped) break;
            try {
              await syncUser(connection.userId, { days: OURA_DEFAULT_RECONCILIATION_DAYS });
            } catch (error) {
              if (error?.code !== 'integration_access_required') {
                logger('warn', 'oura_reconciliation_failed', {
                  userId: connection.userId,
                  message: safeErrorMessage(error)
                });
              }
            }
          }
        } catch (error) {
          logger('warn', 'oura_background_job_failed', { message: safeErrorMessage(error) });
        } finally {
          state.running = false;
          state.currentRun = null;
        }
      })();
      return state.currentRun;
    };

    state.initialTimer = setTimeout(run, 5000);
    state.interval = setInterval(run, reconciliationMinutes * 60 * 1000);
    state.initialTimer.unref?.();
    state.interval.unref?.();
    backgroundJobs = state;
  }

  async function stopBackgroundJobs({ timeoutMs = 30_000 } = {}) {
    const state = backgroundJobs;
    backgroundJobs = null;
    if (!state) return { drained: true };
    state.stopped = true;
    clearTimeout(state.initialTimer);
    clearInterval(state.interval);
    if (!state.currentRun) return { drained: true };

    let drainTimer;
    const drained = await Promise.race([
      state.currentRun.then(() => true),
      new Promise((resolve) => {
        drainTimer = setTimeout(() => resolve(false), Math.max(1, Number(timeoutMs) || 30_000));
      })
    ]);
    if (drainTimer) clearTimeout(drainTimer);
    return { drained };
  }

  return {
    createAuthorization,
    completeAuthorization,
    disconnectUser,
    ensureWebhookSubscriptions,
    getStatus,
    initializeConnection,
    listDocuments,
    processWebhook,
    processWebhookEvent,
    startBackgroundJobs,
    stopBackgroundJobs,
    syncUser,
    verifyChallenge,
    verifyWebhook,
    get oauthConfigured() {
      return Boolean(oauthConfigured);
    },
    get webhookConfigured() {
      return Boolean(webhookConfigured);
    }
  };
}

module.exports = {
  BASE_DATA_TYPES,
  OuraApiError,
  buildOuraWebhookReceipt,
  createOuraService,
  decryptSecret,
  encryptSecret,
  normalizeOuraDocument,
  parseEncryptionKey,
  verifyOuraWebhookSignature
};
