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
    'listWorkoutEntries',
    'getAnalysisSnapshot',
    'saveAnalysisReport',
    'getLatestAnalysisReport',
    'getEnergyBalance',
    'createApiToken',
    'validateApiToken',
    'listApiTokens',
    'deleteApiToken',
    'exportUserData',
    'deleteUserAccount'
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
  const tablesWithSoftDelete = ['entries', 'saved_items', 'weight_entries', 'workout_entries', 'analysis_reports'];

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
});

test('SELECT queries filter out soft-deleted rows', () => {
  const db = read('src/db.js');

  // listSavedItems
  assert.ok(db.includes('WHERE user_id = $1 AND deleted_at IS NULL\n     ORDER BY lower(name)'));
  // listWeightEntries
  assert.ok(db.includes('WHERE user_id = $1 AND deleted_at IS NULL\n       AND logged_at >='));
  // listWorkoutEntries
  assert.ok(db.includes("WHERE user_id = $1 AND deleted_at IS NULL\n     ORDER BY logged_at DESC, id DESC\n     LIMIT $2 OFFSET $3"));
});

test('GDPR deleteUserAccount performs hard delete across all tables', () => {
  const db = read('src/db.js');
  const tables = ['entries', 'saved_items', 'macro_targets', 'weight_entries', 'workout_entries', 'weight_targets', 'analysis_reports', 'api_tokens', 'audit_log', 'users'];
  for (const table of tables) {
    const pattern = `DELETE FROM ${table} WHERE`;
    assert.ok(db.includes(pattern), `deleteUserAccount must hard-delete from ${table}`);
  }
});

test('GDPR exportUserData queries all data tables', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('async function exportUserData'));
  assert.ok(db.includes("FROM entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM saved_items WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM weight_entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM workout_entries WHERE user_id = $1 AND deleted_at IS NULL"));
  assert.ok(db.includes("FROM analysis_reports WHERE user_id = $1 AND deleted_at IS NULL"));
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

// ── server.js API infrastructure ──

test('server.js imports all new db functions', () => {
  const server = read('src/server.js');
  const requiredImports = [
    'upsertUser',
    'logAudit',
    'createApiToken',
    'validateApiToken',
    'listApiTokens',
    'deleteApiToken',
    'exportUserData',
    'deleteUserAccount'
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
});

test('server.js includes Bearer token auth middleware', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('async function bearerTokenAuth'));
  assert.ok(server.includes("startsWith('Bearer ')"));
  assert.ok(server.includes('validateApiToken'));
});

test('server.js has per-user rate limiting', () => {
  const server = read('src/server.js');
  // Rate limiter should use user id when available
  assert.ok(server.includes('req.user && req.user.id ? req.user.id : req.ip'));
});

test('server.js upserts user on OAuth callback', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('await upsertUser(req.user)'));
});

test('server.js has GDPR endpoints', () => {
  const server = read('src/server.js');
  assert.ok(server.includes("apiRouter.get('/account/export'"));
  assert.ok(server.includes("apiRouter.delete('/account'"));
  assert.ok(server.includes('exportUserData'));
  assert.ok(server.includes('deleteUserAccount'));
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
  assert.ok(db.includes("free: { dailyParses:"));
  assert.ok(db.includes("pro: { dailyParses:"));
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

test('server.js has plan-based feature gating on AI endpoints', () => {
  const server = read('src/server.js');
  assert.ok(server.includes('function createPlanGate'));
  assert.ok(server.includes("createPlanGate('dailyParses')"));
  assert.ok(server.includes("createPlanGate('analysisPerDay')"));
  assert.ok(server.includes('Upgrade to Pro for higher limits'));
});

test('subscription indexes exist', () => {
  const db = read('src/db.js');
  assert.ok(db.includes('idx_subscriptions_stripe_customer'));
  assert.ok(db.includes('idx_subscriptions_stripe_sub'));
  assert.ok(db.includes('idx_billing_events_stripe'));
});
