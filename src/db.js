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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  // ── Migrations for existing databases ──
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_user_consumed ON entries(user_id, consumed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_items_user_name ON saved_items(user_id, lower(name));
    CREATE INDEX IF NOT EXISTS idx_macro_targets_user ON macro_targets(user_id);
    CREATE INDEX IF NOT EXISTS idx_weight_entries_user_logged ON weight_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workout_entries_user_logged ON workout_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_user_created ON analysis_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_billing_events_stripe ON billing_events(stripe_event_id);
  `);
}

// ── Users ──

async function upsertUser(user) {
  await pool.query(
    `INSERT INTO users (id, email, name, picture, provider, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           picture = EXCLUDED.picture,
           updated_at = NOW()`,
    [user.id, user.email || null, user.name || null, user.picture || null, user.provider || 'google']
  );
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
  if (!['calories', 'protein', 'carbs', 'fat', 'workouts', 'workout_calories'].includes(value)) {
    throw new Error('Invalid macro. Use calories, protein, carbs, fat, workouts, or workout_calories.');
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
  if (!entry.rows[0].meal_group) throw new Error('Entry is not part of a meal.');

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
    workout_calories: 0
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
  const baseDate = normalizeDate(dateInput);
  const baseDay = toIsoDate(baseDate);
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);

  const dailyTotalsResult = await pool.query(
    `SELECT
       (consumed_at AT TIME ZONE 'UTC')::date::text AS day,
       ROUND(SUM(calories)::numeric, 1) AS calories,
       ROUND(SUM(protein)::numeric, 1) AS protein,
       ROUND(SUM(carbs)::numeric, 1) AS carbs,
       ROUND(SUM(fat)::numeric, 1) AS fat
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
     GROUP BY day
     ORDER BY day DESC`,
    [userId]
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
       (consumed_at AT TIME ZONE 'UTC')::date::text AS day,
       SUM(calories) AS calories,
       SUM(protein) AS protein,
       SUM(carbs) AS carbs,
       SUM(fat) AS fat
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND (consumed_at AT TIME ZONE 'UTC')::date::text >= $2
       AND (consumed_at AT TIME ZONE 'UTC')::date::text < $3
     GROUP BY day`,
    [userId, toIsoDate(sevenDayStart), baseDay]
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
       (consumed_at AT TIME ZONE 'UTC')::date::text AS day,
       meal_group AS "mealGroup",
       meal_name AS "mealName",
       meal_quantity AS "mealQuantity",
       meal_unit AS "mealUnit"
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY consumed_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
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



async function getDailyTotals(userId, scope = 'week') {
  const days = parseScopeDays(scope);
  const result = await pool.query(
    `SELECT
       (consumed_at AT TIME ZONE 'UTC')::date::text AS day,
       ROUND(SUM(calories)::numeric, 1) AS calories,
       ROUND(SUM(protein)::numeric, 1) AS protein,
       ROUND(SUM(carbs)::numeric, 1) AS carbs,
       ROUND(SUM(fat)::numeric, 1) AS fat
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND consumed_at >= NOW() - ($2::text || ' days')::interval
     GROUP BY day
     ORDER BY day DESC`,
    [userId, String(days)]
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

async function listWeightEntries(userId, scope = 'week') {
  const days = parseScopeDays(scope);
  const result = await pool.query(
    `SELECT id, weight, logged_at AS "loggedAt"
     FROM weight_entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND logged_at >= NOW() - ($2::text || ' days')::interval
     ORDER BY logged_at DESC`,
    [userId, String(days)]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    weight: Number(row.weight || 0),
    loggedAt: new Date(row.loggedAt).toISOString()
  }));
}

async function getWeightTarget(userId) {
  const result = await pool.query(
    `SELECT target_weight AS "targetWeight", target_date AS "targetDate"
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

async function listWorkoutEntries(userId, options = {}) {
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 500);
  const offset = Math.max(0, Number(options.offset) || 0);

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
    `SELECT (logged_at AT TIME ZONE 'UTC')::date::text AS day,
            ROUND(SUM(calories_burned)::numeric, 1) AS calories
     FROM workout_entries
     WHERE user_id = $1 AND deleted_at IS NULL
       AND logged_at >= NOW() - INTERVAL '${scopeDays} days'
     GROUP BY day
     ORDER BY day ASC`,
    [userId]
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

function normalizeAnalysisDays(daysInput) {
  const parsed = Number(daysInput);
  if (!Number.isFinite(parsed)) {
    return 90;
  }
  return Math.max(14, Math.min(180, Math.round(parsed)));
}

async function getAnalysisSnapshot(userId, daysInput = 90) {
  const days = normalizeAnalysisDays(daysInput);
  const daysParam = String(days);

  const [mealDailyResult, topMealsResult, mealTimingResult, workoutDailyResult, workoutTypesResult, weightsResult, targets, weightTarget, dataStartResult] =
    await Promise.all([
      pool.query(
        `SELECT
           (consumed_at AT TIME ZONE 'UTC')::date::text AS day,
           COUNT(*)::integer AS item_count,
           ROUND(SUM(calories)::numeric, 1) AS calories,
           ROUND(SUM(protein)::numeric, 1) AS protein,
           ROUND(SUM(carbs)::numeric, 1) AS carbs,
           ROUND(SUM(fat)::numeric, 1) AS fat
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND consumed_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY day
         ORDER BY day ASC`,
        [userId, daysParam]
      ),
      pool.query(
        `SELECT
           MIN(item_name) AS item_name,
           COUNT(*)::integer AS times_logged,
           ROUND(SUM(calories)::numeric, 1) AS total_calories
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND consumed_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY lower(item_name)
         ORDER BY COUNT(*) DESC, SUM(calories) DESC
         LIMIT 12`,
        [userId, daysParam]
      ),
      pool.query(
        `SELECT
           COUNT(*)::integer AS total_entries,
           SUM(CASE WHEN EXTRACT(HOUR FROM consumed_at AT TIME ZONE 'UTC') >= 21 THEN 1 ELSE 0 END)::integer AS late_night_entries
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND consumed_at >= NOW() - ($2::text || ' days')::interval`,
        [userId, daysParam]
      ),
      pool.query(
        `SELECT
           (logged_at AT TIME ZONE 'UTC')::date::text AS day,
           COUNT(*)::integer AS sessions,
           ROUND(SUM(duration_hours)::numeric, 2) AS duration_hours,
           ROUND(SUM(calories_burned)::numeric, 1) AS calories_burned
         FROM workout_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY day
         ORDER BY day ASC`,
        [userId, daysParam]
      ),
      pool.query(
        `SELECT
           MIN(description) AS description,
           COUNT(*)::integer AS sessions,
           ROUND(SUM(duration_hours)::numeric, 2) AS duration_hours
         FROM workout_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY lower(description)
         ORDER BY COUNT(*) DESC, SUM(duration_hours) DESC
         LIMIT 10`,
        [userId, daysParam]
      ),
      pool.query(
        `SELECT weight, logged_at AS "loggedAt"
         FROM weight_entries
         WHERE user_id = $1 AND deleted_at IS NULL
           AND logged_at >= NOW() - ($2::text || ' days')::interval
         ORDER BY logged_at ASC`,
        [userId, daysParam]
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
    `SELECT t.id, t.user_id, u.email, u.name, u.picture, u.provider
     FROM api_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1
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
    provider: row.provider
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
  const [user, entries, savedItems, macroTargets, weightEntries, workoutEntries, weightTarget, analysisReports] =
    await Promise.all([
      pool.query('SELECT id, email, name, provider, created_at, updated_at FROM users WHERE id = $1', [userId]),
      pool.query('SELECT id, item_name, quantity, unit, calories, protein, carbs, fat, consumed_at, meal_group, meal_name, meal_quantity, meal_unit, created_at FROM entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY consumed_at DESC', [userId]),
      pool.query('SELECT id, name, quantity, unit, calories, protein, carbs, fat, usage_count, created_at FROM saved_items WHERE user_id = $1 AND deleted_at IS NULL ORDER BY name', [userId]),
      pool.query('SELECT macro, target, updated_at FROM macro_targets WHERE user_id = $1', [userId]),
      pool.query('SELECT id, weight, logged_at, created_at FROM weight_entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY logged_at DESC', [userId]),
      pool.query('SELECT id, description, intensity, duration_hours, calories_burned, logged_at, created_at FROM workout_entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY logged_at DESC', [userId]),
      getWeightTarget(userId),
      pool.query('SELECT id, period_days, report_json, created_at FROM analysis_reports WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [userId])
    ]);

  return {
    exportedAt: new Date().toISOString(),
    user: user.rows[0] || null,
    entries: entries.rows,
    savedItems: savedItems.rows,
    macroTargets: macroTargets.rows,
    weightEntries: weightEntries.rows,
    workoutEntries: workoutEntries.rows,
    weightTarget,
    analysisReports: analysisReports.rows
  };
}

async function deleteUserAccount(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM saved_items WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM macro_targets WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM weight_entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM workout_entries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM weight_targets WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM analysis_reports WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
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
  free: { dailyParses: 5, analysisPerDay: 1 },
  pro: { dailyParses: 100, analysisPerDay: 10 }
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

module.exports = {
  initDb,
  getPool,
  checkDatabaseHealth,
  upsertUser,
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
  listWorkoutEntries,
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
  saveBillingEvent
};
