require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const OpenAI = require('openai');
const heicConvert = require('heic-convert');
const {
  initDb,
  checkDatabaseHealth,
  addEntries,
  updateEntry,
  deleteEntry,
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
  getLatestAnalysisReport
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

function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}:${req.path}`;
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
  return Boolean(googleClientId && googleClientSecret);
}

function requireAuth(req, res, next) {
  if (hasAuthenticatedUser(req)) {
    return next();
  }

  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized. Sign in with Google first.' });
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

app.get('/login', (req, res) => {
  if (hasAuthenticatedUser(req)) {
    return res.redirect('/');
  }

  return res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
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
  (req, res) => {
    res.redirect('/');
  }
);

app.post('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user || null });
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

app.get('/api/version', (req, res) => {
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

app.use('/api', requireAuth);
app.use('/api', enforceApiSource);
app.use('/api/parse-meal', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 15 }));
app.use('/api/parse-workout', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }));
app.use('/api/analysis', createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 5 }));

app.post('/api/parse-meal', async (req, res) => {
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


app.post('/api/parse-workout', async (req, res) => {
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

app.post('/api/entries/bulk', async (req, res) => {
  try {
    const consumedAt = req.body.consumedAt || todayIsoString();
    const rows = validateItems(req.body.items, consumedAt);

    if (!rows.length) {
      return res.status(400).json({ error: 'At least one item is required.' });
    }

    const userId = userIdFromReq(req);
    await addEntries(userId, rows);

    const saveItems = Array.isArray(req.body.saveItems) ? req.body.saveItems : [];
    const savedIds = [];
    for (const saveItem of saveItems) {
      const id = await addSavedItem(userId, validateSavedItemBody(saveItem));
      savedIds.push(id);
    }

    return res.json({ ok: true, savedIds });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }

    const payload = validateEntryBody(req.body || {});
    const changes = await updateEntry(userIdFromReq(req), id, payload);

    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entry id.' });
    }

    const changes = await deleteEntry(userIdFromReq(req), id);
    if (!changes) {
      return res.status(404).json({ error: 'Entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get('/api/saved-items', async (req, res) => {
  try {
    const items = await listSavedItems(userIdFromReq(req));
    res.json(items);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/saved-items', async (req, res) => {
  try {
    const id = await addSavedItem(userIdFromReq(req), validateSavedItemBody(req.body || {}));
    res.json({ id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/saved-items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid saved item id.' });
    }

    const payload = validateSavedItemBody(req.body || {});
    const changes = await updateSavedItem(userIdFromReq(req), id, payload);

    if (!changes) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/api/saved-items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid saved item id.' });
    }

    const changes = await deleteSavedItem(userIdFromReq(req), id);
    if (!changes) {
      return res.status(404).json({ error: 'Saved item not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/quick-add', async (req, res) => {
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

app.post('/api/claim-legacy-data', async (req, res) => {
  try {
    const result = await claimLegacyData(userIdFromReq(req));
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.put('/api/macro-targets/:macro', async (req, res) => {
  try {
    const macro = String(req.params.macro || '').toLowerCase();
    const target = Number(req.body?.target);
    const updated = await setMacroTarget(userIdFromReq(req), macro, target);
    return res.json({ ok: true, ...updated });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});



app.get('/api/weights', async (req, res) => {
  try {
    const scope = String(req.query.scope || 'week').toLowerCase();
    const entries = await listWeightEntries(userIdFromReq(req), scope);
    res.json({ entries });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/weight-target', async (req, res) => {
  try {
    const target = await getWeightTarget(userIdFromReq(req));
    res.json(target);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/weight-target', async (req, res) => {
  try {
    const target = await setWeightTarget(userIdFromReq(req), req.body || {});
    res.json({ ok: true, ...target });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/weights', async (req, res) => {
  try {
    await addWeightEntry(userIdFromReq(req), req.body || {});
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/weights/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const changes = await updateWeightEntry(userIdFromReq(req), id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/api/weights/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const changes = await deleteWeightEntry(userIdFromReq(req), id);
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/weights/:id/delete', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const changes = await deleteWeightEntry(userIdFromReq(req), id);
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/weights/delete', async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid weight entry id.' });
    }

    const changes = await deleteWeightEntry(userIdFromReq(req), id);
    if (!changes) {
      return res.status(404).json({ error: 'Weight entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get('/api/workouts', async (req, res) => {
  try {
    const data = await listWorkoutEntries(userIdFromReq(req));
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/workouts', async (req, res) => {
  try {
    await addWorkoutEntry(userIdFromReq(req), req.body || {});
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/workouts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid workout entry id.' });
    }

    const changes = await updateWorkoutEntry(userIdFromReq(req), id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Workout entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/workouts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid workout entry id.' });
    }

    const changes = await updateWorkoutEntry(userIdFromReq(req), id, req.body || {});
    if (!changes) {
      return res.status(404).json({ error: 'Workout entry not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get('/api/analysis/latest', async (req, res) => {
  try {
    const latest = await getLatestAnalysisReport(userIdFromReq(req));
    return res.json({ report: latest });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/analysis', async (req, res) => {
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

app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboard(userIdFromReq(req), req.query.date);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

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
