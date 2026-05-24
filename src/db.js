const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

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

async function initDb() {
  // ── Core user table ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      picture TEXT,
      provider TEXT NOT NULL DEFAULT 'google',
      is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
      sexual_activity_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
      deleted_at TIMESTAMPTZ
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
      fat DOUBLE PRECISION NOT NULL,
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, macro)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS weight_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      weight DOUBLE PRECISION NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL,
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
      logged_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
  `);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS wake_ups INTEGER NOT NULL DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS weight_targets (
      user_id TEXT PRIMARY KEY,
      target_weight DOUBLE PRECISION NOT NULL,
      target_date DATE NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      stripe_event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

  // ── Migrations for existing databases ──
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sexual_activity_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;`);

  await pool.query(`
    ALTER TABLE workout_entries
      ADD COLUMN IF NOT EXISTS intensity TEXT NOT NULL DEFAULT 'medium';
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

  // Soft-delete columns for existing databases
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE weight_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE workout_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE analysis_reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE sexual_activity_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_user_consumed ON entries(user_id, consumed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_items_user_name ON saved_items(user_id, lower(name));
    CREATE INDEX IF NOT EXISTS idx_macro_targets_user ON macro_targets(user_id);
    CREATE INDEX IF NOT EXISTS idx_weight_entries_user_logged ON weight_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workout_entries_user_logged ON workout_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sleep_entries_user_logged ON sleep_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_user_created ON analysis_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_normalized_email ON users(lower(email));
    CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_billing_events_stripe ON billing_events(stripe_event_id);
    CREATE INDEX IF NOT EXISTS idx_daily_usage_counts_user_date ON daily_usage_counts(user_id, usage_date DESC);
  `);
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
    isDisabled: Boolean(row.isDisabled ?? row.is_disabled),
    sexualActivityEnabled: Boolean(row.sexualActivityEnabled ?? row.sexual_activity_enabled),
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
      `INSERT INTO users (id, email, name, picture, provider, last_login_at, login_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), 1, NOW())
       ON CONFLICT (id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             name = COALESCE(EXCLUDED.name, users.name),
             picture = COALESCE(EXCLUDED.picture, users.picture),
             provider = CASE
               WHEN EXCLUDED.provider = ANY(string_to_array(users.provider, ',')) THEN users.provider
               ELSE users.provider || ',' || EXCLUDED.provider
             END,
             last_login_at = NOW(),
             login_count = COALESCE(users.login_count, 0) + 1,
             updated_at = NOW()
       RETURNING id, email, name, picture, provider,
                 is_disabled AS "isDisabled",
                 sexual_activity_enabled AS "sexualActivityEnabled",
                 last_login_at AS "lastLoginAt",
                 login_count AS "loginCount",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [canonicalUserId, email, name, picture, provider]
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
    `SELECT id, email, name, picture, provider,
            is_disabled AS "isDisabled",
            sexual_activity_enabled AS "sexualActivityEnabled",
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
    lastAuditAt: dateToIso(row.lastAuditAt ?? row.last_audit_at)
  };
}

async function listAdminAccounts({ search = '', limit = 25, offset = 0 } = {}) {
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));

  const result = await pool.query(
    `WITH filtered AS (
       SELECT u.id, u.email, u.name, u.picture, u.provider,
              u.is_disabled AS "isDisabled",
              u.sexual_activity_enabled AS "sexualActivityEnabled",
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
            aus."lastAuditAt"
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

// ── Macros / entries ──

function normalizeMacroName(macro) {
  const value = String(macro || '').toLowerCase();
  if (!['calories', 'protein', 'carbs', 'fat', 'workouts', 'workout_calories', 'sleep_hours'].includes(value)) {
    throw new Error('Invalid macro. Use calories, protein, carbs, fat, workouts, workout_calories, or sleep_hours.');
  }
  return value;
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
        meal_unit
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `;

    for (const row of entries) {
      await client.query(query, [
        userId,
        row.itemName,
        Number(row.quantity || 0),
        row.unit || null,
        Number(row.calories || 0),
        Number(row.protein || 0),
        Number(row.carbs || 0),
        Number(row.fat || 0),
        new Date(row.consumedAt),
        row.mealGroup || null,
        row.mealName || null,
        row.mealQuantity != null ? Number(row.mealQuantity) : 1,
        row.mealUnit || 'serving'
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

async function updateEntry(userId, id, entry) {
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
       consumed_at = $8
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
      userId
    ]
  );

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

async function addSavedItem(userId, item) {
  const result = await pool.query(
    `INSERT INTO saved_items (user_id, name, quantity, unit, calories, protein, carbs, fat)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      userId,
      item.name,
      Number(item.quantity || 1),
      item.unit || null,
      Number(item.calories || 0),
      Number(item.protein || 0),
      Number(item.carbs || 0),
      Number(item.fat || 0)
    ]
  );

  return Number(result.rows[0].id);
}

async function updateSavedItem(userId, id, item) {
  const result = await pool.query(
    `UPDATE saved_items
     SET
       name = $1,
       quantity = $2,
       unit = $3,
       calories = $4,
       protein = $5,
       carbs = $6,
       fat = $7
     WHERE id = $8 AND user_id = $9 AND deleted_at IS NULL`,
    [
      item.name,
      Number(item.quantity || 1),
      item.unit || null,
      Number(item.calories || 0),
      Number(item.protein || 0),
      Number(item.carbs || 0),
      Number(item.fat || 0),
      id,
      userId
    ]
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
    `SELECT id, name, quantity, unit, calories, protein, carbs, fat, usage_count AS "usageCount"
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
    usageCount: Number(row.usageCount || 0)
  }));
}

async function quickAddFromSaved(userId, savedItemId, multiplier, consumedAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const savedResult = await client.query(
      `SELECT id, name, quantity, unit, calories, protein, carbs, fat
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
         consumed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        userId,
        entry.itemName,
        entry.quantity,
        entry.unit || null,
        entry.calories,
        entry.protein,
        entry.carbs,
        entry.fat,
        new Date(consumedAt)
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

async function getMacroTargets(userId) {
  const result = await pool.query(
    `SELECT macro, target
     FROM macro_targets
     WHERE user_id = $1`,
    [userId]
  );

  const defaults = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    workouts: 5,
    workout_calories: 0,
    sleep_hours: 8
  };

  for (const row of result.rows) {
    const macro = normalizeMacroName(row.macro);
    defaults[macro] = Number(row.target || 0);
  }

  return defaults;
}

async function setMacroTarget(userId, macro, target) {
  const normalizedMacro = normalizeMacroName(macro);
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
    `INSERT INTO macro_targets (user_id, macro, target, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, macro)
     DO UPDATE SET target = EXCLUDED.target, updated_at = NOW()`,
    [userId, normalizedMacro, normalizedTarget]
  );

  return { macro: normalizedMacro, target: normalizedTarget };
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
  const baseDate = normalizeDate(dateInput);
  const baseDay = toIsoDate(baseDate);
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);

  const dailyTotalsResult = await pool.query(
    `SELECT
       (consumed_at AT TIME ZONE $2)::date::text AS day,
       ROUND(SUM(calories)::numeric, 1) AS calories,
       ROUND(SUM(protein)::numeric, 1) AS protein,
       ROUND(SUM(carbs)::numeric, 1) AS carbs,
       ROUND(SUM(fat)::numeric, 1) AS fat
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
     GROUP BY day
     ORDER BY day DESC`,
    [userId, timezone]
  );

  const allDailyTotals = dailyTotalsResult.rows.map((row) => ({
    day: row.day,
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0)
  }));

  const currentDayTotals =
    allDailyTotals.find((row) => row.day === baseDay) ||
    { day: baseDay, calories: 0, protein: 0, carbs: 0, fat: 0 };

  const previousDays = allDailyTotals.filter((row) => row.day < baseDay).slice(0, 30);

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
       meal_unit AS "mealUnit"
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
    mealUnit: row.mealUnit || 'serving'
  }));

  const targets = await getMacroTargets(userId);

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
  const result = await pool.query(
    `SELECT
       (consumed_at AT TIME ZONE $3)::date::text AS day,
       ROUND(SUM(calories)::numeric, 1) AS calories,
       ROUND(SUM(protein)::numeric, 1) AS protein,
       ROUND(SUM(carbs)::numeric, 1) AS carbs,
       ROUND(SUM(fat)::numeric, 1) AS fat
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND consumed_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
     GROUP BY day
     ORDER BY day DESC`,
    [userId, String(days), timezone]
  );

  return result.rows.map((row) => ({
    day: row.day,
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0)
  }));
}

function parseScopeDays(scope) {
  if (scope === 'year') return 365;
  if (scope === 'month') return 30;
  return 7;
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

  await pool.query(
    `INSERT INTO weight_entries (user_id, weight, logged_at)
     VALUES ($1, $2, $3)`,
    [userId, weight, loggedAt]
  );
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

  const result = await pool.query(
    `UPDATE weight_entries
     SET weight = $3, logged_at = $4
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, weight, loggedAt]
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
  let query = `SELECT id, weight, logged_at AS "loggedAt"
     FROM weight_entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
     ORDER BY logged_at DESC, id DESC`;

  if (limit != null) {
    params.push(limit, offset);
    query += '\n     LIMIT $4 OFFSET $5';
  }

  const result = await pool.query(query, params);

  const entries = result.rows.map((row) => ({
    id: Number(row.id),
    weight: Number(row.weight || 0),
    loggedAt: new Date(row.loggedAt).toISOString()
  }));

  return {
    entries,
    pagination: limit == null ? undefined : { limit, offset, returned: entries.length }
  };
}

async function getWeightTarget(userId) {
  const result = await pool.query(
    `SELECT target_weight AS "targetWeight", target_date::text AS "targetDate"
     FROM weight_targets
     WHERE user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      targetWeight: null,
      targetDate: null
    };
  }

  return {
    targetWeight: Number(row.targetWeight || 0),
    targetDate: String(row.targetDate || '')
  };
}

function normalizeIsoDateInput(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('Target date must be in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Target date must be a valid date.');
  }
  return raw;
}

async function setWeightTarget(userId, payload) {
  const targetWeight = Number(payload?.targetWeight);
  if (!Number.isFinite(targetWeight) || targetWeight <= 0) {
    throw new Error('Target weight must be greater than 0.');
  }
  const normalizedTargetWeight = Number(targetWeight.toFixed(1));
  const targetDate = normalizeIsoDateInput(payload?.targetDate);

  await pool.query(
    `INSERT INTO weight_targets (user_id, target_weight, target_date, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id)
     DO UPDATE
       SET target_weight = EXCLUDED.target_weight,
           target_date = EXCLUDED.target_date,
           updated_at = NOW()`,
    [userId, normalizedTargetWeight, targetDate]
  );

  return {
    targetWeight: normalizedTargetWeight,
    targetDate
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

  await pool.query(
    `INSERT INTO workout_entries (user_id, description, intensity, duration_hours, calories_burned, logged_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, description, intensity, durationHours, caloriesBurned, loggedAt]
  );
}

async function updateWorkoutEntry(userId, id, payload) {
  const description = String(payload.description || '').trim();
  if (!description) {
    throw new Error('Workout description is required.');
  }
  const intensity = normalizeWorkoutIntensity(payload.intensity);
  const durationHours = Number(payload.durationHours);
  const caloriesBurned = Number(payload.caloriesBurned);
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
         logged_at = $7
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, description, intensity, durationHours, caloriesBurned, loggedAt]
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
    `SELECT id, description, intensity, duration_hours AS "durationHours", calories_burned AS "caloriesBurned", logged_at AS "loggedAt"
     FROM workout_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY logged_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const scopeDays = parseScopeDays(options.scope || 'week');
  const dailyResult = await pool.query(
    `SELECT (logged_at AT TIME ZONE $2)::date::text AS day,
            ROUND(SUM(calories_burned)::numeric, 1) AS calories
     FROM workout_entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND logged_at >= ((NOW() AT TIME ZONE $2)::date - ($3::text || ' days')::interval) AT TIME ZONE $2
     GROUP BY day
     ORDER BY day ASC`,
    [userId, timezone, String(scopeDays)]
  );

  return {
    entries: rowsResult.rows.map((row) => ({
      id: Number(row.id),
      description: row.description,
      intensity: normalizeWorkoutIntensity(row.intensity),
      durationHours: Number(row.durationHours || 0),
      caloriesBurned: Number(row.caloriesBurned || 0),
      loggedAt: new Date(row.loggedAt).toISOString()
    })),
    dailyCalories: dailyResult.rows.map((row) => ({
      day: row.day,
      calories: Number(row.calories || 0)
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

  await pool.query(
    `INSERT INTO sexual_activity_entries (user_id, type, logged_at)
     VALUES ($1, $2, $3)`,
    [userId, type, loggedAt]
  );
}

async function updateSexualActivityEntry(userId, id, payload) {
  const type = normalizeActivityType(payload.type);
  const loggedAt = new Date(payload.loggedAt || new Date().toISOString());
  if (Number.isNaN(loggedAt.getTime())) {
    throw new Error('Invalid loggedAt value.');
  }

  const result = await pool.query(
    `UPDATE sexual_activity_entries
     SET type = $3, logged_at = $4
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, type, loggedAt]
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
    `SELECT id, type, logged_at AS "loggedAt"
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
      loggedAt: new Date(row.loggedAt).toISOString()
    })),
    dailyTypes: dailyResult.rows.map((row) => ({
      day: row.day,
      types: row.types || []
    })),
    pagination: { limit, offset, returned: rowsResult.rows.length }
  };
}

// ── Sleep entries ──

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

  await pool.query(
    `INSERT INTO sleep_entries (user_id, duration_hours, wake_ups, logged_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, Number(durationHours.toFixed(2)), wakeUps, loggedAt]
  );
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

  const result = await pool.query(
    `UPDATE sleep_entries
     SET duration_hours = $3, wake_ups = $4, logged_at = $5
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [userId, id, Number(durationHours.toFixed(2)), wakeUps, loggedAt]
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
    `SELECT id, duration_hours AS "durationHours", wake_ups AS "wakeUps", logged_at AS "loggedAt"
     FROM sleep_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY logged_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const scopeDays = parseScopeDays(options.scope || 'week');
  const dailyResult = await pool.query(
    `SELECT (logged_at AT TIME ZONE $2)::date::text AS day,
            ROUND(SUM(duration_hours)::numeric, 2) AS total_hours
     FROM sleep_entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND logged_at >= ((NOW() AT TIME ZONE $2)::date - ($3::text || ' days')::interval) AT TIME ZONE $2
     GROUP BY day
     ORDER BY day ASC`,
    [userId, timezone, String(scopeDays)]
  );

  return {
    entries: rowsResult.rows.map((row) => ({
      id: Number(row.id),
      durationHours: Number(row.durationHours),
      wakeUps: Number(row.wakeUps || 0),
      loggedAt: new Date(row.loggedAt).toISOString()
    })),
    dailyTotals: dailyResult.rows.map((row) => ({
      day: row.day,
      totalHours: Number(row.total_hours)
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

  const [mealDailyResult, topMealsResult, mealTimingResult, workoutDailyResult, workoutTypesResult, weightsResult, sleepResult, targets, weightTarget, dataStartResult] =
    await Promise.all([
      pool.query(
        `SELECT
           (consumed_at AT TIME ZONE $3)::date::text AS day,
           COUNT(*)::integer AS item_count,
           ROUND(SUM(calories)::numeric, 1) AS calories,
           ROUND(SUM(protein)::numeric, 1) AS protein,
           ROUND(SUM(carbs)::numeric, 1) AS carbs,
           ROUND(SUM(fat)::numeric, 1) AS fat
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND consumed_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY day
         ORDER BY day ASC`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT
           MIN(item_name) AS item_name,
           COUNT(*)::integer AS times_logged,
           ROUND(SUM(calories)::numeric, 1) AS total_calories
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND consumed_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY lower(item_name)
         ORDER BY COUNT(*) DESC, SUM(calories) DESC
         LIMIT 12`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT
           COUNT(*)::integer AS total_entries,
           SUM(CASE WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE $3) >= 21 THEN 1 ELSE 0 END)::integer AS late_night_entries
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND consumed_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3`,
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
        `SELECT weight, logged_at AS "loggedAt"
         FROM weight_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         ORDER BY logged_at ASC`,
        [userId, daysParam, timezone]
      ),
      pool.query(
        `SELECT (logged_at AT TIME ZONE $3)::date::text AS day,
                ROUND(SUM(duration_hours)::numeric, 2) AS total_hours
         FROM sleep_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= ((NOW() AT TIME ZONE $3)::date - ($2::text || ' days')::interval) AT TIME ZONE $3
         GROUP BY day
         ORDER BY day ASC`,
        [userId, daysParam, timezone]
      ),
      getMacroTargets(userId),
      getWeightTarget(userId),
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
         ) timeline
         WHERE started_at IS NOT NULL`,
        [userId]
      )
    ]);

  const startedAtRaw = dataStartResult.rows[0]?.startedAt;
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : null;
  const elapsedDays = startedAt && Number.isFinite(startedAt.getTime())
    ? Math.max(1, Math.floor((Date.now() - startedAt.getTime()) / (24 * 60 * 60 * 1000)) + 1)
    : days;
  const effectivePeriodDays = Math.max(1, Math.min(days, elapsedDays));

  const weightEntries = weightsResult.rows.map((row) => ({
    weight: Number(row.weight || 0),
    loggedAt: new Date(row.loggedAt).toISOString()
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

  return {
    requestedPeriodDays: days,
    periodDays: effectivePeriodDays,
    trackingStartedAt: startedAt && Number.isFinite(startedAt.getTime()) ? startedAt.toISOString() : null,
    targets,
    meals: {
      dailyTotals: mealDailyResult.rows.map((row) => ({
        day: row.day,
        itemCount: Number(row.item_count || 0),
        calories: Number(row.calories || 0),
        protein: Number(row.protein || 0),
        carbs: Number(row.carbs || 0),
        fat: Number(row.fat || 0)
      })),
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
        caloriesBurned: Number(row.calories_burned || 0)
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
      target: {
        weight: targetWeightValue,
        date: targetDate,
        daysRemaining: Number.isFinite(targetDaysRemaining) ? targetDaysRemaining : null
      }
    },
    sleep: {
      dailyTotals: sleepResult.rows.map((row) => ({
        day: row.day,
        totalHours: Number(row.total_hours || 0)
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

// ── API tokens ──

async function createApiToken(userId, name) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

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
    `SELECT t.id, t.user_id, u.email, u.name, u.picture, u.provider,
            u.is_disabled AS "isDisabled",
            u.sexual_activity_enabled AS "sexualActivityEnabled",
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
    email: row.email,
    name: row.name,
    picture: row.picture,
    provider: row.provider,
    isDisabled: Boolean(row.isDisabled),
    sexualActivityEnabled: Boolean(row.sexualActivityEnabled),
    lastLoginAt: dateToIso(row.lastLoginAt),
    loginCount: Number(row.loginCount || 0),
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt)
  };
}

async function listApiTokens(userId) {
  const result = await pool.query(
    `SELECT id, name, created_at AS "createdAt", expires_at AS "expiresAt", last_used_at AS "lastUsedAt"
     FROM api_tokens
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null
  }));
}

async function deleteApiToken(userId, tokenId) {
  const result = await pool.query(
    'DELETE FROM api_tokens WHERE id = $1 AND user_id = $2',
    [tokenId, userId]
  );
  return result.rowCount || 0;
}

// ── GDPR ──

async function exportUserData(userId) {
  const [user, identities, entries, savedItems, macroTargets, weightEntries, workoutEntries, sexualActivityEntries, sleepEntries, weightTarget, analysisReports, usageCounts] =
    await Promise.all([
      pool.query('SELECT id, email, name, provider, created_at, updated_at FROM users WHERE id = $1', [userId]),
      pool.query('SELECT provider, provider_user_id, created_at, updated_at FROM user_identities WHERE user_id = $1 ORDER BY provider', [userId]),
      pool.query('SELECT id, item_name, quantity, unit, calories, protein, carbs, fat, consumed_at, meal_group, meal_name, meal_quantity, meal_unit, created_at FROM entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY consumed_at DESC', [userId]),
      pool.query('SELECT id, name, quantity, unit, calories, protein, carbs, fat, usage_count, created_at FROM saved_items WHERE user_id = $1 AND deleted_at IS NULL ORDER BY name', [userId]),
      pool.query('SELECT macro, target, updated_at FROM macro_targets WHERE user_id = $1', [userId]),
      pool.query('SELECT id, weight, logged_at, created_at FROM weight_entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY logged_at DESC', [userId]),
      pool.query('SELECT id, description, intensity, duration_hours, calories_burned, logged_at, created_at FROM workout_entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY logged_at DESC', [userId]),
      pool.query('SELECT id, type, logged_at, created_at FROM sexual_activity_entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY logged_at DESC', [userId]),
      pool.query('SELECT id, duration_hours, wake_ups, logged_at, created_at FROM sleep_entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY logged_at DESC', [userId]),
      getWeightTarget(userId),
      pool.query('SELECT id, period_days, report_json, created_at FROM analysis_reports WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [userId]),
      pool.query('SELECT feature, usage_date, count, updated_at FROM daily_usage_counts WHERE user_id = $1 ORDER BY usage_date DESC, feature', [userId])
    ]);

  return {
    exportedAt: new Date().toISOString(),
    user: user.rows[0] || null,
    identities: identities.rows,
    entries: entries.rows,
    savedItems: savedItems.rows,
    macroTargets: macroTargets.rows,
    weightEntries: weightEntries.rows,
    workoutEntries: workoutEntries.rows,
    sexualActivityEntries: sexualActivityEntries.rows,
    sleepEntries: sleepEntries.rows,
    weightTarget,
    analysisReports: analysisReports.rows,
    usageCounts: usageCounts.rows
  };
}

async function deleteUserAccount(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_identities WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM saved_items WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM macro_targets WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM weight_entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM workout_entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM sexual_activity_entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM sleep_entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM weight_targets WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM analysis_reports WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM daily_usage_counts WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM billing_events WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM audit_log WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (!result.rows.length) {
    return { plan: 'free', status: 'active', stripeCustomerId: null, stripeSubscriptionId: null };
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
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

async function upsertSubscription(userId, data) {
  await pool.query(
    `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at = NOW()`,
    [
      userId,
      data.stripeCustomerId || null,
      data.stripeSubscriptionId || null,
      data.plan || 'free',
      data.status || 'active',
      data.currentPeriodStart || null,
      data.currentPeriodEnd || null,
      Boolean(data.cancelAtPeriodEnd)
    ]
  );
}

async function getSubscriptionByStripeCustomerId(stripeCustomerId) {
  const result = await pool.query(
    'SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1',
    [stripeCustomerId]
  );
  return result.rows[0] || null;
}

async function saveBillingEvent(userId, stripeEventId, eventType, payload) {
  await pool.query(
    `INSERT INTO billing_events (user_id, stripe_event_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [userId, stripeEventId, eventType, JSON.stringify(payload)]
  );
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
  getProviderUserId,
  logAudit,
  addEntries,
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
  quickAddFromSaved,
  claimLegacyData,
  getDashboard,
  getDailyTotals,
  getMacroTargets,
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
  exportUserData,
  deleteUserAccount,
  getPlanLimits,
  getSubscription,
  upsertSubscription,
  getSubscriptionByStripeCustomerId,
  saveBillingEvent,
  consumeDailyUsage
};
