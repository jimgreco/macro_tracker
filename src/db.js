const fs = require('fs');
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE workout_entries
      ADD COLUMN IF NOT EXISTS intensity TEXT NOT NULL DEFAULT 'medium';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_user_consumed ON entries(user_id, consumed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_items_user_name ON saved_items(user_id, lower(name));
    CREATE INDEX IF NOT EXISTS idx_macro_targets_user ON macro_targets(user_id);
    CREATE INDEX IF NOT EXISTS idx_weight_entries_user_logged ON weight_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workout_entries_user_logged ON workout_entries(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_user_created ON analysis_reports(user_id, created_at DESC);
  `);
}

function normalizeMacroName(macro) {
  const value = String(macro || '').toLowerCase();
  if (!['calories', 'protein', 'carbs', 'fat', 'workouts'].includes(value)) {
    throw new Error('Invalid macro. Use calories, protein, carbs, fat, or workouts.');
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
        consumed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
        new Date(row.consumedAt)
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
     WHERE id = $9 AND user_id = $10`,
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
  const result = await pool.query('DELETE FROM entries WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rowCount || 0;
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
     WHERE id = $8 AND user_id = $9`,
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
  const result = await pool.query('DELETE FROM saved_items WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rowCount || 0;
}

async function listSavedItems(userId) {
  const result = await pool.query(
    `SELECT id, name, quantity, unit, calories, protein, carbs, fat, usage_count AS "usageCount"
     FROM saved_items
     WHERE user_id = $1
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
       WHERE id = $1 AND user_id = $2
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
    workouts: 5
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

async function getDashboard(userId, dateInput) {
  const baseDate = normalizeDate(dateInput);
  const baseDay = toIsoDate(baseDate);

  const dailyTotalsResult = await pool.query(
    `SELECT
       (consumed_at AT TIME ZONE 'UTC')::date::text AS day,
       ROUND(SUM(calories)::numeric, 1) AS calories,
       ROUND(SUM(protein)::numeric, 1) AS protein,
       ROUND(SUM(carbs)::numeric, 1) AS carbs,
       ROUND(SUM(fat)::numeric, 1) AS fat
     FROM entries
     WHERE user_id = $1
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
     WHERE user_id = $1
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
       (consumed_at AT TIME ZONE 'UTC')::date::text AS day
     FROM entries
     WHERE user_id = $1
     ORDER BY consumed_at DESC, id DESC`,
    [userId]
  );

  const entries = entriesResult.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    quantity: Number(row.quantity || 0),
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    consumedAt: new Date(row.consumedAt).toISOString()
  }));

  const targets = await getMacroTargets(userId);

  return {
    currentDayTotals,
    previousDays,
    sevenDayAverage,
    entries,
    targets
  };
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
     WHERE user_id = $1 AND id = $2`,
    [userId, id, weight, loggedAt]
  );

  return result.rowCount;
}

async function deleteWeightEntry(userId, id) {
  const result = await pool.query(
    `DELETE FROM weight_entries
     WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );

  return result.rowCount;
}

async function listWeightEntries(userId, scope = 'week') {
  const days = parseScopeDays(scope);
  const result = await pool.query(
    `SELECT id, weight, logged_at AS "loggedAt"
     FROM weight_entries
     WHERE user_id = $1
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
     WHERE user_id = $1 AND id = $2`,
    [userId, id, description, intensity, durationHours, caloriesBurned, loggedAt]
  );

  return result.rowCount;
}

async function listWorkoutEntries(userId) {
  const rowsResult = await pool.query(
    `SELECT id, description, intensity, duration_hours AS "durationHours", calories_burned AS "caloriesBurned", logged_at AS "loggedAt"
     FROM workout_entries
     WHERE user_id = $1
     ORDER BY logged_at DESC, id DESC
     LIMIT 100`,
    [userId]
  );

  const dailyResult = await pool.query(
    `SELECT (logged_at AT TIME ZONE 'UTC')::date::text AS day,
            ROUND(SUM(calories_burned)::numeric, 1) AS calories
     FROM workout_entries
     WHERE user_id = $1
       AND logged_at >= NOW() - INTERVAL '30 days'
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
    }))
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
         WHERE user_id = $1
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
         WHERE user_id = $1
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
         WHERE user_id = $1
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
         WHERE user_id = $1
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
         WHERE user_id = $1
           AND logged_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY lower(description)
         ORDER BY COUNT(*) DESC, SUM(duration_hours) DESC
         LIMIT 10`,
        [userId, daysParam]
      ),
      pool.query(
        `SELECT weight, logged_at AS "loggedAt"
         FROM weight_entries
         WHERE user_id = $1
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
           WHERE user_id = $1
           UNION ALL
           SELECT MIN(logged_at) AS started_at
           FROM workout_entries
           WHERE user_id = $1
           UNION ALL
           SELECT MIN(logged_at) AS started_at
           FROM weight_entries
           WHERE user_id = $1
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
  const targetWeight = Number.isFinite(normalizedTargetWeight) && normalizedTargetWeight > 0 ? normalizedTargetWeight : null;
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
        weight: targetWeight,
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
     WHERE user_id = $1
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

module.exports = {
  initDb,
  getPool,
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
  getLatestAnalysisReport
};
