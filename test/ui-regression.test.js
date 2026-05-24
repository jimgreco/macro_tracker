const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('mobile bottom navigation markup is removed', () => {
  const html = read('public/index.html');

  assert.equal(html.includes('class="mobile-nav"'), false);
  assert.equal(html.includes('class="mobile-nav-btn"'), false);
  assert.equal(html.includes('data-nav-target='), false);
});

test('mobile bottom navigation script wiring is removed', () => {
  const script = read('public/script.js');

  assert.equal(script.includes('mobileNavButtons'), false);
  assert.equal(script.includes('setActiveMobileNav('), false);
  assert.equal(script.includes('scrollToSection('), false);
});

test('mobile bottom navigation styles are removed', () => {
  const styles = read('public/styles.css');

  assert.equal(styles.includes('.mobile-nav'), false);
  assert.equal(styles.includes('.mobile-nav-btn'), false);
});


test('brand menu includes macro, weight, workout, and sleep pages', () => {
  const html = read('public/index.html');

  assert.equal(html.includes('data-page="macros"'), true);
  assert.equal(html.includes('data-page="weight"'), true);
  assert.equal(html.includes('data-page="workout"'), true);
  assert.equal(html.includes('data-page="sleep"'), true);
  assert.equal(html.includes('data-page="health"'), false);
  assert.equal(html.includes('id="weight-page"'), true);
  assert.equal(html.includes('id="workout-page"'), true);
  assert.equal(html.includes('id="sleep-page"'), true);
  assert.equal(html.includes('id="health-page"'), false);
});

test('weight page has log, entries, and snapshot sections', () => {
  const html = read('public/index.html');

  assert.equal(html.includes('id="weight-log-section"'), true);
  assert.equal(html.includes('id="weight-entries-section"'), true);
  assert.equal(html.includes('id="weight-snapshot-section"'), true);
});

test('weight page includes target weight + date controls', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(html.includes('id="edit-weight-target-link"'), true);
  assert.equal(script.includes('showWeightTargetModal'), true);
  assert.equal(script.includes("/api/weight-target"), true);
  assert.equal(server.includes("apiRouter.get('/weight-target'"), true);
  assert.equal(server.includes("apiRouter.put('/weight-target'"), true);
});

test('analysis goal selector is removed from weekly analysis form', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');

  assert.equal(html.includes('id="analysis-goal"'), false);
  assert.equal(script.includes('analysisGoalEl'), false);
});

test('analysis report no longer includes recovery context section', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(html.includes('id="analysis-recovery-list"'), false);
  assert.equal(script.includes('analysisRecoveryListEl'), false);
  assert.equal(server.includes('recoveryContext'), false);
});

test('weight entries support edit and delete actions', () => {
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(script.includes('data-weight-action="edit"'), true);
  assert.equal(script.includes('showWeightEditModal'), true);
  assert.equal(script.includes('deleteWeightEntryApi'), true);
  assert.equal(server.includes("apiRouter.put('/weights/:id'"), true);
  assert.equal(server.includes("apiRouter.delete('/weights/:id'"), true);
  assert.equal(server.includes("apiRouter.post('/weights/:id/delete'"), true);
  assert.equal(server.includes("apiRouter.post('/weights/delete'"), true);
});

test('web logged entry lists request paginated pages', () => {
  const script = read('public/script.js');
  const styles = read('public/styles.css');

  assert.equal(script.includes('const LOG_PAGE_SIZE = 30'), true);
  assert.equal(script.includes("api(buildLogPageUrl('/api/weights'"), true);
  assert.equal(script.includes("api(buildLogPageUrl('/api/workouts'"), true);
  assert.equal(script.includes("api(buildLogPageUrl('/api/sleep'"), true);
  assert.equal(script.includes("api(buildLogPageUrl('/api/sexual-activity'"), true);
  assert.equal(script.includes("refreshWeightData({ reset: false })"), true);
  assert.equal(script.includes("refreshWorkoutData({ reset: false })"), true);
  assert.equal(script.includes("refreshSleepData({ reset: false })"), true);
  assert.equal(script.includes("refreshHealthData({ reset: false })"), true);
  assert.equal(styles.includes('.entry-page-sentinel'), true);
});

test('quick entries are searchable and load outside dashboard refresh', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');

  assert.equal(html.includes('id="quick-entry-search"'), true);
  assert.equal(script.includes('quickSearchEl.addEventListener'), true);
  assert.equal(script.includes('loadQuickEntries({ force: true })'), true);

  const start = script.indexOf('async function refreshDashboard()');
  const end = script.indexOf("parseBtnEl.addEventListener", start);
  const refreshSection = script.slice(start, end);
  assert.equal(refreshSection.includes('/api/saved-items'), false);
});

test('iOS quick items are searchable and preload saved items in the background', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');

  assert.equal(swift.includes('@State private var quickSearchText'), true);
  assert.equal(swift.includes('TextField("Search quick entries"'), true);
  assert.equal(swift.includes('Task { await loadSavedItems(showErrors: false) }'), true);
  assert.equal(swift.includes('if !hasLoadedSavedItems'), true);
});

test('iOS macros add button uses the same toolbar group sizing as other tabs', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');

  assert.equal(swift.includes('ToolbarItemGroup(placement: .primaryAction)'), true);
  assert.equal(swift.includes('Image(systemName: "arrow.triangle.2.circlepath")'), true);
  assert.equal(swift.includes('.hidden()'), true);
  assert.equal(swift.includes('Image(systemName: "plus")'), true);
});

test('iOS macro entry rows do not show drag handle icons', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');

  assert.equal(swift.includes('Image(systemName: "line.3.horizontal")'), false);
  assert.equal(swift.includes('entryDragHandle'), false);
  assert.equal(swift.includes('Drag to combine meal items'), false);
});

test('iOS login matches website sign-in layout', () => {
  const swift = read('ios/DailyMacros/DailyMacros/LoginView.swift');

  assert.ok(swift.includes('LoginBackground'));
  assert.ok(swift.includes('loginCard'));
  assert.ok(swift.includes('DailyMacrosLogoMark()'));
  assert.ok(swift.includes('Text("DailyMacros")'));
  assert.ok(swift.includes('Sign in to continue to the app.'));
  assert.ok(swift.includes('Text("Continue with Google")'));
  assert.ok(swift.includes('GoogleLogoMark()'));
  assert.ok(swift.includes('SignInWithAppleButton(.continue)'));
  assert.ok(swift.includes('LoginDivider()'));
  assert.ok(swift.includes('Build \\(value)'));
  assert.ok(swift.indexOf('googleButton') < swift.indexOf('appleButton'));
});

test('workout parser uses server endpoint with local fallback', () => {
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(script.includes("/api/parse-workout"), true);
  assert.equal(script.includes('Used fallback workout parsing'), true);
  assert.equal(server.includes("apiRouter.post('/parse-workout'"), true);
});


test('workout target input lives on workout page and not analysis form', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');

  assert.equal(html.includes('id="edit-workout-target-link"'), true);
  assert.equal(script.includes('showWorkoutTargetModal'), true);
  assert.equal(html.includes('id="analysis-planned-workouts"'), false);
  assert.equal(script.includes('/api/macro-targets/workouts'), true);
  assert.equal(script.includes('plannedWorkoutsPerWeek: Number(analysisPlannedWorkoutsEl?.value || 5)'), false);
});

test('web UI escapes API-rendered text before assigning template HTML', () => {
  const script = read('public/script.js');

  assert.equal(script.includes('function escapeHtml'), true);
  assert.equal(script.includes('function escapeAttr'), true);
  assert.equal(script.includes('function escapeJsonAttr'), true);
  assert.equal(script.includes('${escapeHtml(entry.itemName)}'), true);
  assert.equal(script.includes("${escapeHtml(entry.description || 'Workout')}"), true);
  assert.equal(script.includes('${escapeHtml(child.itemName)}'), true);
  assert.equal(script.includes('data-workout-quick="${escapeJsonAttr(payload)}"'), true);
  assert.equal(script.includes('profileAvatarEl.src = avatarUrl.href'), true);
});

test('web account menu surfaces privacy support export delete and build info', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const styles = read('public/styles.css');

  assert.equal(html.includes('id="account-info-btn"'), true);
  assert.equal(script.includes('showAccountPrivacyModal'), true);
  assert.equal(script.includes('/api/account/export'), true);
  assert.equal(script.includes("/api/account', { method: 'DELETE' }"), true);
  assert.equal(script.includes('/api/version'), true);
  assert.equal(script.includes('meal photos may be sent to OpenAI'), true);
  assert.equal(styles.includes('.account-privacy-modal'), true);
});

test('web build labels use short git hashes', () => {
  const loginScript = read('public/login.js');
  const appScript = read('public/script.js');

  for (const script of [loginScript, appScript]) {
    assert.equal(script.includes('const BUILD_HASH_DIGITS = 7'), true);
    assert.equal(script.includes('function formatBuildLabel(build)'), true);
    assert.equal(script.includes('value.slice(0, BUILD_HASH_DIGITS)'), true);
  }

  assert.equal(loginScript.includes('const build = formatBuildLabel(data.appBuild)'), true);
  assert.equal(appScript.includes("const build = formatBuildLabel(version.appBuild || 'local')"), true);
});

test('web UI reflects admin-controlled sexual activity feature flag', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');

  assert.equal(html.includes('class="nav-tab sexual-activity-feature" data-page="sexual-activity" hidden'), true);
  assert.equal(html.includes('id="sexual-activity-page"'), true);
  assert.equal(html.includes('id="admin-page-btn"'), true);
  assert.equal(script.includes('features: {\n    sexualActivity: false'), true);
  assert.equal(script.includes('const sexualActivityFeatureEls'), true);
  assert.equal(script.includes('function syncFeatureVisibility'), true);
  assert.equal(script.includes("renderActivePage('sleep')"), true);
  assert.equal(script.includes('Boolean(me.user?.features?.sexualActivity)'), true);
  assert.equal(script.includes("window.location.href = '/admin'"), true);
});

test('admin page supports searchable paginated account controls', () => {
  const html = read('public/admin.html');
  const script = read('public/admin.js');
  const styles = read('public/styles.css');

  assert.equal(html.includes('id="admin-account-search"'), true);
  assert.equal(html.includes('id="admin-prev-page"'), true);
  assert.equal(html.includes('id="admin-next-page"'), true);
  assert.equal(script.includes('/api/admin/accounts?'), true);
  assert.equal(script.includes("data-admin-control=\"isDisabled\""), true);
  assert.equal(script.includes("data-admin-control=\"sexualActivityEnabled\""), true);
  assert.equal(script.includes('accountStats(account)'), true);
  assert.equal(styles.includes('.admin-account-row'), true);
});

test('iOS sleep tab and sexual activity More item honor the account feature flag', () => {
  const models = read('ios/DailyMacros/DailyMacros/Models.swift');
  const auth = read('ios/DailyMacros/DailyMacros/AuthManager.swift');
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const tabs = read('ios/DailyMacros/DailyMacros/MainTabView.swift');

  assert.equal(models.includes('struct UserFeatures'), true);
  assert.equal(models.includes('var sexualActivityEnabled: Bool'), true);
  assert.equal(auth.includes('(try? await api.getMe()) ?? User'), true);
  assert.equal(health.includes('@EnvironmentObject var auth: AuthManager'), true);
  assert.equal(health.includes('struct SleepView: View'), true);
  assert.equal(health.includes('struct SexualActivityView: View'), true);
  assert.equal(health.includes('guard sexualActivityEnabled else'), true);
  assert.equal(tabs.includes('SleepView()'), true);
  assert.equal(tabs.includes('Label("Sleep", systemImage: "moon.zzz.fill")'), true);
  assert.equal(tabs.includes('if auth.user?.sexualActivityEnabled == true'), true);
  assert.equal(tabs.includes('SexualActivityView()'), true);
  assert.equal(tabs.indexOf('SleepView()') < tabs.indexOf('AnalysisView()'), true);
  assert.equal(tabs.indexOf('SleepView()') < tabs.indexOf('SexualActivityView()'), true);
  assert.equal(tabs.indexOf('SexualActivityView()') < tabs.indexOf('AnalysisView()'), true);
});

test('iOS health refresh ignores cancellation errors', () => {
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');

  assert.equal(health.includes('showErrorUnlessCancelled'), true);
  assert.equal(health.includes('error is CancellationError'), true);
  assert.equal(health.includes('URLError, urlError.code == .cancelled'), true);
  assert.equal(health.includes('NSURLErrorCancelled'), true);
});

test('iOS HealthKit auto-sync registers background delivery and exports after local creates', () => {
  const app = read('ios/DailyMacros/DailyMacros/DailyMacrosApp.swift');
  const autoSync = read('ios/DailyMacros/DailyMacros/HealthKitAutoSync.swift');
  const entitlements = read('ios/DailyMacros/DailyMacros/DailyMacros.entitlements');
  const workouts = read('ios/DailyMacros/DailyMacros/WorkoutsView.swift');
  const weight = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');

  assert.equal(app.includes('@StateObject private var healthKitAutoSync = HealthKitAutoSync()'), true);
  assert.equal(app.includes('await healthKitAutoSync.start('), true);
  assert.equal(autoSync.includes('HKObserverQuery'), true);
  assert.equal(autoSync.includes('enableBackgroundDelivery(for: sampleType, frequency: .hourly)'), true);
  assert.equal(autoSync.includes('syncRecentWorkouts(api: api)'), true);
  assert.equal(autoSync.includes('syncRecentWeight(api: api)'), true);
  assert.equal(autoSync.includes('syncRecentSleep(api: api)'), true);
  assert.equal(autoSync.includes('syncRecentSexualActivity(api: api)'), true);
  assert.equal(entitlements.includes('com.apple.developer.healthkit.background-delivery'), true);
  assert.equal(workouts.includes('triggerHealthKitExport()'), true);
  assert.equal(weight.includes('triggerHealthKitExport()'), true);
  assert.equal(health.includes('triggerSleepHealthKitExport()'), true);
  assert.equal(health.includes('triggerSexualActivityHealthKitExport()'), true);
});

test('mobile sleep target is editable and drives sleep chart', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const db = read('src/db.js');

  assert.equal(html.includes('id="edit-sleep-target-link"'), true);
  assert.equal(html.includes('id="sleep-target-value"'), true);
  assert.equal(script.includes('showSleepTargetModal'), true);
  assert.equal(script.includes('/api/macro-targets/sleep_hours'), true);
  assert.equal(script.includes('targetValue: getSleepTargetHours()'), true);
  assert.equal(db.includes('sleep_hours: 8'), true);
});
