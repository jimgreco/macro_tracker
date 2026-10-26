const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('dated meal copies preserve quantities, unknown fiber, local time and atomic replay', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use a disposable loopback test database');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const db = require('../src/db');
  const userId = `copy-date-${crypto.randomUUID()}`;
  try {
    await require('./helpers/database').initializeTestSchema(db);
    await db.upsertUser({ id: userId, provider: 'local-dev', providerUserId: userId, email: `${userId}@example.test`, name: 'Synthetic copy test', timezone: 'America/New_York' });
    const group = crypto.randomUUID();
    await db.addEntries(userId, [
      { itemName: 'Unknown fiber', quantity: 2, unit: 'bowl', calories: 400, protein: 20, carbs: 50, fat: 10, fiber: null, consumedAt: '2026-03-07T14:15:00Z', mealGroup: group, mealName: 'Breakfast', mealQuantity: 2, mealUnit: 'meal' },
      { itemName: 'Known fiber', quantity: 1.5, unit: 'cup', calories: 100, protein: 2, carbs: 20, fat: 1, fiber: 3, consumedAt: '2026-03-07T14:15:00Z', mealGroup: group, mealName: 'Breakfast', mealQuantity: 2, mealUnit: 'meal' },
    ]);
    const mutationId = crypto.randomUUID();
    const descriptor = { method: 'POST', path: '/entries/copy-to-today', requestHash: crypto.createHash('sha256').update(group).digest('hex') };
    const execute = async () => ({ status: 200, body: await db.copyEntriesToLocalDay(userId, { mealGroup: group, targetDay: '2026-03-09', timezone: 'America/New_York' }) });
    const results = await Promise.all([db.runClientMutation(userId, mutationId, descriptor, execute), db.runClientMutation(userId, mutationId, descriptor, execute)]);
    assert.ok(results.some(result => result.disposition === 'replay'));
    const data = await db.getDashboard(userId, '2026-03-09', { timezone: 'America/New_York', entriesDay: '2026-03-09' });
    const copied = data.entries.filter(entry => entry.sourceDetail === `copied_from_meal:${group}`);
    assert.equal(copied.length, 2);
    assert.equal(new Set(copied.map(entry => entry.mealGroup)).size, 1);
    assert.notEqual(copied[0].mealGroup, group);
    assert.deepEqual(copied.map(entry => [entry.itemName, Number(entry.quantity), entry.fiber]).sort(), [['Known fiber', 1.5, 3], ['Unknown fiber', 2, null]]);
    assert.ok(copied.every(entry => new Date(entry.consumedAt).toISOString() === '2026-03-09T13:15:00.000Z'));
    assert.ok(copied.every(entry => Number(entry.mealQuantity) === 2 && entry.mealUnit === 'meal'));
    assert.equal((await db.getNutritionDayCompleteness(userId, '2026-03-09', 'America/New_York')).state, 'unknown');
    await assert.rejects(db.copyEntriesToLocalDay(userId, { mealGroup: group, targetDay: '2026-03-07' }), /after the source day/);
    await assert.rejects(db.copyEntriesToLocalDay(userId, { mealGroup: group, targetDay: '2999-01-01' }), /no later than today/);
  } finally { await db.deleteUserAccount(userId).catch(() => {}); await db.getPool().end(); }
});
