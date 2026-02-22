const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(process.cwd(), 'data', 'macros.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

function columnExists(tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((col) => col.name === columnName);
}

function migrateEntriesUserColumn() {
  if (columnExists('entries', 'user_id')) {
    return;
  }

  db.exec(`
    BEGIN TRANSACTION;

    CREATE TABLE entries_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      consumed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO entries_new (
      id,
      user_id,
      item_name,
      quantity,
      unit,
      calories,
      protein,
      carbs,
      fat,
      consumed_at,
      created_at
    )
    SELECT
      id,
      'legacy-local-user',
      item_name,
      quantity,
      unit,
      calories,
      protein,
      carbs,
      fat,
      consumed_at,
      created_at
    FROM entries;

    DROP TABLE entries;
    ALTER TABLE entries_new RENAME TO entries;

    COMMIT;
  `);
}

function migrateSavedItemsUsageCount() {
  if (columnExists('saved_items', 'usage_count')) {
    return;
  }

  db.exec(`ALTER TABLE saved_items ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0`);
}

function migrateSavedItemsUserColumn() {
  if (columnExists('saved_items', 'user_id')) {
    return;
  }

  db.exec(`
    BEGIN TRANSACTION;

    CREATE TABLE saved_items_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO saved_items_new (
      id,
      user_id,
      name,
      quantity,
      unit,
      calories,
      protein,
      carbs,
      fat,
      created_at
    )
    SELECT
      id,
      'legacy-local-user',
      name,
      quantity,
      unit,
      calories,
      protein,
      carbs,
      fat,
      created_at
    FROM saved_items;

    DROP TABLE saved_items;
    ALTER TABLE saved_items_new RENAME TO saved_items;

    COMMIT;
  `);
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      consumed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const hasMealNameColumn = db
    .prepare(`PRAGMA table_info(entries)`)
    .all()
    .some((col) => col.name === 'meal_name');

  if (hasMealNameColumn) {
    db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE entries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT,
        calories REAL NOT NULL,
        protein REAL NOT NULL,
        carbs REAL NOT NULL,
        fat REAL NOT NULL,
        consumed_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO entries_new (
        id,
        user_id,
        item_name,
        quantity,
        unit,
        calories,
        protein,
        carbs,
        fat,
        consumed_at,
        created_at
      )
      SELECT
        id,
        'legacy-local-user',
        item_name,
        quantity,
        unit,
        calories,
        protein,
        carbs,
        fat,
        consumed_at,
        created_at
      FROM entries;

      DROP TABLE entries;
      ALTER TABLE entries_new RENAME TO entries;

      COMMIT;
    `);
  }

  migrateEntriesUserColumn();
  migrateSavedItemsUserColumn();
  migrateSavedItemsUsageCount();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_entries_user_consumed ON entries(user_id, consumed_at);
    CREATE INDEX IF NOT EXISTS idx_saved_items_user_name ON saved_items(user_id, name);
  `);
}

function addEntries(userId, entries) {
  const stmt = db.prepare(`
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
    ) VALUES (
      @userId,
      @itemName,
      @quantity,
      @unit,
      @calories,
      @protein,
      @carbs,
      @fat,
      @consumedAt
    )
  `);

  const transaction = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run({ userId, ...row });
    }
  });

  transaction(entries);
}

function updateEntry(userId, id, entry) {
  const stmt = db.prepare(`
    UPDATE entries
    SET
      item_name = @itemName,
      quantity = @quantity,
      unit = @unit,
      calories = @calories,
      protein = @protein,
      carbs = @carbs,
      fat = @fat,
      consumed_at = @consumedAt
    WHERE id = @id
      AND user_id = @userId
  `);

  const result = stmt.run({ id, userId, ...entry });
  return result.changes;
}

function deleteEntry(userId, id) {
  const stmt = db.prepare(`DELETE FROM entries WHERE id = ? AND user_id = ?`);
  const result = stmt.run(id, userId);
  return result.changes;
}

function addSavedItem(userId, item) {
  const stmt = db.prepare(`
    INSERT INTO saved_items (user_id, name, quantity, unit, calories, protein, carbs, fat)
    VALUES (@userId, @name, @quantity, @unit, @calories, @protein, @carbs, @fat)
  `);

  const result = stmt.run({ userId, ...item });
  return result.lastInsertRowid;
}

function updateSavedItem(userId, id, item) {
  const stmt = db.prepare(`
    UPDATE saved_items
    SET
      name = @name,
      quantity = @quantity,
      unit = @unit,
      calories = @calories,
      protein = @protein,
      carbs = @carbs,
      fat = @fat
    WHERE id = @id
      AND user_id = @userId
  `);

  const result = stmt.run({ userId, id, ...item });
  return result.changes;
}

function deleteSavedItem(userId, id) {
  const stmt = db.prepare(`DELETE FROM saved_items WHERE id = ? AND user_id = ?`);
  const result = stmt.run(id, userId);
  return result.changes;
}

function listSavedItems(userId) {
  return db
    .prepare(
      `SELECT id, name, quantity, unit, calories, protein, carbs, fat, usage_count AS usageCount
       FROM saved_items
       WHERE user_id = ?
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all(userId);
}

function quickAddFromSaved(userId, savedItemId, multiplier, consumedAt) {
  const saved = db
    .prepare(
      `SELECT id, name, quantity, unit, calories, protein, carbs, fat
       FROM saved_items
       WHERE id = ?
         AND user_id = ?`
    )
    .get(savedItemId, userId);

  if (!saved) {
    return null;
  }

  db.prepare(
    `UPDATE saved_items
     SET usage_count = usage_count + 1
     WHERE id = ?
       AND user_id = ?`
  ).run(savedItemId, userId);

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

  addEntries(userId, [entry]);
  return entry;
}

function claimLegacyData(userId) {
  const updateEntries = db.prepare(`
    UPDATE entries
    SET user_id = @userId
    WHERE user_id = 'legacy-local-user'
  `);
  const updateSavedItems = db.prepare(`
    UPDATE saved_items
    SET user_id = @userId
    WHERE user_id = 'legacy-local-user'
  `);

  const runClaim = db.transaction(() => {
    const entriesResult = updateEntries.run({ userId });
    const savedItemsResult = updateSavedItems.run({ userId });
    return {
      claimedEntries: entriesResult.changes,
      claimedSavedItems: savedItemsResult.changes
    };
  });

  return runClaim();
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

function getDashboard(userId, dateInput) {
  const baseDate = normalizeDate(dateInput);
  const baseDay = toIsoDate(baseDate);

  const dailyTotalsStmt = db.prepare(`
    SELECT
      substr(consumed_at, 1, 10) AS day,
      ROUND(SUM(calories), 1) AS calories,
      ROUND(SUM(protein), 1) AS protein,
      ROUND(SUM(carbs), 1) AS carbs,
      ROUND(SUM(fat), 1) AS fat
    FROM entries
    WHERE user_id = ?
    GROUP BY day
    ORDER BY day DESC
  `);

  const allDailyTotals = dailyTotalsStmt.all(userId);
  const currentDayTotals =
    allDailyTotals.find((row) => row.day === baseDay) ||
    { day: baseDay, calories: 0, protein: 0, carbs: 0, fat: 0 };

  const previousDays = allDailyTotals.filter((row) => row.day < baseDay).slice(0, 30);

  const sevenDayStart = new Date(baseDate);
  sevenDayStart.setDate(sevenDayStart.getDate() - 7);

  const sevenDayRows = db
    .prepare(
      `SELECT
         substr(consumed_at, 1, 10) AS day,
         SUM(calories) AS calories,
         SUM(protein) AS protein,
         SUM(carbs) AS carbs,
         SUM(fat) AS fat
       FROM entries
       WHERE user_id = ?
         AND substr(consumed_at, 1, 10) >= ?
         AND substr(consumed_at, 1, 10) < ?
       GROUP BY day`
    )
    .all(userId, toIsoDate(sevenDayStart), baseDay);

  const totals = sevenDayRows.reduce(
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
    daysWithData: sevenDayRows.length,
    calories: Number((totals.calories / 7).toFixed(1)),
    protein: Number((totals.protein / 7).toFixed(1)),
    carbs: Number((totals.carbs / 7).toFixed(1)),
    fat: Number((totals.fat / 7).toFixed(1))
  };

  const entries = db
    .prepare(
      `SELECT
         id,
         item_name AS itemName,
         quantity,
         unit,
         calories,
         protein,
         carbs,
         fat,
         consumed_at AS consumedAt,
         substr(consumed_at, 1, 10) AS day
       FROM entries
       WHERE user_id = ?
       ORDER BY consumed_at DESC, id DESC`
    )
    .all(userId);

  return {
    currentDayTotals,
    previousDays,
    sevenDayAverage,
    entries
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
  getDashboard
};
