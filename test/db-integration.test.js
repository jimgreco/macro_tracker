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

    const webSessionId = crypto.randomUUID();
    const webSessionPublicId = crypto.randomUUID();
    const webSessionData = {
      cookie: { expires: new Date(Date.now() + 60_000).toISOString() },
      passport: { user: userId },
      appleAuthState: crypto.randomUUID()
    };
    await db.saveWebSession(webSessionId, webSessionData, {
      publicId: webSessionPublicId,
      userId,
      expiresAt: new Date(Date.now() + 60_000)
    });
    const restoredWebSession = await db.loadWebSession(webSessionId);
    assert.deepEqual(restoredWebSession.sessionData, webSessionData);
    const webInventory = await db.listUserWebSessions(userId, webSessionId);
    assert.equal(webInventory.length, 1);
    assert.equal(webInventory[0].id, webSessionPublicId);
    assert.equal(webInventory[0].current, true);

    const expiredSessionId = crypto.randomUUID();
    await db.saveWebSession(expiredSessionId, { passport: { user: userId } }, {
      publicId: crypto.randomUUID(),
      userId,
      expiresAt: new Date(Date.now() - 1_000)
    });
    assert.equal(await db.loadWebSession(expiredSessionId), null);

    const rateLimitKey = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
    const sharedCounts = await Promise.all(
      Array.from({ length: 12 }, () => db.consumeRateLimit(rateLimitKey, 60_000))
    );
    assert.deepEqual(
      sharedCounts.map((entry) => entry.count).sort((a, b) => a - b),
      Array.from({ length: 12 }, (_, index) => index + 1)
    );

    const mobileCredential = await db.createApiToken(userId, 'Integration iOS');
    const validatedCredential = await db.validateApiToken(mobileCredential.token);
    assert.equal(validatedCredential.id, userId);
    assert.equal(validatedCredential.apiTokenId, mobileCredential.id);
    assert.ok(
      new Date(mobileCredential.expiresAt).getTime() <=
        Date.now() + 91 * 24 * 60 * 60 * 1000
    );
    const rotatedCredential = await db.rotateApiToken(userId, mobileCredential.id);
    assert.equal((await db.validateApiToken(rotatedCredential.token)).id, userId);
    assert.equal(
      (await db.validateApiToken(mobileCredential.token)).id,
      userId,
      'the prior credential remains valid so a lost rotation response cannot break offline use'
    );

    const credentialInventory = await db.listApiTokens(userId, rotatedCredential.id);
    assert.equal(credentialInventory.length, 2);
    assert.equal(
      credentialInventory.find((entry) => entry.id === rotatedCredential.id).current,
      true
    );

    const revokedCredentials = await db.revokeAllCredentials(userId);
    assert.equal(revokedCredentials.webSessionCount, 1);
    assert.equal(revokedCredentials.apiTokenCount, 2);
    assert.equal(await db.loadWebSession(webSessionId), null);
    assert.equal(await db.validateApiToken(mobileCredential.token), null);
    assert.equal(await db.validateApiToken(rotatedCredential.token), null);

    const clientMutationId = crypto.randomUUID();
    const mutationDescriptor = {
      method: 'POST',
      path: '/weights',
      requestHash: crypto.createHash('sha256').update('integration-mutation').digest('hex')
    };
    const concurrentClaims = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.claimClientMutation(userId, clientMutationId, mutationDescriptor)
      )
    );
    assert.equal(
      concurrentClaims.filter((claim) => claim.disposition === 'acquired').length,
      1
    );
    assert.equal(
      concurrentClaims.filter((claim) => claim.disposition === 'processing').length,
      7
    );

    await db.completeClientMutation(userId, clientMutationId, {
      responseStatus: 200,
      responseBody: { ok: true, id: 90210 }
    });
    const replayClaim = await db.claimClientMutation(
      userId,
      clientMutationId,
      mutationDescriptor
    );
    assert.equal(replayClaim.disposition, 'replay');
    assert.deepEqual(replayClaim.mutation.responseBody, { ok: true, id: 90210 });

    const conflictingClaim = await db.claimClientMutation(
      userId,
      clientMutationId,
      { ...mutationDescriptor, requestHash: 'different-request-hash' }
    );
    assert.equal(conflictingClaim.disposition, 'conflict');

    const otherAccountClaim = await db.claimClientMutation(
      `${userId}-other`,
      clientMutationId,
      mutationDescriptor
    );
    assert.equal(otherAccountClaim.disposition, 'acquired');

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
    assert.equal(dashboard.currentDayTotals.completeness.state, 'unknown');
    assert.equal(dashboard.currentDayTotals.completeness.eligibleForNutritionAnalysis, false);
    assert.equal(dashboard.currentDayTotals.completeness.suggestedState, 'partial');

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

    const doubledCorrection = await db.applyFoodCorrections(userId, [
      {
        itemName: 'integration oatmeal',
        quantity: 2,
        unit: 'bowl',
        calories: 600,
        protein: 24,
        carbs: 96,
        fat: 12,
        source: 'ai_text'
      }
    ]);
    assert.equal(doubledCorrection[0].quantity, 2);
    assert.equal(doubledCorrection[0].calories, 710);
    assert.equal(doubledCorrection[0].protein, 40);

    const trustedQuickAdd = await db.applyFoodCorrections(userId, [
      {
        itemName: 'integration oatmeal',
        quantity: 1,
        unit: 'bowl',
        calories: 300,
        protein: 12,
        carbs: 48,
        fat: 6,
        source: 'quick_add'
      }
    ]);
    assert.equal(trustedQuickAdd[0].calories, 300);
    assert.equal(trustedQuickAdd[0].source, 'quick_add');

    const completedDay = await db.setNutritionDayCompleteness(
      userId,
      '2026-06-11',
      'complete',
      'America/New_York'
    );
    assert.equal(completedDay.state, 'complete');
    assert.equal(completedDay.eligibleForNutritionAnalysis, true);

    await db.updateEntry(userId, logged.id, {
      itemName: 'Integration Oatmeal',
      quantity: 1,
      unit: 'bowl',
      calories: 360,
      protein: 21,
      carbs: 42,
      fat: 8,
      consumedAt: logged.consumedAt
    });
    const afterLateCorrection = await db.getDashboard(
      userId,
      '2026-06-11',
      { timezone: 'America/New_York' }
    );
    assert.equal(afterLateCorrection.currentDayTotals.calories, 360);
    assert.equal(afterLateCorrection.currentDayTotals.completeness.state, 'complete');
    const completedSnapshot = await db.getAnalysisSnapshot(userId, 90, 'America/New_York');
    assert.equal(
      completedSnapshot.meals.dailyTotals.find((row) => row.day === '2026-06-11')
        ?.completeness.eligibleForNutritionAnalysis,
      true
    );

    const reopenedDay = await db.setNutritionDayCompleteness(
      userId,
      '2026-06-11',
      'partial',
      'America/New_York'
    );
    assert.equal(reopenedDay.state, 'partial');
    assert.equal(reopenedDay.eligibleForNutritionAnalysis, false);
    const reopenedSnapshot = await db.getAnalysisSnapshot(userId, 90, 'America/New_York');
    assert.equal(
      reopenedSnapshot.meals.dailyTotals.find((row) => row.day === '2026-06-11')
        ?.completeness.eligibleForNutritionAnalysis,
      false
    );
    await db.setNutritionDayCompleteness(userId, '2026-06-11', 'complete', 'America/New_York');

    const copyResult = await db.copyEntriesForLocalDay(userId, '2026-06-11', '2026-06-12', 'America/New_York');
    assert.equal(copyResult.copiedCount, 1);
    const copiedDashboard = await db.getDashboard(userId, '2026-06-12', { timezone: 'America/New_York' });
    const copied = copiedDashboard.entries.find((entry) => entry.source === 'copy_day');
    assert.ok(copied);
    assert.equal(copied.sourceDetail, 'copied_from:2026-06-11');
    assert.equal(copiedDashboard.currentDayTotals.completeness.state, 'unknown');
    assert.equal(copiedDashboard.currentDayTotals.completeness.eligibleForNutritionAnalysis, false);

    const completeNoEntryDay = await db.setNutritionDayCompleteness(
      userId,
      '2026-06-14',
      'complete',
      'America/New_York'
    );
    assert.equal(completeNoEntryDay.state, 'complete');
    const noEntryDashboard = await db.getDashboard(
      userId,
      '2026-06-14',
      { timezone: 'America/New_York' }
    );
    assert.equal(noEntryDashboard.currentDayTotals.calories, 0);
    assert.equal(noEntryDashboard.currentDayTotals.completeness.state, 'complete');

    await db.addEntries(userId, [{
      itemName: 'DST Midnight Fixture',
      quantity: 1,
      unit: 'serving',
      calories: 77,
      protein: 7,
      carbs: 8,
      fat: 2,
      consumedAt: '2026-03-08T07:30:00.000Z',
      source: 'manual'
    }]);
    const newYorkDstDay = await db.getDashboard(
      userId,
      '2026-03-08',
      { timezone: 'America/New_York' }
    );
    const losAngelesPriorDay = await db.getDashboard(
      userId,
      '2026-03-07',
      { timezone: 'America/Los_Angeles' }
    );
    assert.equal(newYorkDstDay.currentDayTotals.calories, 77);
    assert.equal(losAngelesPriorDay.currentDayTotals.calories, 77);
    await db.setNutritionDayCompleteness(userId, '2026-03-08', 'complete', 'America/New_York');
    assert.equal(
      (await db.getNutritionDayCompleteness(userId, '2026-03-07', 'America/Los_Angeles')).state,
      'unknown',
      'marking the New York local day must not mark the adjacent travel day complete'
    );

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

    const sleepStart = new Date();
    sleepStart.setUTCDate(sleepStart.getUTCDate() - 2);
    sleepStart.setUTCHours(1, 3, 0, 0);
    const sleepDay = sleepStart.toISOString().slice(0, 10);

    const initialSleep = await db.addSleepEntry(userId, {
      durationHours: 7.5,
      wakeUps: 42,
      loggedAt: sleepStart.toISOString(),
      source: 'healthkit',
      externalId: `legacy-sleep-${crypto.randomUUID()}`
    });
    assert.equal(initialSleep.created, true);

    const revisedSleep = await db.addSleepEntry(userId, {
      durationHours: 7.2,
      wakeUps: 21,
      loggedAt: sleepStart.toISOString(),
      source: 'healthkit',
      externalId: `sleep-v2-${Math.floor(sleepStart.getTime() / 1_800_000)}`
    });
    assert.equal(revisedSleep.created, false);
    assert.equal(revisedSleep.updated, true);
    assert.equal(revisedSleep.id, initialSleep.id);

    let sleepEntries = await db.listSleepEntries(userId, {
      limit: 500,
      scope: 'month',
      timezone: 'UTC'
    });
    let matchingSleepEntries = sleepEntries.entries.filter(
      (entry) =>
        entry.source === 'healthkit' &&
        Math.abs(new Date(entry.loggedAt).getTime() - sleepStart.getTime()) < 1_000
    );
    assert.equal(matchingSleepEntries.length, 1);
    assert.equal(matchingSleepEntries[0].durationHours, 7.2);
    assert.equal(matchingSleepEntries[0].wakeUps, 21);
    assert.equal(
      sleepEntries.dailyTotals.find((row) => row.day === sleepDay)?.totalHours,
      7.2
    );

    const napStart = new Date(sleepStart);
    napStart.setUTCHours(15, 0, 0, 0);
    const nap = await db.addSleepEntry(userId, {
      durationHours: 1,
      wakeUps: 0,
      loggedAt: napStart.toISOString(),
      source: 'healthkit',
      externalId: `sleep-v2-${Math.floor(napStart.getTime() / 1_800_000)}`
    });
    assert.equal(nap.created, true);

    sleepEntries = await db.listSleepEntries(userId, {
      limit: 500,
      scope: 'month',
      timezone: 'UTC'
    });
    assert.equal(
      sleepEntries.dailyTotals.find((row) => row.day === sleepDay)?.totalHours,
      8.2,
      'a separate daytime nap must remain additive'
    );

    const concurrentStart = new Date(sleepStart);
    concurrentStart.setUTCDate(concurrentStart.getUTCDate() - 1);
    const concurrentRevisions = await Promise.all([
      db.addSleepEntry(userId, {
        durationHours: 6.4,
        wakeUps: 3,
        loggedAt: concurrentStart.toISOString(),
        source: 'healthkit',
        externalId: `concurrent-a-${crypto.randomUUID()}`
      }),
      db.addSleepEntry(userId, {
        durationHours: 6.6,
        wakeUps: 2,
        loggedAt: concurrentStart.toISOString(),
        source: 'healthkit',
        externalId: `concurrent-b-${crypto.randomUUID()}`
      })
    ]);
    assert.equal(concurrentRevisions.filter((entry) => entry.created).length, 1);
    assert.equal(new Set(concurrentRevisions.map((entry) => entry.id)).size, 1);

    sleepEntries = await db.listSleepEntries(userId, {
      limit: 500,
      scope: 'month',
      timezone: 'UTC'
    });
    matchingSleepEntries = sleepEntries.entries.filter(
      (entry) =>
        entry.source === 'healthkit' &&
        Math.abs(new Date(entry.loggedAt).getTime() - concurrentStart.getTime()) < 1_000
    );
    assert.equal(matchingSleepEntries.length, 1);
    assert.ok([6.4, 6.6].includes(matchingSleepEntries[0].durationHours));

    const annotatedRevisionStart = new Date(sleepStart);
    annotatedRevisionStart.setUTCDate(annotatedRevisionStart.getUTCDate() - 6);
    await db.getPool().query(
      `INSERT INTO sleep_entries (
         user_id, duration_hours, wake_ups, quality, notes, logged_at, source, external_id, created_at
       )
       VALUES
         ($1, 6.8, 3, 5, NULL, $2, 'healthkit', $3, NOW() - INTERVAL '1 minute'),
         ($1, 6.9, 2, NULL, 'Keep this note', $2, 'healthkit', $4, NOW())`,
      [
        userId,
        annotatedRevisionStart,
        `annotated-a-${crypto.randomUUID()}`,
        `annotated-b-${crypto.randomUUID()}`
      ]
    );
    const annotatedRevision = await db.addSleepEntry(userId, {
      durationHours: 7,
      wakeUps: 1,
      loggedAt: annotatedRevisionStart.toISOString(),
      source: 'healthkit',
      externalId: `sleep-v2-${Math.floor(annotatedRevisionStart.getTime() / 1_800_000)}`
    });
    assert.equal(annotatedRevision.created, false);
    assert.equal(annotatedRevision.deduplicatedCount, 1);
    sleepEntries = await db.listSleepEntries(userId, {
      limit: 500,
      scope: 'month',
      timezone: 'UTC'
    });
    matchingSleepEntries = sleepEntries.entries.filter(
      (entry) =>
        entry.source === 'healthkit' &&
        Math.abs(new Date(entry.loggedAt).getTime() - annotatedRevisionStart.getTime()) < 1_000
    );
    assert.equal(matchingSleepEntries.length, 1);
    assert.equal(matchingSleepEntries[0].durationHours, 7);
    assert.equal(matchingSleepEntries[0].quality, 5);
    assert.equal(matchingSleepEntries[0].notes, 'Keep this note');

    const legacyCleanupStart = new Date(sleepStart);
    legacyCleanupStart.setUTCDate(legacyCleanupStart.getUTCDate() - 3);
    const legacyExternalA = `legacy-cleanup-a-${crypto.randomUUID()}`;
    const legacyExternalB = `legacy-cleanup-b-${crypto.randomUUID()}`;
    await db.getPool().query(
      `INSERT INTO sleep_entries (
         user_id, duration_hours, wake_ups, quality, notes, logged_at, source, external_id, created_at
       )
       VALUES
         ($1, 7.5, 42, 4, NULL, $2, 'healthkit', $3, NOW() - INTERVAL '1 minute'),
         ($1, 7.2, 21, NULL, 'Latest note', $2, 'healthkit', $4, NOW())`,
      [userId, legacyCleanupStart, legacyExternalA, legacyExternalB]
    );

    const shiftedOverlapStart = new Date(sleepStart);
    shiftedOverlapStart.setUTCDate(shiftedOverlapStart.getUTCDate() - 4);
    const shiftedOverlapRevision = new Date(shiftedOverlapStart.getTime() + 2 * 60 * 60 * 1_000);
    await db.getPool().query(
      `INSERT INTO sleep_entries (
         user_id, duration_hours, wake_ups, logged_at, source, external_id, created_at
       )
       VALUES
         ($1, 4, 5, $2, 'healthkit', $3, NOW() - INTERVAL '1 minute'),
         ($1, 3, 4, $4, 'healthkit', $5, NOW())`,
      [
        userId,
        shiftedOverlapStart,
        `shifted-overlap-a-${crypto.randomUUID()}`,
        shiftedOverlapRevision,
        `shifted-overlap-b-${crypto.randomUUID()}`
      ]
    );

    assert.ok((await db.deduplicateHealthKitSleepRevisions()) >= 2);
    sleepEntries = await db.listSleepEntries(userId, {
      limit: 500,
      scope: 'month',
      timezone: 'UTC'
    });
    matchingSleepEntries = sleepEntries.entries.filter(
      (entry) =>
        entry.source === 'healthkit' &&
        Math.abs(new Date(entry.loggedAt).getTime() - legacyCleanupStart.getTime()) < 1_000
    );
    assert.equal(matchingSleepEntries.length, 1);
    assert.equal(matchingSleepEntries[0].durationHours, 7.2);
    assert.equal(matchingSleepEntries[0].wakeUps, 21);
    assert.equal(matchingSleepEntries[0].quality, 4);
    assert.equal(matchingSleepEntries[0].notes, 'Latest note');

    matchingSleepEntries = sleepEntries.entries.filter((entry) => {
      const entryStart = new Date(entry.loggedAt).getTime();
      return (
        entry.source === 'healthkit' &&
        entryStart >= shiftedOverlapStart.getTime() &&
        entryStart <= shiftedOverlapRevision.getTime()
      );
    });
    assert.equal(matchingSleepEntries.length, 1);
    assert.equal(matchingSleepEntries[0].durationHours, 3);
    assert.equal(
      new Date(matchingSleepEntries[0].loggedAt).getTime(),
      shiftedOverlapRevision.getTime()
    );

    const oldDiagnosticRequestId = '7ca2d834-a403-4f0a-83aa-0c223041cdb4';
    const recentDiagnosticRequestId = '1eb8443b-9dda-4e7e-b5c4-89166018a67f';
    const oldDiagnostic = await db.logClientDiagnostic(userId, {
      level: 'error',
      category: 'api_error',
      message: 'sensitive integration diagnostic',
      details: {
        routeTemplate: '/api/entries/123?token=secret',
        status: 500,
        requestId: oldDiagnosticRequestId,
        token: 'secret'
      },
      appPlatform: 'web',
      appVersion: '1.0.0',
      requestId: oldDiagnosticRequestId
    });
    const recentDiagnostic = await db.logClientDiagnostic(userId, {
      level: 'error',
      category: 'api_error',
      details: {
        routeTemplate: '/api/entries/456',
        status: 502,
        requestId: recentDiagnosticRequestId
      },
      appPlatform: 'web',
      appVersion: '1.0.0',
      requestId: recentDiagnosticRequestId
    });
    const retentionNow = new Date();
    const oldTimestamp = new Date(retentionNow.getTime() - 400 * 24 * 60 * 60 * 1000);
    await db.getPool().query(
      'UPDATE client_diagnostics SET created_at = $1 WHERE id = $2',
      [oldTimestamp, oldDiagnostic.id]
    );
    await db.getPool().query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, created_at)
       VALUES ($1, 'retention_old', 'integration', 'old', $2),
              ($1, 'retention_new', 'integration', 'new', $3)`,
      [userId, oldTimestamp, retentionNow]
    );
    await db.getPool().query(
      `INSERT INTO daily_usage_counts (user_id, feature, usage_date, count, updated_at)
       VALUES ($1, 'retention_old', $2::date, 1, $3),
              ($1, 'retention_new', $4::date, 1, $5)
       ON CONFLICT (user_id, feature, usage_date) DO UPDATE
       SET count = EXCLUDED.count, updated_at = EXCLUDED.updated_at`,
      [
        userId,
        oldTimestamp.toISOString(),
        oldTimestamp,
        retentionNow.toISOString(),
        retentionNow
      ]
    );

    const cleanup = await db.runDataRetentionCleanup({ now: retentionNow });
    assert.equal(cleanup.inventoryVersion, '2026-07-28');
    assert.ok(cleanup.tables.client_diagnostics.deleted >= 1);
    assert.ok(cleanup.tables.audit_log.deleted >= 1);
    assert.ok(cleanup.tables.daily_usage_counts.deleted >= 1);
    const retainedMarkers = await Promise.all([
      db.getPool().query(
        'SELECT request_id FROM client_diagnostics WHERE user_id = $1 ORDER BY created_at',
        [userId]
      ),
      db.getPool().query(
        `SELECT action FROM audit_log
         WHERE user_id = $1 AND action IN ('retention_old', 'retention_new')
         ORDER BY action`,
        [userId]
      ),
      db.getPool().query(
        `SELECT feature FROM daily_usage_counts
         WHERE user_id = $1 AND feature IN ('retention_old', 'retention_new')
         ORDER BY feature`,
        [userId]
      )
    ]);
    assert.deepEqual(retainedMarkers[0].rows.map((row) => row.request_id), [recentDiagnosticRequestId]);
    assert.deepEqual(retainedMarkers[1].rows.map((row) => row.action), ['retention_new']);
    assert.deepEqual(retainedMarkers[2].rows.map((row) => row.feature), ['retention_new']);

    const diagnostics = await db.listClientDiagnostics(userId);
    assert.equal(diagnostics[0].id, recentDiagnostic.id);
    assert.equal(diagnostics[0].message, 'API request failed');
    assert.deepEqual(diagnostics[0].details, {
      routeTemplate: '/api/entries/:id',
      status: 502,
      requestId: recentDiagnosticRequestId
    });
    assert.equal(diagnostics[0].userAgent, null);

    const exported = await db.exportUserData(userId);
    assert.equal(exported.dataInventoryVersion, '2026-07-28');
    assert.equal(exported.foodCorrections.length, 1);
    assert.equal(exported.clientDiagnostics.length, 1);
    assert.equal(exported.clientDiagnostics[0].request_id, recentDiagnosticRequestId);
    assert.equal(exported.clientDiagnostics[0].user_agent, undefined);
    assert.equal(exported.apiCredentials[0]?.token_hash, undefined);
    assert.equal(exported.webSessions[0]?.session_data, undefined);
    assert.equal(exported.clientMutations[0]?.request_hash, undefined);
    assert.equal(
      exported.nutritionDayCompleteness.some((row) => {
        const localDay = row.local_date instanceof Date
          ? row.local_date.toISOString().slice(0, 10)
          : String(row.local_date).slice(0, 10);
        return localDay === '2026-06-11' && row.state === 'complete';
      }),
      true
    );

    await db.deleteUserAccount(userId);
    const { accountDeletionInventory } = require('../src/data-inventory');
    for (const item of accountDeletionInventory()) {
      const result = await db.getPool().query(
        `SELECT COUNT(*)::int AS count
         FROM ${item.table}
         WHERE ${item.userColumn} = $1`,
        [userId]
      );
      assert.equal(result.rows[0].count, 0, `${item.table} should be deleted`);
    }
  } finally {
    await db.deleteUserAccount(userId).catch(() => {});
    await db.deleteUserAccount(`${userId}-other`).catch(() => {});
    await db.getPool().end();
    delete require.cache[dbPath];
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
