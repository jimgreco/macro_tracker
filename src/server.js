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
  logAudit,
  addEntries,
  updateEntry,
  deleteEntry,
  scaleMealGroup,
  addSavedItem,
  updateSavedItem,
  deleteSavedItem,
  listSavedItems,
  quickAddFromSaved,
  claimLegacyData,
  getDashboard,
  setMacroTarget,
  addWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  listWeightEntries,
  getWeightTarget,
  setWeightTarget,
  addWorkoutEntry,
  updateWorkoutEntry,
  listWorkoutEntries,
  getAnalysisSnapshot,
  saveAnalysisReport,
  getLatestAnalysisReport,
  getEnergyBalance,
  createApiToken,
  validateApiToken,
  listApiTokens,
  deleteApiToken,
  exportUserData,
  deleteUserAccount,
  getPlanLimits,
  getSubscription,
  upsertSubscription,
  getSubscriptionByStripeCustomerId,
  saveBillingEvent
} = require('./db');
const { parseMealText, parseWorkoutText } = require('./parser');
const packageJson = require('../package.json');

const app = express();
const port = Number(process.env.PORT) || 3000;
app.set('trust proxy', 1);
const appBuild = process.env.APP_BUILD || 'c24d664';
const startedAtIso = new Date().toISOString();

const scriptPath = path.join(process.cwd(), 'public', 'script.js');
const scriptHash = crypto
  .createHash('md5')
  .update(fs.readFileSync(scriptPath))
  .digest('hex')
  .slice(0, 8);
const indexHtmlRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
const indexHtml = indexHtmlRaw.replace('src="/script.js"', `src="/script.js?v=${scriptHash}"`);
const isProduction = process.env.NODE_ENV === 'production';

const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const oauthCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/auth/google/callback`;

const appleClientId = process.env.APPLE_CLIENT_ID || ''; // Service ID (e.g. com.macroflow.web)
const appleTeamId = process.env.APPLE_TEAM_ID || '';
const appleKeyId = process.env.APPLE_KEY_ID || '';
const applePrivateKey = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const appleRedirectUri = process.env.APPLE_REDIRECT_URI || `${process.env.APP_BASE_URL || `http://localhost:${port}`}/auth/apple/callback`;
const appleBundleId = process.env.APPLE_BUNDLE_ID || ''; // iOS app bundle ID (e.g. com.macroflow.app)

function parseBooleanEnv(name, fallbackValue = false) {
  const normalized = String(process.env[name] || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallbackValue;
}

const localAuthBypassEnabled = !isProduction && parseBooleanEnv('LOCAL_AUTH_BYPASS', false);
const localDevUser = localAuthBypassEnabled
  ? {
      id: String(process.env.LOCAL_DEV_USER_ID || 'local-dev-user'),
      name: String(process.env.LOCAL_DEV_USER_NAME || 'Local Preview User'),
      email: String(process.env.LOCAL_DEV_USER_EMAIL || 'local-preview@example.com'),
      picture: null,
      provider: 'local-dev'
    }
  : null;

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

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
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

function enforceApiSource(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const origin = req.get('origin');
  const referer = req.get('referer');
  const source = origin || referer || '';
  if (!isAllowedSource(source, req)) {
    return res.status(403).json({ error: 'Forbidden request origin.' });
  }
  return next();
}

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
      return res.status(429).json({ error: 'Too many requests. Please retry shortly.' });
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

app.use(express.json({ limit: '10mb' }));
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
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * parsePositiveIntegerEnv('SESSION_TTL_DAYS', 30)
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  if (!localDevUser || (req.user && req.user.id)) {
    return next();
  }

  req.user = { ...localDevUser };
  return next();
});

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

function userIdFromReq(req) {
  return req.user && req.user.id ? String(req.user.id) : '';
}

function hasAuthenticatedUser(req) {
  return Boolean(req.user && req.user.id);
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
  if (hasAuthenticatedUser(req)) {
    return next();
  }

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
      req.user = user;
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
    return res.status(401).json({ error: 'Unauthorized. Please sign in first.' });
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
      weightChange: Number(weightChange.toFixed(2))
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
          'You are a direct fitness and nutrition coach. Be honest, specific, and practical. Use only the data provided. Return strict JSON only. Next-week plan items must be numeric and measurable. IMPORTANT: completedWorkoutCount and plannedWorkoutCount represent distinct days with at least one workout — not total session counts. Two workouts logged on the same day still count as only one workout day.'
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

  return items.map((item) => ({
    itemName: String(item.itemName || '').trim(),
    quantity: Number(item.quantity || 0),
    unit: item.unit || 'serving',
    calories: Number(item.calories || 0),
    protein: Number(item.protein || 0),
    carbs: Number(item.carbs || 0),
    fat: Number(item.fat || 0),
    consumedAt: item.consumedAt || consumedAt || todayIsoString()
  }));
}

function validateEntryBody(body) {
  const consumedAt = body.consumedAt || todayIsoString();
  const itemName = String(body.itemName || '').trim();

  if (!itemName) {
    throw new Error('itemName is required.');
  }

  return {
    itemName,
    quantity: Number(body.quantity || 0),
    unit: String(body.unit || 'serving').trim(),
    calories: Number(body.calories || 0),
    protein: Number(body.protein || 0),
    carbs: Number(body.carbs || 0),
    fat: Number(body.fat || 0),
    consumedAt: new Date(consumedAt).toISOString()
  };
}

function validateSavedItemBody(body) {
  const name = String(body.name || '').trim();
  if (!name) {
    throw new Error('name is required.');
  }

  return {
    name,
    quantity: Number(body.quantity || 1),
    unit: String(body.unit || 'serving').trim(),
    calories: Number(body.calories || 0),
    protein: Number(body.protein || 0),
    carbs: Number(body.carbs || 0),
    fat: Number(body.fat || 0)
  };
}

// ── Non-API routes (login, auth, health) ──

const loginHtmlRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'login.html'), 'utf8');

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

app.use('/auth', createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 30 }));

app.get('/auth/google', (req, res, next) => {
  if (localDevUser) {
    return res.redirect('/');
  }

  if (!isAuthConfigured()) {
    return res.status(500).send('Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (localDevUser) {
      return res.redirect('/');
    }

    if (!isAuthConfigured()) {
      return res.status(500).send('Google OAuth is not configured.');
    }
    return next();
  },
  passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed' }),
  async (req, res) => {
    // Upsert user into the users table on every login
    if (req.user && req.user.id) {
      try {
        await upsertUser(req.user);
      } catch (_error) {
        // Don't block login if upsert fails
      }
    }
    res.redirect('/');
  }
);

// ── Apple Sign-In (web flow) ──

app.get('/auth/apple', (req, res) => {
  if (localDevUser) {
    return res.redirect('/');
  }

  if (!isAppleAuthConfigured()) {
    return res.redirect('/login?error=apple_not_configured');
  }

  const authUrl = appleSignin.getAuthorizationUrl({
    clientID: appleClientId,
    redirectUri: appleRedirectUri,
    scope: 'name email',
    responseMode: 'form_post',
    state: crypto.randomBytes(16).toString('hex')
  });

  return res.redirect(authUrl);
});

// Apple posts form data to the callback (responseMode: form_post)
app.post('/auth/apple/callback', express.urlencoded({ extended: false }), async (req, res) => {
  if (localDevUser) {
    return res.redirect('/');
  }

  if (!isAppleAuthConfigured()) {
    return res.redirect('/login?error=apple_auth_failed');
  }

  try {
    const { id_token: idToken, user: userJson } = req.body;

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
    let userEmail = payload.email || null;
    if (userJson) {
      try {
        const parsed = typeof userJson === 'string' ? JSON.parse(userJson) : userJson;
        if (parsed.name) {
          const parts = [parsed.name.firstName, parsed.name.lastName].filter(Boolean);
          userName = parts.join(' ') || null;
        }
        if (parsed.email) userEmail = parsed.email;
      } catch (_e) { /* ignore parse errors */ }
    }

    const user = {
      id: `apple_${payload.sub}`,
      name: userName,
      email: userEmail,
      picture: null,
      provider: 'apple'
    };

    try {
      await upsertUser(user);
    } catch (_error) {
      // Don't block login if upsert fails
    }

    req.login(user, (loginErr) => {
      if (loginErr) {
        return res.redirect('/login?error=apple_auth_failed');
      }
      return res.redirect('/');
    });
  } catch (error) {
    return res.redirect('/login?error=apple_auth_failed');
  }
});

// ── Apple Sign-In (mobile / token exchange) ──
// iOS app sends the Apple identity token; we verify and return an API token

app.post('/auth/apple/mobile', express.json(), async (req, res) => {
  const { identityToken, fullName, email } = req.body;

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
      name: userName,
      email: email || payload.email || null,
      picture: null,
      provider: 'apple'
    };

    await upsertUser(user);

    // Create a long-lived API token for the mobile app
    const tokenResult = await createApiToken(user.id, 'MacroFlow iOS', null);

    return res.json({
      ok: true,
      token: tokenResult.token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid Apple identity token.' });
  }
});

app.post('/auth/logout', (req, res) => {
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
    return res.status(503).json({
      ok: false,
      app: 'degraded',
      database: {
        ok: false,
        error: error.message
      },
      startedAt: startedAtIso
    });
  }
});

// ── API Router (mounted at /api/v1 and /api for backward compat) ──

const apiRouter = express.Router();

// ── Plan-based feature gating for AI endpoints ──
function createPlanGate(limitKey) {
  const dailyUsage = new Map();

  return async (req, res, next) => {
    const userId = userIdFromReq(req);
    if (!userId) return next();

    try {
      const sub = await getSubscription(userId);
      const limits = getPlanLimits(sub.plan);
      const maxDaily = limits[limitKey] || 5;

      const today = new Date().toISOString().slice(0, 10);
      const key = `${userId}:${today}`;
      const current = dailyUsage.get(key) || 0;

      if (current >= maxDaily) {
        return res.status(429).json({
          error: `Daily limit reached (${maxDaily}/${limitKey}). Upgrade to Pro for higher limits.`,
          plan: sub.plan,
          limit: maxDaily,
          upgrade: sub.plan === 'free'
        });
      }

      dailyUsage.set(key, current + 1);

      // Clean old keys periodically
      if (dailyUsage.size > 10000) {
        for (const [k] of dailyUsage) {
          if (!k.endsWith(today)) dailyUsage.delete(k);
        }
      }
    } catch (_error) {
      // Don't block on plan check failure
    }
    return next();
  };
}

// Rate limiters on specific paths
apiRouter.use('/parse-meal', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 15 }));
apiRouter.use('/parse-workout', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }));
apiRouter.use('/analysis', createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 5 }));

// Plan-based daily limits (after rate limiter, before handler)
apiRouter.use('/parse-meal', createPlanGate('dailyParses'));
apiRouter.use('/parse-workout', createPlanGate('dailyParses'));
apiRouter.use('/analysis', createPlanGate('analysisPerDay'));

apiRouter.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

apiRouter.get('/version', (req, res) => {
  res.json(getVersionPayload());
});

apiRouter.post('/parse-meal', async (req, res) => {
  let hasImage = false;
  try {
    const consumedAt = req.body.consumedAt || todayIsoString();
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const rawImageDataUrl = typeof req.body.imageDataUrl === 'string' ? req.body.imageDataUrl : '';
    hasImage = Boolean(rawImageDataUrl);
    let imageDataUrl = rawImageDataUrl;

    if (!text.trim() && !rawImageDataUrl) {
      return res.status(400).json({ error: 'Add a description, a photo, or both.' });
    }

    if (rawImageDataUrl) {
      const parsedImage = parseImageDataUrl(rawImageDataUrl);
      if (!parsedImage) {
        return res.status(400).json({ error: 'Invalid image format. Use an image file.' });
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
        return res.status(400).json({
          error: 'Unsupported image type. Use JPEG, PNG, WEBP, GIF, or HEIC.'
        });
      }

      const maxImageBytes = 6 * 1024 * 1024;
      const estimatedBytes = Math.floor((parsedImage.base64Payload.length * 3) / 4);
      if (estimatedBytes > maxImageBytes) {
        return res.status(400).json({ error: 'Image is too large. Please use an image under 6MB.' });
      }

      if (isHeicMimeType(mimeType)) {
        imageDataUrl = await convertHeicDataUrlToJpegDataUrl(rawImageDataUrl);
      } else {
        imageDataUrl = `data:${mimeType};base64,${parsedImage.base64Payload}`;
      }

      const normalizedImage = parseImageDataUrl(imageDataUrl);
      const normalizedEstimatedBytes = Math.floor((String(normalizedImage?.base64Payload || '').length * 3) / 4);
      if (normalizedEstimatedBytes > maxImageBytes) {
        return res.status(400).json({ error: 'Image is too large after processing. Please use a smaller photo.' });
      }
    }

    const parsed = await parseMealText({
      text,
      consumedAt,
      imageDataUrl
    });

    res.json(parsed);
  } catch (error) {
    const message = String(error?.message || 'Request failed');
    if (hasImage && message.includes('did not match the expected pattern')) {
      return res.status(400).json({
        error: 'Photo format was not accepted. Please retry with a JPEG/PNG image or add a short description.'
      });
    }
    res.status(400).json({ error: error.message });
  }
});


apiRouter.post('/parse-workout', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      return res.status(400).json({ error: 'Add a workout description first.' });
    }

    const parsed = await parseWorkoutText({ text });
    return res.json(parsed);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/entries/bulk', async (req, res) => {
  try {
    const consumedAt = req.body.consumedAt || todayIsoString();
    const rows = validateItems(req.body.items, consumedAt);

    if (!rows.length) {
      return res.status(400).json({ error: 'At least one item is required.' });
    }

    const mealName = String(req.body.mealName || '').trim() || null;
    const mealGroup = rows.length > 1 && mealName ? crypto.randomUUID() : null;
    const mealQuantity = Number(req.body.mealQuantity) > 0 ? Number(req.body.mealQuantity) : 1;
    const mealUnit = String(req.body.mealUnit || 'serving').trim();
    for (const row of rows) {
      row.mealGroup = mealGroup;
      row.mealName = mealName;
      row.mealQuantity = mealQuantity;
      row.mealUnit = mealUnit;
    }

    const userId = userIdFromReq(req);
    await addEntries(userId, rows);

    const saveItems = Array.isArray(req.body.saveItems) ? req.body.saveItems : [];
    const savedIds = [];
    for (const saveItem of saveItems) {
      const id = await addSavedItem(userId, validateSavedItemBody(saveItem));
      savedIds.push(id);
    }

    logAudit(userId, 'create', 'entries', null, { count: rows.length });
    return res.json({ ok: true, savedIds });
  } catch (error) {
    return res.status(400).json({ error: error.message });
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
    const updated = await setMacroTarget(userIdFromReq(req), macro, target);
    return res.json({ ok: true, ...updated });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});



apiRouter.get('/weights', async (req, res) => {
  try {
    const scope = String(req.query.scope || 'week').toLowerCase();
    const entries = await listWeightEntries(userIdFromReq(req), scope);
    res.json({ entries });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/energy-balance', async (req, res) => {
  try {
    const scope = String(req.query.scope || 'week').toLowerCase();
    const data = await getEnergyBalance(userIdFromReq(req), scope);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.get('/weight-target', async (req, res) => {
  try {
    const target = await getWeightTarget(userIdFromReq(req));
    res.json(target);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put('/weight-target', async (req, res) => {
  try {
    const target = await setWeightTarget(userIdFromReq(req), req.body || {});
    res.json({ ok: true, ...target });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/weights', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    await addWeightEntry(userId, req.body || {});
    logAudit(userId, 'create', 'weight_entry');
    res.json({ ok: true });
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
    const limit = Number(req.query.limit) || undefined;
    const offset = Number(req.query.offset) || undefined;
    const data = await listWorkoutEntries(userIdFromReq(req), { limit, offset });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/workouts', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    await addWorkoutEntry(userId, req.body || {});
    logAudit(userId, 'create', 'workout_entry');
    res.json({ ok: true });
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

apiRouter.get('/analysis/latest', async (req, res) => {
  try {
    const latest = await getLatestAnalysisReport(userIdFromReq(req));
    return res.json({ report: latest });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

apiRouter.post('/analysis', async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const days = normalizeAnalysisDays(req.body?.days);
    const snapshot = await getAnalysisSnapshot(userId, days);
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
    const limit = Number(req.query.limit) || undefined;
    const offset = Number(req.query.offset) || undefined;
    const data = await getDashboard(userIdFromReq(req), req.query.date, { limit, offset });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
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
app.use('/api/v1', bearerTokenAuth, requireAuth, enforceApiSource, apiRouter);
app.use('/api', bearerTokenAuth, requireAuth, enforceApiSource, apiRouter);

// ── Authenticated frontend routes ──

app.use(requireAuth);
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(indexHtml);
});
app.use(express.static(path.join(process.cwd(), 'public')));

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

startServer();
