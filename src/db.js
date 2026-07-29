const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const { applyFoodCorrectionToItem, canApplyFoodCorrection } = require('./food-correction');
const {
  DAY_COMPLETENESS_STATES,
  normalizeDayCompletenessState,
  buildDayCompleteness,
  summarizeDayCompleteness
} = require('./day-completeness');
const { sanitizeClientDiagnostic } = require('./client-diagnostics');
const {
  DATA_INVENTORY_VERSION,
  accountDeletionInventory,
  accountExportInventory,
  retentionInventory
} = require('./data-inventory');

const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL || (!isProduction ? 'postgres://postgres:postgres@localhost:5432/macro_tracker' : '');

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Postgres.');
}

function toBoolean(value, defaultValue) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

function buildSslConfig(connectionString) {
  if (process.env.PGSSL === 'false') {
    return undefined;
  }

  const useSsl =
    process.env.PGSSL === 'true' ||
    process.env.PGSSL === 'require' ||
    isProduction ||
    String(connectionString || '').includes('rds.amazonaws.com');

  if (!useSsl) {
    return undefined;
  }

  const rejectUnauthorized = toBoolean(process.env.PGSSL_REJECT_UNAUTHORIZED, true);
  const ssl = { rejectUnauthorized };
  const caInline = String(process.env.PGSSL_CA_CERT || '').trim();
  const caFile = String(process.env.PGSSL_CA_FILE || '').trim();

  if (caInline) {
    ssl.ca = caInline;
  } else if (caFile) {
    ssl.ca = fs.readFileSync(caFile, 'utf8');
  }

  return ssl;
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: buildSslConfig(databaseUrl),
  max: Number(process.env.PG_POOL_MAX || 10)
});

function getPool() {
  return pool;
}

async function checkDatabaseHealth() {
  const startedAt = Date.now();
  await pool.query('SELECT 1');
  return {
    ok: true,
    latencyMs: Date.now() - startedAt
  };
}

async function recordSchemaMigration(name) {
  await pool.query(
    `INSERT INTO schema_migrations (name, applied_at)
     VALUES ($1, NOW())
     ON CONFLICT (name) DO NOTHING`,
    [name]
  );
}

async function deduplicateHealthKitSleepRevisions(queryable = pool) {
  const result = await queryable.query(`
    WITH ordered AS (
      SELECT id,
             user_id,
             duration_hours,
             quality,
             notes,
             logged_at,
             created_at,
             LAG(logged_at) OVER (
               PARTITION BY user_id
               ORDER BY logged_at, id
             ) AS previous_logged_at,
             MAX(logged_at + (duration_hours * INTERVAL '1 hour')) OVER (
               PARTITION BY user_id
               ORDER BY logged_at, id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS previous_session_end
      FROM sleep_entries
      WHERE source = 'healthkit' AND deleted_at IS NULL
    ),
    cluster_boundaries AS (
      SELECT *,
             CASE
               WHEN previous_logged_at IS NULL
                 OR (
                   logged_at - previous_logged_at > INTERVAL '15 minutes'
                   AND logged_at >= previous_session_end
                 )
               THEN 1
               ELSE 0
             END AS starts_new_cluster
      FROM ordered
    ),
    clustered AS (
      SELECT *,
             SUM(starts_new_cluster) OVER (
               PARTITION BY user_id
               ORDER BY logged_at, id
             ) AS session_cluster
      FROM cluster_boundaries
    ),
    session_summary AS (
      SELECT user_id,
             session_cluster,
             COUNT(*) AS revision_count,
             (ARRAY_AGG(id ORDER BY created_at DESC, id DESC))[1] AS canonical_id,
             (
               ARRAY_AGG(quality ORDER BY created_at DESC, id DESC)
               FILTER (WHERE quality IS NOT NULL)
             )[1] AS preserved_quality,
             (
               ARRAY_AGG(notes ORDER BY created_at DESC, id DESC)
               FILTER (WHERE notes IS NOT NULL)
             )[1] AS preserved_notes
      FROM clustered
      GROUP BY user_id, session_cluster
    ),
    assignments AS (
      SELECT clustered.id,
             summary.canonical_id,
             summary.preserved_quality,
             summary.preserved_notes
      FROM clustered
      JOIN session_summary AS summary
        ON summary.user_id = clustered.user_id
       AND summary.session_cluster = clustered.session_cluster
      WHERE summary.revision_count > 1
    )
    UPDATE sleep_entries AS entry
    SET quality = CASE
          WHEN entry.id = assignments.canonical_id
          THEN COALESCE(entry.quality, assignments.preserved_quality)
          ELSE entry.quality
        END,
        notes = CASE
          WHEN entry.id = assignments.canonical_id
          THEN COALESCE(entry.notes, assignments.preserved_notes)
          ELSE entry.notes
        END,
        deleted_at = CASE
          WHEN entry.id = assignments.canonical_id
          THEN NULL
          ELSE NOW()
        END
    FROM assignments
    WHERE entry.id = assignments.id
    RETURNING entry.deleted_at
  `);
  return result.rows.filter((row) => row.deleted_at != null).length;
}

async function applyHealthKitSleepRevisionMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const migration = await client.query(
      `INSERT INTO schema_migrations (name, applied_at)
       VALUES ($1, NOW())
       ON CONFLICT (name) DO NOTHING
       RETURNING name`,
      ['2026-07-28_healthkit_sleep_revision_deduplication']
    );
    if (migration.rows.length) {
      await deduplicateHealthKitSleepRevisions(client);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Core user table ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      picture TEXT,
      provider TEXT NOT NULL DEFAULT 'google',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
      sexual_activity_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      optional_diagnostics_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      setup_tutorial_reset_at TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      login_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_identities (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, provider_user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      meal_group TEXT,
      meal_name TEXT,
      meal_quantity DOUBLE PRECISION DEFAULT 1,
      meal_unit TEXT DEFAULT 'serving',
      source TEXT NOT NULL DEFAULT 'manual',
      source_detail TEXT,
      confidence DOUBLE PRECISION,
      needs_review BOOLEAN NOT NULL DEFAULT FALSE,
      correction_key TEXT,
      deleted_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nutrition_day_completeness (
      user_id TEXT NOT NULL,
      local_date DATE NOT NULL,
      state TEXT NOT NULL,
      timezone TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, local_date),
      CHECK (state IN ('complete', 'partial'))
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_items (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      unit TEXT,
      calories DOUBLE PRECISION NOT NULL,
      protein DOUBLE PRECISION NOT NULL,
      carbs DOUBLE PRECISION NOT NULL,
      components JSONB,
      fat DOUBLE PRECISION NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      source_detail TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS macro_targets (
      user_id TEXT NOT NULL,
      macro TEXT NOT NULL,
      target DOUBLE PRECISION NOT NULL,
      effective_date DATE NOT NULL DEFAULT DATE '1970-01-01',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, macro, effective_date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS weight_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      weight DOUBLE PRECISION NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      intensity TEXT NOT NULL DEFAULT 'medium',
      duration_hours DOUBLE PRECISION NOT NULL,
      calories_burned DOUBLE PRECISION NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  // Rename old table if it exists
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ejaculation_entries')
         AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sexual_activity_entries') THEN
        ALTER TABLE ejaculation_entries RENAME TO sexual_activity_entries;
      ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ejaculation_entries')
         AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sexual_activity_entries') THEN
        DROP TABLE ejaculation_entries;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sexual_activity_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'masturbation',
      logged_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sleep_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      duration_hours DOUBLE PRECISION NOT NULL,
      wake_ups INTEGER NOT NULL DEFAULT 0,
      quality INTEGER CHECK (quality IS NULL OR (quality BETWEEN 1 AND 5)),
      notes TEXT,
      logged_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS wake_ups INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS quality INTEGER;`);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS notes TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS weight_targets (
      user_id TEXT NOT NULL,
      target_weight DOUBLE PRECISION,
      target_date DATE,
      effective_date DATE NOT NULL DEFAULT DATE '1970-01-01',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, effective_date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS analysis_reports (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      period_days INTEGER NOT NULL,
      report_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);

  // ── Subscriptions ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      stripe_customer_id TEXT UNIQUE,
      stripe_subscription_id TEXT UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      provider_observed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_observed_at TIMESTAMPTZ;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      stripe_event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;`);
  // The durable inbox owns the short-lived minimum provider receipt. The
  // billing ledger needs only event identity/type and application time.
  await pool.query(`UPDATE billing_events SET payload = '{}'::jsonb WHERE payload <> '{}'::jsonb;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      delivery_kind TEXT NOT NULL DEFAULT 'webhook'
        CHECK (delivery_kind IN ('webhook', 'reconciliation')),
      user_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'processing', 'processed', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
      next_attempt_at TIMESTAMPTZ,
      processing_started_at TIMESTAMPTZ,
      lease_expires_at TIMESTAMPTZ,
      worker_id TEXT,
      failure_code TEXT,
      occurred_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_failed_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ,
      purge_after TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_event_id)
    );
  `);
  await pool.query(`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;`);
  await pool.query(`
    DELETE FROM subscriptions AS subscription
    WHERE NOT EXISTS (
      SELECT 1 FROM users WHERE users.id = subscription.user_id
    );
  `);
  await pool.query(`
    DELETE FROM billing_events AS event
    WHERE event.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users WHERE users.id = event.user_id
      );
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'subscriptions_user_id_fkey'
          AND conrelid = 'subscriptions'::regclass
      ) THEN
        ALTER TABLE subscriptions
          ADD CONSTRAINT subscriptions_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billing_events_user_id_fkey'
          AND conrelid = 'billing_events'::regclass
      ) THEN
        ALTER TABLE billing_events
          ADD CONSTRAINT billing_events_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
  `);
  await pool.query(`ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_user_id_fkey;`);
  await pool.query(`ALTER TABLE billing_events VALIDATE CONSTRAINT billing_events_user_id_fkey;`);

  // ── API tokens for mobile/external clients ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT 'default',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ
    );
  `);

  // ── Shared web sessions and abuse-control counters ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      sid TEXT PRIMARY KEY,
      public_id UUID NOT NULL UNIQUE,
      user_id TEXT,
      session_data JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      bucket_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (count > 0)
    );
  `);

  // ── Audit log ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Durable daily usage counters for cost-sensitive AI features ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_usage_counts (
      user_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, feature, usage_date)
    );
  `);

  // ── Synced AI coach dismissals ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coach_dismissals (
      user_id TEXT NOT NULL,
      dismissal_type TEXT NOT NULL,
      dismissal_key TEXT NOT NULL,
      dismissed_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, dismissal_type, dismissal_key),
      CHECK (dismissal_type IN ('today', 'pattern'))
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS food_corrections (
      user_id TEXT NOT NULL,
      correction_key TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      unit TEXT,
      calories DOUBLE PRECISION NOT NULL,
      protein DOUBLE PRECISION NOT NULL,
      carbs DOUBLE PRECISION NOT NULL,
      fat DOUBLE PRECISION NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual_correction',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, correction_key)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_diagnostics (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL DEFAULT 'client',
      message TEXT NOT NULL,
      details JSONB,
      user_agent TEXT,
      app_platform TEXT,
      app_version TEXT,
      request_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Per-account idempotency ledger for replayable client mutations ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_mutations (
      user_id TEXT NOT NULL,
      client_mutation_id TEXT NOT NULL,
      request_method TEXT NOT NULL,
      request_path TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'processing',
      response_status INTEGER,
      response_body JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (user_id, client_mutation_id),
      CHECK (state IN ('processing', 'completed'))
    );
  `);

  // ── Migrations for existing databases ──
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sexual_activity_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS optional_diagnostics_enabled BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_tutorial_reset_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;`);

  await pool.query(`
    ALTER TABLE workout_entries
      ADD COLUMN IF NOT EXISTS intensity TEXT NOT NULL DEFAULT 'medium';
  `);
  await pool.query(`ALTER TABLE workout_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';`);
  await pool.query(`ALTER TABLE workout_entries ADD COLUMN IF NOT EXISTS external_id TEXT;`);
  await pool.query(`ALTER TABLE weight_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';`);
  await pool.query(`ALTER TABLE weight_entries ADD COLUMN IF NOT EXISTS external_id TEXT;`);
  await pool.query(`ALTER TABLE sexual_activity_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';`);
  await pool.query(`ALTER TABLE sexual_activity_entries ADD COLUMN IF NOT EXISTS external_id TEXT;`);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';`);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS external_id TEXT;`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sleep_entries_quality_range'
      ) THEN
        ALTER TABLE sleep_entries
          ADD CONSTRAINT sleep_entries_quality_range
          CHECK (quality IS NULL OR (quality BETWEEN 1 AND 5));
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE entries
      ADD COLUMN IF NOT EXISTS meal_group TEXT;
  `);
  await pool.query(`
    ALTER TABLE entries
      ADD COLUMN IF NOT EXISTS meal_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE entries
      ADD COLUMN IF NOT EXISTS meal_quantity DOUBLE PRECISION DEFAULT 1;
  `);
  await pool.query(`
    ALTER TABLE entries
      ADD COLUMN IF NOT EXISTS meal_unit TEXT DEFAULT 'serving';
  `);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';`);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS source_detail TEXT;`);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;`);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS correction_key TEXT;`);

  // Soft-delete columns for existing databases
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS components JSONB;`);
  await pool.query(`ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';`);
  await pool.query(`ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS source_detail TEXT;`);
  await pool.query(`ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE macro_targets ADD COLUMN IF NOT EXISTS effective_date DATE;`);
  await pool.query(`UPDATE macro_targets SET effective_date = DATE '1970-01-01' WHERE effective_date IS NULL;`);
  await pool.query(`ALTER TABLE macro_targets ALTER COLUMN effective_date SET NOT NULL;`);
  await pool.query(`
    DO $$ DECLARE pk_name TEXT;
    BEGIN
      SELECT conname INTO pk_name
      FROM pg_constraint
      WHERE conrelid = 'macro_targets'::regclass AND contype = 'p'
      LIMIT 1;

      IF pk_name IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'macro_targets'
          AND c.contype = 'p'
          AND (
            SELECT array_agg(a.attname ORDER BY a.attnum)
            FROM unnest(c.conkey) AS ck(attnum)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
          ) = ARRAY['user_id', 'macro', 'effective_date']::name[]
      ) THEN
        EXECUTE format('ALTER TABLE macro_targets DROP CONSTRAINT %I', pk_name);
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'macro_targets'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE macro_targets
          ADD CONSTRAINT macro_targets_pkey PRIMARY KEY (user_id, macro, effective_date);
      END IF;
    END $$;
  `);
  await pool.query(`ALTER TABLE weight_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE weight_targets ADD COLUMN IF NOT EXISTS effective_date DATE;`);
  await pool.query(`ALTER TABLE weight_targets ALTER COLUMN target_weight DROP NOT NULL;`);
  await pool.query(`ALTER TABLE weight_targets ALTER COLUMN target_date DROP NOT NULL;`);
  await pool.query(`UPDATE weight_targets SET effective_date = DATE '1970-01-01' WHERE effective_date IS NULL;`);
  await pool.query(`ALTER TABLE weight_targets ALTER COLUMN effective_date SET NOT NULL;`);
  await pool.query(`
    DO $$ DECLARE pk_name TEXT;
    BEGIN
      SELECT conname INTO pk_name
      FROM pg_constraint
      WHERE conrelid = 'weight_targets'::regclass AND contype = 'p'
      LIMIT 1;

      IF pk_name IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'weight_targets'
          AND c.contype = 'p'
          AND (
            SELECT array_agg(a.attname ORDER BY a.attnum)
            FROM unnest(c.conkey) AS ck(attnum)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
          ) = ARRAY['user_id', 'effective_date']::name[]
      ) THEN
        EXECUTE format('ALTER TABLE weight_targets DROP CONSTRAINT %I', pk_name);
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'weight_targets'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE weight_targets
          ADD CONSTRAINT weight_targets_pkey PRIMARY KEY (user_id, effective_date);
      END IF;
    END $$;
  `);
  await pool.query(`ALTER TABLE workout_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE analysis_reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE sexual_activity_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_user_consumed ON entries(user_id, consumed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_entries_user_source ON entries(user_id, source);
    CREATE INDEX IF NOT EXISTS idx_entries_user_review ON entries(user_id, needs_review) WHERE deleted_at IS NULL AND needs_review IS TRUE;
    CREATE INDEX IF NOT EXISTS idx_nutrition_day_completeness_user_date
      ON nutrition_day_completeness(user_id, local_date DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_items_user_name ON saved_items(user_id, lower(name));
    CREATE INDEX IF NOT EXISTS idx_macro_targets_user ON macro_targets(user_id);
    CREATE INDEX IF NOT EXISTS idx_macro_targets_user_macro_effective ON macro_targets(user_id, macro, effective_date DESC);
    CREATE INDEX IF NOT EXISTS idx_weight_entries_user_logged ON weight_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_weight_targets_user_effective ON weight_targets(user_id, effective_date DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_entries_user_source_external
      ON weight_entries(user_id, source, external_id)
      WHERE external_id IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_workout_entries_user_logged ON workout_entries(user_id, logged_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_entries_user_source_external
      ON workout_entries(user_id, source, external_id)
      WHERE external_id IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sleep_entries_user_logged ON sleep_entries(user_id, logged_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sleep_entries_user_source_external
      ON sleep_entries(user_id, source, external_id)
      WHERE external_id IS NOT NULL AND deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sexual_activity_entries_user_source_external
      ON sexual_activity_entries(user_id, source, external_id)
      WHERE external_id IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_user_created ON analysis_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_normalized_email ON users(lower(email));
    CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_expires ON rate_limit_counters(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_billing_events_stripe ON billing_events(stripe_event_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_claim
      ON webhook_events(status, next_attempt_at, received_at);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_lease
      ON webhook_events(lease_expires_at)
      WHERE status = 'processing';
    CREATE INDEX IF NOT EXISTS idx_webhook_events_user
      ON webhook_events(user_id, received_at DESC)
      WHERE user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_webhook_events_processed
      ON webhook_events(processed_at)
      WHERE processed_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_webhook_events_purge
      ON webhook_events(purge_after)
      WHERE purge_after IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_usage_counts_user_date ON daily_usage_counts(user_id, usage_date DESC);
    CREATE INDEX IF NOT EXISTS idx_coach_dismissals_user_updated ON coach_dismissals(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_food_corrections_user_updated ON food_corrections(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_diagnostics_user_created ON client_diagnostics(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_diagnostics_level_created ON client_diagnostics(level, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_mutations_completed ON client_mutations(completed_at DESC);
  `);

  await recordSchemaMigration('2026-06-11_feature_foundations');
  await recordSchemaMigration('2026-07-27_client_mutation_idempotency');
  await recordSchemaMigration('2026-07-27_shared_auth_state');
  await recordSchemaMigration('2026-07-27_nutrition_day_completeness');
  await recordSchemaMigration('2026-07-28_data_inventory_and_retention');
  await recordSchemaMigration('2026-07-29_durable_webhook_inbox');
  await applyHealthKitSleepRevisionMigration();

  await pool.query('DELETE FROM web_sessions WHERE expires_at <= NOW()');
  await pool.query('DELETE FROM rate_limit_counters WHERE expires_at <= NOW()');
  await pool.query('DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
}

// ── Users ──

function normalizeUserEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized || null;
}

function normalizeAuthProvider(provider) {
  const normalized = String(provider || 'google').trim().toLowerCase();
  return normalized || 'google';
}

function dateToIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowToPublicUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email || null,
    name: row.name || null,
    picture: row.picture || null,
    provider: row.provider || 'google',
    timezone: row.timezone || 'America/New_York',
    isDisabled: Boolean(row.isDisabled ?? row.is_disabled),
    sexualActivityEnabled: Boolean(row.sexualActivityEnabled ?? row.sexual_activity_enabled),
    optionalDiagnosticsEnabled: (row.optionalDiagnosticsEnabled ?? row.optional_diagnostics_enabled) !== false,
    setupTutorialResetAt: dateToIso(row.setupTutorialResetAt ?? row.setup_tutorial_reset_at),
    lastLoginAt: dateToIso(row.lastLoginAt ?? row.last_login_at),
    loginCount: Number(row.loginCount ?? row.login_count ?? 0),
    createdAt: dateToIso(row.createdAt ?? row.created_at),
    updatedAt: dateToIso(row.updatedAt ?? row.updated_at)
  };
}

async function upsertUser(user) {
  const provider = normalizeAuthProvider(user.provider);
  const providerUserId = String(user.providerUserId || user.provider_user_id || user.id || '').trim();
  const requestedUserId = String(user.id || providerUserId || '').trim();
  if (!requestedUserId) {
    throw new Error('User id is required.');
  }

  const email = normalizeUserEmail(user.email);
  const name = user.name || null;
  const picture = user.picture || null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let canonicalUserId = requestedUserId;
    if (providerUserId) {
      const identityResult = await client.query(
        `SELECT user_id
         FROM user_identities
         WHERE provider = $1 AND provider_user_id = $2`,
        [provider, providerUserId]
      );
      if (identityResult.rows[0]?.user_id) {
        canonicalUserId = identityResult.rows[0].user_id;
      }
    }

    if (canonicalUserId === requestedUserId && email) {
      const existingUserResult = await client.query(
        `SELECT id
         FROM users
         WHERE lower(email) = $1
         ORDER BY created_at ASC
         LIMIT 1`,
        [email]
      );
      if (existingUserResult.rows[0]?.id) {
        canonicalUserId = existingUserResult.rows[0].id;
      }
    }

    const userResult = await client.query(
      `INSERT INTO users (id, email, name, picture, provider, timezone, last_login_at, login_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'America/New_York'), NOW(), 1, NOW())
       ON CONFLICT (id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             name = COALESCE(EXCLUDED.name, users.name),
             picture = COALESCE(EXCLUDED.picture, users.picture),
             timezone = COALESCE(users.timezone, EXCLUDED.timezone),
             provider = CASE
               WHEN EXCLUDED.provider = ANY(string_to_array(users.provider, ',')) THEN users.provider
               ELSE users.provider || ',' || EXCLUDED.provider
             END,
             last_login_at = NOW(),
             login_count = COALESCE(users.login_count, 0) + 1,
             updated_at = NOW()
       RETURNING id, email, name, picture, provider,
                 timezone,
                 is_disabled AS "isDisabled",
                 sexual_activity_enabled AS "sexualActivityEnabled",
                 optional_diagnostics_enabled AS "optionalDiagnosticsEnabled",
                 setup_tutorial_reset_at AS "setupTutorialResetAt",
                 last_login_at AS "lastLoginAt",
                 login_count AS "loginCount",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [canonicalUserId, email, name, picture, provider, user.timezone || null]
    );

    if (providerUserId) {
      await client.query(
        `INSERT INTO user_identities (provider, provider_user_id, user_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (provider, provider_user_id) DO UPDATE
           SET user_id = EXCLUDED.user_id,
               updated_at = NOW()`,
        [provider, providerUserId, canonicalUserId]
      );
    }

    await client.query('COMMIT');

    return rowToPublicUser(userResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getUserAccountControls(userId) {
  const result = await pool.query(
    `SELECT id, email, name, picture, provider, timezone,
            is_disabled AS "isDisabled",
            sexual_activity_enabled AS "sexualActivityEnabled",
            optional_diagnostics_enabled AS "optionalDiagnosticsEnabled",
            setup_tutorial_reset_at AS "setupTutorialResetAt",
            last_login_at AS "lastLoginAt",
            login_count AS "loginCount",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM users
     WHERE id = $1`,
    [userId]
  );
  return rowToPublicUser(result.rows[0]);
}

function rowToAdminAccount(row) {
  const user = rowToPublicUser(row);
  if (!user) {
    return null;
  }
  return {
    ...user,
    plan: row.plan || 'free',
    subscriptionStatus: row.subscriptionStatus || row.subscription_status || 'active',
    itemCount: Number(row.itemCount ?? row.item_count ?? 0),
    savedItemCount: Number(row.savedItemCount ?? row.saved_item_count ?? 0),
    weightEntryCount: Number(row.weightEntryCount ?? row.weight_entry_count ?? 0),
    workoutEntryCount: Number(row.workoutEntryCount ?? row.workout_entry_count ?? 0),
    sleepEntryCount: Number(row.sleepEntryCount ?? row.sleep_entry_count ?? 0),
    sexualActivityEntryCount: Number(row.sexualActivityEntryCount ?? row.sexual_activity_entry_count ?? 0),
    analysisReportCount: Number(row.analysisReportCount ?? row.analysis_report_count ?? 0),
    apiTokenCount: Number(row.apiTokenCount ?? row.api_token_count ?? 0),
    dailyUsageCount7d: Number(row.dailyUsageCount7d ?? row.daily_usage_count_7d ?? 0),
    lastItemAt: dateToIso(row.lastItemAt ?? row.last_item_at),
    lastWorkoutAt: dateToIso(row.lastWorkoutAt ?? row.last_workout_at),
    lastWeightAt: dateToIso(row.lastWeightAt ?? row.last_weight_at),
    lastSleepAt: dateToIso(row.lastSleepAt ?? row.last_sleep_at),
    lastSexualActivityAt: dateToIso(row.lastSexualActivityAt ?? row.last_sexual_activity_at),
    lastApiTokenUsedAt: dateToIso(row.lastApiTokenUsedAt ?? row.last_api_token_used_at),
    lastAuditAt: dateToIso(row.lastAuditAt ?? row.last_audit_at),
    diagnosticCount7d: Number(row.diagnosticCount7d ?? row.diagnostic_count_7d ?? 0),
    lastDiagnosticAt: dateToIso(row.lastDiagnosticAt ?? row.last_diagnostic_at),
    lastClientErrorAt: dateToIso(row.lastClientErrorAt ?? row.last_client_error_at)
  };
}

async function listAdminAccounts({ search = '', limit = 25, offset = 0 } = {}) {
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));

  const result = await pool.query(
    `WITH filtered AS (
       SELECT u.id, u.email, u.name, u.picture, u.provider, u.timezone,
              u.is_disabled AS "isDisabled",
              u.sexual_activity_enabled AS "sexualActivityEnabled",
              u.optional_diagnostics_enabled AS "optionalDiagnosticsEnabled",
              u.setup_tutorial_reset_at AS "setupTutorialResetAt",
              u.last_login_at AS "lastLoginAt",
              u.login_count AS "loginCount",
              u.created_at AS "createdAt",
              u.updated_at AS "updatedAt",
              COALESCE(s.plan, 'free') AS plan,
              COALESCE(s.status, 'active') AS "subscriptionStatus"
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE $1 = ''
          OR lower(COALESCE(u.email, '')) LIKE '%' || $1 || '%'
          OR lower(COALESCE(u.name, '')) LIKE '%' || $1 || '%'
          OR lower(u.id) LIKE '%' || $1 || '%'
     ),
     paged AS (
       SELECT *, COUNT(*) OVER() AS "totalCount"
       FROM filtered
       ORDER BY "lastLoginAt" DESC NULLS LAST, "createdAt" DESC, id ASC
       LIMIT $2 OFFSET $3
     ),
     entry_stats AS (
       SELECT user_id, COUNT(*)::int AS "itemCount", MAX(consumed_at) AS "lastItemAt"
       FROM entries
       WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     saved_item_stats AS (
       SELECT user_id, COUNT(*)::int AS "savedItemCount"
       FROM saved_items
       WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     weight_stats AS (
       SELECT user_id, COUNT(*)::int AS "weightEntryCount", MAX(logged_at) AS "lastWeightAt"
       FROM weight_entries
       WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     workout_stats AS (
       SELECT user_id, COUNT(*)::int AS "workoutEntryCount", MAX(logged_at) AS "lastWorkoutAt"
       FROM workout_entries
       WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     sleep_stats AS (
       SELECT user_id, COUNT(*)::int AS "sleepEntryCount", MAX(logged_at) AS "lastSleepAt"
       FROM sleep_entries
       WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     sexual_activity_stats AS (
       SELECT user_id, COUNT(*)::int AS "sexualActivityEntryCount", MAX(logged_at) AS "lastSexualActivityAt"
       FROM sexual_activity_entries
       WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     analysis_stats AS (
       SELECT user_id, COUNT(*)::int AS "analysisReportCount"
       FROM analysis_reports
       WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     token_stats AS (
       SELECT user_id, COUNT(*)::int AS "apiTokenCount", MAX(last_used_at) AS "lastApiTokenUsedAt"
       FROM api_tokens
       WHERE user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     usage_stats AS (
       SELECT user_id, COALESCE(SUM(count), 0)::int AS "dailyUsageCount7d"
       FROM daily_usage_counts
       WHERE usage_date >= CURRENT_DATE - INTERVAL '7 days'
         AND user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     audit_stats AS (
       SELECT user_id, MAX(created_at) AS "lastAuditAt"
       FROM audit_log
       WHERE user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     ),
     client_diag_stats AS (
       SELECT user_id,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS "diagnosticCount7d",
              MAX(created_at) AS "lastDiagnosticAt",
              MAX(created_at) FILTER (WHERE level IN ('error', 'fatal')) AS "lastClientErrorAt"
       FROM client_diagnostics
       WHERE user_id IN (SELECT id FROM paged)
       GROUP BY user_id
     )
     SELECT p.*,
            COALESCE(es."itemCount", 0) AS "itemCount",
            es."lastItemAt",
            COALESCE(sis."savedItemCount", 0) AS "savedItemCount",
            COALESCE(ws."weightEntryCount", 0) AS "weightEntryCount",
            ws."lastWeightAt",
            COALESCE(wos."workoutEntryCount", 0) AS "workoutEntryCount",
            wos."lastWorkoutAt",
            COALESCE(ss."sleepEntryCount", 0) AS "sleepEntryCount",
            ss."lastSleepAt",
            COALESCE(sas."sexualActivityEntryCount", 0) AS "sexualActivityEntryCount",
            sas."lastSexualActivityAt",
            COALESCE(ars."analysisReportCount", 0) AS "analysisReportCount",
            COALESCE(ts."apiTokenCount", 0) AS "apiTokenCount",
            ts."lastApiTokenUsedAt",
            COALESCE(us."dailyUsageCount7d", 0) AS "dailyUsageCount7d",
            aus."lastAuditAt",
            COALESCE(cds."diagnosticCount7d", 0) AS "diagnosticCount7d",
            cds."lastDiagnosticAt",
            cds."lastClientErrorAt"
     FROM paged p
     LEFT JOIN entry_stats es ON es.user_id = p.id
     LEFT JOIN saved_item_stats sis ON sis.user_id = p.id
     LEFT JOIN weight_stats ws ON ws.user_id = p.id
     LEFT JOIN workout_stats wos ON wos.user_id = p.id
     LEFT JOIN sleep_stats ss ON ss.user_id = p.id
     LEFT JOIN sexual_activity_stats sas ON sas.user_id = p.id
     LEFT JOIN analysis_stats ars ON ars.user_id = p.id
     LEFT JOIN token_stats ts ON ts.user_id = p.id
     LEFT JOIN usage_stats us ON us.user_id = p.id
     LEFT JOIN audit_stats aus ON aus.user_id = p.id
     LEFT JOIN client_diag_stats cds ON cds.user_id = p.id
     ORDER BY p."lastLoginAt" DESC NULLS LAST, p."createdAt" DESC, p.id ASC`,
    [normalizedSearch, normalizedLimit, normalizedOffset]
  );

  const accounts = result.rows.map(rowToAdminAccount).filter(Boolean);
  const total = Number(result.rows[0]?.totalCount || 0);
  return {
    accounts,
    pagination: {
      limit: normalizedLimit,
      offset: normalizedOffset,
      returned: accounts.length,
      total,
      hasMore: normalizedOffset + accounts.length < total
    }
  };
}

async function updateAdminAccountControls(userId, controls = {}) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    throw new Error('User id is required.');
  }

  const updates = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(controls, 'isDisabled')) {
    values.push(Boolean(controls.isDisabled));
    updates.push(`is_disabled = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(controls, 'sexualActivityEnabled')) {
    values.push(Boolean(controls.sexualActivityEnabled));
    updates.push(`sexual_activity_enabled = $${values.length}`);
  }
  if (controls.resetSetupTutorial === true) {
    updates.push('setup_tutorial_reset_at = NOW()');
  }

  if (!updates.length) {
    return getUserAccountControls(normalizedUserId);
  }

  values.push(normalizedUserId);
  const result = await pool.query(
    `UPDATE users
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING id`,
    values
  );
  if (!result.rowCount) {
    throw new Error('Account not found.');
  }

  return getUserAccountControls(normalizedUserId);
}

async function updateUserPreferences(userId, preferences = {}) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    throw new Error('User id is required.');
  }

  const updates = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(preferences, 'timezone')) {
    const timezone = String(preferences.timezone || '').trim();
    if (!timezone || timezone.length > 64) {
      throw new Error('timezone must be 64 characters or less.');
    }
    values.push(timezone);
    updates.push(`timezone = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(preferences, 'optionalDiagnosticsEnabled')) {
    values.push(Boolean(preferences.optionalDiagnosticsEnabled));
    updates.push(`optional_diagnostics_enabled = $${values.length}`);
  }

  if (!updates.length) {
    return getUserAccountControls(normalizedUserId);
  }

  values.push(normalizedUserId);
  const result = await pool.query(
    `UPDATE users
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING id`,
    values
  );
  if (!result.rowCount) {
    throw new Error('Account not found.');
  }

  return getUserAccountControls(normalizedUserId);
}

async function getProviderUserId(userId, provider) {
  const normalizedProvider = normalizeAuthProvider(provider);
  const result = await pool.query(
    `SELECT provider_user_id
     FROM user_identities
     WHERE user_id = $1 AND provider = $2`,
    [userId, normalizedProvider]
  );

  return result.rows[0]?.provider_user_id || null;
}

// ── Audit logging ──

async function logAudit(userId, action, entityType, entityId, details) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [userId, action, entityType, entityId || null, details ? JSON.stringify(details) : null]
    );
  } catch (_error) {
    // Audit logging should never break the main operation
  }
}

async function logClientDiagnostic(userId, diagnostic = {}) {
  const sanitized = sanitizeClientDiagnostic(diagnostic);
  const details = sanitized.details ? JSON.stringify(sanitized.details) : null;

  const result = await pool.query(
    `INSERT INTO client_diagnostics (
       user_id, level, category, message, details, user_agent, app_platform, app_version, request_id
     )
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
     RETURNING id, created_at AS "createdAt"`,
    [
      userId,
      sanitized.level,
      sanitized.category,
      sanitized.message,
      details,
      null,
      sanitized.appPlatform,
      sanitized.appVersion,
      sanitized.requestId
    ]
  );

  return {
    id: Number(result.rows[0].id),
    createdAt: dateToIso(result.rows[0].createdAt)
  };
}

async function listClientDiagnostics(userId, { limit = 25 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  const result = await pool.query(
    `SELECT id, level, category, message, details, user_agent AS "userAgent",
            app_platform AS "appPlatform", app_version AS "appVersion",
            request_id AS "requestId", created_at AS "createdAt"
     FROM client_diagnostics
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [userId, normalizedLimit]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    level: row.level,
    category: row.category,
    message: row.message,
    details: row.details || null,
    userAgent: row.userAgent || null,
    appPlatform: row.appPlatform || null,
    appVersion: row.appVersion || null,
    requestId: row.requestId || null,
    createdAt: dateToIso(row.createdAt)
  }));
}

// ── Replay-safe client mutations ──

function mapClientMutation(row) {
  if (!row) return null;
  return {
    userId: row.userId ?? row.user_id,
    clientMutationId: row.clientMutationId ?? row.client_mutation_id,
    method: row.requestMethod ?? row.request_method,
    path: row.requestPath ?? row.request_path,
    requestHash: row.requestHash ?? row.request_hash,
    state: row.state,
    responseStatus:
      row.responseStatus == null && row.response_status == null
        ? null
        : Number(row.responseStatus ?? row.response_status),
    responseBody: row.responseBody ?? row.response_body ?? null,
    createdAt: dateToIso(row.createdAt ?? row.created_at),
    completedAt: dateToIso(row.completedAt ?? row.completed_at)
  };
}

async function getClientMutation(userId, clientMutationId) {
  const result = await pool.query(
    `SELECT user_id AS "userId",
            client_mutation_id AS "clientMutationId",
            request_method AS "requestMethod",
            request_path AS "requestPath",
            request_hash AS "requestHash",
            state,
            response_status AS "responseStatus",
            response_body AS "responseBody",
            created_at AS "createdAt",
            completed_at AS "completedAt"
     FROM client_mutations
     WHERE user_id = $1 AND client_mutation_id = $2`,
    [userId, clientMutationId]
  );
  return mapClientMutation(result.rows[0]);
}

async function claimClientMutation(userId, clientMutationId, descriptor) {
  const result = await pool.query(
    `INSERT INTO client_mutations (
       user_id, client_mutation_id, request_method, request_path, request_hash
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, client_mutation_id) DO NOTHING
     RETURNING client_mutation_id`,
    [
      userId,
      clientMutationId,
      descriptor.method,
      descriptor.path,
      descriptor.requestHash
    ]
  );

  if (result.rows.length) {
    return { disposition: 'acquired' };
  }

  const mutation = await getClientMutation(userId, clientMutationId);
  if (
    !mutation ||
    mutation.method !== descriptor.method ||
    mutation.path !== descriptor.path ||
    mutation.requestHash !== descriptor.requestHash
  ) {
    return { disposition: 'conflict', mutation };
  }

  if (mutation.state === 'completed') {
    return { disposition: 'replay', mutation };
  }

  return { disposition: 'processing', mutation };
}

async function completeClientMutation(userId, clientMutationId, result) {
  const updated = await pool.query(
    `UPDATE client_mutations
     SET state = 'completed',
         response_status = $3,
         response_body = $4::jsonb,
         completed_at = NOW()
     WHERE user_id = $1
       AND client_mutation_id = $2
       AND state = 'processing'
     RETURNING user_id AS "userId",
               client_mutation_id AS "clientMutationId",
               request_method AS "requestMethod",
               request_path AS "requestPath",
               request_hash AS "requestHash",
               state,
               response_status AS "responseStatus",
               response_body AS "responseBody",
               created_at AS "createdAt",
               completed_at AS "completedAt"`,
    [
      userId,
      clientMutationId,
      Number(result.responseStatus) || 200,
      JSON.stringify(result.responseBody ?? null)
    ]
  );

  return mapClientMutation(updated.rows[0]) || getClientMutation(userId, clientMutationId);
}

// ── Macros / entries ──

function normalizeMacroName(macro) {
  const value = String(macro || '').toLowerCase();
  if (!['calories', 'protein', 'carbs', 'fat', 'workouts', 'workout_calories', 'sleep_hours'].includes(value)) {
    throw new Error('Invalid macro. Use calories, protein, carbs, fat, workouts, workout_calories, or sleep_hours.');
  }
  return value;
}

const DEFAULT_MACRO_TARGETS = Object.freeze({
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  workouts: 5,
  workout_calories: 0,
  sleep_hours: 8
});

function defaultMacroTargets() {
  return { ...DEFAULT_MACRO_TARGETS };
}

function todayIsoDateInTimezone(timezone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeIsoDateString(value, label = 'Date') {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${label} must be in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${label} must be a valid date.`);
  }
  return raw;
}

function normalizeTargetEffectiveDate(value, timezone = 'America/New_York') {
  const raw = String(value || '').trim();
  if (!raw) {
    return todayIsoDateInTimezone(timezone);
  }
  return normalizeIsoDateString(raw, 'Effective date');
}

function normalizeCompletenessDays(days) {
  return [...new Set(
    (Array.isArray(days) ? days : [days])
      .filter((day) => day != null && day !== '')
      .map((day) => normalizeIsoDateString(day, 'Day'))
  )].sort();
}

function isoDaysInRange(startDay, endDay, maxDays = 366) {
  const start = normalizeIsoDateString(startDay, 'Start day');
  const end = normalizeIsoDateString(endDay, 'End day');
  if (end < start) {
    throw new Error('End day must be on or after start day.');
  }

  const days = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endTime = new Date(`${end}T00:00:00Z`).getTime();
  while (cursor.getTime() <= endTime) {
    days.push(cursor.toISOString().slice(0, 10));
    if (days.length > maxDays) {
      throw new Error(`Day completeness range cannot exceed ${maxDays} days.`);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function getNutritionDayCompletenessForDays(
  userId,
  days,
  timezone = 'America/New_York'
) {
  const normalizedDays = normalizeCompletenessDays(days);
  if (!normalizedDays.length) {
    return [];
  }

  const result = await pool.query(
    `WITH requested_days AS (
       SELECT unnest($2::date[]) AS day
     ),
     entry_stats AS (
       SELECT
         (consumed_at AT TIME ZONE $3)::date AS day,
         COUNT(*)::integer AS entry_count,
         COUNT(DISTINCT CASE
           WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) >= 5
             AND EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) < 11 THEN 'breakfast'
           WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) >= 11
             AND EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) < 16 THEN 'midday'
           WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) >= 16
             AND EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) < 22 THEN 'evening'
           ELSE 'overnight'
         END)::integer AS daypart_count,
         EXTRACT(EPOCH FROM (
           MAX(consumed_at AT TIME ZONE $3) - MIN(consumed_at AT TIME ZONE $3)
         )) / 3600.0 AS span_hours
       FROM entries
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND (consumed_at AT TIME ZONE $3)::date = ANY($2::date[])
       GROUP BY day
     )
     SELECT
       requested_days.day::text AS day,
       completeness.state,
       COALESCE(completeness.timezone, $3) AS timezone,
       completeness.updated_at AS "updatedAt",
       COALESCE(entry_stats.entry_count, 0)::integer AS "entryCount",
       COALESCE(entry_stats.daypart_count, 0)::integer AS "daypartCount",
       COALESCE(entry_stats.span_hours, 0)::double precision AS "spanHours"
     FROM requested_days
     LEFT JOIN nutrition_day_completeness completeness
       ON completeness.user_id = $1
      AND completeness.local_date = requested_days.day
     LEFT JOIN entry_stats
       ON entry_stats.day = requested_days.day
     ORDER BY requested_days.day ASC`,
    [userId, normalizedDays, timezone]
  );

  const today = todayIsoDateInTimezone(timezone);
  return result.rows.map((row) => buildDayCompleteness({
    day: row.day,
    state: row.state || DAY_COMPLETENESS_STATES.UNKNOWN,
    timezone: row.timezone || timezone,
    updatedAt: row.updatedAt,
    entryCount: Number(row.entryCount || 0),
    daypartCount: Number(row.daypartCount || 0),
    spanHours: Number(row.spanHours || 0),
    today
  }));
}

async function getNutritionDayCompleteness(
  userId,
  day,
  timezone = 'America/New_York'
) {
  const [record] = await getNutritionDayCompletenessForDays(userId, [day], timezone);
  return record;
}

async function listNutritionDayCompleteness(
  userId,
  { startDay, endDay, timezone = 'America/New_York' } = {}
) {
  const normalizedEnd = endDay || todayIsoDateInTimezone(timezone);
  const normalizedStart = startDay || normalizedEnd;
  return getNutritionDayCompletenessForDays(
    userId,
    isoDaysInRange(normalizedStart, normalizedEnd),
    timezone
  );
}

async function setNutritionDayCompleteness(
  userId,
  day,
  state,
  timezone = 'America/New_York'
) {
  const normalizedDay = normalizeIsoDateString(day, 'Day');
  const normalizedState = normalizeDayCompletenessState(state);

  if (normalizedState === DAY_COMPLETENESS_STATES.UNKNOWN) {
    await pool.query(
      `DELETE FROM nutrition_day_completeness
       WHERE user_id = $1 AND local_date = $2::date`,
      [userId, normalizedDay]
    );
  } else {
    await pool.query(
      `INSERT INTO nutrition_day_completeness (
         user_id,
         local_date,
         state,
         timezone,
         updated_at
       )
       VALUES ($1, $2::date, $3, $4, NOW())
       ON CONFLICT (user_id, local_date)
       DO UPDATE SET
         state = EXCLUDED.state,
         timezone = EXCLUDED.timezone,
         updated_at = NOW()`,
      [userId, normalizedDay, normalizedState, timezone]
    );
  }

  return getNutritionDayCompleteness(userId, normalizedDay, timezone);
}

async function attachNutritionDayCompleteness(
  userId,
  rows,
  timezone = 'America/New_York'
) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const records = await getNutritionDayCompletenessForDays(
    userId,
    normalizedRows.map((row) => row.day),
    timezone
  );
  const recordsByDay = new Map(records.map((record) => [record.day, record]));
  return normalizedRows.map((row) => ({
    ...row,
    completeness: recordsByDay.get(row.day) || buildDayCompleteness({
      day: row.day,
      state: DAY_COMPLETENESS_STATES.UNKNOWN,
      timezone,
      today: todayIsoDateInTimezone(timezone)
    })
  }));
}

const ENTRY_SOURCES = new Set([
  'manual',
  'ai_text',
  'ai_photo',
  'barcode',
  'quick_add',
  'copy_day',
  'starter_template',
  'manual_correction',
  'food_correction'
]);

function normalizeEntrySource(source) {
  const normalized = String(source || '').trim().toLowerCase();
  return ENTRY_SOURCES.has(normalized) ? normalized : 'manual';
}

function normalizeSourceDetail(value) {
  const detail = String(value || '').trim();
  return detail ? detail.slice(0, 255) : null;
}

function normalizeEntryConfidence(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Number(number.toFixed(3))));
}

function nutritionCorrectionKey(itemName) {
  return String(itemName || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

function rowNeedsReview(row) {
  if (row.needsReview != null || row.needs_review != null) {
    return Boolean(row.needsReview ?? row.needs_review);
  }
  const source = normalizeEntrySource(row.source);
  return source === 'ai_text' || source === 'ai_photo' || source === 'barcode';
}

function normalizeEntryForInsert(row) {
  const source = normalizeEntrySource(row.source);
  return {
    itemName: row.itemName,
    quantity: Number(row.quantity || 0),
    unit: row.unit || null,
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    consumedAt: row.consumedAt,
    mealGroup: row.mealGroup || null,
    mealName: row.mealName || null,
    mealQuantity: row.mealQuantity != null ? Number(row.mealQuantity) : 1,
    mealUnit: row.mealUnit || 'serving',
    source,
    sourceDetail: normalizeSourceDetail(row.sourceDetail ?? row.source_detail),
    confidence: normalizeEntryConfidence(row.confidence, source === 'manual' || source === 'quick_add' ? 1 : null),
    needsReview: rowNeedsReview({ ...row, source }),
    correctionKey: nutritionCorrectionKey(row.itemName)
  };
}

async function upsertFoodCorrection(userId, item) {
  const correctionKey = nutritionCorrectionKey(item?.itemName || item?.name);
  if (!correctionKey) {
    return null;
  }
  const itemName = String(item.itemName || item.name || '').trim();
  if (!itemName) {
    return null;
  }

  await pool.query(
    `INSERT INTO food_corrections (
       user_id, correction_key, item_name, quantity, unit, calories, protein, carbs, fat, source, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual_correction',NOW())
     ON CONFLICT (user_id, correction_key)
     DO UPDATE SET
       item_name = EXCLUDED.item_name,
       quantity = EXCLUDED.quantity,
       unit = EXCLUDED.unit,
       calories = EXCLUDED.calories,
       protein = EXCLUDED.protein,
       carbs = EXCLUDED.carbs,
       fat = EXCLUDED.fat,
       source = EXCLUDED.source,
       updated_at = NOW()`,
    [
      userId,
      correctionKey,
      itemName,
      Number(item.quantity || 0),
      item.unit || null,
      Number(item.calories || 0),
      Number(item.protein || 0),
      Number(item.carbs || 0),
      Number(item.fat || 0)
    ]
  );

  return correctionKey;
}

async function applyFoodCorrections(userId, items) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }
  const keys = Array.from(new Set(
    items
      .filter(canApplyFoodCorrection)
      .map((item) => nutritionCorrectionKey(item.itemName || item.name))
      .filter(Boolean)
  ));
  if (!keys.length) {
    return items;
  }
  const result = await pool.query(
    `SELECT correction_key, item_name, quantity, unit, calories, protein, carbs, fat
     FROM food_corrections
     WHERE user_id = $1 AND correction_key = ANY($2::text[])`,
    [userId, keys]
  );
  const corrections = new Map(result.rows.map((row) => [row.correction_key, row]));

  return items.map((item) => {
    const key = nutritionCorrectionKey(item.itemName || item.name);
    const correction = corrections.get(key);
    return applyFoodCorrectionToItem(item, correction, key);
  });
}

async function addEntries(userId, entries) {
  if (!entries.length) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const query = `
      INSERT INTO entries (
        user_id,
        item_name,
        quantity,
        unit,
        calories,
        protein,
        carbs,
        fat,
        consumed_at,
        meal_group,
        meal_name,
        meal_quantity,
        meal_unit,
        source,
        source_detail,
        confidence,
        needs_review,
        correction_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    `;

    for (const row of entries) {
      const entry = normalizeEntryForInsert(row);
      await client.query(query, [
        userId,
        entry.itemName,
        entry.quantity,
        entry.unit,
        entry.calories,
        entry.protein,
        entry.carbs,
        entry.fat,
        new Date(entry.consumedAt),
        entry.mealGroup,
        entry.mealName,
        entry.mealQuantity,
        entry.mealUnit,
        entry.source,
        entry.sourceDetail,
        entry.confidence,
        entry.needsReview,
        entry.correctionKey
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function copyEntriesForLocalDay(userId, sourceDay, targetDay, timezone = 'America/New_York') {
  const normalizedSourceDay = normalizeIsoDateString(sourceDay, 'sourceDay');
  const normalizedTargetDay = normalizeIsoDateString(targetDay, 'targetDay');
  const result = await pool.query(
    `SELECT id,
            item_name AS "itemName",
            quantity,
            unit,
            calories,
            protein,
            carbs,
            fat,
            consumed_at AS "consumedAt",
            (consumed_at AT TIME ZONE $3)::time AS "localTime",
            meal_group AS "mealGroup",
            meal_name AS "mealName",
            meal_quantity AS "mealQuantity",
            meal_unit AS "mealUnit"
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND (consumed_at AT TIME ZONE $3)::date = $2::date
     ORDER BY consumed_at ASC, id ASC`,
    [userId, normalizedSourceDay, timezone]
  );

  if (!result.rows.length) {
    return { copiedCount: 0 };
  }

  const groupMap = new Map();
  const rows = result.rows.map((row) => {
    const oldGroup = row.mealGroup || null;
    if (oldGroup && !groupMap.has(oldGroup)) {
      groupMap.set(oldGroup, crypto.randomUUID());
    }
    return {
      itemName: row.itemName,
      quantity: Number(row.quantity || 0),
      unit: row.unit || 'serving',
      calories: Number(row.calories || 0),
      protein: Number(row.protein || 0),
      carbs: Number(row.carbs || 0),
      fat: Number(row.fat || 0),
      consumedAt: null,
      mealGroup: oldGroup ? groupMap.get(oldGroup) : null,
      mealName: row.mealName || null,
      mealQuantity: Number(row.mealQuantity || 1),
      mealUnit: row.mealUnit || 'serving',
      source: 'copy_day',
      sourceDetail: `copied_from:${normalizedSourceDay}`,
      confidence: 1,
      needsReview: false
    };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const localTime = String(result.rows[i].localTime || '12:00:00');
      const consumedAtResult = await client.query(
        `SELECT (($1::date + $2::time) AT TIME ZONE $3) AS "consumedAt"`,
        [normalizedTargetDay, localTime, timezone]
      );
      row.consumedAt = consumedAtResult.rows[0].consumedAt;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await addEntries(userId, rows);
  return { copiedCount: rows.length };
}

async function copyEntriesToLocalDay(userId, { entryId = null, mealGroup = null, targetDay = null, timezone = 'America/New_York' } = {}) {
  const normalizedTargetDay = normalizeIsoDateString(targetDay || todayIsoDateInTimezone(timezone), 'targetDay');
  const copyingMeal = Boolean(mealGroup);
  const params = copyingMeal
    ? [userId, mealGroup, timezone]
    : [userId, Number(entryId || 0), timezone];
  const whereClause = copyingMeal
    ? 'user_id = $1 AND meal_group = $2 AND deleted_at IS NULL'
    : 'user_id = $1 AND id = $2 AND deleted_at IS NULL';

  if (!copyingMeal && (!Number.isInteger(Number(entryId)) || Number(entryId) <= 0)) {
    throw new Error('entryId is required.');
  }
  if (copyingMeal && !String(mealGroup || '').trim()) {
    throw new Error('mealGroup is required.');
  }

  const result = await pool.query(
    `SELECT id,
            item_name AS "itemName",
            quantity,
            unit,
            calories,
            protein,
            carbs,
            fat,
            consumed_at AS "consumedAt",
            to_char((consumed_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS "localDay",
            to_char((consumed_at AT TIME ZONE $3)::time, 'HH24:MI:SS.US') AS "localTime",
            meal_group AS "mealGroup",
            meal_name AS "mealName",
            meal_quantity AS "mealQuantity",
            meal_unit AS "mealUnit"
     FROM entries
     WHERE ${whereClause}
     ORDER BY consumed_at ASC, id ASC`,
    params
  );

  if (!result.rows.length) {
    return { copiedCount: 0 };
  }

  if (result.rows.some((row) => String(row.localDay || '') >= normalizedTargetDay)) {
    throw new Error('Only entries from previous days can be copied to today.');
  }

  const copiedMealGroup = copyingMeal ? crypto.randomUUID() : null;
  const rows = result.rows.map((row) => ({
    itemName: row.itemName,
    quantity: Number(row.quantity || 0),
    unit: row.unit || 'serving',
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    consumedAt: null,
    mealGroup: copyingMeal ? copiedMealGroup : null,
    mealName: copyingMeal ? (row.mealName || null) : null,
    mealQuantity: copyingMeal ? Number(row.mealQuantity || 1) : 1,
    mealUnit: copyingMeal ? (row.mealUnit || 'serving') : 'serving',
    source: 'copy_day',
    sourceDetail: copyingMeal ? `copied_from_meal:${mealGroup}` : `copied_from_entry:${row.id}`,
    confidence: 1,
    needsReview: false
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += 1) {
      const localTime = String(result.rows[i].localTime || '12:00:00');
      const consumedAtResult = await client.query(
        `SELECT (($1::date + $2::time) AT TIME ZONE $3) AS "consumedAt"`,
        [normalizedTargetDay, localTime, timezone]
      );
      rows[i].consumedAt = consumedAtResult.rows[0].consumedAt;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await addEntries(userId, rows);
  return { copiedCount: rows.length };
}

async function updateEntry(userId, id, entry) {
  const correctionKey = nutritionCorrectionKey(entry.itemName);
  const result = await pool.query(
    `UPDATE entries
     SET
       item_name = $1,
       quantity = $2,
       unit = $3,
       calories = $4,
       protein = $5,
       carbs = $6,
       fat = $7,
       consumed_at = $8,
       source = 'manual_correction',
       source_detail = 'Corrected by user',
       confidence = 1,
       needs_review = FALSE,
       correction_key = $11
     WHERE id = $9 AND user_id = $10 AND deleted_at IS NULL`,
    [
      entry.itemName,
      Number(entry.quantity || 0),
      entry.unit || null,
      Number(entry.calories || 0),
      Number(entry.protein || 0),
      Number(entry.carbs || 0),
      Number(entry.fat || 0),
      new Date(entry.consumedAt),
      id,
      userId,
      correctionKey
    ]
  );

  if (result.rowCount) {
    await upsertFoodCorrection(userId, entry);
  }

  return result.rowCount || 0;
}

async function deleteEntry(userId, id) {
  const result = await pool.query(
    'UPDATE entries SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  return result.rowCount || 0;
}

async function scaleMealGroup(userId, mealGroup, newQuantity, newUnit, newName) {
  const existing = await pool.query(
    'SELECT id, quantity, calories, protein, carbs, fat, meal_quantity FROM entries WHERE user_id = $1 AND meal_group = $2 AND deleted_at IS NULL',
    [userId, mealGroup]
  );
  if (!existing.rows.length) return 0;

  const oldMealQty = Number(existing.rows[0].meal_quantity || 1);
  const scale = Number(newQuantity) / oldMealQty;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of existing.rows) {
      await client.query(
        `UPDATE entries
         SET quantity = ROUND(($1 * quantity)::numeric, 2),
             calories = ROUND(($1 * calories)::numeric, 2),
             protein = ROUND(($1 * protein)::numeric, 2),
             carbs = ROUND(($1 * carbs)::numeric, 2),
             fat = ROUND(($1 * fat)::numeric, 2),
             meal_quantity = $2,
             meal_unit = $3
             ${newName ? ', meal_name = $6' : ''}
         WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL`,
        newName
          ? [scale, Number(newQuantity), newUnit, row.id, userId, newName]
          : [scale, Number(newQuantity), newUnit, row.id, userId]
      );
    }
    await client.query('COMMIT');
    return existing.rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function combineEntries(userId, entryIds, mealName, quantity, unit) {
  if (!entryIds || entryIds.length < 2) throw new Error('At least two entries are required.');
  const placeholders = entryIds.map((_, i) => `$${i + 2}`).join(', ');
  const existing = await pool.query(
    `SELECT id, meal_group FROM entries WHERE user_id = $1 AND id IN (${placeholders}) AND deleted_at IS NULL`,
    [userId, ...entryIds]
  );
  if (existing.rows.length !== entryIds.length) throw new Error('One or more entries not found.');
  if (existing.rows.some((r) => r.meal_group)) throw new Error('Cannot combine entries that are already part of a meal.');

  const mealGroup = require('crypto').randomUUID();
  const mealQty = Number(quantity) || 1;
  const mealUnit = unit || 'serving';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const id of entryIds) {
      await client.query(
        `UPDATE entries SET meal_group = $1, meal_name = $2, meal_quantity = $3, meal_unit = $4
         WHERE id = $5 AND user_id = $6 AND deleted_at IS NULL`,
        [mealGroup, mealName || 'Meal', mealQty, mealUnit, id, userId]
      );
    }
    await client.query('COMMIT');
    return mealGroup;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function splitMealGroup(userId, mealGroup) {
  const result = await pool.query(
    `UPDATE entries SET meal_group = NULL, meal_name = NULL, meal_quantity = NULL, meal_unit = NULL
     WHERE user_id = $1 AND meal_group = $2 AND deleted_at IS NULL`,
    [userId, mealGroup]
  );
  return result.rowCount || 0;
}

async function removeFromMealGroup(userId, entryId) {
  const entry = await pool.query(
    'SELECT id, meal_group FROM entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [entryId, userId]
  );
  if (!entry.rows.length) throw new Error('Entry not found.');
  if (!entry.rows[0].meal_group) return; // already ungrouped (e.g. auto-dissolved)

  const mealGroup = entry.rows[0].meal_group;

  await pool.query(
    `UPDATE entries SET meal_group = NULL, meal_name = NULL, meal_quantity = NULL, meal_unit = NULL
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [entryId, userId]
  );

  // If only one entry remains in the group, ungroup it too
  const remaining = await pool.query(
    'SELECT id FROM entries WHERE user_id = $1 AND meal_group = $2 AND deleted_at IS NULL',
    [userId, mealGroup]
  );
  if (remaining.rows.length === 1) {
    await pool.query(
      `UPDATE entries SET meal_group = NULL, meal_name = NULL, meal_quantity = NULL, meal_unit = NULL
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [remaining.rows[0].id, userId]
    );
  }

  return 1;
}

function normalizeSavedItemComponents(components) {
  if (!Array.isArray(components) || !components.length) {
    return [];
  }

  return components
    .map((component) => ({
      itemName: String(component.itemName || component.name || '').trim(),
      quantity: Number(component.quantity || 0),
      unit: component.unit || 'serving',
      calories: Number(component.calories || 0),
      protein: Number(component.protein || 0),
      carbs: Number(component.carbs || 0),
      fat: Number(component.fat || 0)
    }))
    .filter((component) => component.itemName && component.quantity > 0);
}

function savedItemComponentsJson(item) {
  const components = normalizeSavedItemComponents(item.components);
  return components.length ? JSON.stringify(components) : null;
}

async function addSavedItem(userId, item) {
  const source = normalizeEntrySource(item.source);
  const result = await pool.query(
    `INSERT INTO saved_items (user_id, name, quantity, unit, calories, protein, carbs, fat, components, source, source_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
     RETURNING id`,
    [
      userId,
      item.name,
      Number(item.quantity || 1),
      item.unit || null,
      Number(item.calories || 0),
      Number(item.protein || 0),
      Number(item.carbs || 0),
      Number(item.fat || 0),
      savedItemComponentsJson(item),
      source,
      normalizeSourceDetail(item.sourceDetail ?? item.source_detail)
    ]
  );

  return Number(result.rows[0].id);
}

async function updateSavedItem(userId, id, item) {
  const values = [
    item.name,
    Number(item.quantity || 1),
    item.unit || null,
    Number(item.calories || 0),
    Number(item.protein || 0),
    Number(item.carbs || 0),
    Number(item.fat || 0)
  ];
  const updates = [
    'name = $1',
    'quantity = $2',
    'unit = $3',
    'calories = $4',
    'protein = $5',
    'carbs = $6',
    'fat = $7',
    `source = COALESCE($8, source)`,
    `source_detail = COALESCE($9, source_detail)`
  ];
  values.push(item.source ? normalizeEntrySource(item.source) : null);
  values.push(item.sourceDetail || item.source_detail ? normalizeSourceDetail(item.sourceDetail ?? item.source_detail) : null);

  if (Object.prototype.hasOwnProperty.call(item, 'components')) {
    values.push(savedItemComponentsJson(item));
    updates.push(`components = $${values.length}::jsonb`);
  }

  values.push(id, userId);
  const result = await pool.query(
    `UPDATE saved_items
     SET ${updates.join(', ')}
     WHERE id = $${values.length - 1} AND user_id = $${values.length} AND deleted_at IS NULL`,
    values
  );

  return result.rowCount || 0;
}

async function deleteSavedItem(userId, id) {
  const result = await pool.query(
    'UPDATE saved_items SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  return result.rowCount || 0;
}

async function listSavedItems(userId) {
  const result = await pool.query(
    `SELECT id, name, quantity, unit, calories, protein, carbs, fat, components,
            source, source_detail AS "sourceDetail", usage_count AS "usageCount"
     FROM saved_items
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY lower(name) ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    quantity: Number(row.quantity || 0),
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    components: normalizeSavedItemComponents(row.components),
    source: row.source || 'manual',
    sourceDetail: row.sourceDetail || null,
    usageCount: Number(row.usageCount || 0)
  }));
}

const STARTER_QUICK_ADDS = Object.freeze([
  { name: 'Greek yogurt', quantity: 1, unit: 'serving', calories: 130, protein: 18, carbs: 8, fat: 0, sourceDetail: 'starter_template' },
  { name: 'Chicken breast', quantity: 4, unit: 'oz', calories: 185, protein: 35, carbs: 0, fat: 4, sourceDetail: 'starter_template' },
  { name: 'White rice', quantity: 1, unit: 'cup', calories: 205, protein: 4, carbs: 45, fat: 0.4, sourceDetail: 'starter_template' },
  { name: 'Eggs', quantity: 2, unit: 'eggs', calories: 140, protein: 12, carbs: 1, fat: 10, sourceDetail: 'starter_template' },
  { name: 'Protein shake', quantity: 1, unit: 'shake', calories: 160, protein: 30, carbs: 5, fat: 2, sourceDetail: 'starter_template' }
]);

async function addStarterQuickAdds(userId) {
  const existing = await listSavedItems(userId);
  const existingNames = new Set(existing.map((item) => String(item.name || '').trim().toLowerCase()));
  const addedIds = [];
  for (const item of STARTER_QUICK_ADDS) {
    if (existingNames.has(item.name.toLowerCase())) {
      continue;
    }
    const id = await addSavedItem(userId, {
      ...item,
      source: 'starter_template'
    });
    addedIds.push(id);
  }
  return {
    addedCount: addedIds.length,
    addedIds
  };
}

async function quickAddFromSaved(userId, savedItemId, multiplier, consumedAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const savedResult = await client.query(
      `SELECT id, name, quantity, unit, calories, protein, carbs, fat, components
       FROM saved_items
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [savedItemId, userId]
    );

    const saved = savedResult.rows[0];
    if (!saved) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `UPDATE saved_items
       SET usage_count = usage_count + 1
       WHERE id = $1 AND user_id = $2`,
      [savedItemId, userId]
    );

    const quantityMultiplier = Number(multiplier) || 1;
    const components = normalizeSavedItemComponents(saved.components);
    if (components.length) {
      const mealQuantity = Number(saved.quantity) * quantityMultiplier;
      const mealGroup = components.length > 1 ? crypto.randomUUID() : null;
      const loggedComponents = [];

      for (const component of components) {
        const entry = {
          itemName: component.itemName,
          quantity: component.quantity * mealQuantity,
          unit: component.unit,
          calories: component.calories * mealQuantity,
          protein: component.protein * mealQuantity,
          carbs: component.carbs * mealQuantity,
          fat: component.fat * mealQuantity,
          consumedAt
        };
        loggedComponents.push(entry);
        await client.query(
          `INSERT INTO entries (
             user_id,
             item_name,
             quantity,
             unit,
             calories,
             protein,
             carbs,
             fat,
             consumed_at,
             meal_group,
             meal_name,
             meal_quantity,
             meal_unit,
             source,
             source_detail,
             confidence,
             needs_review,
             correction_key
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'quick_add',$14,1,FALSE,$15)`,
          [
            userId,
            entry.itemName,
            entry.quantity,
            entry.unit || null,
            entry.calories,
            entry.protein,
            entry.carbs,
            entry.fat,
            new Date(consumedAt),
            mealGroup,
            mealGroup ? saved.name : null,
            mealGroup ? mealQuantity : 1,
            mealGroup ? (saved.unit || 'serving') : 'serving',
            `saved_item:${saved.id}`,
            nutritionCorrectionKey(entry.itemName)
          ]
        );
      }

      await client.query('COMMIT');
      return {
        itemName: saved.name,
        quantity: mealQuantity,
        unit: saved.unit,
        calories: loggedComponents.reduce((sum, entry) => sum + entry.calories, 0),
        protein: loggedComponents.reduce((sum, entry) => sum + entry.protein, 0),
        carbs: loggedComponents.reduce((sum, entry) => sum + entry.carbs, 0),
        fat: loggedComponents.reduce((sum, entry) => sum + entry.fat, 0),
        consumedAt,
        mealGroup,
        mealName: mealGroup ? saved.name : null,
        mealQuantity: mealGroup ? mealQuantity : 1,
        mealUnit: mealGroup ? (saved.unit || 'serving') : 'serving',
        components: loggedComponents
      };
    }

    const entry = {
      itemName: saved.name,
      quantity: Number(saved.quantity) * quantityMultiplier,
      unit: saved.unit,
      calories: Number(saved.calories) * quantityMultiplier,
      protein: Number(saved.protein) * quantityMultiplier,
      carbs: Number(saved.carbs) * quantityMultiplier,
      fat: Number(saved.fat) * quantityMultiplier,
      consumedAt
    };

    await client.query(
      `INSERT INTO entries (
         user_id,
         item_name,
         quantity,
         unit,
         calories,
         protein,
         carbs,
         fat,
         consumed_at,
         source,
         source_detail,
         confidence,
         needs_review,
         correction_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'quick_add',$10,1,FALSE,$11)`,
      [
        userId,
        entry.itemName,
        entry.quantity,
        entry.unit || null,
        entry.calories,
        entry.protein,
        entry.carbs,
        entry.fat,
        new Date(consumedAt),
        `saved_item:${saved.id}`,
        nutritionCorrectionKey(entry.itemName)
      ]
    );

    await client.query('COMMIT');
    return entry;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function claimLegacyData() {
  return { claimedEntries: 0, claimedSavedItems: 0 };
}

async function getMacroTargets(userId, effectiveDateInput, options = {}) {
  const effectiveDate = normalizeTargetEffectiveDate(effectiveDateInput, options.timezone || 'America/New_York');
  const result = await pool.query(
    `SELECT DISTINCT ON (macro)
       macro,
       target,
       effective_date::text AS "effectiveDate"
     FROM macro_targets
     WHERE user_id = $1 AND effective_date <= $2::date
     ORDER BY macro, effective_date DESC, updated_at DESC`,
    [userId, effectiveDate]
  );

  const defaults = defaultMacroTargets();

  for (const row of result.rows) {
    const macro = normalizeMacroName(row.macro);
    defaults[macro] = Number(row.target || 0);
  }

  return defaults;
}

async function getMacroTargetHistory(userId, scope = 'week', timezone = 'America/New_York') {
  const days = parseTargetHistoryDays(scope);
  const result = await pool.query(
    `SELECT
       day::date::text AS day,
       COALESCE((
         SELECT target FROM macro_targets mt
         WHERE mt.user_id = $1 AND mt.macro = 'calories' AND mt.effective_date <= day::date
         ORDER BY mt.effective_date DESC, mt.updated_at DESC
         LIMIT 1
       ), $4) AS calories,
       COALESCE((
         SELECT target FROM macro_targets mt
         WHERE mt.user_id = $1 AND mt.macro = 'protein' AND mt.effective_date <= day::date
         ORDER BY mt.effective_date DESC, mt.updated_at DESC
         LIMIT 1
       ), $5) AS protein,
       COALESCE((
         SELECT target FROM macro_targets mt
         WHERE mt.user_id = $1 AND mt.macro = 'carbs' AND mt.effective_date <= day::date
         ORDER BY mt.effective_date DESC, mt.updated_at DESC
         LIMIT 1
       ), $6) AS carbs,
       COALESCE((
         SELECT target FROM macro_targets mt
         WHERE mt.user_id = $1 AND mt.macro = 'fat' AND mt.effective_date <= day::date
         ORDER BY mt.effective_date DESC, mt.updated_at DESC
         LIMIT 1
       ), $7) AS fat,
       COALESCE((
         SELECT target FROM macro_targets mt
         WHERE mt.user_id = $1 AND mt.macro = 'workouts' AND mt.effective_date <= day::date
         ORDER BY mt.effective_date DESC, mt.updated_at DESC
         LIMIT 1
       ), $8) AS workouts,
       COALESCE((
         SELECT target FROM macro_targets mt
         WHERE mt.user_id = $1 AND mt.macro = 'workout_calories' AND mt.effective_date <= day::date
         ORDER BY mt.effective_date DESC, mt.updated_at DESC
         LIMIT 1
       ), $9) AS workout_calories,
       COALESCE((
         SELECT target FROM macro_targets mt
         WHERE mt.user_id = $1 AND mt.macro = 'sleep_hours' AND mt.effective_date <= day::date
         ORDER BY mt.effective_date DESC, mt.updated_at DESC
         LIMIT 1
       ), $10) AS sleep_hours
     FROM generate_series(
       ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval),
       (NOW() AT TIME ZONE $3)::date,
       interval '1 day'
     ) AS target_days(day)
     ORDER BY day ASC`,
    [
      userId,
      String(days),
      timezone,
      DEFAULT_MACRO_TARGETS.calories,
      DEFAULT_MACRO_TARGETS.protein,
      DEFAULT_MACRO_TARGETS.carbs,
      DEFAULT_MACRO_TARGETS.fat,
      DEFAULT_MACRO_TARGETS.workouts,
      DEFAULT_MACRO_TARGETS.workout_calories,
      DEFAULT_MACRO_TARGETS.sleep_hours
    ]
  );

  return result.rows.map((row) => ({
    day: row.day,
    targets: {
      calories: Number(row.calories || 0),
      protein: Number(row.protein || 0),
      carbs: Number(row.carbs || 0),
      fat: Number(row.fat || 0),
      workouts: Number(row.workouts || 0),
      workout_calories: Number(row.workout_calories || 0),
      sleep_hours: Number(row.sleep_hours || 0)
    }
  }));
}

async function setMacroTarget(userId, macro, target, options = {}) {
  const normalizedMacro = normalizeMacroName(macro);
  const effectiveDate = normalizeTargetEffectiveDate(
    options.effectiveDate,
    options.timezone || 'America/New_York'
  );
  let normalizedTarget = Number(target);
  if (!Number.isFinite(normalizedTarget) || normalizedTarget < 0) {
    throw new Error('Target must be a number greater than or equal to 0.');
  }
  if (normalizedMacro === 'workouts') {
    normalizedTarget = Math.max(0, Math.min(14, Math.round(normalizedTarget)));
  }
  if (normalizedMacro === 'sleep_hours') {
    normalizedTarget = Math.max(0, Math.min(24, Number(normalizedTarget.toFixed(2))));
  }

  await pool.query(
    `INSERT INTO macro_targets (user_id, macro, target, effective_date, updated_at)
     VALUES ($1, $2, $3, $4::date, NOW())
     ON CONFLICT (user_id, macro, effective_date)
     DO UPDATE SET target = EXCLUDED.target, updated_at = NOW()`,
    [userId, normalizedMacro, normalizedTarget, effectiveDate]
  );

  return { macro: normalizedMacro, target: normalizedTarget, effectiveDate };
}

function normalizeDate(inputDate) {
  const date = inputDate ? new Date(inputDate) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

async function getDashboard(userId, dateInput, options = {}) {
  const timezone = options.timezone || 'America/New_York';
  const baseDay = dateInput
    ? normalizeIsoDateString(String(dateInput).slice(0, 10), 'date')
    : todayIsoDateInTimezone(timezone);
  const baseDate = new Date(`${baseDay}T00:00:00Z`);
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);

  const dailyTotalsResult = await pool.query(
    `WITH entry_totals AS (
       SELECT
         (consumed_at AT TIME ZONE $2)::date AS day,
         ROUND(SUM(calories)::numeric, 1) AS calories,
         ROUND(SUM(protein)::numeric, 1) AS protein,
         ROUND(SUM(carbs)::numeric, 1) AS carbs,
         ROUND(SUM(fat)::numeric, 1) AS fat
       FROM entries
       WHERE user_id = $1 AND deleted_at IS NULL
       GROUP BY day
     ),
     tracked_days AS (
       SELECT day FROM entry_totals
       UNION
       SELECT local_date AS day
       FROM nutrition_day_completeness
       WHERE user_id = $1
     )
     SELECT
       tracked_days.day::text AS day,
       COALESCE(entry_totals.calories, 0) AS calories,
       COALESCE(entry_totals.protein, 0) AS protein,
       COALESCE(entry_totals.carbs, 0) AS carbs,
       COALESCE(entry_totals.fat, 0) AS fat
     FROM tracked_days
     LEFT JOIN entry_totals ON entry_totals.day = tracked_days.day
     ORDER BY tracked_days.day DESC`,
    [userId, timezone]
  );

  const allDailyTotals = dailyTotalsResult.rows.map((row) => ({
    day: row.day,
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0)
  }));

  const currentDayTotalsRaw =
    allDailyTotals.find((row) => row.day === baseDay) ||
    { day: baseDay, calories: 0, protein: 0, carbs: 0, fat: 0 };

  const previousDaysRaw = allDailyTotals.filter((row) => row.day < baseDay).slice(0, 30);
  const [currentDayTotals, ...previousDays] = await attachNutritionDayCompleteness(
    userId,
    [currentDayTotalsRaw, ...previousDaysRaw],
    timezone
  );

  const sevenDayStart = new Date(baseDate);
  sevenDayStart.setDate(sevenDayStart.getDate() - 7);

  const sevenDayRowsResult = await pool.query(
    `SELECT
       (consumed_at AT TIME ZONE $4)::date::text AS day,
       SUM(calories) AS calories,
       SUM(protein) AS protein,
       SUM(carbs) AS carbs,
       SUM(fat) AS fat
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND (consumed_at AT TIME ZONE $4)::date::text >= $2
       AND (consumed_at AT TIME ZONE $4)::date::text < $3
     GROUP BY day`,
    [userId, toIsoDate(sevenDayStart), baseDay, timezone]
  );

  const totals = sevenDayRowsResult.rows.reduce(
    (acc, row) => {
      acc.calories += Number(row.calories || 0);
      acc.protein += Number(row.protein || 0);
      acc.carbs += Number(row.carbs || 0);
      acc.fat += Number(row.fat || 0);
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const sevenDayAverage = {
    daysWithData: sevenDayRowsResult.rows.length,
    calories: Number((totals.calories / 7).toFixed(1)),
    protein: Number((totals.protein / 7).toFixed(1)),
    carbs: Number((totals.carbs / 7).toFixed(1)),
    fat: Number((totals.fat / 7).toFixed(1))
  };

  const entriesResult = await pool.query(
    `SELECT
       id,
       item_name AS "itemName",
       quantity,
       unit,
       calories,
       protein,
       carbs,
       fat,
       consumed_at AS "consumedAt",
       (consumed_at AT TIME ZONE $4)::date::text AS day,
       meal_group AS "mealGroup",
       meal_name AS "mealName",
       meal_quantity AS "mealQuantity",
       meal_unit AS "mealUnit",
       source,
       source_detail AS "sourceDetail",
       confidence,
       needs_review AS "needsReview",
       correction_key AS "correctionKey"
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY consumed_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset, timezone]
  );

  const entries = entriesResult.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    quantity: Number(row.quantity || 0),
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    consumedAt: new Date(row.consumedAt).toISOString(),
    mealGroup: row.mealGroup || null,
    mealName: row.mealName || null,
    mealQuantity: Number(row.mealQuantity || 1),
    mealUnit: row.mealUnit || 'serving',
    source: row.source || 'manual',
    sourceDetail: row.sourceDetail || null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    needsReview: Boolean(row.needsReview),
    correctionKey: row.correctionKey || null
  }));

  const targets = await getMacroTargets(userId, baseDay, { timezone });

  return {
    currentDayTotals,
    previousDays,
    sevenDayAverage,
    entries,
    targets,
    pagination: { limit, offset, returned: entries.length }
  };
}



async function getDailyTotals(userId, scope = 'week', timezone = 'America/New_York') {
  const days = parseScopeDays(scope);
  const [result, targetHistory] = await Promise.all([
    pool.query(
      `WITH entry_totals AS (
         SELECT
           (consumed_at AT TIME ZONE $3)::date AS day,
           ROUND(SUM(calories)::numeric, 1) AS calories,
           ROUND(SUM(protein)::numeric, 1) AS protein,
           ROUND(SUM(carbs)::numeric, 1) AS carbs,
           ROUND(SUM(fat)::numeric, 1) AS fat
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND consumed_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY day
       ),
       tracked_days AS (
         SELECT day FROM entry_totals
         UNION
         SELECT local_date AS day
         FROM nutrition_day_completeness
         WHERE user_id = $1
           AND local_date >= (NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval
       )
       SELECT
         tracked_days.day::text AS day,
         COALESCE(entry_totals.calories, 0) AS calories,
         COALESCE(entry_totals.protein, 0) AS protein,
         COALESCE(entry_totals.carbs, 0) AS carbs,
         COALESCE(entry_totals.fat, 0) AS fat
       FROM tracked_days
       LEFT JOIN entry_totals ON entry_totals.day = tracked_days.day
       ORDER BY tracked_days.day DESC`,
      [userId, String(days), timezone]
    ),
    getMacroTargetHistory(userId, scope, timezone)
  ]);
  const targetsByDay = new Map(targetHistory.map((row) => [row.day, row.targets]));

  const dailyTotals = result.rows.map((row) => ({
    day: row.day,
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    targets: targetsByDay.get(row.day) || defaultMacroTargets()
  }));
  return attachNutritionDayCompleteness(userId, dailyTotals, timezone);
}

function parseScopeDays(scope) {
  if (scope === 'year') return 365;
  if (scope === 'month') return 30;
  return 7;
}

function parseTargetHistoryDays(scopeOrDays) {
  const numericDays = Number(scopeOrDays);
  if (Number.isFinite(numericDays)) {
    return Math.max(1, Math.min(730, Math.round(numericDays)));
  }
  return parseScopeDays(scopeOrDays);
}

function normalizeWorkoutIntensity(intensity) {
  const normalized = String(intensity || '').trim().toLowerCase();
  if (!normalized) {
    return 'medium';
  }
  if (!['low', 'medium', 'high'].includes(normalized)) {
    throw new Error('Workout intensity must be low, medium, or high.');
  }
  return normalized;
}

function normalizeWorkoutSource(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) {
    return 'manual';
  }
  if (!['manual', 'healthkit', 'workout_planner'].includes(normalized)) {
    throw new Error('Workout source must be manual, healthkit, or workout_planner.');
  }
  return normalized;
}

function normalizeHealthEntrySource(source, label) {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) {
    return 'manual';
  }
  if (!['manual', 'healthkit'].includes(normalized)) {
    throw new Error(`${label} source must be manual or healthkit.`);
  }
  return normalized;
}

function normalizeExternalId(externalId, label = 'Workout') {
  const normalized = String(externalId || '').trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > 255) {
    throw new Error(`${label} externalId must be 255 characters or less.`);
  }
  return normalized;
}

async function addWeightEntry(userId, payload) {
  const rawWeight = String(payload.weight ?? '').trim().replace(',', '.');
  const weight = Number(rawWeight);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('Weight must be greater than 0.');
  }
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid loggedAt value.');
  }
  const source = normalizeHealthEntrySource(payload.source, 'Weight');
  const externalId = normalizeExternalId(payload.externalId ?? payload.external_id, 'Weight');

  if (externalId) {
    const existing = await pool.query(
      `SELECT id
       FROM weight_entries
       WHERE user_id = $1 AND source = $2 AND external_id = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [userId, source, externalId]
    );
    if (existing.rows.length) {
      return { id: Number(existing.rows[0].id), created: false };
    }
  }

  const result = await pool.query(
    `INSERT INTO weight_entries (user_id, weight, logged_at, source, external_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, weight, loggedAt, source, externalId]
  );
  return { id: Number(result.rows[0].id), created: true };
}

async function updateWeightEntry(userId, id, payload) {
  const rawWeight = String(payload.weight ?? '').trim().replace(',', '.');
  const weight = Number(rawWeight);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('Weight must be greater than 0.');
  }
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid loggedAt value.');
  }
  const source = payload.source == null ? null : normalizeHealthEntrySource(payload.source, 'Weight');
  const externalId = payload.externalId == null && payload.external_id == null ? null : normalizeExternalId(payload.externalId ?? payload.external_id, 'Weight');

  const result = await pool.query(
    `UPDATE weight_entries
     SET weight = $3,
         logged_at = $4,
         source = COALESCE($5, source),
         external_id = COALESCE($6, external_id)
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, weight, loggedAt, source, externalId]
  );

  return result.rowCount;
}

async function deleteWeightEntry(userId, id) {
  const result = await pool.query(
    `UPDATE weight_entries SET deleted_at = NOW()
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id]
  );

  return result.rowCount;
}

async function listWeightEntries(userId, options = {}) {
  const scope = options.scope || 'week';
  const timezone = options.timezone || 'America/New_York';
  const limit = options.limit == null ? undefined : Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);
  const days = parseScopeDays(scope);
  const params = [userId, String(days), timezone];
  let query = `SELECT id,
            weight,
            logged_at AS "loggedAt",
            (logged_at AT TIME ZONE $3)::date::text AS day,
            source,
            external_id AS "externalId"
     FROM weight_entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
     ORDER BY logged_at DESC, id DESC`;

  if (limit != null) {
    params.push(limit, offset);
    query += '\n     LIMIT $4 OFFSET $5';
  }

  const [result, targetHistory] = await Promise.all([
    pool.query(query, params),
    getWeightTargetHistory(userId, scope, timezone)
  ]);
  const targetsByDay = new Map(targetHistory.map((row) => [row.day, row]));

  const entries = result.rows.map((row) => ({
    id: Number(row.id),
    weight: Number(row.weight || 0),
    loggedAt: new Date(row.loggedAt).toISOString(),
    day: row.day,
    targetWeight: targetsByDay.get(row.day)?.targetWeight ?? null,
    targetDate: targetsByDay.get(row.day)?.targetDate ?? null,
    source: row.source || 'manual',
    externalId: row.externalId || null
  }));

  return {
    entries,
    pagination: limit == null ? undefined : { limit, offset, returned: entries.length }
  };
}

async function getWeightTarget(userId, effectiveDateInput, options = {}) {
  const effectiveDate = normalizeTargetEffectiveDate(effectiveDateInput, options.timezone || 'America/New_York');
  const result = await pool.query(
    `SELECT target_weight AS "targetWeight",
            target_date::text AS "targetDate",
            effective_date::text AS "effectiveDate"
     FROM weight_targets
     WHERE user_id = $1 AND effective_date <= $2::date
     ORDER BY effective_date DESC, updated_at DESC
     LIMIT 1`,
    [userId, effectiveDate]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      targetWeight: null,
      targetDate: null
    };
  }

  return {
    targetWeight: row.targetWeight == null ? null : Number(row.targetWeight),
    targetDate: row.targetDate || null,
    effectiveDate: row.effectiveDate || null
  };
}

async function getWeightTargetHistory(userId, scope = 'week', timezone = 'America/New_York') {
  const days = parseTargetHistoryDays(scope);
  const result = await pool.query(
    `SELECT
       target_days.day::date::text AS day,
       target.target_weight AS "targetWeight",
       target.target_date::text AS "targetDate",
       target.effective_date::text AS "effectiveDate"
     FROM generate_series(
       ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval),
       (NOW() AT TIME ZONE $3)::date,
       interval '1 day'
     ) AS target_days(day)
     LEFT JOIN LATERAL (
       SELECT target_weight, target_date, effective_date
       FROM weight_targets wt
       WHERE wt.user_id = $1 AND wt.effective_date <= target_days.day::date
       ORDER BY wt.effective_date DESC, wt.updated_at DESC
       LIMIT 1
     ) AS target ON true
     ORDER BY target_days.day ASC`,
    [userId, String(days), timezone]
  );

  return result.rows.map((row) => ({
    day: row.day,
    targetWeight: row.targetWeight == null ? null : Number(row.targetWeight || 0),
    targetDate: row.targetDate || null,
    effectiveDate: row.effectiveDate || null
  }));
}

function normalizeIsoDateInput(value) {
  return normalizeIsoDateString(value, 'Target date');
}

async function setWeightTarget(userId, payload) {
  const targetWeight = Number(payload?.targetWeight);
  if (!Number.isFinite(targetWeight) || targetWeight <= 0) {
    throw new Error('Target weight must be greater than 0.');
  }
  const normalizedTargetWeight = Number(targetWeight.toFixed(1));
  const targetDate = normalizeIsoDateInput(payload?.targetDate);
  const effectiveDate = normalizeTargetEffectiveDate(payload?.effectiveDate ?? payload?.effective_date, payload?.tz || 'America/New_York');

  await pool.query(
    `INSERT INTO weight_targets (user_id, target_weight, target_date, effective_date, updated_at)
     VALUES ($1, $2, $3, $4::date, NOW())
     ON CONFLICT (user_id, effective_date)
     DO UPDATE
       SET target_weight = EXCLUDED.target_weight,
           target_date = EXCLUDED.target_date,
           updated_at = NOW()`,
    [userId, normalizedTargetWeight, targetDate, effectiveDate]
  );

  return {
    targetWeight: normalizedTargetWeight,
    targetDate,
    effectiveDate
  };
}

async function clearWeightTarget(userId, payload = {}) {
  const effectiveDate = normalizeTargetEffectiveDate(
    payload?.effectiveDate ?? payload?.effective_date,
    payload?.tz || 'America/New_York'
  );

  await pool.query(
    `INSERT INTO weight_targets (user_id, target_weight, target_date, effective_date, updated_at)
     VALUES ($1, NULL, NULL, $2::date, NOW())
     ON CONFLICT (user_id, effective_date)
     DO UPDATE
       SET target_weight = NULL,
           target_date = NULL,
           updated_at = NOW()`,
    [userId, effectiveDate]
  );

  return {
    targetWeight: null,
    targetDate: null,
    effectiveDate
  };
}

async function addWorkoutEntry(userId, payload) {
  const description = String(payload.description || '').trim();
  if (!description) {
    throw new Error('Workout description is required.');
  }
  const intensity = normalizeWorkoutIntensity(payload.intensity);
  const durationHours = Number(payload.durationHours);
  const caloriesBurned = Number(payload.caloriesBurned);
  const source = normalizeWorkoutSource(payload.source);
  const externalId = normalizeExternalId(payload.externalId ?? payload.external_id);
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error('Workout duration must be greater than 0 hours.');
  }
  if (!Number.isFinite(caloriesBurned) || caloriesBurned < 0) {
    throw new Error('Calories burned must be 0 or greater.');
  }
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid workout loggedAt value.');
  }

  if (externalId) {
    const existing = await pool.query(
      `SELECT id
       FROM workout_entries
       WHERE user_id = $1 AND source = $2 AND external_id = $3
       ORDER BY deleted_at NULLS FIRST, id DESC
       LIMIT 1`,
      [userId, source, externalId]
    );
    if (existing.rows.length) {
      return { id: Number(existing.rows[0].id), created: false };
    }
  }

  const result = await pool.query(
    `INSERT INTO workout_entries (user_id, description, intensity, duration_hours, calories_burned, logged_at, source, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [userId, description, intensity, durationHours, caloriesBurned, loggedAt, source, externalId]
  );
  return { id: Number(result.rows[0].id), created: true };
}

async function updateWorkoutEntry(userId, id, payload) {
  const description = String(payload.description || '').trim();
  if (!description) {
    throw new Error('Workout description is required.');
  }
  const intensity = normalizeWorkoutIntensity(payload.intensity);
  const durationHours = Number(payload.durationHours);
  const caloriesBurned = Number(payload.caloriesBurned);
  const source = payload.source == null ? null : normalizeWorkoutSource(payload.source);
  const externalId = payload.externalId == null && payload.external_id == null ? null : normalizeExternalId(payload.externalId ?? payload.external_id);
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error('Workout duration must be greater than 0 hours.');
  }
  if (!Number.isFinite(caloriesBurned) || caloriesBurned < 0) {
    throw new Error('Calories burned must be 0 or greater.');
  }
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid workout loggedAt value.');
  }

  const result = await pool.query(
    `UPDATE workout_entries
     SET description = $3,
         intensity = $4,
         duration_hours = $5,
         calories_burned = $6,
         logged_at = $7,
         source = COALESCE($8, source),
         external_id = COALESCE($9, external_id)
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, description, intensity, durationHours, caloriesBurned, loggedAt, source, externalId]
  );

  return result.rowCount;
}

async function deleteWorkoutEntry(userId, id) {
  const result = await pool.query(
    'UPDATE workout_entries SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  return result.rowCount;
}

async function listWorkoutEntries(userId, options = {}) {
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);
  const timezone = options.timezone || 'America/New_York';

  const rowsResult = await pool.query(
    `SELECT id,
            description,
            intensity,
            duration_hours AS "durationHours",
            calories_burned AS "caloriesBurned",
            logged_at AS "loggedAt",
            source,
            external_id AS "externalId"
     FROM workout_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY logged_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const scopeDays = parseScopeDays(options.scope || 'week');
  const [dailyResult, targetHistory] = await Promise.all([
    pool.query(
      `SELECT (logged_at AT TIME ZONE $2)::date::text AS day,
              ROUND(SUM(calories_burned)::numeric, 1) AS calories
       FROM workout_entries
       WHERE user_id = $1 AND deleted_at IS NULL
         AND logged_at >= ((NOW() AT TIME ZONE $2)::date - ($3::text || ' days')::interval) AT TIME ZONE $2
       GROUP BY day
       ORDER BY day ASC`,
      [userId, timezone, String(scopeDays)]
    ),
    getMacroTargetHistory(userId, options.scope || 'week', timezone)
  ]);
  const targetsByDay = new Map(targetHistory.map((row) => [row.day, row.targets]));

  return {
    entries: rowsResult.rows.map((row) => ({
      id: Number(row.id),
      description: row.description,
      intensity: normalizeWorkoutIntensity(row.intensity),
      durationHours: Number(row.durationHours || 0),
      caloriesBurned: Number(row.caloriesBurned || 0),
      loggedAt: new Date(row.loggedAt).toISOString(),
      source: row.source || 'manual',
      externalId: row.externalId || null
    })),
    dailyCalories: dailyResult.rows.map((row) => ({
      day: row.day,
      calories: Number(row.calories || 0),
      targetCalories: Number(targetsByDay.get(row.day)?.workout_calories || 0),
      targetWorkouts: Number(targetsByDay.get(row.day)?.workouts || 0)
    })),
    pagination: { limit, offset, returned: rowsResult.rows.length }
  };
}

const VALID_ACTIVITY_TYPES = ['masturbation', 'oral sex', 'vaginal sex', 'other'];

function normalizeActivityType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return VALID_ACTIVITY_TYPES.includes(normalized) ? normalized : 'masturbation';
}

async function addSexualActivityEntry(userId, payload) {
  const type = normalizeActivityType(payload.type);
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid loggedAt value.');
  }
  const source = normalizeHealthEntrySource(payload.source, 'Sexual activity');
  const externalId = normalizeExternalId(payload.externalId ?? payload.external_id, 'Sexual activity');

  if (externalId) {
    const existing = await pool.query(
      `SELECT id
       FROM sexual_activity_entries
       WHERE user_id = $1 AND source = $2 AND external_id = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [userId, source, externalId]
    );
    if (existing.rows.length) {
      return { id: Number(existing.rows[0].id), created: false };
    }
  }

  const result = await pool.query(
    `INSERT INTO sexual_activity_entries (user_id, type, logged_at, source, external_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, type, loggedAt, source, externalId]
  );
  return { id: Number(result.rows[0].id), created: true };
}

async function updateSexualActivityEntry(userId, id, payload) {
  const type = normalizeActivityType(payload.type);
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid loggedAt value.');
  }
  const source = payload.source == null ? null : normalizeHealthEntrySource(payload.source, 'Sexual activity');
  const externalId = payload.externalId == null && payload.external_id == null ? null : normalizeExternalId(payload.externalId ?? payload.external_id, 'Sexual activity');

  const result = await pool.query(
    `UPDATE sexual_activity_entries
     SET type = $3,
         logged_at = $4,
         source = COALESCE($5, source),
         external_id = COALESCE($6, external_id)
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, type, loggedAt, source, externalId]
  );

  return result.rowCount;
}

async function deleteSexualActivityEntry(userId, id) {
  const result = await pool.query(
    `UPDATE sexual_activity_entries SET deleted_at = NOW()
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id]
  );
  return result.rowCount;
}

async function listSexualActivityEntries(userId, options = {}) {
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);
  const timezone = options.timezone || 'America/New_York';

  const rowsResult = await pool.query(
    `SELECT id,
            type,
            logged_at AS "loggedAt",
            source,
            external_id AS "externalId"
     FROM sexual_activity_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY logged_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const scopeDays = parseScopeDays(options.scope || 'week');
  const dailyResult = await pool.query(
    `SELECT (logged_at AT TIME ZONE $2)::date::text AS day,
            array_agg(DISTINCT type) AS types
     FROM sexual_activity_entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND logged_at >= ((NOW() AT TIME ZONE $2)::date - ($3::text || ' days')::interval) AT TIME ZONE $2
     GROUP BY day
     ORDER BY day ASC`,
    [userId, timezone, String(scopeDays)]
  );

  return {
    entries: rowsResult.rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      loggedAt: new Date(row.loggedAt).toISOString(),
      source: row.source || 'manual',
      externalId: row.externalId || null
    })),
    dailyTypes: dailyResult.rows.map((row) => ({
      day: row.day,
      types: row.types || []
    })),
    pagination: { limit, offset, returned: rowsResult.rows.length }
  };
}

// ── Sleep entries ──

function hasSleepQualityPayload(payload = {}) {
  return Object.prototype.hasOwnProperty.call(payload, 'quality') ||
    Object.prototype.hasOwnProperty.call(payload, 'sleepQuality');
}

function normalizeSleepQuality(payload = {}) {
  const raw = payload.quality ?? payload.sleepQuality;
  if (raw == null || raw === '') {
    return null;
  }
  const quality = Number(raw);
  if (!Number.isFinite(quality) || Math.round(quality) !== quality || quality < 1 || quality > 5) {
    throw new Error('Sleep quality must be a whole number between 1 and 5.');
  }
  return quality;
}

function hasSleepNotesPayload(payload = {}) {
  return Object.prototype.hasOwnProperty.call(payload, 'notes') ||
    Object.prototype.hasOwnProperty.call(payload, 'sleepNotes');
}

function normalizeSleepNotes(payload = {}) {
  const raw = payload.notes ?? payload.sleepNotes;
  if (raw == null) {
    return null;
  }
  const notes = String(raw).trim();
  if (!notes) {
    return null;
  }
  if (notes.length > 1000) {
    throw new Error('Sleep notes must be 1,000 characters or fewer.');
  }
  return notes;
}

async function addSleepEntry(userId, payload) {
  const durationHours = Number(payload.durationHours);
  if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) {
    throw new Error('Duration must be between 0 and 24 hours.');
  }
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid loggedAt value.');
  }

  const wakeUps = Math.max(0, Math.min(99, Math.round(Number(payload.wakeUps) || 0)));
  const quality = normalizeSleepQuality(payload);
  const notes = normalizeSleepNotes(payload);
  const source = normalizeHealthEntrySource(payload.source, 'Sleep');
  const externalId = normalizeExternalId(payload.externalId ?? payload.external_id, 'Sleep');

  if (source === 'healthkit' && externalId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`healthkit-sleep:${userId}`]
      );

      const matching = await client.query(
        `SELECT id,
                quality,
                notes
         FROM sleep_entries
         WHERE user_id = $1
           AND source = 'healthkit'
           AND deleted_at IS NULL
           AND (
             external_id = $2
             OR ABS(EXTRACT(EPOCH FROM (logged_at - $3::timestamptz))) <= 900
             OR (
               logged_at < $3::timestamptz + ($4::double precision * INTERVAL '1 hour')
               AND logged_at + (duration_hours * INTERVAL '1 hour') > $3::timestamptz
             )
           )
         ORDER BY created_at DESC,
                  id DESC
         FOR UPDATE`,
        [userId, externalId, loggedAt, durationHours]
      );

      const activeMatches = matching.rows;
      if (activeMatches.length) {
        const canonical = activeMatches[0];
        const duplicateIds = activeMatches
          .slice(1)
          .map((row) => Number(row.id));

        if (duplicateIds.length) {
          await client.query(
            `UPDATE sleep_entries
             SET deleted_at = NOW()
             WHERE user_id = $1
               AND id = ANY($2::bigint[])
               AND deleted_at IS NULL`,
            [userId, duplicateIds]
          );
        }

        const preservedQuality =
          activeMatches.find((row) => row.quality != null)?.quality ?? quality;
        const preservedNotes =
          activeMatches.find((row) => row.notes != null)?.notes ?? notes;
        await client.query(
          `UPDATE sleep_entries
           SET duration_hours = $3,
               wake_ups = $4,
               logged_at = $5,
               external_id = $6,
               quality = $7,
               notes = $8
           WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [
            userId,
            canonical.id,
            Number(durationHours.toFixed(2)),
            wakeUps,
            loggedAt,
            externalId,
            preservedQuality,
            preservedNotes
          ]
        );
        await client.query('COMMIT');
        return {
          id: Number(canonical.id),
          created: false,
          updated: true,
          deduplicatedCount: duplicateIds.length
        };
      }

      const inserted = await client.query(
        `INSERT INTO sleep_entries (user_id, duration_hours, wake_ups, quality, notes, logged_at, source, external_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'healthkit', $7)
         RETURNING id`,
        [
          userId,
          Number(durationHours.toFixed(2)),
          wakeUps,
          quality,
          notes,
          loggedAt,
          externalId
        ]
      );
      await client.query('COMMIT');
      return { id: Number(inserted.rows[0].id), created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const result = await pool.query(
    `INSERT INTO sleep_entries (user_id, duration_hours, wake_ups, quality, notes, logged_at, source, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [userId, Number(durationHours.toFixed(2)), wakeUps, quality, notes, loggedAt, source, externalId]
  );
  return { id: Number(result.rows[0].id), created: true };
}

async function updateSleepEntry(userId, id, payload) {
  const durationHours = Number(payload.durationHours);
  if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) {
    throw new Error('Duration must be between 0 and 24 hours.');
  }
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid loggedAt value.');
  }

  const wakeUps = Math.max(0, Math.min(99, Math.round(Number(payload.wakeUps) || 0)));
  const hasQuality = hasSleepQualityPayload(payload);
  const quality = hasQuality ? normalizeSleepQuality(payload) : null;
  const hasNotes = hasSleepNotesPayload(payload);
  const notes = hasNotes ? normalizeSleepNotes(payload) : null;
  const source = payload.source == null ? null : normalizeHealthEntrySource(payload.source, 'Sleep');
  const externalId = payload.externalId == null && payload.external_id == null ? null : normalizeExternalId(payload.externalId ?? payload.external_id, 'Sleep');

  const result = await pool.query(
    `UPDATE sleep_entries
     SET duration_hours = $3,
         wake_ups = $4,
         logged_at = $5,
         source = COALESCE($6, source),
         external_id = COALESCE($7, external_id),
         quality = CASE WHEN $8 THEN $9::integer ELSE quality END,
         notes = CASE WHEN $10 THEN $11::text ELSE notes END
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, Number(durationHours.toFixed(2)), wakeUps, loggedAt, source, externalId, hasQuality, quality, hasNotes, notes]
  );

  return result.rowCount;
}

async function deleteSleepEntry(userId, id) {
  const result = await pool.query(
    `UPDATE sleep_entries SET deleted_at = NOW()
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id]
  );
  return result.rowCount;
}

async function listSleepEntries(userId, options = {}) {
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);
  const timezone = options.timezone || 'America/New_York';

  const rowsResult = await pool.query(
    `SELECT id,
            duration_hours AS "durationHours",
            wake_ups AS "wakeUps",
            quality,
            notes,
            logged_at AS "loggedAt",
            source,
            external_id AS "externalId"
     FROM sleep_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY logged_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const scopeDays = parseScopeDays(options.scope || 'week');
  const [dailyResult, targetHistory] = await Promise.all([
    pool.query(
      `SELECT (logged_at AT TIME ZONE $2)::date::text AS day,
              ROUND(SUM(duration_hours)::numeric, 2) AS total_hours
       FROM sleep_entries
       WHERE user_id = $1 AND deleted_at IS NULL
         AND logged_at >= ((NOW() AT TIME ZONE $2)::date - ($3::text || ' days')::interval) AT TIME ZONE $2
       GROUP BY day
       ORDER BY day ASC`,
      [userId, timezone, String(scopeDays)]
    ),
    getMacroTargetHistory(userId, options.scope || 'week', timezone)
  ]);
  const targetsByDay = new Map(targetHistory.map((row) => [row.day, row.targets]));

  return {
    entries: rowsResult.rows.map((row) => ({
      id: Number(row.id),
      durationHours: Number(row.durationHours),
      wakeUps: Number(row.wakeUps || 0),
      quality: row.quality == null ? null : Number(row.quality),
      notes: row.notes || null,
      loggedAt: new Date(row.loggedAt).toISOString(),
      source: row.source || 'manual',
      externalId: row.externalId || null
    })),
    dailyTotals: dailyResult.rows.map((row) => ({
      day: row.day,
      totalHours: Number(row.total_hours),
      targetHours: Number(targetsByDay.get(row.day)?.sleep_hours || DEFAULT_MACRO_TARGETS.sleep_hours)
    })),
    pagination: { limit, offset, returned: rowsResult.rows.length }
  };
}

function normalizeAnalysisDays(daysInput) {
  const parsed = Number(daysInput);
  if (!Number.isFinite(parsed)) {
    return 90;
  }
  return Math.max(14, Math.min(180, Math.round(parsed)));
}

async function getAnalysisSnapshot(userId, daysInput = 90, timezone = 'America/New_York') {
  const days = normalizeAnalysisDays(daysInput);
  const daysParam = String(days);

  const [mealDailyResult, topMealsResult, mealTimingResult, workoutDailyResult, workoutTypesResult, weightsResult, sleepResult, targets, targetHistory, weightTarget, weightTargetHistory, dataStartResult] =
    await Promise.all([
      pool.query(
        `WITH day_range AS (
           SELECT generate_series(
             (NOW() AT TIME ZONE $3)::date - (($2::integer - 1) * INTERVAL '1 day'),
             (NOW() AT TIME ZONE $3)::date,
             INTERVAL '1 day'
           )::date AS day
         ),
         meal_totals AS (
           SELECT
             (consumed_at AT TIME ZONE $3)::date AS day,
             COUNT(*)::integer AS item_count,
             COUNT(DISTINCT CASE
               WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) >= 5
                 AND EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) < 11 THEN 'breakfast'
               WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) >= 11
                 AND EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) < 16 THEN 'midday'
               WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) >= 16
                 AND EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) < 22 THEN 'evening'
               ELSE 'overnight'
             END)::integer AS daypart_count,
             EXTRACT(EPOCH FROM (
               MAX(consumed_at AT TIME ZONE $3) - MIN(consumed_at AT TIME ZONE $3)
             )) / 3600.0 AS span_hours,
             ROUND(SUM(calories)::numeric, 1) AS calories,
             ROUND(SUM(protein)::numeric, 1) AS protein,
             ROUND(SUM(carbs)::numeric, 1) AS carbs,
             ROUND(SUM(fat)::numeric, 1) AS fat
           FROM entries
           WHERE user_id = $1 AND deleted_at IS NULL
             AND consumed_at >= (
               (NOW() AT TIME ZONE $3)::date - (($2::integer - 1) * INTERVAL '1 day')
             ) AT TIME ZONE $3
           GROUP BY day
         )
         SELECT
           day_range.day::text AS day,
           COALESCE(meal_totals.item_count, 0)::integer AS item_count,
           COALESCE(meal_totals.daypart_count, 0)::integer AS daypart_count,
           COALESCE(meal_totals.span_hours, 0)::double precision AS span_hours,
           COALESCE(meal_totals.calories, 0) AS calories,
           COALESCE(meal_totals.protein, 0) AS protein,
           COALESCE(meal_totals.carbs, 0) AS carbs,
           COALESCE(meal_totals.fat, 0) AS fat,
           COALESCE(completeness.state, 'unknown') AS completeness_state,
           COALESCE(completeness.timezone, $3) AS completeness_timezone,
           completeness.updated_at AS completeness_updated_at
         FROM day_range
         LEFT JOIN meal_totals ON meal_totals.day = day_range.day
         LEFT JOIN nutrition_day_completeness completeness
           ON completeness.user_id = $1
          AND completeness.local_date = day_range.day
         WHERE meal_totals.item_count IS NOT NULL OR completeness.state IS NOT NULL
         ORDER BY day_range.day ASC`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT
           MIN(entries.item_name) AS item_name,
           COUNT(*)::integer AS times_logged,
           ROUND(SUM(entries.calories)::numeric, 1) AS total_calories
         FROM entries
         JOIN nutrition_day_completeness completeness
           ON completeness.user_id = entries.user_id
          AND completeness.local_date = (entries.consumed_at AT TIME ZONE $3)::date
          AND completeness.state = 'complete'
         WHERE entries.user_id = $1 AND entries.deleted_at IS NULL
           AND entries.consumed_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY lower(entries.item_name)
         ORDER BY COUNT(*) DESC, SUM(entries.calories) DESC
         LIMIT 12`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT
           COUNT(*)::integer AS total_entries,
           SUM(CASE WHEN EXTRACT(HOUR FROM entries.consumed_at AT TIME ZONE $3) >= 21 THEN 1 ELSE 0 END)::integer AS late_night_entries
         FROM entries
         JOIN nutrition_day_completeness completeness
           ON completeness.user_id = entries.user_id
          AND completeness.local_date = (entries.consumed_at AT TIME ZONE $3)::date
          AND completeness.state = 'complete'
         WHERE entries.user_id = $1 AND entries.deleted_at IS NULL
           AND entries.consumed_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT
           (logged_at AT TIME ZONE $3)::date::text AS day,
           COUNT(*)::integer AS sessions,
           ROUND(SUM(duration_hours)::numeric, 2) AS duration_hours,
           ROUND(SUM(calories_burned)::numeric, 1) AS calories_burned
         FROM workout_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY day
         ORDER BY day ASC`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT
           MIN(description) AS description,
           COUNT(*)::integer AS sessions,
           ROUND(SUM(duration_hours)::numeric, 2) AS duration_hours
         FROM workout_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY lower(description)
         ORDER BY COUNT(*) DESC, SUM(duration_hours) DESC
         LIMIT 10`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT weight,
                logged_at AS "loggedAt",
                (logged_at AT TIME ZONE $3)::date::text AS day
         FROM weight_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         ORDER BY logged_at ASC`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT (logged_at AT TIME ZONE $3)::date::text AS day,
                ROUND(SUM(duration_hours)::numeric, 2) AS total_hours,
                ROUND(AVG(quality)::numeric, 2) AS avg_quality
         FROM sleep_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY day
         ORDER BY day ASC`,
        [userId, daysParam, timezone]
      ),
      getMacroTargets(userId, undefined, { timezone }),
      getMacroTargetHistory(userId, days, timezone),
      getWeightTarget(userId, undefined, { timezone }),
      getWeightTargetHistory(userId, days, timezone),
      pool.query(
        `SELECT MIN(started_at) AS "startedAt"
         FROM (
           SELECT MIN(consumed_at) AS started_at
           FROM entries
           WHERE user_id = $1 AND deleted_at IS NULL
           UNION ALL
           SELECT MIN(logged_at) AS started_at
           FROM workout_entries
           WHERE user_id = $1 AND deleted_at IS NULL
           UNION ALL
           SELECT MIN(logged_at) AS started_at
           FROM weight_entries
           WHERE user_id = $1 AND deleted_at IS NULL
           UNION ALL
           SELECT MIN(local_date::timestamp AT TIME ZONE $2) AS started_at
           FROM nutrition_day_completeness
           WHERE user_id = $1
         ) timeline
         WHERE started_at IS NOT NULL`,
        [userId, timezone]
      )
    ]);

  const startedAtRaw = dataStartResult.rows[0]?.startedAt;
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : null;
  const elapsedDays = startedAt && Number.isFinite(startedAt.getTime())
    ? Math.max(1, Math.floor((Date.now() - startedAt.getTime()) / (24 * 60 * 60 * 1000)) + 1)
    : days;
  const effectivePeriodDays = Math.max(1, Math.min(days, elapsedDays));

  const weightTargetsByDay = new Map(weightTargetHistory.map((row) => [row.day, row]));
  const weightEntries = weightsResult.rows.map((row) => ({
    weight: Number(row.weight || 0),
    loggedAt: new Date(row.loggedAt).toISOString(),
    day: row.day,
    targetWeight: weightTargetsByDay.get(row.day)?.targetWeight ?? null,
    targetDate: weightTargetsByDay.get(row.day)?.targetDate ?? null
  }));

  const firstWeight = weightEntries.length ? Number(weightEntries[0].weight || 0) : 0;
  const lastWeight = weightEntries.length ? Number(weightEntries[weightEntries.length - 1].weight || 0) : 0;
  const normalizedTargetWeight = Number(weightTarget?.targetWeight);
  const targetWeightValue = Number.isFinite(normalizedTargetWeight) && normalizedTargetWeight > 0 ? normalizedTargetWeight : null;
  const targetDate = typeof weightTarget?.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weightTarget.targetDate)
    ? weightTarget.targetDate
    : null;
  let targetDaysRemaining = null;
  if (targetDate) {
    const targetDateTime = new Date(`${targetDate}T00:00:00Z`).getTime();
    if (Number.isFinite(targetDateTime)) {
      const now = Date.now();
      targetDaysRemaining = Math.ceil((targetDateTime - now) / (24 * 60 * 60 * 1000));
    }
  }
  const targetsByDay = new Map(targetHistory.map((row) => [row.day, row.targets]));
  const today = todayIsoDateInTimezone(timezone);
  const mealDailyTotals = mealDailyResult.rows.map((row) => ({
    day: row.day,
    itemCount: Number(row.item_count || 0),
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    targets: targetsByDay.get(row.day) || defaultMacroTargets(),
    completeness: buildDayCompleteness({
      day: row.day,
      state: row.completeness_state,
      timezone: row.completeness_timezone || timezone,
      updatedAt: row.completeness_updated_at,
      entryCount: Number(row.item_count || 0),
      daypartCount: Number(row.daypart_count || 0),
      spanHours: Number(row.span_hours || 0),
      today
    })
  }));
  const completenessCoverage = summarizeDayCompleteness(
    mealDailyTotals,
    effectivePeriodDays
  );

  return {
    requestedPeriodDays: days,
    periodDays: effectivePeriodDays,
    trackingStartedAt: startedAt && Number.isFinite(startedAt.getTime()) ? startedAt.toISOString() : null,
    targets,
    targetHistory,
    meals: {
      dailyTotals: mealDailyTotals,
      completenessCoverage,
      topItems: topMealsResult.rows.map((row) => ({
        itemName: row.item_name,
        timesLogged: Number(row.times_logged || 0),
        totalCalories: Number(row.total_calories || 0)
      })),
      timing: {
        totalEntries: Number(mealTimingResult.rows[0]?.total_entries || 0),
        lateNightEntries: Number(mealTimingResult.rows[0]?.late_night_entries || 0)
      }
    },
    workouts: {
      dailyTotals: workoutDailyResult.rows.map((row) => ({
        day: row.day,
        sessions: Number(row.sessions || 0),
        durationHours: Number(row.duration_hours || 0),
        caloriesBurned: Number(row.calories_burned || 0),
        targetWorkouts: Number(targetsByDay.get(row.day)?.workouts || 0),
        targetCalories: Number(targetsByDay.get(row.day)?.workout_calories || 0)
      })),
      topTypes: workoutTypesResult.rows.map((row) => ({
        description: row.description,
        sessions: Number(row.sessions || 0),
        durationHours: Number(row.duration_hours || 0)
      }))
    },
    weight: {
      entries: weightEntries,
      firstWeight,
      lastWeight,
      change: Number((lastWeight - firstWeight).toFixed(2)),
      entryCount: weightEntries.length,
      targetHistory: weightTargetHistory,
      target: {
        weight: targetWeightValue,
        date: targetDate,
        daysRemaining: Number.isFinite(targetDaysRemaining) ? targetDaysRemaining : null
      }
    },
    sleep: {
      dailyTotals: sleepResult.rows.map((row) => ({
        day: row.day,
        totalHours: Number(row.total_hours || 0),
        targetHours: Number(targetsByDay.get(row.day)?.sleep_hours || DEFAULT_MACRO_TARGETS.sleep_hours),
        avgQuality: row.avg_quality == null ? null : Number(row.avg_quality)
      })),
      daysLogged: sleepResult.rows.length,
      avgHours: sleepResult.rows.length
        ? Number((sleepResult.rows.reduce((sum, row) => sum + Number(row.total_hours || 0), 0) / sleepResult.rows.length).toFixed(2))
        : 0
    }
  };
}

async function saveAnalysisReport(userId, periodDays, report) {
  const result = await pool.query(
    `INSERT INTO analysis_reports (user_id, period_days, report_json)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, period_days AS "periodDays", report_json AS "reportJson", created_at AS "createdAt"`,
    [userId, normalizeAnalysisDays(periodDays), JSON.stringify(report || {})]
  );
  const row = result.rows[0];
  return {
    id: Number(row.id),
    periodDays: Number(row.periodDays || 0),
    report: row.reportJson || {},
    createdAt: new Date(row.createdAt).toISOString()
  };
}

async function getLatestAnalysisReport(userId) {
  const result = await pool.query(
    `SELECT id, period_days AS "periodDays", report_json AS "reportJson", created_at AS "createdAt"
     FROM analysis_reports
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    periodDays: Number(row.periodDays || 0),
    report: row.reportJson || {},
    createdAt: new Date(row.createdAt).toISOString()
  };
}

// ── Shared web sessions and rate limits ──

function mapStoredWebSession(row) {
  if (!row) return null;
  return {
    sessionData: row.sessionData ?? row.session_data,
    userId: row.userId ?? row.user_id ?? null,
    publicId: row.publicId ?? row.public_id,
    expiresAt: dateToIso(row.expiresAt ?? row.expires_at),
    createdAt: dateToIso(row.createdAt ?? row.created_at),
    updatedAt: dateToIso(row.updatedAt ?? row.updated_at)
  };
}

async function loadWebSession(sessionId) {
  const result = await pool.query(
    `SELECT session_data AS "sessionData",
            user_id AS "userId",
            public_id AS "publicId",
            expires_at AS "expiresAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM web_sessions
     WHERE sid = $1
       AND expires_at > NOW()`,
    [sessionId]
  );
  if (result.rows[0]) {
    return mapStoredWebSession(result.rows[0]);
  }
  await pool.query('DELETE FROM web_sessions WHERE sid = $1 AND expires_at <= NOW()', [sessionId]);
  return null;
}

async function saveWebSession(sessionId, sessionData, metadata) {
  const result = await pool.query(
    `INSERT INTO web_sessions (
       sid, public_id, user_id, session_data, expires_at
     )
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (sid) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           session_data = EXCLUDED.session_data,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()
     RETURNING session_data AS "sessionData",
               user_id AS "userId",
               public_id AS "publicId",
               expires_at AS "expiresAt",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [
      sessionId,
      metadata.publicId,
      metadata.userId || null,
      JSON.stringify(sessionData),
      metadata.expiresAt
    ]
  );
  return mapStoredWebSession(result.rows[0]);
}

async function touchWebSession(sessionId, sessionData, metadata) {
  const result = await pool.query(
    `UPDATE web_sessions
     SET user_id = $2,
         session_data = $3::jsonb,
         expires_at = $4,
         updated_at = NOW()
     WHERE sid = $1
       AND expires_at > NOW()
     RETURNING session_data AS "sessionData",
               user_id AS "userId",
               public_id AS "publicId",
               expires_at AS "expiresAt",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [
      sessionId,
      metadata.userId || null,
      JSON.stringify(sessionData),
      metadata.expiresAt
    ]
  );
  return mapStoredWebSession(result.rows[0]);
}

async function destroyWebSession(sessionId) {
  const result = await pool.query('DELETE FROM web_sessions WHERE sid = $1', [sessionId]);
  return result.rowCount || 0;
}

async function clearWebSessions() {
  const result = await pool.query('DELETE FROM web_sessions');
  return result.rowCount || 0;
}

async function countWebSessions() {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS count FROM web_sessions WHERE expires_at > NOW()'
  );
  return Number(result.rows[0]?.count || 0);
}

async function listStoredWebSessions() {
  const result = await pool.query(
    `SELECT session_data AS "sessionData",
            user_id AS "userId",
            public_id AS "publicId",
            expires_at AS "expiresAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM web_sessions
     WHERE expires_at > NOW()
     ORDER BY updated_at DESC`
  );
  return result.rows.map(mapStoredWebSession);
}

async function listUserWebSessions(userId, currentSessionId = null) {
  const result = await pool.query(
    `SELECT public_id AS id,
            created_at AS "createdAt",
            updated_at AS "lastUsedAt",
            expires_at AS "expiresAt",
            (sid = $2) AS current
     FROM web_sessions
     WHERE user_id = $1
       AND expires_at > NOW()
     ORDER BY updated_at DESC`,
    [userId, currentSessionId]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    kind: 'web',
    name: 'Web browser',
    createdAt: dateToIso(row.createdAt),
    lastUsedAt: dateToIso(row.lastUsedAt),
    expiresAt: dateToIso(row.expiresAt),
    current: Boolean(row.current)
  }));
}

async function deleteUserWebSession(userId, publicId) {
  const result = await pool.query(
    'DELETE FROM web_sessions WHERE user_id = $1 AND public_id = $2',
    [userId, publicId]
  );
  return result.rowCount || 0;
}

let lastRateLimitCleanupAt = 0;

async function cleanupExpiredRateLimits(now = Date.now()) {
  if (now - lastRateLimitCleanupAt < 60 * 1000) {
    return;
  }
  lastRateLimitCleanupAt = now;
  await pool.query('DELETE FROM rate_limit_counters WHERE expires_at <= NOW()');
}

async function consumeRateLimit(bucketKey, windowMs) {
  await cleanupExpiredRateLimits();
  const result = await pool.query(
    `INSERT INTO rate_limit_counters (bucket_key, count, expires_at, updated_at)
     VALUES ($1, 1, NOW() + ($2::double precision * INTERVAL '1 millisecond'), NOW())
     ON CONFLICT (bucket_key) DO UPDATE
       SET count = CASE
             WHEN rate_limit_counters.expires_at <= NOW() THEN 1
             ELSE rate_limit_counters.count + 1
           END,
           expires_at = CASE
             WHEN rate_limit_counters.expires_at <= NOW()
               THEN NOW() + ($2::double precision * INTERVAL '1 millisecond')
             ELSE rate_limit_counters.expires_at
           END,
           updated_at = NOW()
     RETURNING count, expires_at AS "expiresAt"`,
    [bucketKey, windowMs]
  );
  return {
    count: Number(result.rows[0].count),
    expiresAt: dateToIso(result.rows[0].expiresAt)
  };
}

// ── API tokens ──

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

function getApiTokenPolicy() {
  return {
    ttlDays: boundedInteger(process.env.MOBILE_TOKEN_TTL_DAYS, 90, 7, 180),
    rotateWithinDays: boundedInteger(process.env.MOBILE_TOKEN_ROTATE_WITHIN_DAYS, 14, 1, 60)
  };
}

async function createApiToken(userId, name, options = {}) {
  const tokenOptions = options && typeof options === 'object' ? options : {};
  const policy = getApiTokenPolicy();
  const ttlDays = boundedInteger(tokenOptions.ttlDays, policy.ttlDays, 1, 180);
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO api_tokens (user_id, token_hash, name, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, created_at AS "createdAt", expires_at AS "expiresAt"`,
    [userId, hash, name || 'default', expiresAt]
  );

  return {
    id: Number(result.rows[0].id),
    name: result.rows[0].name,
    token,
    createdAt: new Date(result.rows[0].createdAt).toISOString(),
    expiresAt: new Date(result.rows[0].expiresAt).toISOString()
  };
}

async function validateApiToken(token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await pool.query(
    `SELECT t.id, t.user_id, t.name AS "tokenName",
            t.expires_at AS "tokenExpiresAt",
            u.email, u.name, u.picture, u.provider, u.timezone,
            u.is_disabled AS "isDisabled",
            u.sexual_activity_enabled AS "sexualActivityEnabled",
            u.optional_diagnostics_enabled AS "optionalDiagnosticsEnabled",
            u.setup_tutorial_reset_at AS "setupTutorialResetAt",
            u.last_login_at AS "lastLoginAt",
            u.login_count AS "loginCount",
            u.created_at AS "createdAt",
            u.updated_at AS "updatedAt"
     FROM api_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1
       AND u.is_disabled IS NOT TRUE
       AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [hash]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  pool.query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});

  return {
    id: row.user_id,
    apiTokenId: Number(row.id),
    apiTokenName: row.tokenName,
    apiTokenExpiresAt: dateToIso(row.tokenExpiresAt),
    email: row.email,
    name: row.name,
    picture: row.picture,
    provider: row.provider,
    timezone: row.timezone || 'America/New_York',
    isDisabled: Boolean(row.isDisabled),
    sexualActivityEnabled: Boolean(row.sexualActivityEnabled),
    optionalDiagnosticsEnabled: row.optionalDiagnosticsEnabled !== false,
    setupTutorialResetAt: dateToIso(row.setupTutorialResetAt),
    lastLoginAt: dateToIso(row.lastLoginAt),
    loginCount: Number(row.loginCount || 0),
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt)
  };
}

async function listApiTokens(userId, currentTokenId = null) {
  const result = await pool.query(
    `SELECT id, name, created_at AS "createdAt", expires_at AS "expiresAt",
            last_used_at AS "lastUsedAt", (id = $2) AS current
     FROM api_tokens
     WHERE user_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`,
    [userId, currentTokenId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    kind: 'mobile',
    name: row.name,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    current: Boolean(row.current)
  }));
}

async function deleteApiToken(userId, tokenId) {
  const result = await pool.query(
    'DELETE FROM api_tokens WHERE id = $1 AND user_id = $2',
    [tokenId, userId]
  );
  return result.rowCount || 0;
}

async function deleteAllApiTokens(userId) {
  const result = await pool.query(
    'DELETE FROM api_tokens WHERE user_id = $1',
    [userId]
  );
  return result.rowCount || 0;
}

async function rotateApiToken(userId, tokenId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id, name
       FROM api_tokens
       WHERE id = $1
         AND user_id = $2
         AND (expires_at IS NULL OR expires_at > NOW())
       FOR UPDATE`,
      [tokenId, userId]
    );
    if (!current.rows[0]) {
      throw new Error('Active mobile credential not found.');
    }

    const policy = getApiTokenPolicy();
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + policy.ttlDays * 24 * 60 * 60 * 1000);
    const inserted = await client.query(
      `INSERT INTO api_tokens (user_id, token_hash, name, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, created_at AS "createdAt", expires_at AS "expiresAt"`,
      [userId, hash, current.rows[0].name || 'DailyMacros iOS', expiresAt]
    );
    await client.query('COMMIT');
    return {
      id: Number(inserted.rows[0].id),
      name: inserted.rows[0].name,
      token,
      createdAt: dateToIso(inserted.rows[0].createdAt),
      expiresAt: dateToIso(inserted.rows[0].expiresAt)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function revokeAllCredentials(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const webSessions = await client.query(
      'DELETE FROM web_sessions WHERE user_id = $1',
      [userId]
    );
    const apiTokens = await client.query(
      'DELETE FROM api_tokens WHERE user_id = $1',
      [userId]
    );
    await client.query('COMMIT');
    return {
      webSessionCount: webSessions.rowCount || 0,
      apiTokenCount: apiTokens.rowCount || 0
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── AI coach dismissals ──

function normalizeCoachDismissalType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized !== 'today' && normalized !== 'pattern') {
    throw new Error('Invalid coach dismissal type.');
  }
  return normalized;
}

function mapCoachDismissalRow(row) {
  return {
    type: row.dismissal_type,
    key: row.dismissal_key,
    dismissedUntil: dateToIso(row.dismissed_until),
    updatedAt: dateToIso(row.updated_at)
  };
}

async function listCoachDismissals(userId) {
  const result = await pool.query(
    `SELECT dismissal_type, dismissal_key, dismissed_until, updated_at
     FROM coach_dismissals
     WHERE user_id = $1
       AND (dismissed_until IS NULL OR dismissed_until > NOW())
     ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows.map(mapCoachDismissalRow);
}

async function upsertCoachDismissals(userId, dismissals) {
  if (!Array.isArray(dismissals)) {
    throw new Error('dismissals must be an array.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const dismissal of dismissals) {
      const type = normalizeCoachDismissalType(dismissal.type);
      const key = String(dismissal.key || '').trim();
      if (!key) {
        throw new Error('dismissal key is required.');
      }
      if (key.length > 512) {
        throw new Error('dismissal key must be 512 characters or less.');
      }

      const dismissedUntil = dismissal.dismissedUntil ? new Date(dismissal.dismissedUntil) : null;
      if (dismissedUntil && Number.isNaN(dismissedUntil.getTime())) {
        throw new Error('dismissedUntil must be a valid date.');
      }

      await client.query(
        `INSERT INTO coach_dismissals (user_id, dismissal_type, dismissal_key, dismissed_until, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, dismissal_type, dismissal_key)
         DO UPDATE SET dismissed_until = EXCLUDED.dismissed_until, updated_at = NOW()`,
        [userId, type, key, dismissedUntil]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return listCoachDismissals(userId);
}

async function deleteCoachDismissals(userId) {
  const result = await pool.query(
    'DELETE FROM coach_dismissals WHERE user_id = $1',
    [userId]
  );
  return result.rowCount || 0;
}

// ── GDPR ──

const INVENTORY_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;
const INVENTORY_ORDER_PATTERN = /^[a-z0-9_,\s]+$/i;

function assertInventoryIdentifier(value, label) {
  const normalized = String(value || '');
  if (!INVENTORY_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`Invalid data inventory ${label}.`);
  }
  return normalized;
}

function inventoryExportQuery(item) {
  const table = assertInventoryIdentifier(item.table, 'table');
  const userColumn = assertInventoryIdentifier(item.userColumn, 'user column');
  const columns = item.export.columns
    .map((column) => assertInventoryIdentifier(column, 'export column'))
    .join(', ');
  if (item.export.orderBy && !INVENTORY_ORDER_PATTERN.test(item.export.orderBy)) {
    throw new Error('Invalid data inventory order.');
  }
  const orderBy = item.export.orderBy ? ` ORDER BY ${item.export.orderBy}` : '';
  return `SELECT ${columns} FROM ${table} WHERE ${userColumn} = $1${orderBy}`;
}

async function exportUserData(userId) {
  const inventory = accountExportInventory();
  const [results, weightTarget] = await Promise.all([
    Promise.all(inventory.map((item) => pool.query(inventoryExportQuery(item), [userId]))),
    getWeightTarget(userId)
  ]);
  const retention = Object.fromEntries(
    retentionInventory().map((item) => [
      item.table,
      item.retention.mode === 'deadline'
        ? {
            mode: 'deadline',
            processedDays: item.retention.processedDays,
            exhaustedDays: item.retention.exhaustedDays
          }
        : { days: item.retention.days }
    ])
  );
  const exported = {
    exportedAt: new Date().toISOString(),
    dataInventoryVersion: DATA_INVENTORY_VERSION,
    retention,
    weightTarget,
  };

  inventory.forEach((item, index) => {
    exported[item.export.key] = item.export.cardinality === 'one'
      ? (results[index].rows[0] || null)
      : results[index].rows;
  });

  return exported;
}

async function deleteUserAccount(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of accountDeletionInventory()) {
      const table = assertInventoryIdentifier(item.table, 'table');
      const userColumn = assertInventoryIdentifier(item.userColumn, 'user column');
      await client.query(`DELETE FROM ${table} WHERE ${userColumn} = $1`, [userId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runDataRetentionCleanup({ now = new Date(), queryable = pool } = {}) {
  const cleanupAt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(cleanupAt.getTime())) {
    throw new Error('Retention cleanup time must be a valid date.');
  }

  const tables = {};
  let deletedTotal = 0;
  for (const item of retentionInventory()) {
    const table = assertInventoryIdentifier(item.table, 'table');
    const column = assertInventoryIdentifier(item.retention.column, 'retention column');
    const deadlineMode = item.retention.mode === 'deadline';
    const result = deadlineMode
      ? await queryable.query(
          `DELETE FROM ${table}
           WHERE ${column} IS NOT NULL
             AND ${column} <= $1::timestamptz`,
          [cleanupAt.toISOString()]
        )
      : await queryable.query(
          `DELETE FROM ${table}
           WHERE ${column} < ($1::timestamptz - ($2 * INTERVAL '1 day'))`,
          [cleanupAt.toISOString(), item.retention.days]
        );
    const deleted = Number(result.rowCount || 0);
    deletedTotal += deleted;
    tables[table] = deadlineMode
      ? {
          deleted,
          retentionMode: 'deadline',
          processedDays: item.retention.processedDays,
          exhaustedDays: item.retention.exhaustedDays
        }
      : {
          deleted,
          retentionDays: item.retention.days
        };
  }

  return {
    completedAt: cleanupAt.toISOString(),
    inventoryVersion: DATA_INVENTORY_VERSION,
    deletedTotal,
    tables
  };
}

// ── Durable provider event inbox ──

function normalizeWebhookEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    provider: row.provider,
    providerEventId: row.providerEventId,
    eventType: row.eventType,
    deliveryKind: row.deliveryKind,
    userId: row.userId || null,
    payload: row.payload || {},
    status: row.status,
    attemptCount: Number(row.attemptCount || 0),
    maxAttempts: Number(row.maxAttempts || 0),
    nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt).toISOString() : null,
    processingStartedAt: row.processingStartedAt
      ? new Date(row.processingStartedAt).toISOString()
      : null,
    leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt).toISOString() : null,
    workerId: row.workerId || null,
    failureCode: row.failureCode || null,
    occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : null,
    receivedAt: row.receivedAt ? new Date(row.receivedAt).toISOString() : null,
    lastFailedAt: row.lastFailedAt ? new Date(row.lastFailedAt).toISOString() : null,
    processedAt: row.processedAt ? new Date(row.processedAt).toISOString() : null,
    purgeAfter: row.purgeAfter ? new Date(row.purgeAfter).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

const WEBHOOK_EVENT_COLUMNS = `
  id,
  provider,
  provider_event_id AS "providerEventId",
  event_type AS "eventType",
  delivery_kind AS "deliveryKind",
  user_id AS "userId",
  payload,
  status,
  attempt_count AS "attemptCount",
  max_attempts AS "maxAttempts",
  next_attempt_at AS "nextAttemptAt",
  processing_started_at AS "processingStartedAt",
  lease_expires_at AS "leaseExpiresAt",
  worker_id AS "workerId",
  failure_code AS "failureCode",
  occurred_at AS "occurredAt",
  received_at AS "receivedAt",
  last_failed_at AS "lastFailedAt",
  processed_at AS "processedAt",
  purge_after AS "purgeAfter",
  updated_at AS "updatedAt"
`;

function normalizedWebhookIdentifier(value, label, { pattern, maxLength = 255 } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength || (pattern && !pattern.test(normalized))) {
    throw new Error(`Webhook ${label} is invalid.`);
  }
  return normalized;
}

async function receiveWebhookEvent({
  provider,
  providerEventId,
  eventType,
  deliveryKind = 'webhook',
  userId = null,
  payload = {},
  occurredAt = null,
  maxAttempts = 8
}) {
  const normalizedProvider = normalizedWebhookIdentifier(provider, 'provider', {
    pattern: /^[a-z0-9_-]+$/,
    maxLength: 40
  });
  const normalizedEventId = normalizedWebhookIdentifier(providerEventId, 'event id', {
    maxLength: 500
  });
  const normalizedEventType = normalizedWebhookIdentifier(eventType, 'event type', {
    maxLength: 160
  });
  const normalizedDeliveryKind = String(deliveryKind || '').trim();
  if (!['webhook', 'reconciliation'].includes(normalizedDeliveryKind)) {
    throw new Error('Webhook delivery kind is invalid.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Webhook payload must be an object.');
  }
  const normalizedMaxAttempts = Math.max(1, Math.min(50, Math.floor(Number(maxAttempts) || 8)));
  const normalizedUserId = String(userId || '').trim() || null;
  const occurred = occurredAt ? new Date(occurredAt) : null;
  if (occurred && Number.isNaN(occurred.getTime())) {
    throw new Error('Webhook event time is invalid.');
  }

  const result = await pool.query(
    `INSERT INTO webhook_events (
       provider, provider_event_id, event_type, delivery_kind, user_id, payload,
       max_attempts, next_attempt_at, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), $8)
     ON CONFLICT (provider, provider_event_id)
     DO UPDATE SET
       user_id = COALESCE(webhook_events.user_id, EXCLUDED.user_id)
     RETURNING ${WEBHOOK_EVENT_COLUMNS}`,
    [
      normalizedProvider,
      normalizedEventId,
      normalizedEventType,
      normalizedDeliveryKind,
      normalizedUserId,
      JSON.stringify(payload),
      normalizedMaxAttempts,
      occurred
    ]
  );
  return normalizeWebhookEventRow(result.rows[0]);
}

async function claimWebhookEvents({
  workerId,
  limit = 10,
  leaseMs = 120_000,
  providers = [],
  queryable = pool
}) {
  const normalizedWorkerId = normalizedWebhookIdentifier(workerId, 'worker id', {
    maxLength: 160
  });
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));
  const normalizedLeaseMs = Math.max(1_000, Math.min(
    60 * 60 * 1000,
    Math.floor(Number(leaseMs) || 120_000)
  ));
  const normalizedProviders = [...new Set(
    (Array.isArray(providers) ? providers : [])
      .map((provider) => String(provider || '').trim())
      .filter((provider) => /^[a-z0-9_-]{1,40}$/.test(provider))
  )];
  if (!normalizedProviders.length) return [];

  // A worker that died during its final permitted attempt cannot leave a row
  // stuck in processing forever.
  await queryable.query(
    `UPDATE webhook_events
     SET status = 'failed',
         next_attempt_at = NULL,
         worker_id = NULL,
         lease_expires_at = NULL,
         failure_code = 'lease_expired_after_final_attempt',
         last_failed_at = NOW(),
         purge_after = COALESCE(purge_after, NOW() + INTERVAL '90 days'),
         updated_at = NOW()
     WHERE status = 'processing'
       AND lease_expires_at <= NOW()
       AND attempt_count >= max_attempts
       AND provider = ANY($1::text[])`,
    [normalizedProviders]
  );

  const result = await queryable.query(
    `WITH claimable AS (
       SELECT id AS claim_id
       FROM webhook_events
       WHERE provider = ANY($4::text[])
         AND attempt_count < max_attempts
         AND (
           (status = 'received' AND next_attempt_at <= NOW())
           OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW())
           OR (status = 'processing' AND lease_expires_at <= NOW())
         )
       ORDER BY next_attempt_at ASC NULLS FIRST, received_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE webhook_events AS event
     SET status = 'processing',
         attempt_count = event.attempt_count + 1,
         processing_started_at = NOW(),
         lease_expires_at = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
         worker_id = $2,
         failure_code = NULL,
         purge_after = NULL,
         updated_at = NOW()
     FROM claimable
     WHERE event.id = claimable.claim_id
     RETURNING ${WEBHOOK_EVENT_COLUMNS}`,
    [normalizedLimit, normalizedWorkerId, normalizedLeaseMs, normalizedProviders]
  );
  return result.rows.map(normalizeWebhookEventRow);
}

function webhookLeaseLostError() {
  const error = new Error('Webhook event lease is no longer owned by this worker.');
  error.code = 'webhook_lease_lost';
  return error;
}

async function markWebhookEventProcessed(eventId, workerId, queryable = pool) {
  const result = await queryable.query(
    `UPDATE webhook_events
     SET status = 'processed',
         next_attempt_at = NULL,
         lease_expires_at = NULL,
         worker_id = NULL,
         failure_code = NULL,
         processed_at = NOW(),
         purge_after = NOW() + INTERVAL '30 days',
         updated_at = NOW()
     WHERE id = $1
       AND status = 'processing'
       AND worker_id = $2
     RETURNING ${WEBHOOK_EVENT_COLUMNS}`,
    [eventId, workerId]
  );
  if (!result.rows.length) throw webhookLeaseLostError();
  return normalizeWebhookEventRow(result.rows[0]);
}

async function markWebhookEventFailed(eventId, workerId, {
  errorCode = 'processing_error',
  retryDelayMs = 1_000
} = {}, queryable = pool) {
  const normalizedErrorCode = normalizedWebhookIdentifier(errorCode, 'failure code', {
    pattern: /^[a-z0-9_:-]+$/,
    maxLength: 80
  });
  const normalizedRetryDelayMs = Math.max(1_000, Math.min(
    24 * 60 * 60 * 1000,
    Math.floor(Number(retryDelayMs) || 1_000)
  ));
  const result = await queryable.query(
    `UPDATE webhook_events
     SET status = 'failed',
         next_attempt_at = CASE
           WHEN attempt_count >= max_attempts THEN NULL
           ELSE NOW() + ($4::bigint * INTERVAL '1 millisecond')
         END,
         lease_expires_at = NULL,
         worker_id = NULL,
         failure_code = $3,
         last_failed_at = NOW(),
         purge_after = CASE
           WHEN attempt_count >= max_attempts THEN NOW() + INTERVAL '90 days'
           ELSE NULL
         END,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'processing'
       AND worker_id = $2
     RETURNING ${WEBHOOK_EVENT_COLUMNS}`,
    [eventId, workerId, normalizedErrorCode, normalizedRetryDelayMs]
  );
  if (!result.rows.length) throw webhookLeaseLostError();
  const event = normalizeWebhookEventRow(result.rows[0]);
  return {
    ...event,
    exhausted: event.nextAttemptAt === null
  };
}

async function retryWebhookEvent(eventId) {
  const normalizedId = Math.floor(Number(eventId));
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new Error('Webhook event id is invalid.');
  }
  const result = await pool.query(
    `UPDATE webhook_events
     SET status = 'received',
         attempt_count = 0,
         next_attempt_at = NOW(),
         processing_started_at = NULL,
         lease_expires_at = NULL,
         worker_id = NULL,
         failure_code = NULL,
         last_failed_at = NULL,
         purge_after = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'failed'
     RETURNING ${WEBHOOK_EVENT_COLUMNS}`,
    [normalizedId]
  );
  return normalizeWebhookEventRow(result.rows[0]);
}

async function getWebhookOperationsSummary({ failureLimit = 50 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(Number(failureLimit) || 50)));
  const [summaryResult, providerResult, failureResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'received'
             OR (status = 'failed' AND next_attempt_at IS NOT NULL)
             OR (status = 'processing' AND lease_expires_at <= NOW())
        )::bigint AS "backlogCount",
        COUNT(*) FILTER (WHERE status = 'processing')::bigint AS "processingCount",
        COUNT(*) FILTER (WHERE status = 'failed')::bigint AS "failureCount",
        COUNT(*) FILTER (
          WHERE status = 'failed' AND next_attempt_at IS NULL
        )::bigint AS "exhaustedCount",
        FLOOR(EXTRACT(EPOCH FROM (
          NOW() - MIN(received_at) FILTER (
            WHERE status = 'received'
               OR (status = 'failed' AND next_attempt_at IS NOT NULL)
               OR (status = 'processing' AND lease_expires_at <= NOW())
          )
        )))::bigint AS "oldestBacklogAgeSeconds",
        MAX(processed_at) AS "lastSuccessAt"
      FROM webhook_events
    `),
    pool.query(`
      SELECT provider,
             COUNT(*) FILTER (
               WHERE status = 'received'
                  OR (status = 'failed' AND next_attempt_at IS NOT NULL)
                  OR (status = 'processing' AND lease_expires_at <= NOW())
             )::bigint AS "backlogCount",
             COUNT(*) FILTER (WHERE status = 'failed')::bigint AS "failureCount",
             MAX(processed_at) AS "lastSuccessAt"
      FROM webhook_events
      GROUP BY provider
      ORDER BY provider
    `),
    pool.query(
      `SELECT id,
              provider,
              event_type AS "eventType",
              attempt_count AS "attemptCount",
              max_attempts AS "maxAttempts",
              failure_code AS "failureCode",
              received_at AS "receivedAt",
              last_failed_at AS "lastFailedAt",
              next_attempt_at AS "nextAttemptAt"
       FROM webhook_events
       WHERE status = 'failed'
       ORDER BY last_failed_at DESC NULLS LAST, id DESC
       LIMIT $1`,
      [normalizedLimit]
    )
  ]);
  const summary = summaryResult.rows[0] || {};
  return {
    backlogCount: Number(summary.backlogCount || 0),
    processingCount: Number(summary.processingCount || 0),
    failureCount: Number(summary.failureCount || 0),
    exhaustedCount: Number(summary.exhaustedCount || 0),
    oldestBacklogAgeSeconds: summary.oldestBacklogAgeSeconds == null
      ? null
      : Number(summary.oldestBacklogAgeSeconds),
    lastSuccessAt: summary.lastSuccessAt
      ? new Date(summary.lastSuccessAt).toISOString()
      : null,
    providers: providerResult.rows.map((row) => ({
      provider: row.provider,
      backlogCount: Number(row.backlogCount || 0),
      failureCount: Number(row.failureCount || 0),
      lastSuccessAt: row.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null
    })),
    failures: failureResult.rows.map((row) => ({
      id: Number(row.id),
      provider: row.provider,
      eventType: row.eventType,
      attemptCount: Number(row.attemptCount || 0),
      maxAttempts: Number(row.maxAttempts || 0),
      failureCode: row.failureCode || null,
      receivedAt: row.receivedAt ? new Date(row.receivedAt).toISOString() : null,
      lastFailedAt: row.lastFailedAt ? new Date(row.lastFailedAt).toISOString() : null,
      nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt).toISOString() : null
    }))
  };
}

// ── Subscriptions ──

const PLAN_LIMITS = {
  free: {
    dailyParses: 20,
    mealParsesPerDay: 20,
    workoutParsesPerDay: 30,
    photoParsesPerDay: 8,
    analysisPerDay: 2
  },
  pro: {
    dailyParses: 100,
    mealParsesPerDay: 100,
    workoutParsesPerDay: 100,
    photoParsesPerDay: 40,
    analysisPerDay: 10
  }
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

async function getSubscription(userId) {
  const result = await pool.query(
    `SELECT id, user_id, stripe_customer_id AS "stripeCustomerId",
            stripe_subscription_id AS "stripeSubscriptionId",
            plan, status, current_period_start AS "currentPeriodStart",
            current_period_end AS "currentPeriodEnd",
            cancel_at_period_end AS "cancelAtPeriodEnd",
            provider_observed_at AS "providerObservedAt",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (!result.rows.length) {
    return {
      plan: 'free',
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      providerObservedAt: null
    };
  }
  const row = result.rows[0];
  return {
    id: Number(row.id),
    plan: row.plan || 'free',
    status: row.status || 'active',
    stripeCustomerId: row.stripeCustomerId || null,
    stripeSubscriptionId: row.stripeSubscriptionId || null,
    currentPeriodStart: row.currentPeriodStart ? new Date(row.currentPeriodStart).toISOString() : null,
    currentPeriodEnd: row.currentPeriodEnd ? new Date(row.currentPeriodEnd).toISOString() : null,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    providerObservedAt: row.providerObservedAt
      ? new Date(row.providerObservedAt).toISOString()
      : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

async function upsertSubscriptionWithQueryable(queryable, userId, data) {
  const providerObservedAt = data.providerObservedAt
    ? new Date(data.providerObservedAt)
    : new Date();
  if (Number.isNaN(providerObservedAt.getTime())) {
    throw new Error('Subscription provider observation time is invalid.');
  }
  const result = await queryable.query(
    `INSERT INTO subscriptions (
       user_id, stripe_customer_id, stripe_subscription_id, plan, status,
       current_period_start, current_period_end, cancel_at_period_end,
       provider_observed_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       provider_observed_at = EXCLUDED.provider_observed_at,
       updated_at = NOW()
     WHERE subscriptions.provider_observed_at IS NULL
        OR subscriptions.provider_observed_at < EXCLUDED.provider_observed_at
     RETURNING user_id`,
    [
      userId,
      data.stripeCustomerId || null,
      data.stripeSubscriptionId || null,
      data.plan || 'free',
      data.status || 'active',
      data.currentPeriodStart || null,
      data.currentPeriodEnd || null,
      Boolean(data.cancelAtPeriodEnd),
      providerObservedAt
    ]
  );
  return { updated: result.rows.length === 1 };
}

async function upsertSubscription(userId, data) {
  return upsertSubscriptionWithQueryable(pool, userId, data);
}

async function getSubscriptionByStripeCustomerId(stripeCustomerId) {
  const result = await pool.query(
    'SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1',
    [stripeCustomerId]
  );
  return result.rows[0] || null;
}

async function saveBillingEvent(userId, stripeEventId, eventType, payload) {
  const result = await pool.query(
    `INSERT INTO billing_events (user_id, stripe_event_id, event_type, payload, applied_at)
     VALUES ($1, $2, $3, '{}'::jsonb, NOW())
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING id`,
    [userId, stripeEventId, eventType]
  );
  return { applied: result.rows.length === 1 };
}

async function applyStripeBillingEvent(userId, {
  stripeEventId,
  eventType,
  payload,
  subscription
}) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedEventId = String(stripeEventId || '').trim();
  const normalizedEventType = String(eventType || '').trim();
  if (!normalizedUserId || !normalizedEventId || !normalizedEventType) {
    throw new Error('Stripe billing application is missing required identifiers.');
  }
  if (!subscription || typeof subscription !== 'object') {
    throw new Error('Stripe billing application is missing subscription state.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO billing_events (
         user_id, stripe_event_id, event_type, payload, applied_at
       )
       VALUES ($1, $2, $3, '{}'::jsonb, NULL)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [normalizedUserId, normalizedEventId, normalizedEventType]
    );
    const eventResult = await client.query(
      `SELECT applied_at AS "appliedAt"
       FROM billing_events
       WHERE stripe_event_id = $1
       FOR UPDATE`,
      [normalizedEventId]
    );
    if (!eventResult.rows.length) {
      throw new Error('Stripe billing event receipt could not be locked.');
    }
    if (eventResult.rows[0].appliedAt) {
      await client.query('COMMIT');
      return { applied: false };
    }

    await upsertSubscriptionWithQueryable(client, normalizedUserId, subscription);
    await client.query(
      `UPDATE billing_events
       SET user_id = $2,
           event_type = $3,
           payload = '{}'::jsonb,
           applied_at = NOW()
       WHERE stripe_event_id = $1`,
      [normalizedEventId, normalizedUserId, normalizedEventType]
    );
    await client.query('COMMIT');
    return { applied: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listStripeSubscriptionsForReconciliation({ limit = 500, offset = 0 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(2_000, Math.floor(Number(limit) || 500)));
  const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const result = await pool.query(
    `SELECT user_id AS "userId",
            stripe_customer_id AS "stripeCustomerId",
            stripe_subscription_id AS "stripeSubscriptionId"
     FROM subscriptions
     WHERE stripe_customer_id IS NOT NULL
     ORDER BY user_id
     LIMIT $1 OFFSET $2`,
    [normalizedLimit, normalizedOffset]
  );
  return result.rows;
}

async function consumeDailyUsage(userId, feature, maxDaily) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedFeature = String(feature || '').trim();
  const normalizedMax = Math.floor(Number(maxDaily));

  if (!normalizedUserId || !normalizedFeature) {
    throw new Error('Usage counter requires user and feature.');
  }
  if (!Number.isFinite(normalizedMax) || normalizedMax <= 0) {
    return { allowed: false, count: 0, limit: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = await pool.query(
    `WITH upsert AS (
       INSERT INTO daily_usage_counts (user_id, feature, usage_date, count, updated_at)
       VALUES ($1, $2, $3::date, 1, NOW())
       ON CONFLICT (user_id, feature, usage_date)
       DO UPDATE SET count = daily_usage_counts.count + 1, updated_at = NOW()
       WHERE daily_usage_counts.count < $4
       RETURNING count
     )
     SELECT count FROM upsert`,
    [normalizedUserId, normalizedFeature, today, normalizedMax]
  );

  if (result.rows.length) {
    return { allowed: true, count: Number(result.rows[0].count || 0), limit: normalizedMax };
  }

  const current = await pool.query(
    `SELECT count
     FROM daily_usage_counts
     WHERE user_id = $1 AND feature = $2 AND usage_date = $3::date`,
    [normalizedUserId, normalizedFeature, today]
  );
  return {
    allowed: false,
    count: Number(current.rows[0]?.count || normalizedMax),
    limit: normalizedMax
  };
}

module.exports = {
  initDb,
  getPool,
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
  loadWebSession,
  saveWebSession,
  touchWebSession,
  destroyWebSession,
  clearWebSessions,
  countWebSessions,
  listStoredWebSessions,
  listUserWebSessions,
  deleteUserWebSession,
  consumeRateLimit,
  claimClientMutation,
  getClientMutation,
  completeClientMutation,
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
  getNutritionDayCompleteness,
  getNutritionDayCompletenessForDays,
  listNutritionDayCompleteness,
  setNutritionDayCompleteness,
  getMacroTargets,
  getMacroTargetHistory,
  setMacroTarget,
  addWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  listWeightEntries,
  getWeightTarget,
  getWeightTargetHistory,
  setWeightTarget,
  clearWeightTarget,
  addWorkoutEntry,
  updateWorkoutEntry,
  deleteWorkoutEntry,
  listWorkoutEntries,
  addSexualActivityEntry,
  updateSexualActivityEntry,
  deleteSexualActivityEntry,
  listSexualActivityEntries,
  deduplicateHealthKitSleepRevisions,
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
  rotateApiToken,
  revokeAllCredentials,
  getApiTokenPolicy,
  listCoachDismissals,
  upsertCoachDismissals,
  deleteCoachDismissals,
  exportUserData,
  deleteUserAccount,
  runDataRetentionCleanup,
  receiveWebhookEvent,
  claimWebhookEvents,
  markWebhookEventProcessed,
  markWebhookEventFailed,
  retryWebhookEvent,
  getWebhookOperationsSummary,
  getPlanLimits,
  getSubscription,
  upsertSubscription,
  getSubscriptionByStripeCustomerId,
  saveBillingEvent,
  applyStripeBillingEvent,
  listStripeSubscriptionsForReconciliation,
  consumeDailyUsage
};
