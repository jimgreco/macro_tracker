const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const serverPath = require.resolve(path.join(__dirname, '..', 'src', 'server.js'));
const requiredRuntimeDependencies = [
  'dotenv',
  'express',
  'express-session',
  'passport',
  'passport-google-oauth20',
  'openai',
  'stripe',
  'apple-signin-auth',
  'heic-convert'
];

function canResolve(name) {
  try {
    require.resolve(name);
    return true;
  } catch (_error) {
    return false;
  }
}

const runtimeDependenciesAvailable = requiredRuntimeDependencies.every(canResolve);
const routeTestOptions = runtimeDependenciesAvailable
  ? {}
  : { skip: 'runtime npm dependencies are not installed' };

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  LOCAL_AUTH_BYPASS: process.env.LOCAL_AUTH_BYPASS,
  LOCAL_DEV_USER_ID: process.env.LOCAL_DEV_USER_ID,
  LOCAL_DEV_USER_EMAIL: process.env.LOCAL_DEV_USER_EMAIL,
  LOCAL_DEV_USER_NAME: process.env.LOCAL_DEV_USER_NAME,
  SESSION_SECRET: process.env.SESSION_SECRET
};
const originalLoad = Module._load;
const calls = [];

function record(name, payload) {
  calls.push({ name, payload });
}

function resetCalls() {
  calls.length = 0;
}

function latestCall(name) {
  return [...calls].reverse().find((call) => call.name === name);
}

const fakeUser = {
  id: 'local-dev-user',
  email: 'local@example.com',
  name: 'Local User',
  provider: 'local-dev',
  timezone: 'America/Los_Angeles',
  isDisabled: false,
  sexualActivityEnabled: true,
  setupTutorialResetAt: null,
  lastLoginAt: null,
  loginCount: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const fakeDb = {
  initDb: async () => {},
  checkDatabaseHealth: async () => ({ ok: true, latencyMs: 1 }),
  upsertUser: async (user) => ({ ...fakeUser, ...user }),
  getUserAccountControls: async () => fakeUser,
  listAdminAccounts: async () => ({ accounts: [], pagination: { total: 0, limit: 25, offset: 0, returned: 0, hasMore: false } }),
  updateAdminAccountControls: async () => fakeUser,
  updateUserPreferences: async (_userId, preferences) => {
    record('updateUserPreferences', preferences);
    return { ...fakeUser, ...preferences };
  },
  getProviderUserId: async () => null,
  logAudit: async (userId, action, entityType, entityId, details) => {
    record('logAudit', { userId, action, entityType, entityId, details });
  },
  logClientDiagnostic: async (_userId, diagnostic) => {
    record('logClientDiagnostic', diagnostic);
    return { id: 42, createdAt: new Date().toISOString() };
  },
  listClientDiagnostics: async () => [],
  addEntries: async (userId, rows) => {
    record('addEntries', { userId, rows });
  },
  copyEntriesForLocalDay: async (userId, sourceDay, targetDay, timezone) => {
    record('copyEntriesForLocalDay', { userId, sourceDay, targetDay, timezone });
    return { copiedCount: 3 };
  },
  copyEntriesToLocalDay: async (userId, payload) => {
    record('copyEntriesToLocalDay', { userId, ...payload });
    return { copiedCount: payload.mealGroup ? 2 : 1 };
  },
  updateEntry: async () => 1,
  deleteEntry: async () => 1,
  scaleMealGroup: async () => 1,
  combineEntries: async () => 'meal-group-id',
  splitMealGroup: async () => 2,
  removeFromMealGroup: async () => 1,
  addSavedItem: async () => 99,
  updateSavedItem: async () => 1,
  deleteSavedItem: async () => 1,
  listSavedItems: async () => [],
  addStarterQuickAdds: async () => {
    record('addStarterQuickAdds', {});
    return { addedCount: 5, addedIds: [1, 2, 3, 4, 5] };
  },
  quickAddFromSaved: async () => ({ itemName: 'Quick', quantity: 1, unit: 'serving', calories: 100, protein: 10, carbs: 10, fat: 2 }),
  applyFoodCorrections: async (_userId, rows) => {
    record('applyFoodCorrections', rows);
    return rows.map((row) => ({ ...row, source: row.source || 'manual' }));
  },
  claimLegacyData: async () => ({ claimedEntries: 0, claimedSavedItems: 0 }),
  getDashboard: async (userId, date, options) => {
    record('getDashboard', { userId, date, options });
    return { currentDayTotals: {}, previousDays: [], sevenDayAverage: {}, entries: [], targets: {}, pagination: {} };
  },
  getDailyTotals: async () => [],
  getMacroTargets: async () => ({}),
  getMacroTargetHistory: async () => [],
  setMacroTarget: async () => ({ macro: 'calories', target: 2000 }),
  addWeightEntry: async () => ({ id: 1, created: true }),
  updateWeightEntry: async () => 1,
  deleteWeightEntry: async () => 1,
  listWeightEntries: async () => ({ entries: [] }),
  getWeightTarget: async () => ({ targetWeight: null, targetDate: null }),
  setWeightTarget: async () => ({ targetWeight: 180, targetDate: '2026-12-31' }),
  addWorkoutEntry: async () => ({ id: 1, created: true }),
  updateWorkoutEntry: async () => 1,
  deleteWorkoutEntry: async () => 1,
  listWorkoutEntries: async () => ({ entries: [], dailyCalories: [] }),
  addSexualActivityEntry: async () => ({ id: 1, created: true }),
  updateSexualActivityEntry: async () => 1,
  deleteSexualActivityEntry: async () => 1,
  listSexualActivityEntries: async () => ({ entries: [], dailyCounts: [] }),
  addSleepEntry: async () => ({ id: 1, created: true }),
  updateSleepEntry: async () => 1,
  deleteSleepEntry: async () => 1,
  listSleepEntries: async () => ({ entries: [], dailyTotals: [] }),
  getAnalysisSnapshot: async (_userId, days, timezone) => {
    record('getAnalysisSnapshot', { days, timezone });
    return {
      requestedPeriodDays: 14,
      periodDays: 14,
      targets: { calories: 2000, protein: 160, workouts: 4, sleep_hours: 8 },
      meals: {
        dailyTotals: Array.from({ length: 7 }, (_, i) => ({
          day: `2026-06-${String(i + 1).padStart(2, '0')}`,
          itemCount: 3,
          calories: 1950,
          protein: 155
        })),
        timing: { totalEntries: 21, lateNightEntries: 1 }
      },
      workouts: { dailyTotals: [{ day: '2026-06-01', sessions: 1, durationHours: 1, caloriesBurned: 400 }] },
      weight: { entries: [], change: 0, target: {} },
      sleep: { dailyTotals: [{ day: '2026-06-01', totalHours: 8, targetHours: 8 }] }
    };
  },
  saveAnalysisReport: async () => ({ id: 1, report: {}, createdAt: new Date().toISOString() }),
  getLatestAnalysisReport: async () => null,
  createApiToken: async () => ({ id: 1, token: 'token' }),
  validateApiToken: async () => null,
  listApiTokens: async () => [],
  deleteApiToken: async () => 1,
  deleteAllApiTokens: async () => 1,
  listCoachDismissals: async () => [],
  upsertCoachDismissals: async () => [],
  deleteCoachDismissals: async () => 0,
  exportUserData: async () => ({}),
  deleteUserAccount: async () => {},
  getPlanLimits: () => ({ dailyParses: 100, mealParsesPerDay: 100, workoutParsesPerDay: 100, analysisPerDay: 100 }),
  getSubscription: async () => ({ plan: 'free' }),
  upsertSubscription: async () => {},
  getSubscriptionByStripeCustomerId: async () => null,
  saveBillingEvent: async () => {},
  consumeDailyUsage: async () => ({ allowed: true, count: 1, limit: 100 })
};

const fakeParser = {
  parseMealText: async () => ({ items: [{ itemName: 'Yogurt', quantity: 1, unit: 'serving', calories: 120, protein: 18, carbs: 8, fat: 0 }] }),
  parseWorkoutText: async () => ({ description: 'Run', intensity: 'medium', durationHours: 0.5, caloriesBurned: 300 })
};

let app;
let httpServer;
let baseUrl;

test.before(async () => {
  if (!runtimeDependenciesAvailable) {
    return;
  }

  process.env.NODE_ENV = 'test';
  process.env.LOCAL_AUTH_BYPASS = 'true';
  process.env.LOCAL_DEV_USER_ID = fakeUser.id;
  process.env.LOCAL_DEV_USER_EMAIL = fakeUser.email;
  process.env.LOCAL_DEV_USER_NAME = fakeUser.name;
  process.env.SESSION_SECRET = 'test-session-secret';

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './db' && parent?.filename === serverPath) {
      return fakeDb;
    }
    if (request === './parser' && parent?.filename === serverPath) {
      return fakeParser;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[serverPath];
  app = require(serverPath).app;
  httpServer = await new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  Module._load = originalLoad;
  delete require.cache[serverPath];
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

async function request(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      ...(options.headers || {})
    },
    ...options
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

test('account preferences route persists validated timezone', routeTestOptions, async () => {
  resetCalls();
  const { res, body } = await request('/api/account/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ timezone: 'America/Chicago' })
  });

  assert.equal(res.status, 200);
  assert.equal(body.user.timezone, 'America/Chicago');
  assert.deepEqual(latestCall('updateUserPreferences').payload, { timezone: 'America/Chicago' });
});

test('dashboard route falls back to saved user timezone', routeTestOptions, async () => {
  resetCalls();
  const { res } = await request('/api/dashboard');

  assert.equal(res.status, 200);
  assert.equal(latestCall('getDashboard').payload.options.timezone, 'America/Los_Angeles');
});

test('bulk entries route preserves source metadata and applies corrections', routeTestOptions, async () => {
  resetCalls();
  const { res, body } = await request('/api/entries/bulk', {
    method: 'POST',
    body: JSON.stringify({
      consumedAt: '2026-06-11T12:00:00.000Z',
      source: 'ai_text',
      sourceDetail: 'route test',
      items: [
        { itemName: 'Yogurt', quantity: 1, unit: 'serving', calories: 120, protein: 18, carbs: 8, fat: 0 }
      ]
    })
  });

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(latestCall('applyFoodCorrections').payload[0].source, 'ai_text');
  assert.equal(latestCall('addEntries').payload.rows[0].source, 'ai_text');
});

test('copy-day and starter quick-add routes call backend primitives', routeTestOptions, async () => {
  resetCalls();
  const copy = await request('/api/entries/copy-day', {
    method: 'POST',
    body: JSON.stringify({ sourceDay: '2026-06-10', targetDay: '2026-06-11' })
  });
  const starter = await request('/api/starter-quick-adds', { method: 'POST' });

  assert.equal(copy.res.status, 200);
  assert.equal(copy.body.copiedCount, 3);
  assert.equal(latestCall('copyEntriesForLocalDay').payload.timezone, 'America/Los_Angeles');
  assert.equal(starter.res.status, 200);
  assert.equal(starter.body.addedCount, 5);
  assert.ok(latestCall('addStarterQuickAdds'));
});

test('copy-to-today route copies either an entry or a meal group', routeTestOptions, async () => {
  resetCalls();
  const entryCopy = await request('/api/entries/copy-to-today', {
    method: 'POST',
    body: JSON.stringify({ entryId: 42, targetDay: '2026-06-11' })
  });
  const mealCopy = await request('/api/entries/copy-to-today', {
    method: 'POST',
    body: JSON.stringify({ mealGroup: 'meal-group-id', targetDay: '2026-06-11' })
  });
  const invalid = await request('/api/entries/copy-to-today', {
    method: 'POST',
    body: JSON.stringify({ entryId: 42, mealGroup: 'meal-group-id' })
  });

  assert.equal(entryCopy.res.status, 200);
  assert.equal(entryCopy.body.copiedCount, 1);
  assert.equal(mealCopy.res.status, 200);
  assert.equal(mealCopy.body.copiedCount, 2);
  assert.equal(invalid.res.status, 400);
  assert.equal(latestCall('copyEntriesToLocalDay').payload.mealGroup, 'meal-group-id');
  assert.equal(latestCall('copyEntriesToLocalDay').payload.timezone, 'America/Los_Angeles');
});

test('weekly recap and diagnostics routes are wired through real middleware', routeTestOptions, async () => {
  resetCalls();
  const recap = await request('/api/coach/weekly-recap');
  const diagnostic = await request('/api/diagnostics/client', {
    method: 'POST',
    body: JSON.stringify({ level: 'error', category: 'test', message: 'client failure', details: { path: '/x' } })
  });

  assert.equal(recap.res.status, 200);
  assert.equal(recap.body.recap.periodDays, 7);
  assert.equal(latestCall('getAnalysisSnapshot').payload.timezone, 'America/Los_Angeles');
  assert.equal(diagnostic.res.status, 200);
  assert.equal(latestCall('logClientDiagnostic').payload.message, 'client failure');
});
