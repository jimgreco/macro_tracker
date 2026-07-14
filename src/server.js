// --- Macro Tracker Server ---
// Last Deployed: 2026-04-03
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const OpenAI = require('openai');
const Stripe = require('stripe');
const appleSignin = require('apple-signin-auth');
const heicConvert = require('heic-convert');
const {
  initDb,
  checkDatabaseHealth,
  upsertUser,
  getUserAccountControls,
  listAdminAccounts,
  updateAdminAccountControls,
  updateUserPreferences,
  getProviderUserId,
  logAudit,
  logClientDiagnostic,
  listClientDiagnostics,
  addEntries,
  copyEntriesForLocalDay,
  copyEntriesToLocalDay,
  updateEntry,
  deleteEntry,
  scaleMealGroup,
  combineEntries,
  splitMealGroup,
  removeFromMealGroup,
  addSavedItem,
  updateSavedItem,
  deleteSavedItem,
  listSavedItems,
  addStarterQuickAdds,
  quickAddFromSaved,
  applyFoodCorrections,
  claimLegacyData,
  getDashboard,
  getDailyTotals,
  getMacroTargets,
  getMacroTargetHistory,
  setMacroTarget,
  addWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  listWeightEntries,
  getWeightTarget,
  setWeightTarget,
  addWorkoutEntry,
  updateWorkoutEntry,
  deleteWorkoutEntry,
  listWorkoutEntries,
  addSexualActivityEntry,
  updateSexualActivityEntry,
  deleteSexualActivityEntry,
  listSexualActivityEntries,
  addSleepEntry,
  updateSleepEntry,
  deleteSleepEntry,
  listSleepEntries,
  getAnalysisSnapshot,
  saveAnalysisReport,
  getLatestAnalysisReport,
  createApiToken,
  validateApiToken,
  listApiTokens,
  deleteApiToken,
  deleteAllApiTokens,
  listCoachDismissals,
  upsertCoachDismissals,
  deleteCoachDismissals,
  exportUserData,
  deleteUserAccount,
  getPlanLimits,
  getSubscription,
  upsertSubscription,
  getSubscriptionByStripeCustomerId,
  saveBillingEvent,
  consumeDailyUsage
} = require('./db');
const { parseMealText, parseWorkoutText } = require('./parser');
const { estimateWorkoutCalories } = require('./workout-calories');
const { scaleMealUnitRows } = require('./meal-normalizer');
const packageJson = require('../package.json');

const app = express();
const port = Number(process.env.PORT) || 3000;
const BUILD_HASH_DIGITS = 7;
const MAX_MEAL_PARSE_IMAGES = 4;
const MAX_MEAL_PARSE_IMAGE_BYTES = 6 * 1024 * 1024;

function formatBuildIdentifier(build) {
  const value = String(build || '').trim();
  if (/^[0-9a-f]{8,40}$/i.test(value)) {
    return value.slice(0, BUILD_HASH_DIGITS);
  }
  return value;
}

app.disable('x-powered-by');
app.set('trust proxy', parsePositiveIntegerEnv('TRUST_PROXY_HOPS', 1));
const appBuild = formatBuildIdentifier(process.env.APP_BUILD || process.env.GITHUB_SHA || 'local');
const startedAtIso = new Date().toISOString();

const scriptPath = path.join(process.cwd(), 'public', 'script.js');
const scriptHash = crypto
  .createHash('md5')
  .update(fs.readFileSync(scriptPath))
  .digest('hex')
  .slice(0, 8);
const indexHtmlRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
const indexHtml = indexHtmlRaw.replace('src="/script.js"', `src="/script.js?v=${scriptHash}"`);
const adminScriptPath = path.join(process.cwd(), 'public', 'admin.js');
const adminScriptHash = crypto
  .createHash('md5')
  .update(fs.readFileSync(adminScriptPath))
  .digest('hex')
  .slice(0, 8);
const adminHtmlRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'admin.html'), 'utf8');
const adminHtml = adminHtmlRaw.replace('src="/admin.js"', `src="/admin.js?v=${adminScriptHash}"`);
const isProduction = process.env.NODE_ENV === 'production';

const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const defaultGoogleIOSClientId = '1018348991868-nbg9k2aht11942u6es07t564bgahd0er.apps.googleusercontent.com';
const googleIOSClientId = process.env.GOOGLE_IOS_CLIENT_ID || defaultGoogleIOSClientId;
const oauthCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/auth/google/callback`;

const appleClientId = process.env.APPLE_CLIENT_ID || ''; // Service ID (e.g. com.macroflow.web)
const appleTeamId = process.env.APPLE_TEAM_ID || '';
const appleKeyId = process.env.APPLE_KEY_ID || '';
const applePrivateKey = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const appleRedirectUri = process.env.APPLE_REDIRECT_URI || `${process.env.APP_BASE_URL || `http://localhost:${port}`}/auth/apple/callback`;
const defaultAppleBundleId = 'com.dailymacros.app';
const appleBundleId = process.env.APPLE_BUNDLE_ID || defaultAppleBundleId; // iOS app bundle ID

function parseBooleanEnv(name, fallbackValue = false) {
  const normalized = String(process.env[name] || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallbackValue;
}

function parseCsvSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

const localAuthBypassEnabled = !isProduction && parseBooleanEnv('LOCAL_AUTH_BYPASS', false);
const localDevUser = !isProduction
  ? {
      id: String(process.env.LOCAL_DEV_USER_ID || 'local-dev-user'),
      name: String(process.env.LOCAL_DEV_USER_NAME || 'Local Preview User'),
      email: String(process.env.LOCAL_DEV_USER_EMAIL || 'local-preview@example.com'),
      picture: null,
      provider: 'local-dev'
    }
  : null;
const localAuthBypassUser = localAuthBypassEnabled ? localDevUser : null;
const adminEmails = parseCsvSet(process.env.ADMIN_EMAILS);
const adminUserIds = parseCsvSet(process.env.ADMIN_USER_IDS);

if (isProduction && sessionSecret === 'dev-session-secret-change-me') {
  throw new Error('SESSION_SECRET must be set to a strong value in production.');
}

function parsePositiveIntegerEnv(name, fallbackValue) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallbackValue;
  }
  return Math.floor(raw);
}

function normalizeGoogleTokenBoolean(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function verifiedTokenEmail(payload) {
  if (!payload?.email || !normalizeGoogleTokenBoolean(payload.email_verified)) {
    return null;
  }
  return String(payload.email);
}

function getAllowedOrigins() {
  const origins = new Set();
  const appBaseUrl = String(process.env.APP_BASE_URL || '').trim();
  if (appBaseUrl) {
    try {
      origins.add(new URL(appBaseUrl).origin);
    } catch (error) {
      // Ignore invalid APP_BASE_URL values.
    }
  }
  if (!isProduction) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }
  return origins;
}

const allowedOrigins = getAllowedOrigins();

function createRequestId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function logJson(level, event, fields = {}) {
  const payload = {
    level,
    event,
    ...fields
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 500);
}

function logServerError(req, error, context = {}) {
  logJson('error', 'server_error', {
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl || req?.url,
    message: safeErrorMessage(error),
    ...context
  });
}

function sendError(req, res, status, message, error) {
  if (status >= 500 && error) {
    logServerError(req, error, { status });
  }
  const body = { error: message };
  if (req?.requestId) {
    body.requestId = req.requestId;
  }
  return res.status(status).json(body);
}

app.use((req, res, next) => {
  const incoming = String(req.get('x-request-id') || '').trim();
  req.requestId = /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming) ? incoming : createRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && body.error && !body.requestId) {
      body.requestId = req.requestId;
    }
    return json(body);
  };
  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logJson(res.statusCode >= 500 ? 'error' : 'info', 'http_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id || null
    });
  });
  next();
});

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function isAllowedSource(rawSource, req) {
  if (!rawSource) return true;
  try {
    const origin = new URL(rawSource).origin;
    if (allowedOrigins.size > 0 && allowedOrigins.has(origin)) {
      return true;
    }
    const host = req.get('host');
    if (host && origin === `${req.protocol}://${host}`) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function enforceStateChangingSource(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  if (req.authMode === 'bearer') {
    return next();
  }

  const origin = req.get('origin');
  const referer = req.get('referer');
  const source = origin || referer || '';
  if (!source || !isAllowedSource(source, req)) {
    return sendError(req, res, 403, 'Forbidden request origin.');
  }
  return next();
}

const enforceApiSource = enforceStateChangingSource;

// ── Per-user rate limiting (falls back to IP for unauthenticated requests) ──

function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const userId = req.user && req.user.id ? req.user.id : req.ip;
    const key = `${userId}:${req.baseUrl}${req.path}`;
    const current = hits.get(key);

    if (!current || now > current.expiresAt) {
      hits.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > maxRequests) {
      const retryAfterSeconds = Math.ceil((current.expiresAt - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      return sendError(req, res, 429, 'Too many requests. Please retry shortly.');
    }

    return next();
  };
}

app.use(securityHeaders);



passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (googleClientId && googleClientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: oauthCallbackUrl
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const picture = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

        return done(null, {
          id: profile.id,
          providerUserId: profile.id,
          name: profile.displayName,
          email,
          picture,
          provider: 'google'
        });
      }
    )
  );
}

// ── Stripe setup ──
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripePriceId = process.env.STRIPE_PRO_PRICE_ID || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

// Stripe webhook must be registered BEFORE express.json() — it needs the raw body
if (stripe && stripeWebhookSecret) {
  app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], stripeWebhookSecret);
    } catch (err) {
      return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    }

    try {
      const data = event.data.object;
      let userId = null;

      if (data.customer) {
        const sub = await getSubscriptionByStripeCustomerId(String(data.customer));
        if (sub) userId = sub.user_id;
      }

      await saveBillingEvent(userId, event.id, event.type, data);

      switch (event.type) {
        case 'checkout.session.completed': {
          if (data.mode === 'subscription' && data.client_reference_id) {
            await upsertSubscription(data.client_reference_id, {
              stripeCustomerId: String(data.customer),
              stripeSubscriptionId: String(data.subscription),
              plan: 'pro',
              status: 'active'
            });
            logAudit(data.client_reference_id, 'subscribe', 'subscription', null, { plan: 'pro' });
          }
          break;
        }

        case 'customer.subscription.updated': {
          if (userId) {
            const plan = data.cancel_at_period_end ? 'pro' : (data.status === 'active' ? 'pro' : 'free');
            await upsertSubscription(userId, {
              stripeSubscriptionId: String(data.id),
              plan,
              status: data.status,
              currentPeriodStart: data.current_period_start ? new Date(data.current_period_start * 1000) : null,
              currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end * 1000) : null,
              cancelAtPeriodEnd: Boolean(data.cancel_at_period_end)
            });
          }
          break;
        }

        case 'customer.subscription.deleted': {
          if (userId) {
            await upsertSubscription(userId, {
              plan: 'free',
              status: 'canceled',
              cancelAtPeriodEnd: false
            });
            logAudit(userId, 'cancel', 'subscription', null, { reason: 'subscription_deleted' });
          }
          break;
        }

        case 'invoice.payment_failed': {
          if (userId) {
            await upsertSubscription(userId, {
              status: 'past_due'
            });
          }
          break;
        }
      }
    } catch (err) {
      // Log but don't fail — Stripe will retry
      console.error('Webhook processing error:', err.message);
    }

    res.json({ received: true });
  });

  // Also mount at /api/ for backward compat
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    // Forward to v1 handler — reconstruct since express already consumed the body
    req.app.handle(Object.assign(req, { url: '/api/v1/webhooks/stripe' }), res);
  });
}

app.use(express.json({ limit: '40mb' }));
app.use(
  session({
    name: isProduction ? '__Host-macro.sid' : 'macro.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: isProduction,
    cookie: {
      httpOnly: true,
      // Apple Sign-In uses a cross-site form_post callback, which requires
      // the session cookie to be sent on that POST so OAuth state can validate.
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * parsePositiveIntegerEnv('SESSION_TTL_DAYS', 30)
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  if (!localAuthBypassUser || (req.user && req.user.id)) {
    return next();
  }

  req.user = { ...localAuthBypassUser };
  return next();
});

async function hydrateAuthenticatedUser(req, res, next) {
  if (!hasAuthenticatedUser(req)) {
    return next();
  }

  try {
    let controls = await getUserAccountControls(userIdFromReq(req));
    if (!controls && localAuthBypassUser && userIdFromReq(req) === String(localAuthBypassUser.id)) {
      controls = await upsertUser(localAuthBypassUser);
    }
    if (controls) {
      req.user = {
        ...req.user,
        ...controls
      };
    } else {
      req.user = {
        ...req.user,
        isDisabled: false,
        sexualActivityEnabled: Boolean(req.user.sexualActivityEnabled)
      };
    }
    req.user.isAdmin = isAdminUser(req.user);
    return next();
  } catch (error) {
    return next(error);
  }
}

function enforceActiveAccount(req, res, next) {
  if (!hasAuthenticatedUser(req) || !req.user?.isDisabled) {
    return next();
  }

  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return sendError(req, res, 403, 'This account has been disabled.');
  }

  return req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/login?error=account_disabled');
    });
  });
}

function requireAdmin(req, res, next) {
  if (hasAuthenticatedUser(req) && isAdminUser(req.user)) {
    return next();
  }

  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return sendError(req, res, 403, 'Admin access is required.');
  }
  return res.status(403).type('text').send('Admin access is required.');
}

function requireSexualActivityAccess(req, res, next) {
  if (req.user?.sexualActivityEnabled) {
    return next();
  }
  return sendError(req, res, 403, 'Sexual activity tracking is not enabled for this account.');
}

function disableConditionalCaching(req, res) {
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

app.use(hydrateAuthenticatedUser);

function todayIsoString() {
  return new Date().toISOString();
}

function parseImageDataUrl(imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:([^;,]+)((?:;[^,]*)*),(.*)$/s);
  if (!match) {
    return null;
  }
  const mimeType = String(match[1] || '').toLowerCase();
  const flags = String(match[2] || '').toLowerCase();
  if (!flags.includes(';base64')) {
    return null;
  }
  return {
    mimeType,
    base64Payload: String(match[3] || '').replace(/\s+/g, '')
  };
}

function normalizeOpenAiImageMimeType(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  if (value === 'image/jpg') {
    return 'image/jpeg';
  }
  return value;
}

function isHeicMimeType(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  return value === 'image/heic' || value === 'image/heif' || value === 'image/heic-sequence' || value === 'image/heif-sequence';
}

async function convertHeicDataUrlToJpegDataUrl(imageDataUrl) {
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) {
    throw new Error('Invalid image format. Use an image file.');
  }
  const inputBuffer = Buffer.from(parsed.base64Payload, 'base64');
  const output = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 0.9
  });
  const outputBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  return 'data:image/jpeg;base64,' + outputBuffer.toString('base64');
}

function rawMealImageDataUrlsFromBody(body) {
  const values = [];
  if (Array.isArray(body.imageDataUrls)) {
    values.push(...body.imageDataUrls);
  } else if (body.imageDataUrls !== undefined) {
    throw new Error('imageDataUrls must be an array.');
  }

  if (typeof body.imageDataUrl === 'string') {
    values.push(body.imageDataUrl);
  }

  const imageDataUrls = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  if (imageDataUrls.length > MAX_MEAL_PARSE_IMAGES) {
    throw new Error(`A meal parse can include at most ${MAX_MEAL_PARSE_IMAGES} photos or screenshots.`);
  }

  return imageDataUrls;
}

async function normalizeMealImageDataUrl(rawImageDataUrl) {
  const parsedImage = parseImageDataUrl(rawImageDataUrl);
  if (!parsedImage) {
    throw new Error('Invalid image format. Use an image file.');
  }
  const mimeType = normalizeOpenAiImageMimeType(parsedImage.mimeType);
  const allowedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/heic-sequence',
    'image/heif-sequence'
  ]);
  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WEBP, GIF, or HEIC.');
  }

  const estimatedBytes = Math.floor((parsedImage.base64Payload.length * 3) / 4);
  if (estimatedBytes > MAX_MEAL_PARSE_IMAGE_BYTES) {
    throw new Error('Image is too large. Please use an image under 6MB.');
  }

  const imageDataUrl = isHeicMimeType(mimeType)
    ? await convertHeicDataUrlToJpegDataUrl(rawImageDataUrl)
    : `data:${mimeType};base64,${parsedImage.base64Payload}`;

  const normalizedImage = parseImageDataUrl(imageDataUrl);
  const normalizedEstimatedBytes = Math.floor((String(normalizedImage?.base64Payload || '').length * 3) / 4);
  if (!normalizedImage || normalizedEstimatedBytes > MAX_MEAL_PARSE_IMAGE_BYTES) {
    throw new Error('Image is too large after processing. Please use a smaller photo.');
  }

  return imageDataUrl;
}

function userIdFromReq(req) {
  return req.user && req.user.id ? String(req.user.id) : '';
}

function hasAuthenticatedUser(req) {
  return Boolean(req.user && req.user.id);
}

function userHasProvider(user, provider) {
  return String(user?.provider || '')
    .split(',')
    .map((value) => value.trim())
    .includes(provider);
}

function isAdminUser(user) {
  if (!user || !user.id) {
    return false;
  }
  const userId = String(user.id || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  if (!isProduction && localAuthBypassUser && userId === String(localAuthBypassUser.id).toLowerCase()) {
    return true;
  }
  return (email && adminEmails.has(email)) || (userId && adminUserIds.has(userId));
}

function clientUserPayload(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email || null,
    name: user.name || null,
    picture: user.picture || null,
    provider: user.provider || 'google',
    timezone: user.timezone || 'America/New_York',
    isAdmin: isAdminUser(user),
    setupTutorialResetAt: user.setupTutorialResetAt || null,
    features: {
      sexualActivity: Boolean(user.sexualActivityEnabled)
    }
  };
}

function isAuthConfigured() {
  return Boolean(googleClientId && googleClientSecret) || isAppleAuthConfigured();
}

function isAppleAuthConfigured() {
  return Boolean(appleClientId && appleTeamId && appleKeyId && applePrivateKey);
}

function getAppleClientSecret() {
  return appleSignin.getClientSecret({
    clientID: appleClientId,
    teamID: appleTeamId,
    keyIdentifier: appleKeyId,
    privateKey: applePrivateKey
  });
}

// ── Bearer token auth middleware ──
// Checks Authorization header for Bearer tokens before falling back to session auth.

async function bearerTokenAuth(req, res, next) {
  const authHeader = req.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  if (!token) {
    return next();
  }

  try {
    const user = await validateApiToken(token);
    if (user) {
      req.user = {
        ...user,
        isAdmin: isAdminUser(user)
      };
      req.authMode = 'bearer';
    }
  } catch (_error) {
    // Token validation failed; fall through to session auth
  }

  return next();
}

function requireAuth(req, res, next) {
  if (hasAuthenticatedUser(req)) {
    return next();
  }

  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return sendError(req, res, 401, 'Unauthorized. Please sign in first.');
  }

  return res.redirect('/login');
}

function normalizeAnalysisDays(daysInput) {
  const parsed = Number(daysInput);
  if (!Number.isFinite(parsed)) {
    return 90;
  }
  return Math.max(14, Math.min(180, Math.round(parsed)));
}

function hasOpenAiApiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function toFinite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function requirePlainObject(value, fieldName = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return value;
}

function normalizeString(value, fieldName, { maxLength = 255, fallback = '', required = false } = {}) {
  if (value == null || value === '') {
    if (required) {
      throw new Error(`${fieldName} is required.`);
    }
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or less.`);
  }
  return normalized || fallback;
}

function normalizeNumber(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0, required = false } = {}) {
  if (value == null || value === '') {
    if (required) {
      throw new Error(`${fieldName} is required.`);
    }
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${fieldName} must be a number.`);
  }
  if (number < min || number > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}.`);
  }
  return number;
}

const CONFIDENCE_LABEL_SCORES = {
  high: 0.9,
  medium: 0.7,
  low: 0.4
};

function normalizeConfidence(value, fieldName) {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value === 'string') {
    const label = value.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CONFIDENCE_LABEL_SCORES, label)) {
      return CONFIDENCE_LABEL_SCORES[label];
    }
  }
  return normalizeNumber(value, fieldName, { min: 0, max: 1 });
}

function normalizeIsoDateTime(value, fieldName, fallback = todayIsoString()) {
  const raw = value || fallback;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date/time.`);
  }
  return date.toISOString();
}

function normalizeIdParam(value, fieldName = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return id;
}

function normalizeScope(scopeInput) {
  const scope = String(scopeInput || 'week').toLowerCase();
  return ['week', 'month', 'year'].includes(scope) ? scope : 'week';
}

function normalizeTimezone(tzInput) {
  const timezone = normalizeString(tzInput || 'America/New_York', 'tz', {
    maxLength: 64,
    fallback: 'America/New_York'
  });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_error) {
    throw new Error('tz must be a valid IANA timezone.');
  }
}

function requestTimezone(req) {
  return normalizeTimezone(req?.query?.tz || req?.body?.tz || req?.user?.timezone || 'America/New_York');
}

function normalizeLimit(value, fallback = undefined) {
  if (value == null || value === '') {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(normalizeNumber(value, 'limit', { min: 1, max: 500 }))), 500);
}

function normalizeOffset(value) {
  if (value == null || value === '') {
    return undefined;
  }
  return Math.max(0, Math.floor(normalizeNumber(value, 'offset', { min: 0, max: 100000 })));
}

function avg(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, item) => sum + toFinite(item), 0) / values.length;
}

function stddev(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const mean = avg(values);
  const variance = values.reduce((sum, item) => {
    const delta = toFinite(item) - mean;
    return sum + delta * delta;
  }, 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
}

function normalizeAnalysisContext(snapshot) {
  const plannedFromTargets = toFinite(snapshot?.targets?.workouts, 5);
  const plannedWorkoutsPerWeek = Math.max(0, Math.min(14, Math.round(plannedFromTargets)));
  return {
    plannedWorkoutsPerWeek
  };
}

function inferGoalFromWeightTarget(snapshot) {
  const entries = Array.isArray(snapshot?.weight?.entries) ? snapshot.weight.entries : [];
  const latestWeight = entries.length ? toFinite(entries[entries.length - 1]?.weight) : 0;
  const targetWeight = toFinite(snapshot?.weight?.target?.weight);
  if (latestWeight > 0 && targetWeight > 0) {
    const delta = targetWeight - latestWeight;
    if (Math.abs(delta) <= 0.25) {
      return 'maintain';
    }
    return delta < 0 ? 'lose' : 'gain';
  }
  return 'maintain';
}

function buildAnalysisMetrics(snapshot, context) {
  const periodDays = Math.max(1, toFinite(snapshot?.periodDays, snapshot?.requestedPeriodDays || 90));
  const targets = snapshot?.targets || {};
  const mealDays = Array.isArray(snapshot?.meals?.dailyTotals) ? snapshot.meals.dailyTotals : [];
  const workoutDays = Array.isArray(snapshot?.workouts?.dailyTotals) ? snapshot.workouts.dailyTotals : [];
  const weightEntries = Array.isArray(snapshot?.weight?.entries) ? snapshot.weight.entries : [];
  const mealTiming = snapshot?.meals?.timing || {};

  const mealLoggedDays = mealDays.length;
  const totalLoggedItems = mealDays.reduce((sum, row) => sum + toFinite(row.itemCount), 0);
  // Count distinct days with at least one workout (not total sessions).
  // e.g. target=5 means 5 separate days must have workouts; 2 workouts on one day still counts as 1.
  const workoutSessions = workoutDays.length;
  const totalWorkoutHours = workoutDays.reduce((sum, row) => sum + toFinite(row.durationHours), 0);
  const totalWorkoutCalories = workoutDays.reduce((sum, row) => sum + toFinite(row.caloriesBurned), 0);
  const weightChange = toFinite(snapshot?.weight?.change);
  const sleepDays = Array.isArray(snapshot?.sleep?.dailyTotals) ? snapshot.sleep.dailyTotals : [];
  const sleepHoursArr = sleepDays.map((row) => toFinite(row.totalHours));
  const avgSleepHours = sleepHoursArr.length ? sleepHoursArr.reduce((a, b) => a + b, 0) / sleepHoursArr.length : 0;
  const sleepQualityArr = sleepDays
    .map((row) => toFinite(row.avgQuality, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgSleepQuality = sleepQualityArr.length ? sleepQualityArr.reduce((a, b) => a + b, 0) / sleepQualityArr.length : 0;
  const dailyCalories = mealDays.map((row) => toFinite(row.calories));
  const dailyProtein = mealDays.map((row) => toFinite(row.protein));

  const calorieTarget = toFinite(targets.calories);
  const proteinTarget = toFinite(targets.protein);
  const avgCalories = avg(dailyCalories);
  const avgProtein = avg(dailyProtein);
  const calorieTargetDelta = calorieTarget > 0 ? avgCalories - calorieTarget : 0;
  const proteinTargetDelta = proteinTarget > 0 ? avgProtein - proteinTarget : 0;
  const calorieTargetDeltaPct = calorieTarget > 0 ? (calorieTargetDelta / calorieTarget) * 100 : 0;
  const proteinTargetDeltaPct = proteinTarget > 0 ? (proteinTargetDelta / proteinTarget) * 100 : 0;

  const expectedPlannedSessions = Math.max(
    0,
    Math.round((toFinite(context.plannedWorkoutsPerWeek, 3) * periodDays) / 7)
  );

  const proteinMean = avg(dailyProtein);
  const proteinCv = proteinMean > 0 ? stddev(dailyProtein) / proteinMean : 0;
  const calorieVolatility = stddev(dailyCalories);

  let weekendCalories = [];
  let weekdayCalories = [];
  for (const row of mealDays) {
    const date = new Date(`${row.day}T00:00:00Z`);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) weekendCalories.push(toFinite(row.calories));
    else weekdayCalories.push(toFinite(row.calories));
  }
  const weekendDrift = avg(weekendCalories) - avg(weekdayCalories);
  const lateNightPct = toFinite(mealTiming.totalEntries) > 0
    ? (toFinite(mealTiming.lateNightEntries) / toFinite(mealTiming.totalEntries)) * 100
    : 0;

  const last7Meals = mealDays.slice(-7);
  const prev7Meals = mealDays.slice(-14, -7);
  const last7Workouts = workoutDays.slice(-7);
  const prev7Workouts = workoutDays.slice(-14, -7);
  const last7AvgCalories = avg(last7Meals.map((row) => toFinite(row.calories)));
  const prev7AvgCalories = avg(prev7Meals.map((row) => toFinite(row.calories)));
  const last7AvgProtein = avg(last7Meals.map((row) => toFinite(row.protein)));
  const prev7AvgProtein = avg(prev7Meals.map((row) => toFinite(row.protein)));
  const last7WorkoutHours = last7Workouts.reduce((sum, row) => sum + toFinite(row.durationHours), 0);
  const prev7WorkoutHours = prev7Workouts.reduce((sum, row) => sum + toFinite(row.durationHours), 0);

  const recentWeights = weightEntries.slice(-8).map((row) => toFinite(row.weight)).filter((value) => value > 0);
  const priorWeights = weightEntries.slice(-16, -8).map((row) => toFinite(row.weight)).filter((value) => value > 0);
  const recentWeightChange = recentWeights.length >= 2 ? recentWeights[recentWeights.length - 1] - recentWeights[0] : 0;
  const priorWeightChange = priorWeights.length >= 2 ? priorWeights[priorWeights.length - 1] - priorWeights[0] : 0;
  const weightDeltaWoW = recentWeightChange - priorWeightChange;

  const weeklyRate = periodDays > 0 ? (weightChange * 7) / periodDays : 0;
  const goal = inferGoalFromWeightTarget(snapshot);
  const latestWeight = weightEntries.length ? toFinite(weightEntries[weightEntries.length - 1]?.weight) : 0;
  const targetWeight = toFinite(snapshot?.weight?.target?.weight);
  const targetDate = String(snapshot?.weight?.target?.date || '').trim();
  const targetDaysRemaining = toFinite(snapshot?.weight?.target?.daysRemaining, NaN);
  const hasUsableTarget = latestWeight > 0 && targetWeight > 0;
  const hasFutureTargetDate = Number.isFinite(targetDaysRemaining) && targetDaysRemaining > 0;
  const requiredWeeklyRate = hasUsableTarget && hasFutureTargetDate
    ? ((targetWeight - latestWeight) * 7) / targetDaysRemaining
    : NaN;

  let goalScore = 50;
  let goalStatus = 'partially_on_track';
  let goalReason = 'Insufficient weight trend data to strongly evaluate goal alignment.';
  if (weightEntries.length >= 3) {
    if (Number.isFinite(requiredWeeklyRate)) {
      const deltaRate = Math.abs(weeklyRate - requiredWeeklyRate);
      const tolerance = goal === 'maintain' ? 0.2 : 0.25;
      goalScore = Math.max(0, 100 - Math.min(100, deltaRate * 180));
      goalStatus = deltaRate <= tolerance ? 'on_track' : deltaRate <= tolerance * 2 ? 'partially_on_track' : 'off_track';
      goalReason = `Weight is changing at ${weeklyRate.toFixed(2)} per week; target requires ${requiredWeeklyRate.toFixed(2)} per week by ${targetDate}.`;
    } else if (goal === 'lose') {
      goalScore = Math.max(0, 100 - Math.min(100, Math.abs(weeklyRate + 0.6) * 130));
      goalStatus = weeklyRate < -0.25 ? 'on_track' : 'off_track';
      goalReason = 'Inferred fat-loss direction from target weight. ' +
        `Weight is changing at ${weeklyRate.toFixed(2)} per week vs fat-loss pace.`;
    } else if (goal === 'gain') {
      goalScore = Math.max(0, 100 - Math.min(100, Math.abs(weeklyRate - 0.35) * 170));
      goalStatus = weeklyRate > 0.1 ? 'on_track' : 'off_track';
      goalReason = 'Inferred gain direction from target weight. ' +
        `Weight is changing at ${weeklyRate.toFixed(2)} per week vs lean-gain pace.`;
    } else {
      goalScore = Math.max(0, 100 - Math.min(100, Math.abs(weeklyRate) * 230));
      goalStatus = Math.abs(weeklyRate) <= 0.2 ? 'on_track' : 'off_track';
      goalReason = hasUsableTarget
        ? `Target is near current weight; maintenance inferred. Current rate is ${weeklyRate.toFixed(2)} per week.`
        : `Weight is changing at ${weeklyRate.toFixed(2)} per week; maintenance expects near zero.`;
    }
  }

  const mealCoveragePct = Math.round((mealLoggedDays / periodDays) * 100);
  const workoutCoverage = expectedPlannedSessions > 0 ? workoutSessions / expectedPlannedSessions : 0;
  const weightCoverage = Math.min(1, weightEntries.length / Math.max(2, Math.round(periodDays / 7)));
  const confidenceScore = Math.round(
    Math.max(0, Math.min(100, mealCoveragePct * 0.5 + Math.min(100, workoutCoverage * 100) * 0.3 + weightCoverage * 100 * 0.2))
  );

  return {
    stats: {
      periodDays,
      mealLoggedDays,
      totalLoggedItems,
      workoutSessions,
      totalWorkoutHours: Number(totalWorkoutHours.toFixed(2)),
      totalWorkoutCalories: Number(totalWorkoutCalories.toFixed(1)),
      weightEntryCount: weightEntries.length,
      weightChange: Number(weightChange.toFixed(2)),
      sleepDaysLogged: sleepDays.length,
      avgSleepHours: Number(avgSleepHours.toFixed(2)),
      avgSleepQuality: Number(avgSleepQuality.toFixed(2))
    },
    goalAlignment: {
      goal,
      status: goalStatus,
      score: Math.round(goalScore),
      reason: goalReason
    },
    adherence: {
      mealLoggingPct: mealCoveragePct,
      calorieTargetSet: calorieTarget > 0,
      calorieTargetDelta: Number(calorieTargetDelta.toFixed(1)),
      calorieTargetDeltaPct: Number(calorieTargetDeltaPct.toFixed(1)),
      proteinTargetSet: proteinTarget > 0,
      proteinTargetDelta: Number(proteinTargetDelta.toFixed(1)),
      proteinTargetDeltaPct: Number(proteinTargetDeltaPct.toFixed(1)),
      plannedWorkoutCount: expectedPlannedSessions,
      completedWorkoutCount: workoutSessions
    },
    weekOverWeek: {
      weightChangeDelta: Number(weightDeltaWoW.toFixed(2)),
      avgCaloriesDelta: Number((last7AvgCalories - prev7AvgCalories).toFixed(1)),
      avgProteinDelta: Number((last7AvgProtein - prev7AvgProtein).toFixed(1)),
      workoutHoursDelta: Number((last7WorkoutHours - prev7WorkoutHours).toFixed(2))
    },
    nutritionSignals: {
      proteinConsistency: proteinCv <= 0.2 ? 'high' : proteinCv <= 0.35 ? 'medium' : 'low',
      calorieVolatility: Number(calorieVolatility.toFixed(1)),
      lateNightEatingPct: Math.round(lateNightPct),
      weekendCalorieDrift: Number(weekendDrift.toFixed(1))
    },
    dataConfidence: {
      score: confidenceScore,
      notes:
        confidenceScore >= 75
          ? 'High coverage across meals, workouts, and weight.'
          : confidenceScore >= 50
            ? 'Moderate coverage. Some recommendations may be less reliable.'
            : 'Low coverage. Improve logging consistency for stronger insights.'
    }
  };
}

function buildFallbackAnalysis(snapshot, context) {
  const metrics = buildAnalysisMetrics(snapshot, context);
  const stats = metrics.stats;
  const summary = [
    `Analyzed ${stats.periodDays} days.`,
    `Meal logging ${metrics.adherence.mealLoggingPct}% of days.`,
    `Workout days: ${stats.workoutSessions} days with workouts vs ${metrics.adherence.plannedWorkoutCount} planned workout days.`,
    `Goal alignment score ${metrics.goalAlignment.score}/100 (${metrics.goalAlignment.status.replace('_', ' ')}).`
  ].join(' ');

  return {
    summary,
    progress: [
      `Weight change: ${stats.weightChange > 0 ? '+' : ''}${stats.weightChange.toFixed(1)} over the analysis window.`,
      metrics.adherence.proteinTargetSet
        ? `Average protein is ${metrics.adherence.proteinTargetDelta > 0 ? '+' : ''}${metrics.adherence.proteinTargetDelta.toFixed(1)}g (${metrics.adherence.proteinTargetDeltaPct > 0 ? '+' : ''}${metrics.adherence.proteinTargetDeltaPct.toFixed(1)}%) vs target.`
        : 'Set a protein target to track above/below-target variance.',
      `Workout volume: ${stats.totalWorkoutHours.toFixed(1)} hours total.`
    ],
    needsImprovement: [
      'Increase meal logging consistency to at least 6 of 7 days.',
      'Reduce calorie volatility and weekend drift.',
      'Keep late-night eating to less than 15% of logged meals.'
    ],
    nextWeekPlan: [
      `Complete ${Math.max(3, context.plannedWorkoutsPerWeek)} workouts next week.`,
      'Hit protein target on at least 5 of 7 days.',
      'Log morning weight on at least 4 days with similar conditions.'
    ],
    confidence: metrics.dataConfidence.score >= 75 ? 'high' : metrics.dataConfidence.score >= 50 ? 'medium' : 'low',
    ...metrics
  };
}

function buildWeeklyRecap(snapshot) {
  const metrics = buildAnalysisMetrics(snapshot, normalizeAnalysisContext(snapshot));
  const meals = Array.isArray(snapshot?.meals?.dailyTotals) ? snapshot.meals.dailyTotals : [];
  const workouts = Array.isArray(snapshot?.workouts?.dailyTotals) ? snapshot.workouts.dailyTotals : [];
  const sleep = Array.isArray(snapshot?.sleep?.dailyTotals) ? snapshot.sleep.dailyTotals : [];
  const last7Meals = meals.slice(-7);
  const prev7Meals = meals.slice(-14, -7);
  const last7Workouts = workouts.slice(-7);
  const prev7Workouts = workouts.slice(-14, -7);
  const last7Sleep = sleep.slice(-7);
  const avgCalories = avg(last7Meals.map((row) => toFinite(row.calories)));
  const avgProtein = avg(last7Meals.map((row) => toFinite(row.protein)));
  const avgSleep = avg(last7Sleep.map((row) => toFinite(row.totalHours)));
  const workoutDays = last7Workouts.length;
  const prevWorkoutDays = prev7Workouts.length;
  const proteinTarget = toFinite(snapshot?.targets?.protein);
  const calorieTarget = toFinite(snapshot?.targets?.calories);
  const sleepTarget = toFinite(snapshot?.targets?.sleep_hours, 8);
  const workoutTarget = Math.max(0, Math.round(toFinite(snapshot?.targets?.workouts, 5)));

  const wins = [];
  const focus = [];
  const nextActions = [];

  if (last7Meals.length >= 5) {
    wins.push(`Logged meals on ${last7Meals.length} of the last 7 days.`);
  } else {
    focus.push(`Meal coverage was ${last7Meals.length}/7 days.`);
    nextActions.push('Log at least one meal on 6 of the next 7 days.');
  }

  if (proteinTarget > 0) {
    const proteinDelta = avgProtein - proteinTarget;
    if (avgProtein >= proteinTarget * 0.95) {
      wins.push(`Average protein was ${fmtSignedNumber(proteinDelta, 0)}g vs target.`);
    } else {
      focus.push(`Average protein was ${Math.round(Math.abs(proteinDelta))}g below target.`);
      nextActions.push('Plan one protein-first meal before dinner each day.');
    }
  }

  if (calorieTarget > 0 && last7Meals.length >= 4) {
    const calorieDeltaPct = ((avgCalories - calorieTarget) / calorieTarget) * 100;
    if (Math.abs(calorieDeltaPct) <= 8) {
      wins.push('Average calories stayed near target.');
    } else {
      focus.push(`Average calories were ${Math.abs(Math.round(calorieDeltaPct))}% ${calorieDeltaPct > 0 ? 'above' : 'below'} target.`);
      nextActions.push('Pre-log one anchor meal on high-variance days.');
    }
  }

  if (workoutTarget > 0) {
    if (workoutDays >= workoutTarget) {
      wins.push(`Hit ${workoutDays}/${workoutTarget} workout days.`);
    } else {
      focus.push(`Workout days were ${workoutDays}/${workoutTarget}.`);
      nextActions.push(`Schedule ${Math.max(1, workoutTarget - workoutDays)} more workout day${workoutTarget - workoutDays === 1 ? '' : 's'} next week.`);
    }
  } else if (workoutDays > prevWorkoutDays) {
    wins.push(`Workout days increased from ${prevWorkoutDays} to ${workoutDays}.`);
  }

  if (last7Sleep.length >= 3 && sleepTarget > 0) {
    if (avgSleep >= sleepTarget * 0.95) {
      wins.push(`Average sleep was ${avgSleep.toFixed(1)} hours.`);
    } else {
      focus.push(`Average sleep was ${avgSleep.toFixed(1)} hours vs ${sleepTarget.toFixed(1)} target.`);
      nextActions.push('Pick two nights for an earlier wind-down.');
    }
  }

  if (!nextActions.length) {
    nextActions.push('Keep the current logging rhythm and review targets again next week.');
  }

  return {
    generatedAt: new Date().toISOString(),
    periodDays: 7,
    confidence: metrics.dataConfidence.score >= 75 ? 'high' : metrics.dataConfidence.score >= 50 ? 'medium' : 'low',
    summary: `Last 7 days: ${last7Meals.length}/7 meal days, ${workoutDays} workout days, ${avgProtein ? `${Math.round(avgProtein)}g avg protein` : 'limited protein data'}.`,
    wins: wins.slice(0, 4),
    focus: focus.slice(0, 4),
    nextActions: nextActions.slice(0, 4),
    metrics: {
      mealDays: last7Meals.length,
      avgCalories: Number(avgCalories.toFixed(1)),
      avgProtein: Number(avgProtein.toFixed(1)),
      workoutDays,
      avgSleepHours: Number(avgSleep.toFixed(2)),
      dataConfidenceScore: metrics.dataConfidence.score
    }
  };
}

function fmtSignedNumber(value, places = 1) {
  const number = toFinite(value);
  const fixed = number.toFixed(places).replace(/\.0$/, '');
  return `${number >= 0 ? '+' : ''}${fixed}`;
}

async function generateAiAnalysis(snapshot, context) {
  if (!hasOpenAiApiKey()) {
    return buildFallbackAnalysis(snapshot, context);
  }

  const baseline = buildAnalysisMetrics(snapshot, context);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content:
          'You are a direct fitness and nutrition coach. Be honest, specific, and practical. Use only the data provided. Return strict JSON only. Next-week plan items must be numeric and measurable. IMPORTANT: completedWorkoutCount and plannedWorkoutCount represent distinct days with at least one workout — not total session counts. Two workouts logged on the same day still count as only one workout day. If sleep data is available, incorporate sleep patterns into your analysis and recommendations (e.g. average hours, quality rating, consistency, impact on recovery).'
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              'Analyze this account data. Include goal alignment score, adherence metrics with target variance (value and percent above/below), week-over-week deltas, nutrition quality signals, data confidence, and a concrete next-week plan with numeric targets.\nData:\n' +
              JSON.stringify({ snapshot, context, baseline })
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'weekly_analysis',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: [
            'summary',
            'progress',
            'needsImprovement',
            'nextWeekPlan',
            'confidence',
            'goalAlignment',
            'adherence',
            'weekOverWeek',
            'nutritionSignals',
            'dataConfidence'
          ],
          properties: {
            summary: { type: 'string' },
            progress: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
            needsImprovement: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
            nextWeekPlan: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 7 },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            goalAlignment: {
              type: 'object',
              additionalProperties: false,
              required: ['goal', 'status', 'score', 'reason'],
              properties: {
                goal: { type: 'string', enum: ['lose', 'maintain', 'gain'] },
                status: { type: 'string', enum: ['on_track', 'partially_on_track', 'off_track'] },
                score: { type: 'number' },
                reason: { type: 'string' }
              }
            },
            adherence: {
              type: 'object',
              additionalProperties: false,
              required: [
                'mealLoggingPct',
                'calorieTargetSet',
                'calorieTargetDelta',
                'calorieTargetDeltaPct',
                'proteinTargetSet',
                'proteinTargetDelta',
                'proteinTargetDeltaPct',
                'plannedWorkoutCount',
                'completedWorkoutCount'
              ],
              properties: {
                mealLoggingPct: { type: 'number' },
                calorieTargetSet: { type: 'boolean' },
                calorieTargetDelta: { type: 'number' },
                calorieTargetDeltaPct: { type: 'number' },
                proteinTargetSet: { type: 'boolean' },
                proteinTargetDelta: { type: 'number' },
                proteinTargetDeltaPct: { type: 'number' },
                plannedWorkoutCount: { type: 'number' },
                completedWorkoutCount: { type: 'number' }
              }
            },
            weekOverWeek: {
              type: 'object',
              additionalProperties: false,
              required: ['weightChangeDelta', 'avgCaloriesDelta', 'avgProteinDelta', 'workoutHoursDelta'],
              properties: {
                weightChangeDelta: { type: 'number' },
                avgCaloriesDelta: { type: 'number' },
                avgProteinDelta: { type: 'number' },
                workoutHoursDelta: { type: 'number' }
              }
            },
            nutritionSignals: {
              type: 'object',
              additionalProperties: false,
              required: ['proteinConsistency', 'calorieVolatility', 'lateNightEatingPct', 'weekendCalorieDrift'],
              properties: {
                proteinConsistency: { type: 'string', enum: ['high', 'medium', 'low'] },
                calorieVolatility: { type: 'number' },
                lateNightEatingPct: { type: 'number' },
                weekendCalorieDrift: { type: 'number' }
              }
            },
            dataConfidence: {
              type: 'object',
              additionalProperties: false,
              required: ['score', 'notes'],
              properties: {
                score: { type: 'number' },
                notes: { type: 'string' }
              }
            }
          }
        }
      }
    }
  });

  let parsed = {};
  try {
    parsed = JSON.parse(response.output_text || '{}');
  } catch (_error) {
    parsed = {};
  }

  const fallback = buildFallbackAnalysis(snapshot, context);
  return {
    summary: String(parsed.summary || fallback.summary),
    progress: Array.isArray(parsed.progress) && parsed.progress.length ? parsed.progress.slice(0, 6) : fallback.progress,
    needsImprovement:
      Array.isArray(parsed.needsImprovement) && parsed.needsImprovement.length
        ? parsed.needsImprovement.slice(0, 6)
        : fallback.needsImprovement,
    nextWeekPlan:
      Array.isArray(parsed.nextWeekPlan) && parsed.nextWeekPlan.length
        ? parsed.nextWeekPlan.slice(0, 7)
        : fallback.nextWeekPlan,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : fallback.confidence,
    goalAlignment: parsed.goalAlignment || fallback.goalAlignment,
    adherence: parsed.adherence || fallback.adherence,
    weekOverWeek: parsed.weekOverWeek || fallback.weekOverWeek,
    nutritionSignals: parsed.nutritionSignals || fallback.nutritionSignals,
    dataConfidence: parsed.dataConfidence || fallback.dataConfidence,
    stats: fallback.stats
  };
}

function validateItems(items, consumedAt) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  if (items.length > 50) {
    throw new Error('A meal can include at most 50 items.');
  }

  return items.map((rawItem, index) => {
    const item = requirePlainObject(rawItem, `items[${index}]`);
    return {
      itemName: normalizeString(item.itemName, `items[${index}].itemName`, { maxLength: 160, required: true }),
      quantity: normalizeNumber(item.quantity, `items[${index}].quantity`, { min: 0.001, max: 10000, required: true }),
      unit: normalizeString(item.unit, `items[${index}].unit`, { maxLength: 32, fallback: 'serving' }),
      calories: normalizeNumber(item.calories, `items[${index}].calories`, { min: 0, max: 20000, required: true }),
      protein: normalizeNumber(item.protein, `items[${index}].protein`, { min: 0, max: 5000, required: true }),
      carbs: normalizeNumber(item.carbs, `items[${index}].carbs`, { min: 0, max: 5000, required: true }),
      fat: normalizeNumber(item.fat, `items[${index}].fat`, { min: 0, max: 5000, required: true }),
      consumedAt: normalizeIsoDateTime(item.consumedAt || consumedAt, `items[${index}].consumedAt`),
      source: normalizeString(item.source, `items[${index}].source`, { maxLength: 40, fallback: '' }) || undefined,
      sourceDetail: normalizeString(item.sourceDetail || item.source_detail, `items[${index}].sourceDetail`, { maxLength: 255, fallback: '' }) || undefined,
      confidence: normalizeConfidence(item.confidence, `items[${index}].confidence`),
      needsReview: item.needsReview == null && item.needs_review == null ? undefined : Boolean(item.needsReview ?? item.needs_review)
    };
  });
}

function validateEntryBody(body) {
  const payload = requirePlainObject(body || {}, 'entry');
  const itemName = normalizeString(payload.itemName, 'itemName', { maxLength: 160, required: true });

  return {
    itemName,
    quantity: normalizeNumber(payload.quantity, 'quantity', { min: 0.001, max: 10000, required: true }),
    unit: normalizeString(payload.unit, 'unit', { maxLength: 32, fallback: 'serving' }),
    calories: normalizeNumber(payload.calories, 'calories', { min: 0, max: 20000, required: true }),
    protein: normalizeNumber(payload.protein, 'protein', { min: 0, max: 5000, required: true }),
    carbs: normalizeNumber(payload.carbs, 'carbs', { min: 0, max: 5000, required: true }),
    fat: normalizeNumber(payload.fat, 'fat', { min: 0, max: 5000, required: true }),
    consumedAt: normalizeIsoDateTime(payload.consumedAt, 'consumedAt')
  };
}

function validateSavedItemBody(body) {
  const payload = requirePlainObject(body || {}, 'saved item');
  const name = normalizeString(payload.name, 'name', { maxLength: 160, required: true });

  const normalized = {
    name,
    quantity: normalizeNumber(payload.quantity, 'quantity', { min: 0.001, max: 10000, fallback: 1 }),
    unit: normalizeString(payload.unit, 'unit', { maxLength: 32, fallback: 'serving' }),
    calories: normalizeNumber(payload.calories, 'calories', { min: 0, max: 20000 }),
    protein: normalizeNumber(payload.protein, 'protein', { min: 0, max: 5000 }),
    carbs: normalizeNumber(payload.carbs, 'carbs', { min: 0, max: 5000 }),
    fat: normalizeNumber(payload.fat, 'fat', { min: 0, max: 5000 })
  };

  if (Object.prototype.hasOwnProperty.call(payload, 'source')) {
    normalized.source = normalizeString(payload.source, 'source', { maxLength: 40, fallback: 'manual' });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sourceDetail') || Object.prototype.hasOwnProperty.call(payload, 'source_detail')) {
    normalized.sourceDetail = normalizeString(payload.sourceDetail || payload.source_detail, 'sourceDetail', { maxLength: 255, fallback: '' });
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'components')) {
    normalized.components = validateSavedItemComponents(payload.components);
  }

  return normalized;
}

function validateSavedItemComponents(rawComponents) {
  if (rawComponents == null) {
    return null;
  }
  if (!Array.isArray(rawComponents)) {
    throw new Error('components must be an array.');
  }
  if (rawComponents.length > 50) {
    throw new Error('components can include at most 50 items.');
  }

  const components = rawComponents.map((rawItem, index) => {
    const item = requirePlainObject(rawItem, `components[${index}]`);
    return {
      itemName: normalizeString(item.itemName || item.name, `components[${index}].itemName`, { maxLength: 160, required: true }),
      quantity: normalizeNumber(item.quantity, `components[${index}].quantity`, { min: 0.001, max: 10000, required: true }),
      unit: normalizeString(item.unit, `components[${index}].unit`, { maxLength: 32, fallback: 'serving' }),
      calories: normalizeNumber(item.calories, `components[${index}].calories`, { min: 0, max: 20000, required: true }),
      protein: normalizeNumber(item.protein, `components[${index}].protein`, { min: 0, max: 5000, required: true }),
      carbs: normalizeNumber(item.carbs, `components[${index}].carbs`, { min: 0, max: 5000, required: true }),
      fat: normalizeNumber(item.fat, `components[${index}].fat`, { min: 0, max: 5000, required: true })
    };
  });

  return components.length ? components : null;
}

const barcodeLookupCache = new Map();
const BARCODE_LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BARCODE_LOOKUP_CACHE_MAX = 500;

function normalizeBarcode(value) {
  const barcode = String(value || '').replace(/\D/g, '');
  if (!/^\d{6,18}$/.test(barcode)) {
    throw new Error('Barcode must be 6 to 18 digits.');
  }
  return barcode;
}

function barcodeCacheGet(barcode) {
  const cached = barcodeLookupCache.get(barcode);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    barcodeLookupCache.delete(barcode);
    return null;
  }
  return cached.value;
}

function barcodeCacheSet(barcode, value) {
  if (barcodeLookupCache.size >= BARCODE_LOOKUP_CACHE_MAX) {
    const oldestKey = barcodeLookupCache.keys().next().value;
    if (oldestKey) barcodeLookupCache.delete(oldestKey);
  }
  barcodeLookupCache.set(barcode, {
    value,
    expiresAt: Date.now() + BARCODE_LOOKUP_CACHE_TTL_MS
  });
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function servingGramsFromText(value) {
  const text = String(value || '');
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (!match) return null;
  const grams = Number(match[1].replace(',', '.'));
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

function roundMacro(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 10) / 10;
}

function barcodeItemFromOpenFoodFactsProduct(barcode, product) {
  const nutriments = product?.nutriments || {};
  const productName = firstNonEmptyString(product?.product_name_en, product?.product_name, product?.generic_name_en, product?.generic_name);
  const brand = firstNonEmptyString(product?.brands);
  const itemName = firstNonEmptyString(
    brand && productName && !productName.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${productName}` : productName,
    brand,
    `Barcode ${barcode}`
  ).slice(0, 160);
  const servingSize = firstNonEmptyString(product?.serving_size);
  const servingGrams = servingGramsFromText(servingSize);

  const servingCalories = firstFiniteNumber(nutriments['energy-kcal_serving'], nutriments.energy_kcal_serving);
  const servingProtein = firstFiniteNumber(nutriments.proteins_serving, nutriments.protein_serving);
  const servingCarbs = firstFiniteNumber(nutriments.carbohydrates_serving, nutriments.carbs_serving);
  const servingFat = firstFiniteNumber(nutriments.fat_serving);
  if ([servingCalories, servingProtein, servingCarbs, servingFat].every((value) => value != null)) {
    return {
      itemName,
      quantity: 1,
      unit: 'serving',
      calories: roundMacro(servingCalories),
      protein: roundMacro(servingProtein),
      carbs: roundMacro(servingCarbs),
      fat: roundMacro(servingFat)
    };
  }

  const calories100g = firstFiniteNumber(nutriments['energy-kcal_100g'], nutriments.energy_kcal_100g, nutriments['energy-kcal'], nutriments.energy_kcal);
  const protein100g = firstFiniteNumber(nutriments.proteins_100g, nutriments.protein_100g, nutriments.proteins, nutriments.protein);
  const carbs100g = firstFiniteNumber(nutriments.carbohydrates_100g, nutriments.carbs_100g, nutriments.carbohydrates, nutriments.carbs);
  const fat100g = firstFiniteNumber(nutriments.fat_100g, nutriments.fat);
  if ([calories100g, protein100g, carbs100g, fat100g].every((value) => value != null)) {
    const multiplier = servingGrams ? servingGrams / 100 : 1;
    return {
      itemName,
      quantity: servingGrams ? 1 : 100,
      unit: servingGrams ? 'serving' : 'g',
      calories: roundMacro(calories100g * multiplier),
      protein: roundMacro(protein100g * multiplier),
      carbs: roundMacro(carbs100g * multiplier),
      fat: roundMacro(fat100g * multiplier)
    };
  }

  return null;
}

async function lookupOpenFoodFactsBarcode(barcode) {
  const cached = barcodeCacheGet(barcode);
  if (cached) return cached;

  const fields = [
    'code',
    'product_name',
    'product_name_en',
    'generic_name',
    'generic_name_en',
    'brands',
    'serving_size',
    'nutriments'
  ].join(',');
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': process.env.OPEN_FOOD_FACTS_USER_AGENT || 'DailyMacros/1.0 (https://macro-tracker.jim-greco.com)'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Open Food Facts returned ${response.status}.`);
    }

    const payload = await response.json();
    if (Number(payload.status) !== 1 || !payload.product) {
      const value = {
        barcode,
        found: false,
        source: 'openfoodfacts',
        message: 'Barcode was not found in Open Food Facts.'
      };
      barcodeCacheSet(barcode, value);
      return value;
    }

    const product = payload.product;
    const productName = firstNonEmptyString(product.product_name_en, product.product_name, product.generic_name_en, product.generic_name);
    const result = {
      barcode,
      found: true,
      source: 'openfoodfacts',
      productName: productName || null,
      brand: firstNonEmptyString(product.brands) || null,
      servingSize: firstNonEmptyString(product.serving_size) || null,
      item: barcodeItemFromOpenFoodFactsProduct(barcode, product),
      message: ''
    };
    if (!result.item) {
      result.message = 'Product was found, but nutrition data was incomplete.';
    }
    barcodeCacheSet(barcode, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Non-API routes (login, auth, health) ──

const loginHtmlRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'login.html'), 'utf8');
const privacyHtmlRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'privacy.html'), 'utf8');
const publicBrandAssetPaths = new Map([
  ['/favicon.svg', path.join(process.cwd(), 'public', 'favicon.svg')],
  ['/logo-mark.svg', path.join(process.cwd(), 'public', 'logo-mark.svg')]
]);

app.get('/login', (req, res) => {
  if (hasAuthenticatedUser(req)) {
    return res.redirect('/');
  }

  let html = loginHtmlRaw;

  // Hide Apple button + divider when Apple Sign-In is not configured
  if (!isAppleAuthConfigured()) {
    html = html
      .replace(/<div class="login-divider">or<\/div>/, '')
      .replace(/<button id="apple-login-btn"[^]*?<\/button>/, '');
  }

  // Hide Google button when Google OAuth is not configured
  if (!googleClientId || !googleClientSecret) {
    html = html
      .replace(/<button id="google-login-btn"[^]*?<\/button>/, '');
    // Also remove divider if it's still there
    if (isAppleAuthConfigured()) {
      html = html.replace(/<div class="login-divider">or<\/div>/, '');
    }
  }

  res.type('html').send(html);
});

app.get('/login.js', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'login.js'));
});

app.get(['/privacy', '/privacy.html'], (req, res) => {
  res.set('Cache-Control', isProduction ? 'public, max-age=3600' : 'no-cache');
  res.type('html').send(privacyHtmlRaw);
});

app.get(['/favicon.svg', '/logo-mark.svg'], (req, res) => {
  const assetPath = publicBrandAssetPaths.get(req.path);
  if (!assetPath) {
    return res.status(404).type('text').send('Not found.');
  }

  res.set('Cache-Control', isProduction ? 'public, max-age=3600' : 'no-cache');
  return res.sendFile(assetPath);
});

app.use('/auth', createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 30 }));

app.get('/auth/google', async (req, res, next) => {
  if (localAuthBypassUser) {
    // Web auth bypass can also satisfy the legacy mobile Google redirect path.
    if (req.query.mobile === '1') {
      try {
        const persistedUser = await upsertUser(localAuthBypassUser);
        if (persistedUser.isDisabled) {
          return res.redirect('dailymacros://auth/callback?error=account_disabled');
        }
        const tokenResult = await createApiToken(persistedUser.id, 'DailyMacros iOS', null);
        const params = new URLSearchParams({
          token: tokenResult.token,
          name: persistedUser.name || '',
          email: persistedUser.email || '',
          id: persistedUser.id
        });
        return res.redirect(`dailymacros://auth/callback?${params.toString()}`);
      } catch (error) {
        return res.redirect('dailymacros://auth/callback?error=token_creation_failed');
      }
    }
    return res.redirect('/');
  }

  if (!googleClientId || !googleClientSecret) {
    return res.status(500).send('Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  // Store mobile flag in session so callback knows to return a token
  if (req.query.mobile === '1') {
    req.session.mobileAuth = true;
  }

  return passport.authenticate('google', { scope: ['profile', 'email'], state: true })(req, res, next);
});

app.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (localAuthBypassUser) {
      return res.redirect('/');
    }

    if (!googleClientId || !googleClientSecret) {
      return res.status(500).send('Google OAuth is not configured.');
    }
    return next();
  },
  passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed' }),
  async (req, res) => {
    // Upsert user into the users table on every login
    let signedInUser = req.user;
    if (req.user && req.user.id) {
      try {
        signedInUser = await upsertUser(req.user);
        if (signedInUser.isDisabled) {
          return req.logout(() => {
            req.session.destroy(() => {
              res.redirect('/login?error=account_disabled');
            });
          });
        }
        await new Promise((resolve, reject) => {
          req.login(signedInUser, (loginErr) => (loginErr ? reject(loginErr) : resolve()));
        });
      } catch (_error) {
        // Don't block login if upsert fails
      }
    }

    // Mobile auth: create API token and redirect to app URL scheme
    if (req.session.mobileAuth) {
      delete req.session.mobileAuth;
      try {
        const tokenResult = await createApiToken(signedInUser.id, 'DailyMacros iOS', null);
        const params = new URLSearchParams({
          token: tokenResult.token,
          name: signedInUser.name || '',
          email: signedInUser.email || '',
          id: signedInUser.id
        });
        return res.redirect(`dailymacros://auth/callback?${params.toString()}`);
      } catch (error) {
        return res.redirect('dailymacros://auth/callback?error=token_creation_failed');
      }
    }

    res.redirect('/');
  }
);

// ── Google Sign-In (mobile / native OAuth code exchange) ──
// The iOS app uses its iOS OAuth client and redirects directly back to the app,
// then sends the authorization code here for a backend-issued API token.

app.post('/auth/google/mobile', express.json(), async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body || {};

  if (!googleIOSClientId) {
    return res.status(500).json({ error: 'Google iOS Sign-In is not configured on the server.' });
  }
  if (!code || !codeVerifier || !redirectUri) {
    return res.status(400).json({ error: 'code, codeVerifier, and redirectUri are required.' });
  }

  try {
    const tokenParams = new URLSearchParams({
      code,
      client_id: googleIOSClientId,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok || !tokenPayload.id_token) {
      return res.status(401).json({ error: 'Unable to exchange Google authorization code.' });
    }

    const tokenInfoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenPayload.id_token)}`
    );
    const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));

    if (!tokenInfoResponse.ok || tokenInfo.aud !== googleIOSClientId || !tokenInfo.sub) {
      return res.status(401).json({ error: 'Invalid Google identity token.' });
    }

    if (tokenInfo.email && !normalizeGoogleTokenBoolean(tokenInfo.email_verified)) {
      return res.status(401).json({ error: 'Google email is not verified.' });
    }

    const user = {
      id: tokenInfo.sub,
      providerUserId: tokenInfo.sub,
      name: tokenInfo.name || tokenInfo.email || null,
      email: tokenInfo.email || null,
      picture: tokenInfo.picture || null,
      provider: 'google'
    };

    const persistedUser = await upsertUser(user);
    if (persistedUser.isDisabled) {
      return res.status(403).json({ error: 'This account has been disabled.' });
    }
    const tokenResult = await createApiToken(persistedUser.id, 'DailyMacros iOS', null);

    return res.json({
      ok: true,
      token: tokenResult.token,
      user: { id: persistedUser.id, name: persistedUser.name, email: persistedUser.email }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Google mobile sign-in failed.' });
  }
});

// ── Apple Sign-In (web flow) ──

app.get('/auth/apple', (req, res) => {
  if (localAuthBypassUser) {
    return res.redirect('/');
  }

  if (!isAppleAuthConfigured()) {
    return res.redirect('/login?error=apple_not_configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.appleAuthState = state;

  const authUrl = appleSignin.getAuthorizationUrl({
    clientID: appleClientId,
    redirectUri: appleRedirectUri,
    scope: 'name email',
    responseMode: 'form_post',
    state
  });

  return res.redirect(authUrl);
});

// Apple posts form data to the callback (responseMode: form_post)
app.post('/auth/apple/callback', express.urlencoded({ extended: false }), async (req, res) => {
  if (localAuthBypassUser) {
    return res.redirect('/');
  }

  if (!isAppleAuthConfigured()) {
    return res.redirect('/login?error=apple_auth_failed');
  }

  const expectedState = req.session?.appleAuthState;
  if (req.session) {
    delete req.session.appleAuthState;
  }
  if (!expectedState || String(req.body?.state || '') !== String(expectedState)) {
    return res.redirect('/login?error=apple_auth_failed');
  }

  try {
    const { id_token: idToken, user: userJson } = req.body;

    if (!req.body.code) {
      return res.redirect('/login?error=apple_auth_failed');
    }

    const clientSecret = getAppleClientSecret();
    const tokenResponse = await appleSignin.getAuthorizationToken(req.body.code, {
      clientID: appleClientId,
      clientSecret,
      redirectUri: appleRedirectUri
    });

    const verifyToken = tokenResponse.id_token || idToken;
    const payload = await appleSignin.verifyIdToken(verifyToken, {
      audience: appleClientId,
      ignoreExpiration: false
    });

    // Apple only sends user info on first sign-in; parse it if present
    let userName = null;
    const userEmail = verifiedTokenEmail(payload);
    if (userJson) {
      try {
        const parsed = typeof userJson === 'string' ? JSON.parse(userJson) : userJson;
        if (parsed.name) {
          const parts = [parsed.name.firstName, parsed.name.lastName].filter(Boolean);
          userName = parts.join(' ') || null;
        }
      } catch (_e) { /* ignore parse errors */ }
    }

    const user = {
      id: `apple_${payload.sub}`,
      providerUserId: payload.sub,
      name: userName,
      email: userEmail,
      picture: null,
      provider: 'apple'
    };

    try {
      const persistedUser = await upsertUser(user);
      if (persistedUser.isDisabled) {
        return res.redirect('/login?error=account_disabled');
      }
      return req.login(persistedUser, (loginErr) => {
        if (loginErr) {
          return res.redirect('/login?error=apple_auth_failed');
        }
        return res.redirect('/');
      });
    } catch (_error) {
      return res.redirect('/login?error=apple_auth_failed');
    }
  } catch (error) {
    return res.redirect('/login?error=apple_auth_failed');
  }
});

// ── Apple Sign-In (mobile / token exchange) ──
// iOS app sends the Apple identity token; we verify and return an API token

app.post('/auth/apple/mobile', express.json(), async (req, res) => {
  const { identityToken, fullName } = req.body;

  if (!identityToken) {
    return res.status(400).json({ error: 'identityToken is required.' });
  }

  // Accept either the web Service ID or iOS Bundle ID as valid audiences
  const validAudiences = [appleClientId, appleBundleId].filter(Boolean);
  if (validAudiences.length === 0) {
    return res.status(500).json({ error: 'Apple Sign-In is not configured on the server.' });
  }

  try {
    const payload = await appleSignin.verifyIdToken(identityToken, {
      audience: validAudiences,
      ignoreExpiration: false
    });

    let userName = null;
    if (fullName) {
      const parts = [fullName.givenName, fullName.familyName].filter(Boolean);
      userName = parts.join(' ') || null;
    }

    const user = {
      id: `apple_${payload.sub}`,
      providerUserId: payload.sub,
      name: userName,
      email: verifiedTokenEmail(payload),
      picture: null,
      provider: 'apple'
    };

    const persistedUser = await upsertUser(user);
    if (persistedUser.isDisabled) {
      return res.status(403).json({ error: 'This account has been disabled.' });
    }

    // Create a long-lived API token for the mobile app
    const tokenResult = await createApiToken(persistedUser.id, 'DailyMacros iOS', null);

    return res.json({
      ok: true,
      token: tokenResult.token,
      user: { id: persistedUser.id, name: persistedUser.name, email: persistedUser.email }
    });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid Apple identity token.' });
  }
});

app.post('/auth/dev/mobile', async (req, res) => {
  if (!localDevUser) {
    return res.status(404).json({ error: 'Dev auth bypass is not enabled.' });
  }

  try {
    const persistedUser = await upsertUser(localDevUser);
    if (persistedUser.isDisabled) {
      return res.status(403).json({ error: 'This account has been disabled.' });
    }
    const tokenResult = await createApiToken(persistedUser.id, 'DailyMacros iOS Dev', null);
    return res.json({
      ok: true,
      token: tokenResult.token,
      user: {
        id: persistedUser.id,
        name: persistedUser.name || null,
        email: persistedUser.email || null
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to create dev auth token.' });
  }
});

app.post('/auth/logout', enforceStateChangingSource, (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

function getVersionPayload() {
  return {
    appBuild,
    packageVersion: packageJson.version,
    nodeVersion: process.version,
    startedAt: startedAtIso,
    heicServerConversion: true
  };
}

app.get('/version', (req, res) => {
  res.json(getVersionPayload());
});

app.get('/healthz', async (req, res) => {
  try {
    const database = await checkDatabaseHealth();
    return res.json({
      ok: true,
      app: 'ok',
      database,
      startedAt: startedAtIso
    });
  } catch (error) {
    logServerError(req, error, { status: 503, path: '/healthz' });
    return res.status(503).json({
      ok: false,
      app: 'degraded',
      database: {
        ok: false,
        error: 'Database health check failed.'
      },
      requestId: req.requestId,
      startedAt: startedAtIso
    });
  }
});

// ── API Router (mounted at /api/v1 and /api for backward compat) ──

const apiRouter = express.Router();

// ── Durable plan-based feature gating for AI endpoints ──
function limitFromEnv(name, fallbackValue) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.floor(parsed);
}

function featureLabel(feature) {
  return String(feature || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function enforceDailyUsage(req, res, feature, limitKey, envName) {
  const userId = userIdFromReq(req);
  if (!userId) {
    return null;
  }

  const sub = await getSubscription(userId);
  const limits = getPlanLimits(sub.plan);
  const maxDaily = limitFromEnv(envName, limits[limitKey] || limits.dailyParses || 5);
  const usage = await consumeDailyUsage(userId, feature, maxDaily);
  if (usage.allowed) {
    return null;
  }

  return sendError(
    req,
    res,
    429,
    `Daily ${featureLabel(feature).toLowerCase()} limit reached (${usage.count}/${usage.limit}).`
  );
}

// Rate limiters on specific paths
apiRouter.use('/parse-meal', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 15 }));
apiRouter.use('/parse-workout', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }));
apiRouter.use('/analysis', createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 5 }));
apiRouter.use('/barcode', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }));


apiRouter.get('/me', (req, res) => {
  disableConditionalCaching(req, res);
  res.json({ user: clientUserPayload(req.user) });
});

apiRouter.patch('/account/preferences', async (req, res) => {
  try {
    const body = requirePlainObject(req.body || {}, 'account preferences');
    const preferences = {};
    if (Object.prototype.hasOwnProperty.call(body, 'timezone')) {
      preferences.timezone = normalizeTimezone(body.timezone);
    }

    const user = await updateUserPreferences(userIdFromReq(req), preferences);
    req.user = {
      ...req.user,
      ...user
    };
    logAudit(userIdFromReq(req), 'update', 'account_preferences', null, preferences);
    return res.json({ ok: true, user: clientUserPayload(req.user) });
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to update account preferences.');
  }
});

apiRouter.get('/version', (req, res) => {
  res.json(getVersionPayload());
});

apiRouter.get('/admin/accounts', requireAdmin, async (req, res) => {
  try {
    disableConditionalCaching(req, res);
    const limit = Math.min(normalizeLimit(req.query.limit, 25), 100);
    const offset = req.query.offset != null
      ? normalizeOffset(req.query.offset) || 0
      : (Math.max(1, Math.floor(normalizeNumber(req.query.page, 'page', { min: 1, max: 100000, fallback: 1 }))) - 1) * limit;
    const search = normalizeString(req.query.search || '', 'search', { maxLength: 320, fallback: '' });
    const result = await listAdminAccounts({ search, limit, offset });
    return res.json(result);
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to load accounts.');
  }
});

apiRouter.patch('/admin/accounts/:userId', requireAdmin, async (req, res) => {
  try {
    const targetUserId = normalizeString(req.params.userId, 'userId', { maxLength: 255, required: true });
    const body = requirePlainObject(req.body || {}, 'admin account update');
    const controls = {};

    if (Object.prototype.hasOwnProperty.call(body, 'isDisabled')) {
      if (typeof body.isDisabled !== 'boolean') {
        return sendError(req, res, 400, 'isDisabled must be a boolean.');
      }
      if (body.isDisabled && targetUserId === userIdFromReq(req)) {
        return sendError(req, res, 400, 'You cannot disable your own admin account.');
      }
      controls.isDisabled = body.isDisabled;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'sexualActivityEnabled')) {
      if (typeof body.sexualActivityEnabled !== 'boolean') {
        return sendError(req, res, 400, 'sexualActivityEnabled must be a boolean.');
      }
      controls.sexualActivityEnabled = body.sexualActivityEnabled;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'resetSetupTutorial')) {
      if (body.resetSetupTutorial !== true) {
        return sendError(req, res, 400, 'resetSetupTutorial must be true.');
      }
      controls.resetSetupTutorial = true;
    }

    const account = await updateAdminAccountControls(targetUserId, controls);
    logAudit(userIdFromReq(req), 'admin_update', 'user', targetUserId, controls);
    return res.json({ ok: true, account });
  } catch (error) {
    const message = error.message === 'Account not found.' ? error.message : (error.message || 'Unable to update account.');
    return sendError(req, res, error.message === 'Account not found.' ? 404 : 400, message);
  }
});

apiRouter.get('/admin/accounts/:userId/diagnostics', requireAdmin, async (req, res) => {
  try {
    const targetUserId = normalizeString(req.params.userId, 'userId', { maxLength: 255, required: true });
    const limit = Math.min(normalizeLimit(req.query.limit, 25), 100);
    const diagnostics = await listClientDiagnostics(targetUserId, { limit });
    return res.json({ diagnostics });
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to load diagnostics.');
  }
});

apiRouter.post('/parse-meal', async (req, res) => {
  let hasImage = false;
  try {
    const body = requirePlainObject(req.body || {}, 'parse meal request');
    const consumedAt = normalizeIsoDateTime(body.consumedAt, 'consumedAt');
    const text = normalizeString(body.text, 'text', { maxLength: 4000, fallback: '' });
    const rawImageDataUrls = rawMealImageDataUrlsFromBody(body);
    hasImage = rawImageDataUrls.length > 0;

    if (!text.trim() && !hasImage) {
      return sendError(req, res, 400, 'Add a description, a photo, or both.');
    }

    const imageDataUrls = [];
    for (const rawImageDataUrl of rawImageDataUrls) {
      imageDataUrls.push(await normalizeMealImageDataUrl(rawImageDataUrl));
    }

    const mealLimitResponse = await enforceDailyUsage(
      req,
      res,
      'meal_parse',
      'mealParsesPerDay',
      'AI_DAILY_MEAL_PARSE_LIMIT'
    );
    if (mealLimitResponse) return mealLimitResponse;

    if (hasImage) {
      const photoLimitResponse = await enforceDailyUsage(
        req,
        res,
        'photo_parse',
        'photoParsesPerDay',
        'AI_DAILY_PHOTO_PARSE_LIMIT'
      );
      if (photoLimitResponse) return photoLimitResponse;
    }

    const parsed = await parseMealText({
      text,
      consumedAt,
      imageDataUrls
    });
    if (Array.isArray(parsed.items) && parsed.items.length) {
      const source = hasImage ? 'ai_photo' : 'ai_text';
      parsed.items = await applyFoodCorrections(
        userIdFromReq(req),
        parsed.items.map((item) => ({
          ...item,
          source,
          sourceDetail: hasImage ? 'OpenAI meal photo parse' : 'OpenAI meal text parse',
          needsReview: true
        }))
      );
      parsed.review = {
        needed: parsed.items.some((item) => item.needsReview !== false),
        source
      };
    }

    res.json(parsed);
  } catch (error) {
    const message = String(error?.message || 'Request failed');
    if (hasImage && message.includes('did not match the expected pattern')) {
      return sendError(req, res, 400, 'Photo format was not accepted. Please retry with a JPEG/PNG image or add a short description.');
    }
    return sendError(req, res, 400, error.message || 'Unable to parse meal.');
  }
});

apiRouter.get('/barcode/:barcode', async (req, res) => {
  let barcode = '';
  try {
    barcode = normalizeBarcode(req.params.barcode);
    const result = await lookupOpenFoodFactsBarcode(barcode);
    if (!result.found) {
      return sendError(req, res, 404, result.message || 'Barcode was not found.');
    }
    return res.json(result);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Barcode lookup timed out. Please try again.'
      : (error.message || 'Unable to look up barcode.');
    const status = barcode ? 502 : 400;
    return sendError(req, res, status, message, error);
  }
});

apiRouter.post('/parse-workout', async (req, res) => {
  try {
    const body = requirePlainObject(req.body || {}, 'parse workout request');
    const text = normalizeString(body.text, 'text', { maxLength: 4000, fallback: '' });
    if (!text.trim()) {
      return sendError(req, res, 400, 'Add a workout description first.');
    }

    const limitResponse = await enforceDailyUsage(
      req,
      res,
      'workout_parse',
      'workoutParsesPerDay',
      'AI_DAILY_WORKOUT_PARSE_LIMIT'
    );
    if (limitResponse) return limitResponse;

    const parsed = await parseWorkoutText({ text });
    return res.json(parsed);
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to parse workout.');
  }
});

apiRouter.post('/sync-workouts', async (req, res) => {
  if (!req.user || (!userHasProvider(req.user, 'google') && !userHasProvider(req.user, 'local-dev'))) {
    return sendError(req, res, 403, 'Syncing requires a Google account.');
  }

  try {
    const userId = req.user.id;
    const workoutPlannerUserId = userHasProvider(req.user, 'google')
      ? (await getProviderUserId(userId, 'google')) || userId
      : userId;
    const internalSecret = process.env.INTERNAL_SYNC_SECRET;
    const workoutApiUrl = process.env.WORKOUT_API_URL || 'http://workout_api:3001';

    if (!internalSecret) {
      logJson('warn', 'internal_sync_not_configured', { requestId: req.requestId });
      return sendError(req, res, 500, 'Internal sync is not configured on the server.');
    }

    // Fetch logs from Workout Planner API
    const response = await fetch(`${workoutApiUrl}/logs`, {
      headers: {
        'X-Internal-Sync-Secret': internalSecret,
        'X-Internal-User-Id': workoutPlannerUserId,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logJson('error', 'workout_api_error', {
        requestId: req.requestId,
        status: response.status,
        message: errorText.slice(0, 500)
      });
      return sendError(req, res, 500, 'Failed to fetch workouts from Workout Planner service.');
    }

    const logs = await response.json();

    if (!Array.isArray(logs) || logs.length === 0) {
      return res.json({ message: 'No workouts found in Workout Planner.', syncedCount: 0 });
    }

    // Past 30 days filter
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const filteredLogs = logs.filter(l => new Date(l.date) >= thirtyDaysAgo);

    if (filteredLogs.length === 0) {
      return res.json({ message: 'No workouts found from the last 30 days.', syncedCount: 0 });
    }

    // Get existing workouts from PG to avoid duplicates
    const existingResult = await listWorkoutEntries(userId, { limit: 100, scope: 'month' });
    const existingDates = new Set(existingResult.entries.map(e => e.loggedAt.slice(0, 10)));

    let syncedCount = 0;
    for (const log of filteredLogs) {
      const logDate = log.date.slice(0, 10);
      if (existingDates.has(logDate)) {
        continue;
      }

      // Format log for ChatGPT
      const items = log.exerciseItems || log.items || [];
      const exerciseSummary = items.map(item => {
        const setsSummary = (item.sets || []).map(s => `${s.reps || 0} reps @ ${s.weight || 0} lbs`).join(', ');
        return `${item.name || 'Exercise'}: ${setsSummary}`;
      }).join('. ');

      const text = `Workout: ${log.name || 'Unspecified'}. Exercises: ${exerciseSummary}. Notes: ${log.notes || ''}`;
      
      // Categorize with ChatGPT
      const parsed = await parseWorkoutText({ text });

      // Calculate duration from logs if available
      let durationHours = parsed.durationHours;
      if (log.startTime && log.endTime) {
        const start = new Date(log.startTime);
        const end = new Date(log.endTime);
        const diffMs = end - start;
        if (diffMs > 0) {
          durationHours = Number((diffMs / (1000 * 60 * 60)).toFixed(2));
          // If we have a real duration, re-estimate calories based on it if ChatGPT inferred a very different duration
          if (Math.abs(durationHours - parsed.durationHours) > 0.2) {
             parsed.caloriesBurned = estimateWorkoutCalories(`${text} ${parsed.description}`, durationHours, parsed.intensity);
          }
        }
      }
      
      // Save to PG
      const result = await addWorkoutEntry(userId, {
        description: parsed.description,
        intensity: parsed.intensity,
        durationHours: durationHours,
        caloriesBurned: parsed.caloriesBurned,
        loggedAt: log.startTime || (log.date ? `${log.date}T09:00:00` : new Date().toISOString()),
        source: 'workout_planner',
        externalId: log.id || log._id || log.uuid || null
      });

      if (result.created !== false) {
        syncedCount++;
      }
    }

    return res.json({
      message: syncedCount > 0 ? `Successfully synced ${syncedCount} workout(s).` : 'No new workouts to sync.',
      syncedCount
    });
  } catch (error) {
    return sendError(req, res, 500, 'Failed to sync workouts from Workout Planner.', error);
  }
});

apiRouter.post('/entries/bulk', async (req, res) => {
  try {
    const body = requirePlainObject(req.body || {}, 'bulk entries request');
    const consumedAt = normalizeIsoDateTime(body.consumedAt, 'consumedAt');
    let rows = validateItems(body.items, consumedAt);
    const defaultSource = normalizeString(body.source, 'source', { maxLength: 40, fallback: '' }) || null;

    if (!rows.length) {
      return sendError(req, res, 400, 'At least one item is required.');
    }

    if (defaultSource) {
      rows = rows.map((row) => ({
        ...row,
        source: row.source || defaultSource,
        sourceDetail: row.sourceDetail || body.sourceDetail || body.source_detail || null
      }));
    }
    rows = await applyFoodCorrections(userIdFromReq(req), rows);

    const mealName = normalizeString(body.mealName, 'mealName', { maxLength: 160, fallback: '' }) || null;
    const mealGroup = rows.length > 1 && mealName ? crypto.randomUUID() : null;
    const mealQuantity = normalizeNumber(body.mealQuantity, 'mealQuantity', {
      min: 0.001,
      max: 10000,
      fallback: 1
    });
    const mealUnit = normalizeString(body.mealUnit, 'mealUnit', { maxLength: 32, fallback: 'serving' });
    const itemsAreMealUnit = body.itemsAreMealUnit === true;
    if (mealGroup && itemsAreMealUnit) {
      rows = scaleMealUnitRows(rows, mealQuantity);
    }
    for (const row of rows) {
      row.mealGroup = mealGroup;
      row.mealName = mealName;
      row.mealQuantity = mealQuantity;
      row.mealUnit = mealUnit;
    }

    const userId = userIdFromReq(req);
    await addEntries(userId, rows);

    const saveItems = Array.isArray(body.saveItems) ? body.saveItems.slice(0, 50) : [];
    const savedIds = [];
    for (const saveItem of saveItems) {
      const id = await addSavedItem(userId, validateSavedItemBody(saveItem));
      savedIds.push(id);
    }

    logAudit(userId, 'create', 'entries', null, { count: rows.length });
    return res.json({ ok: true, savedIds });
  } catch (error) {
    return sendError(req, res, 400, error.message);
  }
});

apiRouter.put('/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }

    const payload = validateEntryBody(req.body || {});
    const userId = userIdFromReq(req);
    const changes = await updateEntry(userId, id, payload);

    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }

    logAudit(userId, 'update', 'entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await deleteEntry(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }

    logAudit(userId, 'delete', 'entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/meal-group/:mealGroup/scale', async (req, res) => {
  try {
    const { mealGroup } = req.params;
    if (!mealGroup) {
      return res.status(400).json({ error: 'mealGroup is required.' });
    }
    const quantity = Number(req.body.quantity);
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number.' });
    }
    const unit = String(req.body.unit || 'serving').trim();
    const name = req.body.name ? String(req.body.name).trim() : null;
    const updated = await scaleMealGroup(userIdFromReq(req), mealGroup, quantity, unit, name);
    if (!updated) {
      return res.status(404).json({ error: 'Meal group not found.' });
    }
    return res.json({ ok: true, updated });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/entries/combine', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const { entryIds, mealName } = req.body;
    if (!Array.isArray(entryIds) || entryIds.length < 2) {
      return res.status(400).json({ error: 'At least two entry IDs are required.' });
    }
    const ids = entryIds.map(Number).filter(Number.isFinite);
    if (ids.length < 2) {
      return res.status(400).json({ error: 'At least two valid entry IDs are required.' });
    }
    const quantity = Number(req.body.quantity) || 1;
    const unit = req.body.unit ? String(req.body.unit).trim() : 'serving';
    const mealGroup = await combineEntries(userId, ids, mealName ? String(mealName).trim() : null, quantity, unit);
    logAudit(userId, 'combine', 'entries', mealGroup);
    return res.json({ ok: true, mealGroup });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/meal-group/:mealGroup/split', async (req, res) => {
  try {
    const { mealGroup } = req.params;
    if (!mealGroup) {
      return res.status(400).json({ error: 'mealGroup is required.' });
    }
    const count = await splitMealGroup(userIdFromReq(req), mealGroup);
    if (!count) {
      return res.status(404).json({ error: 'Meal group not found.' });
    }
    logAudit(userIdFromReq(req), 'split', 'meal_group', mealGroup);
    return res.json({ ok: true, count });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/entries/:id/remove-from-group', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Entry ID is required.' });
    }
    await removeFromMealGroup(userIdFromReq(req), id);
    logAudit(userIdFromReq(req), 'remove_from_group', 'entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/saved-items', async (req, res) => {
  try {
    const items = await listSavedItems(userIdFromReq(req));
    res.json(items);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/saved-items', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const id = await addSavedItem(userId, validateSavedItemBody(req.body || {}));
    logAudit(userId, 'create', 'saved_item', String(id));
    res.json({ id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/saved-items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid saved item id.' });
    }

    const userId = userIdFromReq(req);
    const payload = validateSavedItemBody(req.body || {});
    const changes = await updateSavedItem(userId, id, payload);

    if (!changes) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    logAudit(userId, 'update', 'saved_item', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/saved-items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid saved item id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await deleteSavedItem(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    logAudit(userId, 'delete', 'saved_item', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/quick-add', async (req, res) => {
  try {
    const consumedAt = req.body.consumedAt || todayIsoString();
    const entry = await quickAddFromSaved(
      userIdFromReq(req),
      req.body.savedItemId,
      req.body.multiplier,
      consumedAt
    );

    if (!entry) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    return res.json({ ok: true, entry });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/starter-quick-adds', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const result = await addStarterQuickAdds(userId);
    logAudit(userId, 'create', 'starter_quick_adds', null, { addedCount: result.addedCount });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to add starter quick adds.');
  }
});

apiRouter.post('/entries/copy-day', async (req, res) => {
  try {
    const body = requirePlainObject(req.body || {}, 'copy day request');
    const sourceDay = normalizeString(body.sourceDay, 'sourceDay', { maxLength: 10, required: true });
    const targetDay = normalizeString(body.targetDay, 'targetDay', { maxLength: 10, required: true });
    const timezone = requestTimezone(req);
    const result = await copyEntriesForLocalDay(userIdFromReq(req), sourceDay, targetDay, timezone);
    logAudit(userIdFromReq(req), 'copy', 'entries', null, { sourceDay, targetDay, copiedCount: result.copiedCount });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to copy entries.');
  }
});

apiRouter.post('/entries/copy-to-today', async (req, res) => {
  try {
    const body = requirePlainObject(req.body || {}, 'copy entry request');
    const timezone = requestTimezone(req);
    const hasEntryId = body.entryId != null && body.entryId !== '';
    const entryId = hasEntryId ? Number(body.entryId) : null;
    const mealGroup = normalizeString(body.mealGroup, 'mealGroup', { maxLength: 160, fallback: '' }) || null;
    const targetDay = normalizeString(body.targetDay, 'targetDay', { maxLength: 10, fallback: '' }) || undefined;

    if (hasEntryId && mealGroup) {
      return sendError(req, res, 400, 'Choose either entryId or mealGroup, not both.');
    }
    if (!hasEntryId && !mealGroup) {
      return sendError(req, res, 400, 'entryId or mealGroup is required.');
    }
    if (hasEntryId && (!Number.isInteger(entryId) || entryId <= 0)) {
      return sendError(req, res, 400, 'Invalid entry id.');
    }

    const result = await copyEntriesToLocalDay(userIdFromReq(req), {
      entryId,
      mealGroup,
      targetDay,
      timezone
    });
    logAudit(userIdFromReq(req), 'copy', mealGroup ? 'meal_group' : 'entry', mealGroup || String(entryId), {
      targetDay: targetDay || null,
      copiedCount: result.copiedCount
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to copy entry to today.');
  }
});

apiRouter.post('/claim-legacy-data', async (req, res) => {
  try {
    const result = await claimLegacyData(userIdFromReq(req));
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/macro-targets/:macro', async (req, res) => {
  try {
    const macro = String(req.params.macro || '').toLowerCase();
    const target = Number(req.body?.target);
    const effectiveDate = req.body?.effectiveDate || req.body?.effective_date;
    const timezone = requestTimezone(req);
    const updated = await setMacroTarget(userIdFromReq(req), macro, target, { effectiveDate, timezone });
    return res.json({ ok: true, ...updated });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});



apiRouter.get('/weights', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const offset = normalizeOffset(req.query.offset);
    const scope = normalizeScope(req.query.scope);
    const tz = requestTimezone(req);
    const data = await listWeightEntries(userIdFromReq(req), { limit, offset, scope, timezone: tz });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/weight-target', async (req, res) => {
  try {
    const tz = requestTimezone(req);
    const target = await getWeightTarget(userIdFromReq(req), undefined, { timezone: tz });
    res.json(target);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/weight-target', async (req, res) => {
  try {
    const timezone = requestTimezone(req);
    const target = await setWeightTarget(userIdFromReq(req), { ...(req.body || {}), tz: timezone });
    res.json({ ok: true, ...target });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/weights', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const result = await addWeightEntry(userId, req.body || {});
    if (result.created !== false) {
      logAudit(userId, 'create', 'weight_entry', result.id ? String(result.id) : undefined);
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/weights/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await updateWeightEntry(userId, id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    logAudit(userId, 'update', 'weight_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/weights/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await deleteWeightEntry(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    logAudit(userId, 'delete', 'weight_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Legacy compat: POST-based delete (kept for existing frontend)
apiRouter.post('/weights/:id/delete', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await deleteWeightEntry(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    logAudit(userId, 'delete', 'weight_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/weights/delete', async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await deleteWeightEntry(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    logAudit(userId, 'delete', 'weight_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/workouts', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const offset = normalizeOffset(req.query.offset);
    const scope = normalizeScope(req.query.scope);
    const tz = requestTimezone(req);
    const data = await listWorkoutEntries(userIdFromReq(req), { limit, offset, scope, timezone: tz });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/workouts', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const result = await addWorkoutEntry(userId, req.body || {});
    if (result.created !== false) {
      logAudit(userId, 'create', 'workout_entry', result.id ? String(result.id) : undefined);
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/workouts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid workout entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await updateWorkoutEntry(userId, id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Workout entry not found.' });
    }

    logAudit(userId, 'update', 'workout_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/workouts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid workout entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await deleteWorkoutEntry(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Workout entry not found.' });
    }

    logAudit(userId, 'delete', 'workout_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Legacy compat: POST-based update (kept for existing frontend)
apiRouter.post('/workouts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid workout entry id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await updateWorkoutEntry(userId, id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Workout entry not found.' });
    }

    logAudit(userId, 'update', 'workout_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// ── Sexual Activity (Health) endpoints ──

apiRouter.use('/sexual-activity', requireSexualActivityAccess);

apiRouter.get('/sexual-activity', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const offset = normalizeOffset(req.query.offset);
    const scope = normalizeScope(req.query.scope);
    const tz = requestTimezone(req);
    const data = await listSexualActivityEntries(userIdFromReq(req), { limit, offset, scope, timezone: tz });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/sexual-activity', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const result = await addSexualActivityEntry(userId, req.body || {});
    if (result.created !== false) {
      logAudit(userId, 'create', 'sexual_activity_entry', result.id ? String(result.id) : undefined);
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/sexual-activity/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }
    const userId = userIdFromReq(req);
    const changes = await updateSexualActivityEntry(userId, id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    logAudit(userId, 'update', 'sexual_activity_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/sexual-activity/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }
    const userId = userIdFromReq(req);
    const changes = await deleteSexualActivityEntry(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    logAudit(userId, 'delete', 'sexual_activity_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// ── Sleep endpoints ──

apiRouter.get('/sleep', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const offset = normalizeOffset(req.query.offset);
    const scope = normalizeScope(req.query.scope);
    const tz = requestTimezone(req);
    const data = await listSleepEntries(userIdFromReq(req), { limit, offset, scope, timezone: tz });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/sleep', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const result = await addSleepEntry(userId, req.body || {});
    if (result.created !== false) {
      logAudit(userId, 'create', 'sleep_entry', result.id ? String(result.id) : undefined);
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/sleep/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }
    const userId = userIdFromReq(req);
    const changes = await updateSleepEntry(userId, id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    logAudit(userId, 'update', 'sleep_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/sleep/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }
    const userId = userIdFromReq(req);
    const changes = await deleteSleepEntry(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    logAudit(userId, 'delete', 'sleep_entry', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/analysis/latest', async (req, res) => {
  try {
    const latest = await getLatestAnalysisReport(userIdFromReq(req));
    return res.json({ report: latest });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/coach/weekly-recap', async (req, res) => {
  try {
    const tz = requestTimezone(req);
    const snapshot = await getAnalysisSnapshot(userIdFromReq(req), 14, tz);
    const recap = buildWeeklyRecap(snapshot);
    return res.json({ recap });
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to build weekly recap.');
  }
});

apiRouter.post('/analysis', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const body = requirePlainObject(req.body || {}, 'analysis request');
    const days = normalizeAnalysisDays(body.days);
    const tz = requestTimezone(req);
    const limitResponse = await enforceDailyUsage(
      req,
      res,
      'analysis',
      'analysisPerDay',
      'AI_DAILY_ANALYSIS_LIMIT'
    );
    if (limitResponse) return limitResponse;

    const snapshot = await getAnalysisSnapshot(userId, days, tz);
    const context = normalizeAnalysisContext(snapshot);
    const analysis = await generateAiAnalysis(snapshot, context);
    const saved = await saveAnalysisReport(userId, days, {
      ...analysis,
      context,
      sourceSnapshot: snapshot
    });
    return res.json({ report: saved });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/dashboard', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const offset = normalizeOffset(req.query.offset);
    const tz = requestTimezone(req);
    const date = req.query.date ? normalizeString(req.query.date, 'date', { maxLength: 20 }) : undefined;
    const data = await getDashboard(userIdFromReq(req), date, { limit, offset, timezone: tz });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/daily-totals', async (req, res) => {
  try {
    const scope = normalizeScope(req.query.scope);
    const tz = requestTimezone(req);
    const totals = await getDailyTotals(userIdFromReq(req), scope, tz);
    const targets = await getMacroTargets(userIdFromReq(req), undefined, { timezone: tz });
    const targetHistory = await getMacroTargetHistory(userIdFromReq(req), scope, tz);
    res.json({ dailyTotals: totals, targets, targetHistory });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── AI coach dismissals ──

function normalizeCoachDismissalPayload(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`dismissals[${index}] must be an object.`);
  }

  const type = normalizeString(item.type, `dismissals[${index}].type`, { maxLength: 20, required: true });
  if (type !== 'today' && type !== 'pattern') {
    throw new Error(`dismissals[${index}].type must be today or pattern.`);
  }

  const key = normalizeString(item.key, `dismissals[${index}].key`, { maxLength: 512, required: true });
  const dismissedUntil = item.dismissedUntil == null || item.dismissedUntil === ''
    ? null
    : normalizeString(item.dismissedUntil, `dismissals[${index}].dismissedUntil`, { maxLength: 40, required: true });

  if (dismissedUntil && Number.isNaN(new Date(dismissedUntil).getTime())) {
    throw new Error(`dismissals[${index}].dismissedUntil must be a valid date.`);
  }

  return { type, key, dismissedUntil };
}

apiRouter.get('/coach/dismissals', async (req, res) => {
  try {
    const dismissals = await listCoachDismissals(userIdFromReq(req));
    res.json({ dismissals });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/coach/dismissals', async (req, res) => {
  try {
    const body = requirePlainObject(req.body);
    if (!Array.isArray(body.dismissals)) {
      throw new Error('dismissals must be an array.');
    }
    if (body.dismissals.length > 200) {
      throw new Error('dismissals must include 200 items or fewer.');
    }

    const userId = userIdFromReq(req);
    const dismissals = body.dismissals.map(normalizeCoachDismissalPayload);
    const synced = await upsertCoachDismissals(userId, dismissals);
    logAudit(userId, 'sync', 'coach_dismissals', null, { count: dismissals.length });
    res.json({ dismissals: synced });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/coach/dismissals', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const deletedCount = await deleteCoachDismissals(userId);
    logAudit(userId, 'delete', 'coach_dismissals', 'all');
    res.json({ ok: true, deletedCount });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/diagnostics/client', async (req, res) => {
  try {
    const body = requirePlainObject(req.body || {}, 'client diagnostic');
    const diagnostic = {
      level: normalizeString(body.level, 'level', { maxLength: 20, fallback: 'info' }),
      category: normalizeString(body.category, 'category', { maxLength: 80, fallback: 'client' }),
      message: normalizeString(body.message, 'message', { maxLength: 1000, required: true }),
      details: body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : null,
      userAgent: normalizeString(body.userAgent || req.get('user-agent'), 'userAgent', { maxLength: 512, fallback: '' }),
      appPlatform: normalizeString(body.appPlatform || 'web', 'appPlatform', { maxLength: 80, fallback: 'web' }),
      appVersion: normalizeString(body.appVersion || appBuild, 'appVersion', { maxLength: 80, fallback: appBuild }),
      requestId: normalizeString(body.requestId || req.requestId, 'requestId', { maxLength: 128, fallback: req.requestId || '' })
    };
    const saved = await logClientDiagnostic(userIdFromReq(req), diagnostic);
    return res.json({ ok: true, diagnostic: saved });
  } catch (error) {
    return sendError(req, res, 400, error.message || 'Unable to record diagnostic.');
  }
});

// ── API tokens (for mobile/external clients) ──

apiRouter.get('/auth/tokens', async (req, res) => {
  try {
    const tokens = await listApiTokens(userIdFromReq(req));
    res.json({ tokens });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/auth/tokens', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const name = String(req.body?.name || 'default').trim();
    const token = await createApiToken(userId, name);
    logAudit(userId, 'create', 'api_token', String(token.id));
    res.json(token);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/auth/tokens', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const deletedCount = await deleteAllApiTokens(userId);
    logAudit(userId, 'delete', 'api_tokens', 'all');
    return res.json({ ok: true, deletedCount });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/auth/tokens/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid token id.' });
    }

    const userId = userIdFromReq(req);
    const changes = await deleteApiToken(userId, id);
    if (!changes) {
      return res.status(404).json({ error: 'Token not found.' });
    }

    logAudit(userId, 'delete', 'api_token', String(id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// ── GDPR / account management ──

apiRouter.get('/account/export', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const data = await exportUserData(userId);
    logAudit(userId, 'export', 'account');
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.delete('/account', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    logAudit(userId, 'delete', 'account');
    await deleteUserAccount(userId);
    req.logout(() => {
      req.session.destroy(() => {
        res.json({ ok: true });
      });
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Subscription / billing endpoints ──

apiRouter.get('/subscription', async (req, res) => {
  try {
    const sub = await getSubscription(userIdFromReq(req));
    const limits = getPlanLimits(sub.plan);
    res.json({ subscription: sub, limits });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/subscription/checkout', async (req, res) => {
  try {
    if (!stripe || !stripePriceId) {
      return res.status(503).json({ error: 'Billing is not configured.' });
    }
    const userId = userIdFromReq(req);
    const user = req.user;
    const appBaseUrl = String(process.env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${appBaseUrl}/?checkout=success`,
      cancel_url: `${appBaseUrl}/?checkout=cancel`,
      client_reference_id: userId
    };

    // Reuse existing Stripe customer if available
    const sub = await getSubscription(userId);
    if (sub.stripeCustomerId) {
      sessionParams.customer = sub.stripeCustomerId;
    } else {
      sessionParams.customer_email = user.email || undefined;
    }

    const checkoutSession = await stripe.checkout.sessions.create(sessionParams);
    logAudit(userId, 'create', 'checkout_session');
    res.json({ url: checkoutSession.url });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/subscription/portal', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Billing is not configured.' });
    }
    const userId = userIdFromReq(req);
    const sub = await getSubscription(userId);

    if (!sub.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found. Subscribe first.' });
    }

    const appBaseUrl = String(process.env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: appBaseUrl
    });

    res.json({ url: portalSession.url });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Mount API router ──
// Bearer token auth runs before requireAuth so tokens are checked first
app.use('/api/v1', bearerTokenAuth, requireAuth, enforceActiveAccount, enforceApiSource, apiRouter);
app.use('/api', bearerTokenAuth, requireAuth, enforceActiveAccount, enforceApiSource, apiRouter);
app.use(['/api/v1', '/api'], (req, res) => {
  return sendError(req, res, 404, 'API route not found.');
});

// ── Authenticated frontend routes ──

app.use(requireAuth, enforceActiveAccount);
app.get(['/admin', '/admin.html'], requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(adminHtml);
});
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(indexHtml);
});
app.use(express.static(path.join(process.cwd(), 'public')));
app.use((req, res) => {
  res.status(404).type('text').send('Not found.');
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }
  logServerError(req, error, { status: 500 });
  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return sendError(req, res, 500, 'Request failed.');
  }
  return res.status(500).type('text').send(`Request failed. Reference: ${req.requestId || 'unknown'}`);
});

async function startServer() {
  try {
    await initDb();
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Macro tracker listening on http://localhost:${port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize Postgres:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  buildWeeklyRecap,
  requestTimezone,
  normalizeTimezone
};
