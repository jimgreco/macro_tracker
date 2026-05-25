const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

// ── db.js schema & exports ──

test('db.js exports all required functions', () => {
  const db = read('src/db.js');
  const requiredExports = [
    'initDb',
    'getPool',
    'checkDatabaseHealth',
    'upsertUser',
    'getUserAccountControls',
    'listAdminAccounts',
    'updateAdminAccountControls',
    'getProviderUserId',
    'logAudit',
    'addEntries',
    'updateEntry',
    'deleteEntry',
    'scaleMealGroup',
    'addSavedItem',
    'updateSavedItem',
    'deleteSavedItem',
    'listSavedItems',
    'quickAddFromSaved',
    'claimLegacyData',
    'getDashboard',
    'getMacroTargets',
    'setMacroTarget',
    'addWeightEntry',
    'updateWeightEntry',
    'deleteWeightEntry',
    'listWeightEntries',
    'getWeightTarget',
    'setWeightTarget',
    'addWorkoutEntry',
    'updateWorkoutEntry',
    'deleteWorkoutEntry',
    'listWorkoutEntries',
    'getAnalysisSnapshot',
    'saveAnalysisReport',
    'getLatestAnalysisReport',
    'createApiToken',
    'validateApiToken',
    'listApiTokens',
    'deleteApiToken',
    'exportUserData',
    'deleteUserAccount',
    'getPlanLimits',
    'getSubscription',
    'consumeDailyUsage'
  ];

  for (const name of requiredExports) {
    assert.ok(db.includes(name), `db.js must export ${name}`);
  }
});

test('db.js creates users table', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('CREATE TABLE IF NOT EXISTS users'));
  assert.ok(db.includes("provider TEXT NOT NULL DEFAULT 'google'"));
});

test('db.js tracks admin-controlled account flags and login stats', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('is_disabled BOOLEAN NOT NULL DEFAULT FALSE'));
  assert.ok(db.includes('sexual_activity_enabled BOOLEAN NOT NULL DEFAULT FALSE'));
  assert.ok(db.includes('setup_tutorial_reset_at TIMESTAMPTZ'));
  assert.ok(db.includes('ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_tutorial_reset_at TIMESTAMPTZ'));
  assert.ok(db.includes('last_login_at TIMESTAMPTZ'));
  assert.ok(db.includes('login_count INTEGER NOT NULL DEFAULT 0'));
  assert.ok(db.includes('setupTutorialResetAt: dateToIso'));
  assert.ok(db.includes('idx_users_last_login'));
  assert.ok(db.includes('login_count = COALESCE(users.login_count, 0) + 1'));
});

test('db.js tracks auth provider identities for account linking', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('CREATE TABLE IF NOT EXISTS user_identities'));
  assert.ok(db.includes('PRIMARY KEY (provider, provider_user_id)'));
  assert.ok(db.includes('idx_user_identities_user'));
});

test('upsertUser links providers by normalized email and identity', () => {
  const db = read('src/db.js');
  const upsertSection = db.slice(db.indexOf('async function upsertUser'));
  assert.ok(upsertSection.includes('lower(email) = $1'));
  assert.ok(upsertSection.includes('FROM user_identities'));
  assert.ok(upsertSection.includes('ON CONFLICT (provider, provider_user_id) DO UPDATE'));
  assert.ok(upsertSection.includes('RETURNING id, email, name, picture, provider'));
});

test('db.js can resolve linked provider ids for downstream sync', () => {
  const db = read('src/db.js');
  const section = db.slice(db.indexOf('async function getProviderUserId'));
  assert.ok(section.includes('SELECT provider_user_id'));
  assert.ok(section.includes('WHERE user_id = $1 AND provider = $2'));
});

test('db.js creates api_tokens table', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('CREATE TABLE IF NOT EXISTS api_tokens'));
  assert.ok(db.includes('token_hash TEXT NOT NULL UNIQUE'));
});

test('db.js creates audit_log table', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('CREATE TABLE IF NOT EXISTS audit_log'));
  assert.ok(db.includes("action TEXT NOT NULL"));
  assert.ok(db.includes("entity_type TEXT NOT NULL"));
});

test('all data tables have deleted_at column', () => {
  const db = read('src/db.js');
  const tablesWithSoftDelete = [
    'entries',
    'saved_items',
    'weight_entries',
    'workout_entries',
    'analysis_reports',
    'sexual_activity_entries',
    'sleep_entries'
  ];

  for (const table of tablesWithSoftDelete) {
    assert.ok(
      db.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deleted_at`),
      `${table} must have deleted_at migration`
    );
  }
});

test('delete operations use soft delete (UPDATE SET deleted_at)', () => {
  const db = read('src/db.js');

  // deleteEntry
  assert.ok(db.includes("UPDATE entries SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL"));
  // deleteSavedItem
  assert.ok(db.includes("UPDATE saved_items SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL"));
  // deleteWeightEntry
  assert.ok(db.includes("UPDATE weight_entries SET deleted_at = NOW()"));
  // deleteWorkoutEntry
  assert.ok(db.includes("UPDATE workout_entries SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL"));
});

test('SELECT queries filter out soft-deleted rows', () => {
  const db = read('src/db.js');

  // listSavedItems
  assert.ok(db.includes('WHERE user_id = $1 AND deleted_at IS NULL\n     ORDER BY lower(name)'));
  // listWeightEntries
  assert.ok(db.includes('WHERE user_id = $1 AND deleted_at IS NULL\n       AND logged_at >='));
  // listWorkoutEntries
  const workoutSection = db.slice(db.indexOf('async function listWorkoutEntries'));
  assert.ok(workoutSection.includes('WHERE user_id = $1 AND deleted_at IS NULL'));
  assert.ok(workoutSection.includes('ORDER BY logged_at DESC, id DESC'));
});

test('workout entries track external sync source ids', () => {
  const db = read('src/db.js');
  assert.ok(db.includes("source TEXT NOT NULL DEFAULT 'manual'"));
  assert.ok(db.includes('external_id TEXT'));
  assert.ok(db.includes('idx_workout_entries_user_source_external'));
  assert.ok(db.includes('normalizeWorkoutSource'));
  assert.ok(db.includes('external_id AS "externalId"'));
});

test('health metric entries track external sync source ids', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('idx_weight_entries_user_source_external'));
  assert.ok(db.includes('idx_sleep_entries_user_source_external'));
  assert.ok(db.includes('idx_sexual_activity_entries_user_source_external'));
  assert.ok(db.includes('normalizeHealthEntrySource'));
  assert.ok(db.includes("source = normalizeHealthEntrySource(payload.source, 'Weight')"));
  assert.ok(db.includes("source = normalizeHealthEntrySource(payload.source, 'Sleep')"));
  assert.ok(db.includes("source = normalizeHealthEntrySource(payload.source, 'Sexual activity')"));
});

test('sleep entries support optional quality ratings', () => {
  const db = read('src/db.js');
  const server = read('src/server.js');

  assert.ok(db.includes('quality INTEGER CHECK (quality IS NULL OR (quality BETWEEN 1 AND 5))'));
  assert.ok(db.includes('ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS quality INTEGER'));
  assert.ok(db.includes('sleep_entries_quality_range'));
  assert.ok(db.includes('function normalizeSleepQuality'));
  assert.ok(db.includes('Sleep quality must be a whole number between 1 and 5.'));
  assert.ok(db.includes('INSERT INTO sleep_entries (user_id, duration_hours, wake_ups, quality, logged_at, source, external_id)'));
  assert.ok(db.includes('quality = CASE WHEN $8 THEN $9::integer ELSE quality END'));
  assert.ok(db.includes('quality: row.quality == null ? null : Number(row.quality)'));
  assert.ok(db.includes('SELECT id, duration_hours, wake_ups, quality, logged_at, source, external_id, created_at FROM sleep_entries'));
  assert.ok(server.includes('avgSleepQuality'));
});

test('GDPR deleteUserAccount performs hard delete across all tables', () => {
  const db = read('src/db.js');
  const tables = [
    'user_identities',
    'entries',
    'saved_items',
    'macro_targets',
    'weight_entries',
    'workout_entries',
    'sexual_activity_entries',
    'sleep_entries',
    'weight_targets',
    'analysis_reports',
    'api_tokens',
    'daily_usage_counts',
    'audit_log',
    'users'
  ];
  for (const table of tables) {
    const pattern = `DELETE FROM ${table} WHERE`;
    assert.ok(db.includes(pattern), `deleteUserAccount must hard-delete from ${table}`);
  }
});

test('GDPR exportUserData queries all data tables', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('async function exportUserData'));
  assert.ok(db.includes('FROM user_identities WHERE user_id = $1'));
  assert.ok(db.includes("FROM entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM saved_items WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM weight_entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM workout_entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM sexual_activity_entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM sleep_entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM analysis_reports WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes('FROM daily_usage_counts WHERE user_id = $1'));
});

test('daily AI usage counters are durable and keyed by user feature and date', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('CREATE TABLE IF NOT EXISTS daily_usage_counts'));
  assert.ok(db.includes('PRIMARY KEY (user_id, feature, usage_date)'));
  assert.ok(db.includes('async function consumeDailyUsage'));
  assert.ok(db.includes('ON CONFLICT (user_id, feature, usage_date)'));
  assert.ok(db.includes('daily_usage_counts.count < $4'));
});

test('getDashboard supports pagination via limit/offset', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('LIMIT $2 OFFSET $3'), 'getDashboard entries query must use LIMIT/OFFSET');
  assert.ok(db.includes('pagination: { limit, offset, returned:'));
});

test('listWorkoutEntries supports pagination via limit/offset', () => {
  const db = read('src/db.js');
  // The workout list query should also paginate
  const workoutSection = db.slice(db.indexOf('async function listWorkoutEntries'));
  assert.ok(workoutSection.includes('LIMIT $2 OFFSET $3'));
  assert.ok(workoutSection.includes('pagination:'));
});

test('listWeightEntries supports optional pagination via limit/offset', () => {
  const db = read('src/db.js');
  const weightSection = db.slice(db.indexOf('async function listWeightEntries'));
  assert.ok(weightSection.includes('LIMIT $4 OFFSET $5'));
  assert.ok(weightSection.includes('pagination:'));
});

// ── server.js API infrastructure ──

test('server.js imports all new db functions', () => {
  const server = read('src/server.js');
  const requiredImports = [
    'upsertUser',
    'getUserAccountControls',
    'listAdminAccounts',
    'updateAdminAccountControls',
    'logAudit',
    'createApiToken',
    'validateApiToken',
    'listApiTokens',
    'deleteApiToken',
    'exportUserData',
    'deleteUserAccount',
    'consumeDailyUsage'
  ];
  for (const name of requiredImports) {
    assert.ok(server.includes(name), `server.js must import ${name}`);
  }
});

test('server.js uses API router pattern for versioning', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("const apiRouter = express.Router()"));
  assert.ok(server.includes("app.use('/api/v1'"), 'Must mount apiRouter at /api/v1');
  assert.ok(server.includes("app.use('/api'"), 'Must mount apiRouter at /api for backward compat');
  assert.ok(server.includes('const BUILD_HASH_DIGITS = 7'));
  assert.ok(server.includes('function formatBuildIdentifier(build)'));
  assert.ok(server.includes('value.slice(0, BUILD_HASH_DIGITS)'));
  assert.ok(server.includes('const appBuild = formatBuildIdentifier('));
});

test('server.js includes Bearer token auth middleware', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('async function bearerTokenAuth'));
  assert.ok(server.includes("startsWith('Bearer ')"));
  assert.ok(server.includes('validateApiToken'));
});

test('server.js checks bearer tokens even when a local dev user is preloaded', () => {
  const server = read('src/server.js');
  const start = server.indexOf('async function bearerTokenAuth');
  const end = server.indexOf('function requireAuth', start);
  assert.ok(start > -1 && end > start);
  const middleware = server.slice(start, end);
  assert.equal(middleware.includes('if (hasAuthenticatedUser(req))'), false);
  assert.ok(middleware.indexOf("req.get('authorization')") < middleware.indexOf('validateApiToken(token)'));
  assert.ok(middleware.includes("req.authMode = 'bearer'"));
});

test('server.js has per-user rate limiting', () => {
  const server = read('src/server.js');
  // Rate limiter should use user id when available
  assert.ok(server.includes('req.user && req.user.id ? req.user.id : req.ip'));
});

test('server.js emits request IDs and includes them on API errors', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('X-Request-Id'));
  assert.ok(server.includes('req.requestId'));
  assert.ok(server.includes('body.requestId = req.requestId'));
  assert.ok(server.includes("event: 'http_request'") || server.includes("'http_request'"));
});

test('server.js disables Express fingerprinting and hardens state-changing origins', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("app.disable('x-powered-by')"));
  assert.ok(server.includes('function enforceStateChangingSource'));
  assert.ok(server.includes("['POST', 'PUT', 'PATCH', 'DELETE']"));
  assert.ok(server.includes("req.authMode === 'bearer'"));
  assert.ok(server.includes("'Forbidden request origin.'"));
});

test('server.js validates OAuth state for web auth flows', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("passport.authenticate('google', { scope: ['profile', 'email'], state: true })"));
  assert.ok(server.includes('req.session.appleAuthState = state'));
  assert.ok(server.includes("req.body?.state"));
  assert.ok(server.includes('delete req.session.appleAuthState'));
});

test('production session cookie supports Apple form_post callbacks', () => {
  const server = read('src/server.js');
  const sessionSection = server.slice(server.indexOf('app.use(\n  session({'), server.indexOf('app.use(passport.initialize())'));

  assert.ok(sessionSection.includes("sameSite: isProduction ? 'none' : 'lax'"));
  assert.ok(sessionSection.includes('secure: isProduction'));
  assert.ok(server.includes("responseMode: 'form_post'"));
});

test('server.js enforces durable daily usage limits for AI endpoints', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('async function enforceDailyUsage'));
  assert.ok(server.includes('AI_DAILY_MEAL_PARSE_LIMIT'));
  assert.ok(server.includes('AI_DAILY_WORKOUT_PARSE_LIMIT'));
  assert.ok(server.includes('AI_DAILY_PHOTO_PARSE_LIMIT'));
  assert.ok(server.includes('AI_DAILY_ANALYSIS_LIMIT'));
  assert.ok(server.includes("consumeDailyUsage(userId, feature, maxDaily)"));
});

test('server.js bounds parse payloads before invoking AI parsers', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("normalizeString(body.text, 'text', { maxLength: 4000"));
  assert.ok(server.includes('A meal can include at most 50 items.'));
  assert.ok(server.includes('Image is too large. Please use an image under 6MB.'));
});

test('server.js upserts user on OAuth callback', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('await upsertUser(req.user)'));
});

test('server.js supports native iOS Google sign-in code exchange', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("process.env.GOOGLE_IOS_CLIENT_ID"));
  assert.ok(server.includes('defaultGoogleIOSClientId'));
  assert.ok(server.includes("app.post('/auth/google/mobile'"));
  assert.ok(server.includes("'https://oauth2.googleapis.com/token'"));
  assert.ok(server.includes('https://oauth2.googleapis.com/tokeninfo?id_token='));
  assert.ok(server.includes('code_verifier'));
  assert.ok(server.includes('tokenInfo.aud !== googleIOSClientId'));
  assert.ok(server.includes('providerUserId: tokenInfo.sub'));
  assert.ok(server.includes("createApiToken(persistedUser.id, 'DailyMacros iOS'"));
});

test('server.js supports native iOS Apple sign-in without web Apple secrets', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("const defaultAppleBundleId = 'com.dailymacros.app'"));
  assert.ok(server.includes('process.env.APPLE_BUNDLE_ID || defaultAppleBundleId'));
  assert.ok(server.includes("app.post('/auth/apple/mobile'"));
  assert.ok(server.includes('const validAudiences = [appleClientId, appleBundleId].filter(Boolean)'));
  assert.ok(server.includes('providerUserId: payload.sub'));
  assert.ok(server.includes('email: verifiedTokenEmail(payload)'));
  assert.ok(server.includes("createApiToken(persistedUser.id, 'DailyMacros iOS'"));
});

test('server.js allows linked Google accounts to sync workouts', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('function userHasProvider'));
  assert.ok(server.includes("userHasProvider(req.user, 'google')"));
  assert.ok(server.includes("await getProviderUserId(userId, 'google')"));
  assert.ok(server.includes("'X-Internal-User-Id': workoutPlannerUserId"));
});

test('server.js has GDPR endpoints', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("apiRouter.get('/account/export'"));
  assert.ok(server.includes("apiRouter.delete('/account'"));
  assert.ok(server.includes('exportUserData'));
  assert.ok(server.includes('deleteUserAccount'));
});

test('server.js exposes protected admin account controls', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('ADMIN_EMAILS'));
  assert.ok(server.includes('ADMIN_USER_IDS'));
  assert.ok(server.includes('function requireAdmin'));
  assert.ok(server.includes("apiRouter.get('/admin/accounts'"));
  assert.ok(server.includes("apiRouter.patch('/admin/accounts/:userId'"));
  assert.ok(server.includes("res.set('Cache-Control', 'no-store, no-cache"));
  assert.ok(server.includes("delete req.headers['if-none-match']"));
  assert.ok(server.includes('listAdminAccounts({ search, limit, offset })'));
  assert.ok(server.includes('updateAdminAccountControls(targetUserId, controls)'));
  assert.ok(server.includes('resetSetupTutorial must be true'));
  assert.ok(server.includes('controls.resetSetupTutorial = true'));
  assert.ok(server.includes("app.get(['/admin', '/admin.html'], requireAdmin"));
});

test('server.js blocks disabled accounts and gates sexual activity endpoints', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('function enforceActiveAccount'));
  assert.ok(server.includes('This account has been disabled.'));
  assert.ok(server.includes('function requireSexualActivityAccess'));
  assert.ok(server.includes("apiRouter.use('/sexual-activity', requireSexualActivityAccess)"));
  assert.ok(server.includes('features: {\n      sexualActivity: Boolean(user.sexualActivityEnabled)'));
  assert.ok(server.includes('setupTutorialResetAt: user.setupTutorialResetAt || null'));
  assert.ok(server.includes("app.use('/api/v1', bearerTokenAuth, requireAuth, enforceActiveAccount"));
});

test('server.js has API token endpoints', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("apiRouter.get('/auth/tokens'"));
  assert.ok(server.includes("apiRouter.post('/auth/tokens'"));
  assert.ok(server.includes("apiRouter.delete('/auth/tokens/:id'"));
});

test('server.js applies bearerTokenAuth before requireAuth on API routes', () => {
  const server = read('src/server.js');
  // Bearer token should be checked before requireAuth
  const v1Mount = server.indexOf("app.use('/api/v1'");
  const mountLine = server.slice(v1Mount, server.indexOf('\n', v1Mount));
  assert.ok(mountLine.includes('bearerTokenAuth'));
  assert.ok(mountLine.includes('requireAuth'));
  assert.ok(mountLine.indexOf('bearerTokenAuth') < mountLine.indexOf('requireAuth'));
});

test('server.js serves login brand assets before the frontend auth guard', () => {
  const server = read('src/server.js');
  const brandAssetRoute = server.indexOf("app.get(['/favicon.svg', '/logo-mark.svg']");
  const authGuard = server.indexOf('app.use(requireAuth, enforceActiveAccount)');
  const protectedStaticMount = server.indexOf("app.use(express.static(path.join(process.cwd(), 'public'))");

  assert.ok(brandAssetRoute > -1, 'Brand asset route must exist');
  assert.ok(authGuard > -1, 'Frontend auth guard must exist');
  assert.ok(protectedStaticMount > -1, 'Protected static mount must exist');
  assert.ok(brandAssetRoute < authGuard, 'Login brand assets must be public');
  assert.ok(authGuard < protectedStaticMount, 'General static files should stay behind auth');
  assert.ok(server.includes('publicBrandAssetPaths.get(req.path)'));
});

test('server.js audit logs on mutating operations', () => {
  const server = read('src/server.js');
  // Check that key mutating endpoints call logAudit
  assert.ok(server.includes("logAudit(userId, 'create', 'entries'"));
  assert.ok(server.includes("logAudit(userId, 'update', 'entry'"));
  assert.ok(server.includes("logAudit(userId, 'delete', 'entry'"));
  assert.ok(server.includes("logAudit(userId, 'delete', 'account'"));
  assert.ok(server.includes("logAudit(userId, 'export', 'account'"));
});

test('server.js passes pagination params to dashboard', () => {
  const server = read('src/server.js');
  const dashboardSection = server.slice(server.indexOf("apiRouter.get('/dashboard'"));
  assert.ok(dashboardSection.includes('req.query.limit'));
  assert.ok(dashboardSection.includes('req.query.offset'));
});

test('server.js passes pagination params to workouts', () => {
  const server = read('src/server.js');
  const workoutsSection = server.slice(server.indexOf("apiRouter.get('/workouts'"));
  assert.ok(workoutsSection.includes('req.query.limit'));
  assert.ok(workoutsSection.includes('req.query.offset'));
});

test('server.js passes pagination params to weights', () => {
  const server = read('src/server.js');
  const weightsSection = server.slice(server.indexOf("apiRouter.get('/weights'"));
  assert.ok(weightsSection.includes('req.query.limit'));
  assert.ok(weightsSection.includes('req.query.offset'));
});

test('API token creation uses crypto.randomBytes for secure tokens', () => {
  const db = read('src/db.js');
  assert.ok(db.includes("crypto.randomBytes(32).toString('hex')"));
  assert.ok(db.includes("crypto.createHash('sha256')"));
});

test('API token validation joins users table', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('JOIN users u ON u.id = t.user_id'));
  assert.ok(db.includes("t.expires_at IS NULL OR t.expires_at > NOW()"));
});

test('logAudit does not throw on failure', () => {
  const db = read('src/db.js');
  const auditSection = db.slice(db.indexOf('async function logAudit'), db.indexOf('async function logAudit') + 500);
  assert.ok(auditSection.includes('try {'));
  assert.ok(auditSection.includes('catch (_error)'));
  assert.ok(auditSection.includes('// Audit logging should never break'));
});

test('indexes exist for new tables', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('idx_api_tokens_hash'));
  assert.ok(db.includes('idx_api_tokens_user'));
  assert.ok(db.includes('idx_audit_log_user'));
});

// ── Stripe billing infrastructure ──

test('db.js creates subscriptions and billing_events tables', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('CREATE TABLE IF NOT EXISTS subscriptions'));
  assert.ok(db.includes('stripe_customer_id TEXT UNIQUE'));
  assert.ok(db.includes('stripe_subscription_id TEXT UNIQUE'));
  assert.ok(db.includes("plan TEXT NOT NULL DEFAULT 'free'"));
  assert.ok(db.includes('CREATE TABLE IF NOT EXISTS billing_events'));
  assert.ok(db.includes('stripe_event_id TEXT UNIQUE'));
});

test('db.js exports subscription functions', () => {
  const db = read('src/db.js');
  const requiredExports = ['getPlanLimits', 'getSubscription', 'upsertSubscription', 'getSubscriptionByStripeCustomerId', 'saveBillingEvent'];
  for (const name of requiredExports) {
    assert.ok(db.includes(name), `db.js must export ${name}`);
  }
});

test('db.js defines plan limits for free and pro tiers', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('free: {'));
  assert.ok(db.includes('mealParsesPerDay'));
  assert.ok(db.includes('workoutParsesPerDay'));
  assert.ok(db.includes('photoParsesPerDay'));
  assert.ok(db.includes('analysisPerDay'));
  assert.ok(db.includes('pro: {'));
});

test('db.js deleteUserAccount also cleans up billing data', () => {
  const db = read('src/db.js');
  assert.ok(db.includes("DELETE FROM billing_events WHERE user_id = $1"));
  assert.ok(db.includes("DELETE FROM subscriptions WHERE user_id = $1"));
});

test('server.js imports Stripe and subscription functions', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("require('stripe')"));
  assert.ok(server.includes('getPlanLimits'));
  assert.ok(server.includes('getSubscription'));
  assert.ok(server.includes('upsertSubscription'));
  assert.ok(server.includes('saveBillingEvent'));
});

test('server.js has Stripe webhook endpoint before express.json()', () => {
  const server = read('src/server.js');
  const webhookPos = server.indexOf("'/api/v1/webhooks/stripe'");
  const jsonPos = server.indexOf("express.json({ limit: '10mb' })");
  assert.ok(webhookPos > 0, 'Webhook endpoint must exist');
  assert.ok(webhookPos < jsonPos, 'Webhook must be registered before express.json()');
  assert.ok(server.includes("express.raw({ type: 'application/json' })"), 'Webhook must use raw body parser');
  assert.ok(server.includes('stripe.webhooks.constructEvent'), 'Webhook must verify signature');
});

test('server.js handles key Stripe webhook events', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("'checkout.session.completed'"));
  assert.ok(server.includes("'customer.subscription.updated'"));
  assert.ok(server.includes("'customer.subscription.deleted'"));
  assert.ok(server.includes("'invoice.payment_failed'"));
});

test('server.js has subscription, checkout, and portal endpoints', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("apiRouter.get('/subscription'"));
  assert.ok(server.includes("apiRouter.post('/subscription/checkout'"));
  assert.ok(server.includes("apiRouter.post('/subscription/portal'"));
});

test('server.js has durable plan-based feature gating infrastructure', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('async function enforceDailyUsage'));
  assert.ok(server.includes('consumeDailyUsage(userId, feature, maxDaily)'));
});

test('subscription indexes exist', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('idx_subscriptions_stripe_customer'));
  assert.ok(db.includes('idx_subscriptions_stripe_sub'));
  assert.ok(db.includes('idx_billing_events_stripe'));
});

// ── Release infrastructure ──

test('deploy workflow verifies SSH host and smokes production endpoints', () => {
  const workflow = read('.github/workflows/deploy.yml');
  const script = read('scripts/production-smoke.sh');
  assert.ok(workflow.includes('actions/checkout@v5'));
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(workflow.includes('paths:'));
  assert.ok(workflow.includes("'src/**'"));
  assert.ok(workflow.includes("'public/**'"));
  assert.ok(workflow.includes("'.github/workflows/deploy.yml'"));
  assert.equal(workflow.includes("'ios/**'"), false);
  assert.ok(workflow.includes('ssh-keyscan -H "$EC2_HOST"'));
  assert.ok(workflow.includes('UserKnownHostsFile=~/.ssh/known_hosts'));
  assert.equal(workflow.includes('StrictHostKeyChecking=no'), false);
  assert.ok(workflow.includes('docker-compose.macros-build.yml'));
  assert.ok(workflow.includes('APP_BUILD: \\${APP_BUILD}'));
  assert.ok(workflow.includes('SHORT_GITHUB_SHA="${GITHUB_SHA::7}"'));
  assert.ok(workflow.includes('APP_BUILD=$SHORT_GITHUB_SHA docker-compose'));
  assert.ok(workflow.includes('docker-compose -f docker-compose.yml -f docker-compose.macros-build.yml up -d macros'));
  assert.ok(workflow.includes('PRODUCTION_BASE_URL'));
  assert.ok(workflow.includes('PRODUCTION_SMOKE_API_TOKEN'));
  assert.ok(workflow.includes('Skip post-deploy smoke when production URL is not configured'));
  assert.ok(workflow.includes("if: env.PRODUCTION_BASE_URL == ''"));
  assert.ok(workflow.includes("if: env.PRODUCTION_BASE_URL != ''"));
  assert.equal(workflow.includes('for name in EC2_SSH_KEY EC2_USER EC2_HOST PRODUCTION_BASE_URL; do'), false);
  assert.ok(workflow.includes('scripts/production-smoke.sh'));
  assert.ok(script.includes('SMOKE_CURL_RETRIES'));
  assert.ok(script.includes('--retry "$SMOKE_CURL_RETRIES"'));
});

test('scheduled production smoke workflow can run public and authenticated checks', () => {
  const workflow = read('.github/workflows/production-smoke.yml');
  const script = read('scripts/production-smoke.sh');

  assert.ok(workflow.includes("cron: '17 * * * *'"));
  assert.ok(workflow.includes('PRODUCTION_SMOKE_API_TOKEN'));
  assert.ok(workflow.includes('Skip when production URL is not configured'));
  assert.ok(workflow.includes("if: env.PRODUCTION_BASE_URL == ''"));
  assert.ok(workflow.includes("if: env.PRODUCTION_BASE_URL != ''"));
  assert.ok(workflow.includes('scripts/production-smoke.sh'));
  assert.ok(script.includes('$BASE_URL/healthz'));
  assert.ok(script.includes('$BASE_URL/version'));
  assert.ok(script.includes('$BASE_URL/api/me'));
  assert.ok(script.includes('$BASE_URL/api/dashboard?limit=5'));
  assert.ok(script.includes('$BASE_URL/api/account/export'));
  assert.ok(script.includes('$BASE_URL/api/parse-workout'));
  assert.ok(script.includes('Checking authenticated write journeys'));
  assert.ok(script.includes('$BASE_URL/api/entries/bulk'));
  assert.ok(script.includes('$BASE_URL/api/saved-items'));
  assert.ok(script.includes('$BASE_URL/api/quick-add'));
  assert.ok(script.includes('$BASE_URL/api/weights'));
  assert.ok(script.includes('$BASE_URL/api/sleep'));
  assert.ok(script.includes('$BASE_URL/api/sexual-activity'));
  assert.ok(script.includes('trap cleanup_created_records EXIT'));
  assert.ok(script.includes('dashboard_entry_id'));
});

test('barcode lookup uses Open Food Facts with normalized nutrition output', () => {
  const server = read('src/server.js');

  assert.ok(server.includes("apiRouter.use('/barcode'"));
  assert.ok(server.includes("apiRouter.get('/barcode/:barcode'"));
  assert.ok(server.includes('function normalizeBarcode'));
  assert.ok(server.includes('lookupOpenFoodFactsBarcode'));
  assert.ok(server.includes('https://world.openfoodfacts.org/api/v2/product/'));
  assert.ok(server.includes('OPEN_FOOD_FACTS_USER_AGENT'));
  assert.ok(server.includes('barcodeItemFromOpenFoodFactsProduct'));
  assert.ok(server.includes("nutriments['energy-kcal_serving']"));
  assert.ok(server.includes("nutriments['energy-kcal_100g']"));
});

test('TestFlight workflow rejects placeholder API base URLs and passes build metadata', () => {
  const workflow = read('.github/workflows/testflight.yml');
  assert.ok(workflow.includes('IOS_API_BASE_URL must be a real HTTPS production origin'));
  assert.ok(workflow.includes('IOS_API_BASE_URL must start with https://'));
  assert.ok(workflow.includes('GIT_COMMIT_HASH="$(git rev-parse --short=7 HEAD)"'));
  assert.ok(workflow.includes('APP_BUILD="$BUILD_NUMBER"'));
  assert.ok(workflow.includes('GIT_COMMIT_HASH="$GIT_COMMIT_HASH"'));
});

test('iOS settings exposes support privacy and build metadata', () => {
  const settings = read('ios/DailyMacros/DailyMacros/SettingsView.swift');
  const api = read('ios/DailyMacros/DailyMacros/APIClient.swift');
  const plist = read('ios/DailyMacros/DailyMacros/Info.plist');

  assert.ok(settings.includes('Privacy & Support'));
  assert.ok(settings.includes('meal photos submitted for parsing'));
  assert.ok(settings.includes('appBuildLabel'));
  assert.ok(settings.includes('apiBuildLabel'));
  assert.ok(settings.includes('private let buildHashDigits = 7'));
  assert.ok(settings.includes('shortBuildIdentifier(version.appBuild)'));
  assert.ok(settings.includes('String(raw.prefix(buildHashDigits))'));
  assert.ok(api.includes('func getVersion()'));
  assert.ok(api.includes('token = nil'));
  assert.ok(api.includes('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly'));
  assert.ok(plist.includes('<key>CFBundleDisplayName</key>'));
  assert.ok(plist.includes('<string>Daily Macros</string>'));
  assert.ok(plist.includes('<key>AppBuild</key>'));
  assert.ok(plist.includes('<key>GitCommitHash</key>'));
});

test('iOS list deletion wrapper does not intercept scroll drags', () => {
  const row = read('ios/DailyMacros/DailyMacros/SwipeToDeleteRow.swift');

  assert.equal(row.includes('DragGesture'), false);
  assert.equal(row.includes('simultaneousGesture'), false);
  assert.ok(row.includes('.contextMenu'));
  assert.ok(row.includes('accessibilityAction'));
});
