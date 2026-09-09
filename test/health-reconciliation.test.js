const test = require('node:test');
const assert = require('node:assert/strict');
const { metadata, matchingEvent, fallbackAllowed, GRACE_MS } = require('../src/health-reconciliation');
const { buildRecovery } = require('../src/recovery');

const evidence = { sourceName: 'Oura', sourceBundleId: 'observed.test.source', endedAt: '2026-09-08T07:00:00-04:00', awakeSeconds: 1200 };
const payload = { source: 'healthkit', externalId: 'fixture-night', loggedAt: '2026-09-07T23:00:00-04:00', durationHours: 7.5, wakeUps: 9, healthkitMetadata: evidence };
const sleep = { providerDocumentId: 'provider-night', day: '2026-09-08', recordedAt: payload.loggedAt,
  data: { bedtimeStart: payload.loggedAt, bedtimeEnd: evidence.endedAt, totalSleepSeconds: 27000, awakeSeconds: 1200, type: 'long_sleep', averageHrv: 40 } };

test('source metadata is allowlisted and matching requires observed Oura identity plus conservative timestamps/duration', () => {
  assert.equal(metadata({ ...evidence, rawValues: [1, 2], token: 'secret' }).token, undefined);
  const row = { healthkit_metadata: evidence, logged_at: payload.loggedAt, duration_hours: 7.5 };
  assert.equal(matchingEvent(row, sleep, 'sleep'), true);
  assert.equal(matchingEvent({ ...row, healthkit_metadata: { ...evidence, sourceName: 'Apple Watch' } }, sleep, 'sleep'), false);
  assert.equal(matchingEvent({ ...row, duration_hours: 1 }, sleep, 'sleep'), false);
  assert.equal(matchingEvent({ ...row, logged_at: '2026-09-08T16:00:00Z' }, sleep, 'sleep'), false);
  assert.throws(() => metadata({ ...evidence, awakeSeconds: -1 }));
});

test('matching uses absolute instants across DST offsets and preserves separate naps', () => {
  const row = { healthkit_metadata: { ...evidence, endedAt: '2026-11-01T07:00:00-05:00' }, logged_at: '2026-10-31T23:00:00-04:00', duration_hours: 8.5 };
  const document = { data: { bedtimeStart: '2026-11-01T03:00:00Z', bedtimeEnd: '2026-11-01T12:00:00Z', totalSleepSeconds: 30600 } };
  assert.equal(matchingEvent(row, document, 'sleep'), true);
  assert.equal(matchingEvent({ ...row, logged_at: '2026-11-01T13:00:00-05:00', duration_hours: 0.5 }, document, 'sleep'), false);
});

test('fallback waits for the 72-hour grace and never fills covered provider history after disconnect', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  const connected = { status: 'connected', last_synced_at: new Date(now - 3600000) };
  assert.equal(Boolean(fallbackAllowed(connected, null, '2026-09-08', now)), false);
  assert.equal(Boolean(fallbackAllowed({ status: 'connected' }, null, '2026-09-08', now)), false);
  assert.equal(Boolean(fallbackAllowed({ ...connected, status: 'error' }, null, '2026-09-08', now)), false);
  assert.equal(fallbackAllowed({ ...connected, last_synced_at: new Date(now - GRACE_MS - 1) }, '2026-09-07', '2026-09-08', now), true);
  assert.equal(fallbackAllowed(null, '2026-09-08', '2026-09-08', now), false);
  assert.equal(fallbackAllowed(null, '2026-09-08', '2026-09-09', now), true);
});

test('recovery preserves provider day, naps, missing values and separate source totals without inferred zeros', () => {
  const documents = [{ ...sleep, dataType: 'sleep', syncedAt: '2026-09-08T12:00:00Z' },
    { ...sleep, providerDocumentId: 'nap', dataType: 'sleep', data: { ...sleep.data, type: 'rest', bedtimeStart: '2026-09-08T14:00:00-04:00', bedtimeEnd: '2026-09-08T14:30:00-04:00', totalSleepSeconds: 1800 } },
    { dataType: 'daily_sleep', day: sleep.day, data: { score: 82 } }];
  const result = buildRecovery({ documents, now: new Date('2026-09-08T23:00:00Z'), targetHours: 8,
    appEntries: [{ ...payload, durationHours: 8 }] });
  assert.equal(result.sessions.length, 2);
  assert.equal(result.latest.day, '2026-09-08');
  assert.equal(result.latest.readiness, null);
  assert.equal(result.dailyTotals[0].totalHours, 8);
  assert.equal(result.trends.find(row => row.id === 'readiness').value, null);
  assert.equal(result.trends.find(row => row.id === 'hrv').direction, 'Not enough nights for direction');
  assert.equal(result.allowsAINarration, false);
  assert.equal(result.targetHours, 8);
  const missing = buildRecovery({ documents: [{ ...documents[0], data: { bedtimeStart: sleep.data.bedtimeStart, bedtimeEnd: sleep.data.bedtimeEnd } }] });
  assert.equal(missing.sessions.length, 0, 'time in bed is not estimated as sleep');
});

test('recovery direction needs six primary nights and local bedtime consistency handles midnight and travel', () => {
  const documents = Array.from({ length: 6 }, (_, index) => ({ dataType: 'sleep', providerDocumentId: `night-${index}`,
    day: `2026-09-0${index + 1}`, data: { ...sleep.data, bedtimeStart: `2026-09-0${index + 1}T00:15:00${index < 3 ? '-04:00' : '+02:00'}`, averageHrv: index < 3 ? 30 : 45 } }));
  const result = buildRecovery({ documents, now: new Date('2026-09-06T22:00:00Z') });
  assert.equal(result.trends.find(row => row.id === 'hrv').direction, 'Higher');
  assert.equal(result.trends.find(row => row.id === 'timing').value, 0);
});

test('PostgreSQL transport reconciliation is order-independent, annotation-preserving and tombstone-aware', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const db = require('../src/db');
  const userId = `transport-${require('node:crypto').randomUUID()}`;
  const pool = db.getPool();
  try {
    await db.initDb();
    await db.upsertUser({ id: userId, provider: 'local-dev', providerUserId: userId, timezone: 'America/New_York' });
    const first = await db.addSleepEntry(userId, payload);
    assert.equal(first.created, true);
    assert.equal((await db.listSleepEntries(userId)).entries[0].wakeUps, 0, 'measured awake intervals are not perceived wake-ups');
    await db.updateSleepEntry(userId, first.id, { ...payload, durationHours: 2, quality: 4, notes: 'Subjective note', wakeUps: 2 });
    assert.equal((await db.listSleepEntries(userId)).entries[0].durationHours, 7.5, 'imported objective hours cannot be edited');
    await Promise.all([db.upsertOuraDocument(userId, 'sleep', sleep), db.addSleepEntry(userId, payload)]);
    assert.equal((await db.listSleepEntries(userId)).entries.length, 0);
    let documents = await db.listOuraDocuments(userId);
    assert.deepEqual(documents[0].annotations, { quality: 4, notes: 'Subjective note', wakeUps: 2 });
    await db.upsertOuraDocument(userId, 'sleep', { ...sleep, data: { ...sleep.data, totalSleepSeconds: 28000 } });
    assert.equal((await db.listOuraDocuments(userId))[0].annotations.notes, 'Subjective note');

    const watch = { ...payload, externalId: 'watch-night', healthkitMetadata: { ...evidence, sourceBundleId: 'observed.watch', sourceName: 'Apple Watch' } };
    assert.equal((await db.addSleepEntry(userId, watch)).created, true);
    assert.equal((await db.listSleepEntries(userId)).entries.length, 1, 'Apple Watch persists independently');
    await db.ignoreOuraSleep(userId, sleep.providerDocumentId);
    await db.upsertOuraDocument(userId, 'sleep', sleep, { resurrect: true });
    assert.equal((await db.listOuraDocuments(userId)).length, 0, 'provider updates cannot clear a user ignore');
    await db.deleteOuraConnection(userId, { deleteData: true });
    await db.upsertOuraDocument(userId, 'sleep', sleep);
    assert.equal((await db.listOuraDocuments(userId)).length, 0, 'ignore survives reconnect');

    const nap = { ...payload, externalId: 'nap', loggedAt: '2026-09-09T13:00:00-04:00', durationHours: 0.5,
      healthkitMetadata: { ...evidence, endedAt: '2026-09-09T13:30:00-04:00' } };
    const deleted = await db.addSleepEntry(userId, nap);
    await db.deleteSleepEntry(userId, deleted.id);
    assert.equal((await db.addSleepEntry(userId, nap)).created, false);
    await db.upsertOuraDocument(userId, 'sleep', { providerDocumentId: 'nap-doc', day: '2026-09-09',
      data: { bedtimeStart: nap.loggedAt, bedtimeEnd: nap.healthkitMetadata.endedAt, totalSleepSeconds: 1800, type: 'rest' } });
    assert.equal((await db.listOuraDocuments(userId)).length, 0, 'HealthKit deletion suppresses matching direct nap');

    const workout = { ...payload, description: 'Walk', intensity: 'low', caloriesBurned: 90, durationHours: 0.5,
      externalId: 'workout', loggedAt: '2026-09-08T17:00:00-04:00', healthkitMetadata: { ...evidence, endedAt: '2026-09-08T17:30:00-04:00' } };
    const workoutDoc = { providerDocumentId: 'workout-doc', day: '2026-09-08', data: { startDateTime: workout.loggedAt, endDateTime: workout.healthkitMetadata.endedAt, durationSeconds: 1800, calories: 90 } };
    await db.upsertOuraDocument(userId, 'workout', workoutDoc);
    assert.equal((await db.addWorkoutEntry(userId, workout)).created, false);
    assert.equal((await db.listWorkoutEntries(userId)).entries.length, 1, 'one read-only canonical workout remains visible');
    assert.equal((await db.listWorkoutEntries(userId)).entries[0].source, 'oura');
    const analysis = await db.getAnalysisSnapshot(userId, 365);
    assert.equal(analysis.workouts.dailyTotals.length, 0, 'Oura workouts do not enter AI snapshots');
    await db.deleteOuraDocument(userId, 'workout', 'workout-doc');
    await db.upsertOuraDocument(userId, 'workout', workoutDoc);
    assert.equal((await db.listOuraDocuments(userId, { dataType: 'workout' })).length, 0);
    await db.addWorkoutEntry(userId, workout);
    assert.equal((await db.listWorkoutEntries(userId)).entries.length, 0);
    await db.upsertOuraDocument(userId, 'workout', workoutDoc, { resurrect: true });
    const restoredWorkout = (await db.listWorkoutEntries(userId)).entries[0];
    await db.deleteWorkoutEntry(userId, restoredWorkout.id);
    await db.deleteOuraConnection(userId, { deleteData: true });
    await db.upsertOuraDocument(userId, 'workout', workoutDoc, { resurrect: true });
    assert.equal((await db.listWorkoutEntries(userId)).entries.length, 0, 'workout deletion survives reconnect and provider update');
    const diagnosticEvidence = await db.getOuraAcceptanceEvidence(userId);
    assert.ok(diagnosticEvidence.documents.every(row => Object.keys(row).every(key => ['dataType','count','lastSyncedAt','lastUpdatedAt'].includes(key))));
    assert.equal(JSON.stringify(diagnosticEvidence).includes('Subjective note'), false);
    const exported = await db.exportUserData(userId);
    assert.ok(exported.healthTransportCoverage.length > 0);

    // Legacy duplicate cleanup can leave a deleted row alongside the active
    // session. A revised source-specific ID must attach to the active record.
    const legacyStart = '2026-09-10T03:00:00Z';
    const legacyRows = await pool.query(`INSERT INTO sleep_entries
      (user_id, duration_hours, wake_ups, logged_at, source, external_id, deleted_at)
      VALUES ($1, 7.5, 3, $2, 'healthkit', 'old-deleted-copy', NOW()),
             ($1, 7.5, 3, $2, 'healthkit', 'old-active-copy', NULL)
      RETURNING id, deleted_at`, [userId, legacyStart]);
    const activeId = Number(legacyRows.rows.find(row => !row.deleted_at).id);
    const revised = { ...watch, externalId: 'source-specific-revision', loggedAt: legacyStart,
      healthkitMetadata: { ...watch.healthkitMetadata, endedAt: '2026-09-10T11:00:00Z' } };
    assert.equal((await db.addSleepEntry(userId, revised)).id, activeId);
    assert.ok((await db.listSleepEntries(userId)).entries.some(row => row.id === activeId));
    const exactTombstone = await db.addSleepEntry(userId, { ...revised, externalId: 'old-deleted-copy' });
    assert.equal(exactTombstone.skipped, true, 'exact deleted IDs remain tombstones even with an active neighbor');
  } finally { await db.deleteUserAccount(userId); await pool.end(); }
});
