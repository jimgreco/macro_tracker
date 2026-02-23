const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/macro_tracker';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Postgres.');
}

const useSsl =
  process.env.PGSSL === 'true' ||
  process.env.NODE_ENV === 'production' ||
  databaseUrl.includes('rds.amazonaws.com');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10)
});

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
    CREATE INDEX IF NOT EXISTS idx_entries_user_consumed ON entries(user_id, consumed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_items_user_name ON saved_items(user_id, lower(name));
    CREATE INDEX IF NOT EXISTS idx_macro_targets_user ON macro_targets(user_id);
  `);
}

function normalizeMacroName(macro) {
  const value = String(macro || '').toLowerCase();
  if (!['calories', 'protein', 'carbs', 'fat'].includes(value)) {
    throw new Error('Invalid macro. Use calories, protein, carbs, or fat.');
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
    fat: 0
  };

  for (const row of result.rows) {
    const macro = normalizeMacroName(row.macro);
    defaults[macro] = Number(row.target || 0);
  }

  return defaults;
}

async function setMacroTarget(userId, macro, target) {
  const normalizedMacro = normalizeMacroName(macro);
  const normalizedTarget = Number(target);
  if (!Number.isFinite(normalizedTarget) || normalizedTarget < 0) {
    throw new Error('Target must be a number greater than or equal to 0.');
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

module.exports = {
  initDb,
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
  setMacroTarget
};
