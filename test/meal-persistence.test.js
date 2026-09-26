const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('meal writes are atomic under failures and concurrent edits', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const db = require('../src/db');
  const pool = db.getPool();
  const userId = `meal-regression-${crypto.randomUUID()}`;
  t.after(async () => {
    try { await db.deleteUserAccount(userId); }
    finally {
      await pool.end();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });
  await db.initDb();
  await db.upsertUser({ id: userId, provider: 'local-dev', providerUserId: userId,
    email: `${userId}@example.test`, name: 'Meal regression' });
  const entry = { itemName: 'Atomic meal', quantity: 1, unit: 'serving', calories: 100,
    protein: 10, carbs: 10, fat: 2, consumedAt: new Date().toISOString() };

  await t.test('a failed Quick Add rolls back the meal and all earlier Quick Adds', async () => {
    await assert.rejects(db.addEntries(userId, [entry], [
      { name: 'Valid Quick Add', quantity: 1 },
      { name: null, quantity: 1 }
    ]), /null value.*name/i);
    const rows = await pool.query('SELECT id FROM entries WHERE user_id=$1', [userId]);
    assert.equal(rows.rowCount, 0);
    assert.deepEqual(await db.listSavedItems(userId), []);

    const savedIds = await db.addEntries(userId, [entry], [{ name: 'Saved Quick Add', quantity: 1 }]);
    assert.deepEqual((await db.listSavedItems(userId)).map(item => item.id), savedIds);
    assert.equal(savedIds.length, 1);
    assert.equal((await pool.query('SELECT id FROM entries WHERE user_id=$1', [userId])).rowCount, 1);
  });

  await t.test('overlapping combine requests cannot steal another meal\'s children', async () => {
    await db.addEntries(userId, [entry, entry, entry].map(row => ({ ...row, itemName: 'Combine fixture' })));
    const { rows } = await pool.query('SELECT id FROM entries WHERE user_id=$1 AND item_name=$2 ORDER BY id', [userId, 'Combine fixture']);
    const ids = rows.map(row => Number(row.id));
    const blocker = await pool.connect();
    let pending;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM entries WHERE id=ANY($1::bigint[]) FOR UPDATE', [ids]);
      pending = Promise.allSettled([
        db.combineEntries(userId, ids.slice(0, 2), 'First meal', 1, 'serving'),
        db.combineEntries(userId, ids.slice(1), 'Second meal', 1, 'serving')
      ]);
      // Release both requests only once they reach their row lock. This reproduces
      // validation races without depending on a lucky Promise scheduling order.
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (waiting < 2 && Date.now() < deadline) {
        const result = await pool.query(`SELECT COUNT(*)::int AS count FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%meal_group%'`);
        waiting = result.rows[0].count;
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, 2, 'both combine requests must be waiting before releasing the lock');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (pending) await pending;
    }
    const results = await pending;
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /already part of a meal/);
    const grouped = await pool.query('SELECT meal_group FROM entries WHERE id=ANY($1::bigint[]) AND meal_group IS NOT NULL', [ids]);
    assert.equal(grouped.rowCount, 2);
    assert.equal(new Set(grouped.rows.map(row => row.meal_group)).size, 1);
  });
});
