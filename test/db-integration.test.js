const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

test('database feature foundations persist and read back through PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  delete require.cache[dbPath];
  const db = require(dbPath);
  const userId = `integration-${crypto.randomUUID()}`;

  try {
    await db.initDb();
    await db.deleteUserAccount(userId).catch(() => {});

    const createdUser = await db.upsertUser({
      id: userId,
      provider: 'local-dev',
      providerUserId: userId,
      email: `${userId}@example.com`,
      name: 'Integration User',
      timezone: 'America/Los_Angeles'
    });
    assert.equal(createdUser.timezone, 'America/Los_Angeles');

    const updatedUser = await db.updateUserPreferences(userId, { timezone: 'America/Chicago' });
    assert.equal(updatedUser.timezone, 'America/Chicago');

    await db.addEntries(userId, [
      {
        itemName: 'Integration Oatmeal',
        quantity: 1,
        unit: 'bowl',
        calories: 300,
        protein: 12,
        carbs: 48,
        fat: 6,
        consumedAt: '2026-06-11T12:00:00.000Z',
        source: 'ai_text',
        sourceDetail: 'integration test',
        confidence: 0.62,
        needsReview: true
      }
    ]);

    const dashboard = await db.getDashboard(userId, '2026-06-11', { timezone: 'America/New_York' });
    const logged = dashboard.entries.find((entry) => entry.itemName === 'Integration Oatmeal');
    assert.ok(logged);
    assert.equal(logged.source, 'ai_text');
    assert.equal(logged.sourceDetail, 'integration test');
    assert.equal(logged.needsReview, true);
    assert.equal(logged.correctionKey, 'integration oatmeal');

    await db.updateEntry(userId, logged.id, {
      itemName: 'Integration Oatmeal',
      quantity: 1,
      unit: 'bowl',
      calories: 355,
      protein: 20,
      carbs: 42,
      fat: 8,
      consumedAt: logged.consumedAt
    });

    const corrected = await db.applyFoodCorrections(userId, [
      {
        itemName: 'integration oatmeal',
        quantity: 1,
        unit: 'bowl',
        calories: 300,
        protein: 12,
        carbs: 48,
        fat: 6,
        source: 'ai_text'
      }
    ]);
    assert.equal(corrected[0].source, 'food_correction');
    assert.equal(corrected[0].calories, 355);
    assert.equal(corrected[0].protein, 20);
    assert.equal(corrected[0].needsReview, false);

    const copyResult = await db.copyEntriesForLocalDay(userId, '2026-06-11', '2026-06-12', 'America/New_York');
    assert.equal(copyResult.copiedCount, 1);
    const copiedDashboard = await db.getDashboard(userId, '2026-06-12', { timezone: 'America/New_York' });
    const copied = copiedDashboard.entries.find((entry) => entry.source === 'copy_day');
    assert.ok(copied);
    assert.equal(copied.sourceDetail, 'copied_from:2026-06-11');

    const singleCopyResult = await db.copyEntriesToLocalDay(userId, {
      entryId: logged.id,
      targetDay: '2026-06-13',
      timezone: 'America/New_York'
    });
    assert.equal(singleCopyResult.copiedCount, 1);
    const singleCopiedDashboard = await db.getDashboard(userId, '2026-06-13', { timezone: 'America/New_York' });
    const singleCopied = singleCopiedDashboard.entries.find((entry) => entry.sourceDetail === `copied_from_entry:${logged.id}`);
    assert.ok(singleCopied);
    assert.equal(singleCopied.mealGroup, null);

    const starterFirst = await db.addStarterQuickAdds(userId);
    const starterSecond = await db.addStarterQuickAdds(userId);
    assert.equal(starterFirst.addedCount, 5);
    assert.equal(starterSecond.addedCount, 0);
    const savedItems = await db.listSavedItems(userId);
    assert.equal(savedItems.filter((item) => item.source === 'starter_template').length, 5);

    for (const source of ['healthkit', 'workout_planner']) {
      const externalId = `${source}-${crypto.randomUUID()}`;
      const syncedWorkout = await db.addWorkoutEntry(userId, {
        description: 'Integration Run',
        intensity: 'medium',
        durationHours: 0.5,
        caloriesBurned: 250,
        loggedAt: new Date().toISOString(),
        source,
        externalId
      });
      assert.equal(syncedWorkout.created, true);
      assert.equal(await db.deleteWorkoutEntry(userId, syncedWorkout.id), 1);

      const replayedWorkout = await db.addWorkoutEntry(userId, {
        description: 'Integration Run',
        intensity: 'medium',
        durationHours: 0.5,
        caloriesBurned: 250,
        loggedAt: new Date().toISOString(),
        source,
        externalId
      });
      assert.equal(replayedWorkout.created, false);
      assert.equal(replayedWorkout.id, syncedWorkout.id);
    }

    const workouts = await db.listWorkoutEntries(userId, { limit: 100, scope: 'month' });
    assert.equal(workouts.entries.some((entry) => entry.description === 'Integration Run'), false);

    await db.logClientDiagnostic(userId, {
      level: 'error',
      category: 'integration',
      message: 'integration diagnostic',
      details: { route: '/test' },
      appPlatform: 'node-test',
      appVersion: '1.0.0',
      requestId: 'integration-request'
    });
    const diagnostics = await db.listClientDiagnostics(userId);
    assert.equal(diagnostics[0].message, 'integration diagnostic');
    assert.deepEqual(diagnostics[0].details, { route: '/test' });

    const exported = await db.exportUserData(userId);
    assert.equal(exported.foodCorrections.length, 1);
    assert.equal(exported.clientDiagnostics.length, 1);
  } finally {
    await db.deleteUserAccount(userId).catch(() => {});
    await db.getPool().end();
    delete require.cache[dbPath];
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
