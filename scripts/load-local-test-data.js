#!/usr/bin/env node

require('dotenv').config();

const { initDb, getPool } = require('../src/db');

function assertSafeLocalDatabase() {
  const databaseUrl = String(process.env.DATABASE_URL || '');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const parsed = new URL(databaseUrl);
  const hostname = String(parsed.hostname || '').toLowerCase();
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

  if (process.env.NODE_ENV === 'production' || !isLocalHost) {
    throw new Error('Refusing to seed non-local or production databases.');
  }
}

function buildMealRows(userId) {
  const rows = [];
  const now = new Date();
  const baseMeals = [
    { name: 'Greek Yogurt Bowl', quantity: 1, unit: 'bowl', calories: 420, protein: 34, carbs: 42, fat: 11, hour: 8 },
    { name: 'Chicken Rice Bowl', quantity: 1, unit: 'plate', calories: 610, protein: 48, carbs: 58, fat: 18, hour: 13 },
    { name: 'Salmon Sweet Potato', quantity: 1, unit: 'plate', calories: 690, protein: 46, carbs: 44, fat: 26, hour: 19 }
  ];

  for (let dayOffset = 0; dayOffset < 21; dayOffset += 1) {
    for (const [mealIndex, meal] of baseMeals.entries()) {
      const consumedAt = new Date(now);
      consumedAt.setUTCDate(consumedAt.getUTCDate() - dayOffset);
      consumedAt.setUTCHours(meal.hour, mealIndex * 10, 0, 0);

      rows.push({
        userId,
        itemName: meal.name,
        quantity: meal.quantity,
        unit: meal.unit,
        calories: meal.calories - dayOffset * 3 + mealIndex * 15,
        protein: meal.protein + (dayOffset % 3),
        carbs: meal.carbs + mealIndex * 4,
        fat: meal.fat + (dayOffset % 2),
        consumedAt
      });
    }
  }

  return rows;
}

function buildWeightRows(userId) {
  const rows = [];
  const now = new Date();

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const loggedAt = new Date(now);
    loggedAt.setUTCDate(loggedAt.getUTCDate() - dayOffset);
    loggedAt.setUTCHours(7, 15, 0, 0);

    rows.push({
      userId,
      weight: Number((186.4 - dayOffset * 0.28).toFixed(1)),
      loggedAt
    });
  }

  return rows;
}

function buildWorkoutRows(userId) {
  const rows = [];
  const now = new Date();
  const workouts = [
    ['Upper Body Lift', 'high', 1.2, 510],
    ['Zone 2 Bike Ride', 'medium', 0.8, 340],
    ['Leg Day', 'high', 1.1, 560],
    ['Incline Walk', 'low', 0.7, 210],
    ['Tempo Run', 'high', 0.9, 470],
    ['Pull Session', 'medium', 1.0, 430]
  ];

  for (let index = 0; index < workouts.length; index += 1) {
    const [description, intensity, durationHours, caloriesBurned] = workouts[index];
    const loggedAt = new Date(now);
    loggedAt.setUTCDate(loggedAt.getUTCDate() - index * 2);
    loggedAt.setUTCHours(18, 0, 0, 0);

    rows.push({
      userId,
      description,
      intensity,
      durationHours,
      caloriesBurned,
      loggedAt
    });
  }

  return rows;
}

function buildSavedItems(userId) {
  return [
    ['Protein Oats', 1, 'bowl', 390, 30, 44, 10, 12],
    ['Turkey Wrap', 1, 'wrap', 520, 38, 36, 18, 9],
    ['Cottage Cheese + Fruit', 1, 'bowl', 260, 24, 21, 7, 7],
    ['Whey Shake', 1, 'shake', 170, 32, 6, 2, 18]
  ].map(([name, quantity, unit, calories, protein, carbs, fat, usageCount]) => ({
    userId,
    name,
    quantity,
    unit,
    calories,
    protein,
    carbs,
    fat,
    usageCount
  }));
}

async function seed() {
  assertSafeLocalDatabase();
  await initDb();

  const pool = getPool();
  const userId = String(process.env.LOCAL_DEV_USER_ID || 'local-dev-user');
  const userName = String(process.env.LOCAL_DEV_USER_NAME || 'Local Preview User');
  const mealRows = buildMealRows(userId);
  const weightRows = buildWeightRows(userId);
  const workoutRows = buildWorkoutRows(userId);
  const savedItems = buildSavedItems(userId);

  try {
    await pool.query('BEGIN');

    await pool.query('DELETE FROM analysis_reports WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM workout_entries WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM weight_entries WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM entries WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM saved_items WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM macro_targets WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM weight_targets WHERE user_id = $1', [userId]);

    for (const row of mealRows) {
      await pool.query(
        `INSERT INTO entries (
          user_id, item_name, quantity, unit, calories, protein, carbs, fat, consumed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.userId, row.itemName, row.quantity, row.unit, row.calories, row.protein, row.carbs, row.fat, row.consumedAt]
      );
    }

    for (const row of savedItems) {
      await pool.query(
        `INSERT INTO saved_items (
          user_id, name, quantity, unit, calories, protein, carbs, fat, usage_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.userId, row.name, row.quantity, row.unit, row.calories, row.protein, row.carbs, row.fat, row.usageCount]
      );
    }

    for (const macroTarget of [
      ['calories', 2350],
      ['protein', 210],
      ['carbs', 215],
      ['fat', 72],
      ['workouts', 5]
    ]) {
      await pool.query(
        `INSERT INTO macro_targets (user_id, macro, target)
         VALUES ($1, $2, $3)`,
        [userId, macroTarget[0], macroTarget[1]]
      );
    }

    await pool.query(
      `INSERT INTO weight_targets (user_id, target_weight, target_date)
       VALUES ($1, $2, CURRENT_DATE + 56)`,
      [userId, 178]
    );

    for (const row of weightRows) {
      await pool.query(
        `INSERT INTO weight_entries (user_id, weight, logged_at)
         VALUES ($1, $2, $3)`,
        [row.userId, row.weight, row.loggedAt]
      );
    }

    for (const row of workoutRows) {
      await pool.query(
        `INSERT INTO workout_entries (
          user_id, description, intensity, duration_hours, calories_burned, logged_at
        ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.userId, row.description, row.intensity, row.durationHours, row.caloriesBurned, row.loggedAt]
      );
    }

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }

  console.log(
    `Loaded local test data for ${userName} (${userId}): ${mealRows.length} meals, ${savedItems.length} saved items, ${weightRows.length} weigh-ins, ${workoutRows.length} workouts.`
  );
}

seed().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
