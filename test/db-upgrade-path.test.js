const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Pool } = require('pg');

const upgradeDatabaseUrl = process.env.TEST_UPGRADE_DATABASE_URL;

test('initDb upgrades the supported legacy schema without losing account data', {
  skip: !upgradeDatabaseUrl
}, async () => {
  const parsedUrl = new URL(upgradeDatabaseUrl);
  assert.match(
    parsedUrl.pathname,
    /(test|upgrade|ci)/i,
    'TEST_UPGRADE_DATABASE_URL must name a disposable test database'
  );

  const bootstrapPool = new Pool({
    connectionString: upgradeDatabaseUrl,
    ssl: undefined,
    max: 1
  });
  const existing = await bootstrapPool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`
  );
  assert.deepEqual(
    existing.rows,
    [],
    'the upgrade-path test requires a newly created, empty database'
  );

  await bootstrapPool.query(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      picture TEXT,
      provider TEXT NOT NULL DEFAULT 'google',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      unit TEXT,
      calories DOUBLE PRECISION NOT NULL,
      protein DOUBLE PRECISION NOT NULL,
      carbs DOUBLE PRECISION NOT NULL,
      fat DOUBLE PRECISION NOT NULL,
      consumed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE saved_items (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      unit TEXT,
      calories DOUBLE PRECISION NOT NULL,
      protein DOUBLE PRECISION NOT NULL,
      carbs DOUBLE PRECISION NOT NULL,
      fat DOUBLE PRECISION NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE macro_targets (
      user_id TEXT NOT NULL,
      macro TEXT NOT NULL,
      target DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, macro)
    );

    CREATE TABLE weight_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      weight DOUBLE PRECISION NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE workout_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      duration_hours DOUBLE PRECISION NOT NULL,
      calories_burned DOUBLE PRECISION NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE ejaculation_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'masturbation',
      logged_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE sleep_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      duration_hours DOUBLE PRECISION NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE weight_targets (
      user_id TEXT PRIMARY KEY,
      target_weight DOUBLE PRECISION NOT NULL,
      target_date DATE NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE analysis_reports (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      period_days INTEGER NOT NULL,
      report_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      stripe_customer_id TEXT UNIQUE,
      stripe_subscription_id TEXT UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE billing_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      stripe_event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO users (id, email, name, provider)
    VALUES ('upgrade-user', 'upgrade@example.com', 'Upgrade Sentinel', 'google');
    INSERT INTO entries (
      user_id, item_name, quantity, unit, calories, protein, carbs, fat, consumed_at
    )
    VALUES (
      'upgrade-user', 'Legacy Oatmeal', 1, 'bowl', 320, 14, 48, 8,
      '2026-01-15T13:00:00Z'
    );
    INSERT INTO macro_targets (user_id, macro, target)
    VALUES ('upgrade-user', 'protein', 150);
    INSERT INTO weight_targets (user_id, target_weight, target_date)
    VALUES ('upgrade-user', 175, DATE '2026-12-31');
    INSERT INTO ejaculation_entries (user_id, type, logged_at)
    VALUES ('upgrade-user', 'sex', '2026-01-15T23:00:00Z');
    INSERT INTO subscriptions (
      user_id, stripe_customer_id, stripe_subscription_id, plan, status
    )
    VALUES (
      'upgrade-user', 'cus_upgrade_sentinel', 'sub_upgrade_sentinel', 'pro', 'active'
    );
    INSERT INTO billing_events (user_id, stripe_event_id, event_type, payload)
    VALUES (
      'upgrade-user', 'evt_upgrade_sentinel', 'customer.subscription.updated',
      '{"legacy":"sensitive-provider-payload"}'::jsonb
    );
  `);
  await bootstrapPool.end();

  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = upgradeDatabaseUrl;
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  delete require.cache[dbPath];
  const db = require(dbPath);

  try {
    await db.initDb();
    await db.initDb();

    const sentinel = await db.getPool().query(
      `SELECT item_name, source, deleted_at
       FROM entries
       WHERE user_id = 'upgrade-user'`
    );
    assert.deepEqual(sentinel.rows, [
      { item_name: 'Legacy Oatmeal', source: 'manual', deleted_at: null }
    ]);

    const account = await db.getPool().query(
      `SELECT timezone, is_disabled, optional_diagnostics_enabled
       FROM users
       WHERE id = 'upgrade-user'`
    );
    assert.deepEqual(account.rows[0], {
      timezone: 'America/New_York',
      is_disabled: false,
      optional_diagnostics_enabled: true
    });

    const migratedSexualActivity = await db.getPool().query(
      `SELECT type, source, deleted_at
       FROM sexual_activity_entries
       WHERE user_id = 'upgrade-user'`
    );
    assert.deepEqual(migratedSexualActivity.rows, [
      { type: 'sex', source: 'manual', deleted_at: null }
    ]);

    const oldTable = await db.getPool().query(
      `SELECT to_regclass('public.ejaculation_entries') AS table_name`
    );
    assert.equal(oldTable.rows[0].table_name, null);

    const macroTarget = await db.getPool().query(
      `SELECT target, effective_date::text
       FROM macro_targets
       WHERE user_id = 'upgrade-user' AND macro = 'protein'`
    );
    assert.deepEqual(macroTarget.rows, [
      { target: 150, effective_date: '1970-01-01' }
    ]);
    await db.getPool().query(
      `INSERT INTO macro_targets (user_id, macro, target, effective_date)
       VALUES ('upgrade-user', 'protein', 160, DATE '2026-02-01')`
    );

    const weightTarget = await db.getPool().query(
      `SELECT target_weight, target_date::text, effective_date::text
       FROM weight_targets
       WHERE user_id = 'upgrade-user'`
    );
    assert.deepEqual(weightTarget.rows, [
      {
        target_weight: 175,
        target_date: '2026-12-31',
        effective_date: '1970-01-01'
      }
    ]);
    await db.getPool().query(
      `INSERT INTO weight_targets (
         user_id, target_weight, target_date, effective_date
       )
       VALUES ('upgrade-user', NULL, NULL, DATE '2026-02-01')`
    );

    const billingUpgrade = await db.getPool().query(
      `SELECT
         subscription.plan,
         subscription.status,
         subscription.provider_observed_at,
         event.event_type,
         event.payload,
         event.applied_at
       FROM subscriptions AS subscription
       JOIN billing_events AS event
         ON event.user_id = subscription.user_id
       WHERE subscription.user_id = 'upgrade-user'`
    );
    assert.deepEqual(billingUpgrade.rows, [
      {
        plan: 'pro',
        status: 'active',
        provider_observed_at: null,
        event_type: 'customer.subscription.updated',
        payload: {},
        applied_at: null
      }
    ]);

    const billingForeignKeys = await db.getPool().query(
      `SELECT conname, convalidated, confdeltype
       FROM pg_constraint
       WHERE conname = ANY($1::text[])
       ORDER BY conname`,
      [[
        'billing_events_user_id_fkey',
        'subscriptions_user_id_fkey'
      ]]
    );
    assert.deepEqual(billingForeignKeys.rows, [
      {
        conname: 'billing_events_user_id_fkey',
        convalidated: true,
        confdeltype: 'c'
      },
      {
        conname: 'subscriptions_user_id_fkey',
        convalidated: true,
        confdeltype: 'c'
      }
    ]);

    const migrationNames = await db.getPool().query(
      'SELECT name FROM schema_migrations ORDER BY name'
    );
    assert.ok(
      migrationNames.rows.some(
        (row) => row.name === '2026-07-28_data_inventory_and_retention'
      )
    );
    assert.ok(
      migrationNames.rows.some(
        (row) => row.name === '2026-07-28_healthkit_sleep_revision_deduplication'
      )
    );
    assert.ok(
      migrationNames.rows.some(
        (row) => row.name === '2026-07-29_durable_webhook_inbox'
      )
    );
    assert.ok(
      migrationNames.rows.some(
        (row) => row.name === '2026-07-31_integration_data_access'
      )
    );

    const requiredTables = await db.getPool().query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [[
        'client_mutations',
        'integration_data_permissions',
        'nutrition_day_completeness',
        'rate_limit_counters',
        'web_sessions',
        'webhook_events'
      ]]
    );
    assert.deepEqual(
      requiredTables.rows.map((row) => row.table_name),
      [
        'client_mutations',
        'integration_data_permissions',
        'nutrition_day_completeness',
        'rate_limit_counters',
        'web_sessions',
        'webhook_events'
      ]
    );

    const durableInboxColumns = await db.getPool().query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'webhook_events'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [[
        'attempt_count',
        'lease_expires_at',
        'max_attempts',
        'next_attempt_at',
        'provider_event_id',
        'purge_after',
        'status'
      ]]
    );
    assert.deepEqual(
      durableInboxColumns.rows.map((row) => row.column_name),
      [
        'attempt_count',
        'lease_expires_at',
        'max_attempts',
        'next_attempt_at',
        'provider_event_id',
        'purge_after',
        'status'
      ]
    );
  } finally {
    await db.getPool().end();
    delete require.cache[dbPath];
    if (originalDatabaseUrl == null) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});
