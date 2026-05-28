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

test('iOS weight chart omits axis title labels and centers summary legend', () => {
  const swift = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const chartView = swift.slice(
    swift.indexOf('private var chartView'),
    swift.indexOf('private var weightChartEntries')
  );

  assert.equal(chartView.includes('Text("Weight (lb)")'), false);
  assert.equal(chartView.includes('Text("Date")'), false);
  assert.equal(chartView.includes('legendItem("Avg:'), true);
  assert.equal(chartView.includes('legendItem("Target:'), true);
  assert.equal(chartView.includes('.frame(maxWidth: .infinity, alignment: .center)'), true);
});

test('iOS edit weight save button stays disabled until a value changes', () => {
  const swift = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const editSheet = swift.slice(
    swift.indexOf('private func editWeightSheet'),
    swift.indexOf('// MARK: - Edit Target Sheet')
  );

  assert.equal(editSheet.includes('let canSave = canSaveWeightEdit(entry)'), true);
  assert.equal(editSheet.includes('.tint(canSave ? .cyan : .gray)'), true);
  assert.equal(editSheet.includes('.disabled(!canSave)'), true);
  assert.equal(editSheet.includes('private func canSaveWeightEdit'), true);
  assert.equal(editSheet.includes('let baselineWeight = Double(weightEditText(for: entry)) ?? entry.weight'), true);
  assert.equal(editSheet.includes('abs(weight - baselineWeight) > 0.001'), true);
  assert.equal(editSheet.includes('!isSameDisplayedMinute(editWeightDate, parseISO(entry.loggedAt))'), true);
});

test('iOS weight history renders intentional outlined entry cards', () => {
  const swift = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const entriesList = swift.slice(
    swift.indexOf('private var entriesList'),
    swift.indexOf('// MARK: - Add Weight Sheet')
  );
  const entryCard = entriesList.slice(
    entriesList.indexOf('private func weightEntryCard'),
    entriesList.indexOf('private func previousWeightEntry')
  );

  assert.equal(entriesList.includes('ForEach(Array(entries.enumerated()), id: \\.element.id)'), true);
  assert.equal(entriesList.includes('weightEntryCard(entry, previousEntry: previousWeightEntry(after: index))'), true);
  assert.equal(entriesList.includes('private func weightEntryCard'), true);
  assert.equal(entriesList.includes('Image(systemName: weightTrendIcon(for: entry, previousEntry: previousEntry))'), true);
  assert.equal(entriesList.includes('Image(systemName: "scalemass.fill")'), false);
  assert.equal(entriesList.includes('private func previousWeightEntry(after index: Int) -> WeightEntry?'), true);
  assert.equal(entriesList.includes('return "arrow.up.right"'), true);
  assert.equal(entriesList.includes('return "arrow.down.right"'), true);
  assert.ok(entryCard.indexOf('Text(String(format: "%.1f lbs", entry.weight))') < entryCard.indexOf('Text(formatDate(entry.loggedAt))'));
  assert.equal(entryCard.includes('VStack(alignment: .trailing, spacing: 2)'), true);
  assert.equal(entriesList.includes('RoundedRectangle(cornerRadius: 12)'), true);
  assert.equal(entriesList.includes('.stroke(.cyan.opacity(0.18), lineWidth: 1)'), true);
  assert.equal(entriesList.includes('Text(formatTime(entry.loggedAt))'), true);
  assert.equal(entriesList.includes('.monospacedDigit()'), true);
});

test('iOS entry edit sheets share disabled-save and red-delete treatment', () => {
  const workouts = read('ios/DailyMacros/DailyMacros/WorkoutsView.swift');
  const weight = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const workoutEdit = workouts.slice(
    workouts.indexOf('private func editWorkoutSheet'),
    workouts.indexOf('private func detailRow')
  );
  const weightEdit = weight.slice(
    weight.indexOf('private func editWeightSheet'),
    weight.indexOf('// MARK: - Edit Target Sheet')
  );
  const activityEdit = health.slice(
    health.indexOf('private func editHealthSheet'),
    health.indexOf('// MARK: - Edit Sleep Sheet')
  );
  const sleepEdit = health.slice(
    health.indexOf('private func editSleepSheet'),
    health.indexOf('// MARK: - Actions')
  );

  for (const section of [workoutEdit, weightEdit, activityEdit, sleepEdit]) {
    assert.equal(section.includes('.tint(canSave ? .cyan : .gray)'), true);
    assert.equal(section.includes('.disabled(!canSave)'), true);
    assert.equal(section.includes('.buttonStyle(.borderedProminent)'), true);
    assert.equal(section.includes('.tint(.red)'), true);
    assert.equal(
      section.indexOf('Text("Delete").font(.headline).frame(maxWidth: .infinity)') <
        section.indexOf('Text("Save").font(.headline).frame(maxWidth: .infinity)'),
      true
    );
  }

  assert.equal(workouts.includes('private func canSaveWorkoutEdit'), true);
  assert.equal(workoutEdit.includes('Text("Workout Name")'), true);
  assert.equal(workoutEdit.includes('TextField("Workout Name", text: $editWorkoutDescription)'), true);
  assert.equal(workouts.includes('let baselineDuration = Double(workoutDurationEditText(for: workout)) ?? workout.durationHours'), true);
  assert.equal(workouts.includes('let baselineCalories = Double(workoutCaloriesEditText(for: workout)) ?? workout.caloriesBurned'), true);
  assert.equal(workouts.includes('let durationChanged = abs(duration - baselineDuration) > 0.001'), true);
  assert.equal(workouts.includes('let caloriesChanged = abs(calories - baselineCalories) > 0.5'), true);
  assert.equal(weight.includes('let baselineWeight = Double(weightEditText(for: entry)) ?? entry.weight'), true);
  assert.equal(health.includes('let baselineHours = Double(sleepHoursEditText(for: entry)) ?? entry.durationHours'), true);
  assert.equal(weight.includes('private func canSaveWeightEdit'), true);
  assert.equal(health.includes('private func canSaveHealthEdit'), true);
  assert.equal(health.includes('private func canSaveSleepEdit'), true);
  assert.equal(workouts.includes('Calendar.current.compare(lhs, to: rhs, toGranularity: .minute)'), true);
  assert.equal(weight.includes('Calendar.current.compare(lhs, to: rhs, toGranularity: .minute)'), true);
  assert.equal(health.includes('Calendar.current.compare(lhs, to: rhs, toGranularity: .minute)'), true);
  assert.equal(weightEdit.includes('Text("Weight")'), true);
  assert.equal(weightEdit.includes('.frame(maxWidth: .infinity, alignment: .leading)'), true);
  assert.equal(activityEdit.includes('.navigationTitle("Edit Sexual Activity")'), true);
  assert.equal(activityEdit.includes('DatePicker("Logged At", selection: $editHealthDate)'), true);
  assert.equal(activityEdit.includes('.frame(maxWidth: .infinity, alignment: .leading)'), true);
  assert.equal(sleepEdit.includes('DatePicker("Logged At", selection: $editSleepDate)'), true);
  assert.equal(sleepEdit.includes('.frame(maxWidth: .infinity, alignment: .leading)'), true);
});

test('iOS target sheets disable unchanged saves', () => {
  const macros = read('ios/DailyMacros/DailyMacros/MacrosView.swift');
  const workouts = read('ios/DailyMacros/DailyMacros/WorkoutsView.swift');
  const weight = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');

  assert.equal(macros.includes('private var canSaveMacroTargets'), true);
  assert.equal(macros.includes('.tint(canSave ? Color.neonCyan : .gray)'), true);
  assert.equal(macros.includes('guard canSaveMacroTargets else { return }'), true);
  assert.equal(workouts.includes('private var canSaveWorkoutTargets'), true);
  assert.equal(workouts.includes('guard canSaveWorkoutTargets else { return }'), true);
  assert.equal(weight.includes('private var canSaveWeightTarget'), true);
  assert.equal(weight.includes('guard canSaveWeightTarget else { return }'), true);
  assert.equal(weight.includes('.onAppear {\n                Task { await loadTarget(showErrors: false) }'), true);
  assert.equal(weight.includes('private func loadTarget(showErrors: Bool = true) async'), true);
  assert.equal(health.includes('private var canSaveSleepTarget'), true);
  assert.equal(health.includes('guard canSaveSleepTarget else { return }'), true);
});

test('iOS macro edit sheets use disabled saves and left-side destructive actions', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');
  const entryEdit = swift.slice(
    swift.indexOf('private var editEntrySheet'),
    swift.indexOf('/// When quantity changes')
  );
  const mealEdit = swift.slice(
    swift.indexOf('private var editMealSheet'),
    swift.indexOf('private var mealScaleFactor')
  );
  const parsedEdit = swift.slice(
    swift.indexOf('private var editParsedItemSheet'),
    swift.indexOf('private func scaleParsedMacros')
  );
  const quickEdit = swift.slice(
    swift.indexOf('private func editQuickAddSheet'),
    swift.indexOf('// MARK: - Actions')
  );

  assert.equal(entryEdit.includes('let canSave = canSaveEditedEntry'), true);
  assert.equal(entryEdit.includes('.tint(canSave ? Color.neonCyan : .gray)'), true);
  assert.equal(entryEdit.includes('.disabled(!canSave)'), true);
  assert.equal(entryEdit.indexOf('Text("Delete")') < entryEdit.indexOf('Text("Save")'), true);
  assert.equal(entryEdit.includes('DatePicker("Logged At", selection: $editEntryDate)'), true);
  assert.equal(swift.includes('let loggedAtChanged = !isSameDisplayedMinute(editEntryDate, parseISO(entry.consumedAt))'), true);
  assert.equal(swift.includes('editableWholeNumberBaseline(for: entry.calories)'), true);

  assert.equal(mealEdit.includes('let canSave = canSaveEditedMeal'), true);
  assert.equal(mealEdit.includes('.tint(canSave ? Color.neonGreen : .gray)'), true);
  assert.equal(mealEdit.includes('.disabled(!canSave)'), true);

  assert.equal(parsedEdit.includes('let canSave = canSaveParsedItem'), true);
  assert.equal(parsedEdit.includes('.tint(canSave ? Color.neonCyan : .gray)'), true);
  assert.equal(parsedEdit.includes('.disabled(!canSave)'), true);

  assert.equal(quickEdit.includes('let canSave = canSaveQuickAdd(template)'), true);
  assert.equal(quickEdit.includes('.tint(.red)'), true);
  assert.equal(quickEdit.indexOf('Text("Delete")') < quickEdit.indexOf('Text("Save")'), true);
  assert.equal(quickEdit.includes('.disabled(!canSave)'), true);
});

test('iOS log sheets put Logged At first and reset timestamps on open', () => {
  const weight = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const addWeight = weight.slice(
    weight.indexOf('private var addWeightSheet'),
    weight.indexOf('// MARK: - Edit Weight Sheet')
  );
  const logHealth = health.slice(
    health.indexOf('private var logHealthSheet'),
    health.indexOf('// MARK: - Log Sleep Sheet')
  );
  const logSleep = health.slice(
    health.indexOf('private var logSleepSheet'),
    health.indexOf('// MARK: - Edit Sleep Targets Sheet')
  );
  const showLog = health.slice(
    health.indexOf('private func showLogSheetForMode'),
    health.indexOf('// MARK: - Helpers')
  );

  assert.equal(weight.includes('newWeightDate = Date()'), true);
  assert.equal(addWeight.indexOf('DatePicker("Logged At", selection: $newWeightDate)') < addWeight.indexOf('TextField("Weight (lbs)"'), true);
  assert.equal(logHealth.indexOf('DatePicker("Logged At", selection: $healthLogDate)') < logHealth.indexOf('Text("Activity Type")'), true);
  assert.equal(logSleep.indexOf('DatePicker("Logged At", selection: $sleepLogDate)') < logSleep.indexOf('Text("Hours")'), true);
  assert.equal(health.includes('@State private var sleepHours = ""'), true);
  assert.equal(logSleep.includes('.tint(canLogSleepEntry ? .cyan : .gray)'), true);
  assert.equal(logSleep.includes('.disabled(!canLogSleepEntry)'), true);
  assert.equal(health.includes('private var canLogSleepEntry'), true);
  assert.equal(health.includes('Text("Date & Time")'), false);
  assert.equal(showLog.includes('sleepLogDate = Date()'), true);
  assert.equal(showLog.includes('sleepHours = ""'), true);
  assert.equal(showLog.includes('healthLogDate = Date()'), true);
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
  assert.equal(swift.includes('@State private var quickTemplates'), true);
  assert.equal(swift.includes('private func rebuildQuickTemplates()'), true);
  assert.equal(swift.includes('private var quickTemplates: [QuickAddTemplate] {'), false);
  assert.equal(swift.includes('let searchText: String'), true);
  assert.equal(swift.includes('private let quickItemsVisibleLimit = 40'), true);
  assert.equal(swift.includes('private func quickTemplateDisplay()'), true);
  assert.equal(swift.includes('private var filteredQuickTemplates'), false);
  assert.equal(swift.includes('TextField("Search quick entries"'), true);
  assert.equal(swift.includes('Task { await loadSavedItems(showErrors: false) }'), true);
  assert.equal(swift.includes('if !hasLoadedSavedItems'), true);
});

test('iOS macro add sheet defaults logged-at to the current moment', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');
  const toolbar = swift.slice(
    swift.indexOf('.navigationTitle("Macros")'),
    swift.indexOf('.sheet(isPresented: $showAddSheet)')
  );
  const addInput = swift.slice(
    swift.indexOf('private var addInputView'),
    swift.indexOf('private var mealDescriptionField')
  );

  assert.equal(toolbar.includes('consumedAt = Date()'), true);
  assert.equal(toolbar.includes('consumedAt = selectedDate'), false);
  assert.equal(addInput.indexOf('DatePicker("Logged At", selection: $consumedAt)') < addInput.indexOf('mealDescriptionField'), true);
});

test('iOS macros add button uses a grouped toolbar without a blank placeholder', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');

  assert.equal(swift.includes('ToolbarItemGroup(placement: .primaryAction)'), true);
  assert.equal(swift.includes('Image(systemName: "plus")'), true);
  assert.equal(swift.includes('Image(systemName: "arrow.triangle.2.circlepath")'), false);
  assert.equal(swift.includes('.hidden()'), false);
});

test('iOS macro entry rows do not show drag handle icons', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');

  assert.equal(swift.includes('Image(systemName: "line.3.horizontal")'), false);
  assert.equal(swift.includes('entryDragHandle'), false);
  assert.equal(swift.includes('Drag to combine meal items'), false);
});

test('iOS daily totals bars use the richer progress treatment', () => {
  const swift = read('ios/DailyMacros/DailyMacros/MacrosView.swift');
  const progressStart = swift.indexOf('private func macroProgressBar');
  const progressEnd = swift.indexOf('// MARK: - Entries List', progressStart);
  const progressSection = swift.slice(progressStart, progressEnd);

  assert.equal(swift.includes('macroProgressBar(progress: progress, color: color)'), true);
  assert.equal(progressSection.includes('LinearGradient'), true);
  assert.equal(progressSection.includes('color.opacity(0.45)'), true);
  assert.equal(progressSection.includes('.frame(height: 10)'), true);
  assert.equal(progressSection.includes('Color.white.opacity(0.28)'), true);
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
  assert.equal(script.includes('href="/privacy"'), true);
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
  assert.equal(html.includes('class="nav-tab sexual-activity-feature" data-page="sexual-activity" hidden>Sex</button>'), true);
  assert.equal(html.includes('class="nav-tab sexual-activity-feature" data-page="sexual-activity" hidden>Sexual Activity</button>'), false);
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
  assert.equal(script.includes('data-admin-action="resetSetupTutorial"'), true);
  assert.equal(script.includes('async function resetSetupTutorial(accountId, buttonEl)'), true);
  assert.equal(script.includes('body: JSON.stringify({ resetSetupTutorial: true })'), true);
  assert.equal(script.includes('account.setupTutorialResetAt'), true);
  assert.equal(script.includes('accountStats(account)'), true);
  assert.equal(styles.includes('.admin-account-row'), true);
  assert.equal(styles.includes('.admin-reset-tutorial-btn'), true);
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

test('iOS sleep and sexual activity use tab titles with grouped toolbar add actions', () => {
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const toolbarGroup = health.indexOf('ToolbarItemGroup(placement: .primaryAction)');
  const syncAction = health.indexOf('Image(systemName: "arrow.triangle.2.circlepath")', toolbarGroup);
  const addAction = health.indexOf('Image(systemName: "plus")', syncAction);
  const sexualActivitySection = health.slice(
    health.indexOf('private var sexualActivitySection'),
    health.indexOf('private struct ActivityOccurrencePoint')
  );
  const sleepSection = health.slice(
    health.indexOf('private var sleepSection'),
    health.indexOf('private var sleepChart')
  );

  assert.equal(toolbarGroup >= 0, true);
  assert.equal(syncAction > toolbarGroup, true);
  assert.equal(addAction > syncAction, true);
  assert.equal(health.includes('showLogSheetForMode()'), true);
  assert.equal(health.includes('Image(systemName: "plus.circle.fill")'), false);
  assert.equal(sexualActivitySection.includes('Text("Sexual Activity")'), false);
  assert.equal(sleepSection.includes('Text("Sleep")'), false);
  assert.equal(sleepSection.includes('showLogSleep = true'), false);
});

test('iOS sleep chart omits axis title labels and centers summary legend', () => {
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const sleepChart = health.slice(
    health.indexOf('private var sleepChart'),
    health.indexOf('private func drawSleepChart')
  );

  assert.equal(sleepChart.includes('Text("Hours")'), false);
  assert.equal(sleepChart.includes('Text("Date")'), false);
  assert.equal(sleepChart.includes('Text(String(format: "Avg: %.1fh", avg))'), true);
  assert.equal(sleepChart.includes('Text("Target: \\(formatTargetHours(sleepTargetHours))h")'), true);
  assert.equal(sleepChart.includes('.frame(maxWidth: .infinity, alignment: .center)'), true);
});

test('iOS sleep log badges nights that miss target by at least an hour', () => {
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const sleepEntries = health.slice(
    health.indexOf('private var sleepEntriesList'),
    health.indexOf('// MARK: - Log Health Sheet')
  );

  assert.equal(sleepEntries.includes('sleepEntryIcon(entry)'), true);
  assert.equal(sleepEntries.includes('private func sleepEntryIcon(_ entry: SleepEntry) -> some View'), true);
  assert.equal(sleepEntries.includes('let isBadNight = isBadSleepNight(entry)'), true);
  assert.equal(sleepEntries.includes('Image(systemName: "moon.zzz.fill")'), true);
  assert.equal(sleepEntries.includes('Image(systemName: "exclamationmark.circle.fill")'), true);
  assert.equal(sleepEntries.includes('private func isBadSleepNight(_ entry: SleepEntry) -> Bool'), true);
  assert.equal(sleepEntries.includes('return abs(entry.durationHours - sleepTargetHours) >= 1'), true);
  assert.equal(sleepEntries.includes('.accessibilityLabel(isBadNight ? "Bad night sleep" : "Sleep")'), true);
});

test('iOS sexual activity annual occurrence graph renders 365 wrapped daily bubbles', () => {
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const activityOccurrence = health.slice(
    health.indexOf('private var activityOccurrenceSection'),
    health.indexOf('private var activityLegend')
  );

  assert.equal(activityOccurrence.includes('case "year": return "Last 365 Days"'), true);
  assert.equal(activityOccurrence.includes('case "year": return 365'), true);
  assert.equal(activityOccurrence.includes('activityYearOccurrenceGrid(points)'), true);
  assert.equal(activityOccurrence.includes('GridItem(.adaptive(minimum: 6, maximum: 6), spacing: 3)'), true);
  assert.equal(activityOccurrence.includes('if healthScope == "week" || healthScope == "year"'), true);
  assert.equal(activityOccurrence.includes('Last 52 Weeks'), false);
  assert.equal(activityOccurrence.includes('(0..<52)'), false);
  assert.equal(activityOccurrence.includes('Text("weekly")'), false);
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
  assert.equal(app.includes('@Environment(\\.scenePhase) private var scenePhase'), true);
  assert.equal(app.includes('.onChange(of: scenePhase)'), true);
  assert.equal(app.includes('guard phase == .active, auth.isAuthenticated else { return }'), true);
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

test('iOS workouts annual occurrence graph renders 365 wrapped daily dots', () => {
  const workouts = read('ios/DailyMacros/DailyMacros/WorkoutsView.swift');

  assert.equal(workouts.includes('case "year": return "Last 365 Days"'), true);
  assert.equal(workouts.includes('case "year": return 365'), true);
  assert.equal(workouts.includes('workoutYearOccurrenceGrid(points)'), true);
  assert.equal(workouts.includes('GridItem(.adaptive(minimum: 6, maximum: 6), spacing: 3)'), true);
  assert.equal(workouts.includes('if scope == "week" || scope == "year"'), true);
  assert.equal(workouts.includes('Text("daily")'), false);
  assert.equal(workouts.includes('Last 52 Weeks'), false);
  assert.equal(workouts.includes('(0..<52)'), false);
});

test('iOS Coach Tony P. exposes settings and title-first cards', () => {
  const coach = read('ios/DailyMacros/DailyMacros/AICoach.swift');
  const settings = read('ios/DailyMacros/DailyMacros/SettingsView.swift');

  assert.ok(coach.includes('static let name = "Coach Tony P."'));
  assert.ok(coach.includes('static let enabled = "ai_coach_enabled"'));
  assert.ok(coach.includes('static let mode = "ai_coach_mode"'));
  assert.ok(coach.includes('enum CoachMode'));
  assert.ok(coach.includes('case localModelWithTemplates'));
  assert.ok(coach.includes('case localModelOnly'));
  assert.ok(coach.includes('actor CoachNarrator'));
  assert.ok(coach.includes('import FoundationModels'));
  assert.ok(coach.includes('FoundationCoachNarrator.narrate'));
  assert.ok(coach.includes('SystemLanguageModel.default.availability'));
  assert.ok(coach.includes('enum CoachNarrationResult'));
  assert.ok(coach.includes('case vetoed(reason: String)'));
  assert.ok(coach.includes('candidate.narrated(title: trimmedTitle, message: trimmedMessage)'));
  assert.ok(coach.includes('You may hide all candidates'));
  assert.ok(coach.includes('Do not encourage alcohol'));
  assert.ok(coach.includes('record(\n                category: "coach",\n                message: "\\(CoachBrand.name) local_ai_vetoed"'));
  assert.ok(coach.includes('if localAIVetoKey == narrationKey'));
  assert.ok(coach.includes('if mode.allowsLocalModel, narrationFailureKey != narrationKey'));
  assert.ok(coach.includes('modelSource: .afmLocal'));
  assert.ok(coach.includes('@AppStorage(CoachSettingKeys.enabled)'));
  assert.ok(coach.includes('@AppStorage(CoachSettingKeys.mode)'));
  assert.ok(coach.includes('confidence >= 0.85'));
  assert.ok(coach.includes('recordCoachEvent("shown"'));
  assert.ok(coach.includes('recordCoachEvent("acted_on"'));
  assert.ok(coach.includes('recordCoachEvent("not_useful"'));
  assert.ok(coach.includes('recordCoachEvent("local_ai_narrated"'));
  assert.equal(coach.includes('OpenAI'), false);
  assert.equal(coach.includes('/parse'), false);
  assert.ok(coach.includes('mode.allowsTemplateFallback ? topCandidates : []'));
  assert.ok(coach.includes('private struct AICoachPageIndicator'));
  assert.ok(coach.includes('private func displayedSuggestions(from candidates: [CoachSuggestion], mode: CoachMode, narrationKey: String) -> [CoachSuggestion]'));
  assert.ok(coach.includes('let topCandidates = Array(candidates.prefix(3))'));
  assert.ok(coach.includes('DragGesture(minimumDistance: 24)'));
  assert.ok(coach.includes('AICoachPageIndicator('));
  assert.ok(coach.includes('suggestions.count > 1'));
  assert.ok(coach.includes('func syncedRecords(now: Date = Date()) -> [CoachDismissalRecord]'));
  assert.ok(coach.includes('func mergeSyncedRecords(_ records: [CoachDismissalRecord]'));
  assert.ok(coach.includes('api.getCoachDismissals()'));
  assert.ok(coach.includes('api.syncCoachDismissals(records)'));
  assert.ok(coach.includes('Button("Dismiss for today"'));
  assert.ok(coach.includes('Button("Hide this pattern"'));
  assert.ok(coach.includes('Button("Not useful", action: onNotUseful)'));
  assert.ok(coach.includes('Button("Why am I seeing this?")'));
  assert.ok(coach.includes('AICoachWhySheet(suggestion: suggestion)'));
  assert.ok(coach.includes('Section("Evidence")'));
  assert.ok(coach.includes('Section("Confidence")'));
  assert.ok(coach.includes('detailRow("Confidence"'));
  assert.ok(coach.includes('suggestion.modelSource.label'));
  assert.ok(coach.includes('.frame(width: 48, height: 48)'));
  assert.ok(coach.includes('.accessibilityLabel("\\(CoachBrand.name) AI suggestion")'));
  assert.ok(coach.includes('.accessibilityHint("Opens options to explain or dismiss this suggestion")'));
  assert.ok(coach.includes('.accessibilityLabel("Evidence: \\(suggestion.evidence.joined(separator: ", "))")'));
  assert.ok(coach.indexOf('Text(suggestion.title)') < coach.indexOf('Text(CoachBrand.name)'));
  assert.ok(coach.indexOf('Text(suggestion.message)') > coach.indexOf('.accessibilityLabel("Dismiss \\(CoachBrand.name) suggestion")'));
  assert.ok(settings.includes('@AppStorage(CoachSettingKeys.enabled)'));
  assert.ok(settings.includes('@AppStorage(CoachSettingKeys.mode)'));
  assert.ok(settings.includes('@AppStorage(CoachSettingKeys.disabledCategories)'));
  assert.ok(settings.includes('Picker("Mode", selection: compassModeBinding)'));
  assert.ok(settings.includes('ForEach(CoachMode.allCases)'));
  assert.ok(settings.includes('ForEach(CoachCategoryPreference.allCases)'));
  assert.ok(settings.includes('compassCategoryBinding(for: preference)'));
  assert.ok(settings.includes('CoachNarrator.availabilitySummary'));
  assert.ok(settings.includes('legacyAICoachEnabled = mode != .off'));
  assert.ok(settings.includes('api.resetSyncedCoachDismissals()'));
  assert.ok(settings.includes('Reset Dismissed Suggestions'));
  assert.ok(settings.includes('coachDismissals.resetDismissals()'));
});

test('iOS Coach Tony P. computes candidates off the render path', () => {
  const coach = read('ios/DailyMacros/DailyMacros/AICoach.swift');
  const macros = read('ios/DailyMacros/DailyMacros/MacrosView.swift');
  const workouts = read('ios/DailyMacros/DailyMacros/WorkoutsView.swift');
  const weight = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const views = [macros, workouts, weight, health];

  assert.ok(coach.includes('actor CoachCandidateWorker'));
  assert.ok(coach.includes('actor CoachNarrationWorker'));
  assert.ok(coach.includes('CoachNarrationWorker.shared.narrate'));
  assert.ok(macros.includes('CoachCandidateWorker.shared.macros'));
  assert.ok(workouts.includes('CoachCandidateWorker.shared.workouts'));
  assert.ok(weight.includes('CoachCandidateWorker.shared.weight'));
  assert.ok(health.includes('CoachCandidateWorker.shared.sleep'));
  assert.ok(macros.includes('@State private var coachSuggestions: [CoachSuggestion] = []'));
  assert.ok(workouts.includes('@State private var coachSuggestions: [CoachSuggestion] = []'));
  assert.ok(weight.includes('@State private var coachSuggestions: [CoachSuggestion] = []'));
  assert.ok(health.includes('@State private var sleepCoachSuggestions: [CoachSuggestion] = []'));
  for (const view of views) {
    assert.equal(/suggestions:\s*CoachCandidateEngine\./.test(view), false);
  }
});

test('web Coach Tony P. renders local suggestions with synced dismissals', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const coachRules = read('public/coach-rules.js');
  const styles = read('public/styles.css');
  const coachSection = script.slice(
    script.indexOf('const WEB_COACH_LOCAL_DISMISSALS_KEY'),
    script.indexOf('function getLogPaging')
  );

  assert.ok(html.includes('id="macros-coach"'));
  assert.ok(html.includes('id="workout-coach"'));
  assert.ok(html.includes('id="weight-coach"'));
  assert.ok(html.includes('id="sleep-coach"'));
  assert.ok(html.includes('/coach-rules.js'));
  assert.ok(styles.includes('.coach-card'));
  assert.ok(styles.includes('linear-gradient(125deg'));
  assert.ok(styles.includes('.coach-icon'));
  assert.ok(script.includes("api('/api/coach/dismissals'"));
  assert.ok(script.includes("api('/api/coach/dismissals',"));
  assert.ok(script.includes('WEB_COACH_LOCAL_DISMISSALS_KEY'));
  assert.ok(script.includes('WEB_COACH_DISABLED_CATEGORIES_KEY'));
  assert.ok(script.includes('DailyMacrosCoachRules'));
  assert.ok(script.includes('isCoachCategoryDisabled(candidate)'));
  assert.ok(script.includes('account-coach-category-toggle'));
  assert.ok(coachRules.includes('coachEndOfTodayIso'));
  assert.ok(coachRules.includes('buildMacroCoachSuggestions'));
  assert.ok(coachRules.includes('buildWorkoutCoachSuggestions'));
  assert.ok(coachRules.includes('buildWeightCoachSuggestions'));
  assert.ok(coachRules.includes('buildSleepCoachSuggestions'));
  assert.ok(script.includes('confidence >= 0.85'));
  assert.ok(script.includes('Coach Tony P.'));
  assert.ok(script.includes('Local rules'));
  assert.ok(script.includes('High confidence'));
  assert.ok(script.includes('data-coach-why="1"'));
  assert.ok(script.includes('showCoachWhyModal'));
  assert.ok(script.includes('Why am I seeing this?'));
  assert.ok(script.includes('suggestion.modelSource'));
  assert.ok(styles.includes('.coach-why-modal'));
  assert.ok(script.includes('Dismiss today'));
  assert.ok(script.includes('Hide pattern'));
  assert.ok(script.includes('Not useful'));
  assert.ok(script.includes("renderCoachForPage('macros')"));
  assert.ok(script.includes("renderCoachForPage('workout')"));
  assert.ok(script.includes("renderCoachForPage('weight')"));
  assert.ok(script.includes("renderCoachForPage('sleep')"));
  assert.equal(coachSection.includes('OpenAI'), false);
  assert.equal(coachSection.includes('/api/parse'), false);
});

test('iOS Coach Tony P. uses learned meal windows and action context', () => {
  const coach = read('ios/DailyMacros/DailyMacros/AICoach.swift');
  const macros = read('ios/DailyMacros/DailyMacros/MacrosView.swift');
  const workouts = read('ios/DailyMacros/DailyMacros/WorkoutsView.swift');

  assert.ok(coach.includes('private enum CoachDaypart'));
  assert.ok(coach.includes('learnedMealWindow(for: daypart'));
  assert.ok(coach.includes('summary.latestFirstLogHour + 1'));
  assert.ok(coach.includes('days.count >= 3'));
  assert.ok(coach.includes('macroEndOfDaySteering('));
  assert.ok(coach.includes('category: "steering"'));
  assert.ok(coach.includes('proteinProgress + 0.15 < calorieProgress'));
  assert.ok(coach.includes('caloriesRemaining >= max(250, targets.calories * 0.15)'));
  assert.ok(coach.includes('case logMealItem'));
  assert.ok(coach.includes('case logWorkoutEntry'));
  assert.ok(coach.includes('mealItem: match.mealItem'));
  assert.ok(coach.includes('.filter { alcoholTag(for: $0.itemName) == nil }'));
  assert.ok(coach.includes('repeatWorkoutPrompt(entries: entries'));
  assert.ok(coach.includes('workout: match.workout'));
  assert.ok(coach.includes('workout-calorie-trend-'));
  assert.ok(coach.includes('baselineCalories > 0'));
  assert.ok(coach.includes('abs(calorieDelta) >= 0.15'));
  assert.ok(coach.includes('workoutSleepRecoveryGuardrail('));
  assert.ok(coach.includes('category: "recovery"'));
  assert.ok(coach.includes('sleepShortfall >= 0.75'));
  assert.ok(coach.includes('highIntensityDays.count >= 2'));
  assert.ok(workouts.includes('@State private var sleepDailyTotals: [SleepDailyTotals] = []'));
  assert.ok(workouts.includes('sleepDailyTotals: sleepDailyTotals'));
  assert.ok(workouts.includes('loadWorkoutRecoveryContext()'));
  assert.ok(workouts.includes('api.getSleepEntries(scope: "week", limit: 1)'));
  assert.ok(coach.includes('category: "goal_tracking"'));
  assert.ok(coach.includes('weightMaintenanceSuggestion('));
  assert.ok(coach.includes('category: "maintenance"'));
  assert.ok(coach.includes('sorted.count >= 5'));
  assert.ok(coach.includes('spanDays >= 10'));
  assert.ok(coach.includes('outsideBand.isEmpty'));
  assert.ok(coach.includes('weightPlateauSuggestion(entries: sorted'));
  assert.ok(coach.includes('category: "plateau"'));
  assert.ok(coach.includes('recentTwentyEight.count >= 8'));
  assert.ok(coach.includes('spanDays >= 21'));
  assert.ok(coach.includes('distanceToGoal > 1.5, abs(delta) <= 0.35'));
  assert.ok(coach.includes('weightMacroConsistencySuggestion('));
  assert.ok(coach.includes('category: "cross_page"'));
  assert.ok(coach.includes('completeMacroDays.count >= 10'));
  assert.ok(coach.includes('patternThreshold = max(5'));
  assert.ok(coach.includes('!movingTowardGoal || abs(rollingChange) <= 0.35'));
  assert.ok(coach.includes('sleepTargetStreakSuggestion('));
  assert.ok(coach.includes('streakCount >= 3'));
  assert.ok(coach.includes('consecutive target nights'));
  assert.ok(coach.includes('sleepImprovementSuggestion('));
  assert.ok(coach.includes('category: "alcohol"'));
  assert.ok(coach.includes('alcoholTag(for:'));
  assert.ok(coach.includes('savedItemCleanupPrompt(savedItems:'));
  assert.ok(coach.includes('category: "cleanup"'));
  assert.ok(macros.includes('savedItems: savedItems'));
  assert.ok(coach.includes('Wake-ups are also repeatedly elevated'));
  assert.ok(macros.includes('private func handleCoachAction(_ action: CoachAction)'));
  assert.ok(macros.includes('quickSearchText = action.type == .openQuickAdd ? (action.searchText ?? "") : ""'));
  assert.ok(macros.includes('private func logCoachMealItem(_ mealItem: CoachMealItemPayload) async'));
  const weight = read('ios/DailyMacros/DailyMacros/WeightView.swift');
  assert.ok(weight.includes('@State private var macroDailyTotals: [DailyTotals] = []'));
  assert.ok(weight.includes('macroDailyTotals: macroDailyTotals'));
  assert.ok(weight.includes('loadWeightMacroContext()'));
  assert.ok(weight.includes('api.getDailyTotals(scope: "month")'));
  assert.ok(workouts.includes('private func logCoachWorkout(_ workout: CoachWorkoutPayload) async'));
});

test('iOS app includes onboarding reminders offline queue and diagnostics foundations', () => {
  const project = read('ios/DailyMacros/DailyMacros.xcodeproj/project.pbxproj');
  const app = read('ios/DailyMacros/DailyMacros/DailyMacrosApp.swift');
  const settings = read('ios/DailyMacros/DailyMacros/SettingsView.swift');
  const api = read('ios/DailyMacros/DailyMacros/APIClient.swift');
  const auth = read('ios/DailyMacros/DailyMacros/AuthManager.swift');
  const models = read('ios/DailyMacros/DailyMacros/Models.swift');
  const onboarding = read('ios/DailyMacros/DailyMacros/OnboardingView.swift');
  const reminders = read('ios/DailyMacros/DailyMacros/ReminderScheduler.swift');
  const offline = read('ios/DailyMacros/DailyMacros/OfflineMutationStore.swift');
  const diagnostics = read('ios/DailyMacros/DailyMacros/Diagnostics.swift');

  assert.ok(project.includes('OnboardingView.swift in Sources'));
  assert.ok(project.includes('ReminderScheduler.swift in Sources'));
  assert.ok(project.includes('OfflineMutationStore.swift in Sources'));
  assert.ok(project.includes('Diagnostics.swift in Sources'));
  assert.ok(app.includes('@AppStorage("onboarding_complete")'));
  assert.ok(app.includes('@AppStorage("last_setup_tutorial_reset_at")'));
  assert.ok(app.includes('OnboardingView(isComplete: $onboardingComplete)'));
  assert.ok(app.includes('applySetupTutorialReset(auth.user?.setupTutorialResetAt)'));
  assert.ok(app.includes('api.flushPendingMutations()'));
  assert.ok(auth.includes('func refreshUser() async'));
  assert.ok(models.includes('let setupTutorialResetAt: String?'));
  assert.ok(onboarding.includes('Set Up DailyMacros'));
  assert.ok(onboarding.includes('private enum SetupStep'));
  assert.ok(onboarding.includes('case macros'));
  assert.ok(onboarding.includes('case workouts'));
  assert.ok(onboarding.includes('case weight'));
  assert.ok(onboarding.includes('case sleep'));
  assert.ok(onboarding.includes('case targets'));
  assert.ok(onboarding.includes('api.parseMeal(text: mealText, consumedAt: consumedAt)'));
  assert.ok(onboarding.includes('api.saveMealEntries('));
  assert.ok(onboarding.includes('Quick Add reuses saved or recent meals'));
  assert.ok(onboarding.includes('Describe a workout in natural language'));
  assert.ok(onboarding.includes('Forge: Workout Planner app'));
  assert.ok(onboarding.includes('Bidirectional Apple Health sync can import Health weight entries'));
  assert.ok(onboarding.includes('Bidirectional Apple Health sync can import Health sleep sessions'));
  assert.ok(onboarding.includes('targetField("Calories", text: $calorieTarget)'));
  assert.ok(onboarding.includes('targetField("Carbs (g)", text: $carbsTarget)'));
  assert.ok(onboarding.includes('targetField("Fat (g)", text: $fatTarget)'));
  assert.ok(onboarding.includes('targetField("Calories burned per week", text: $workoutCaloriesTarget)'));
  assert.ok(onboarding.includes('api.getDashboard(limit: 1)'));
  assert.ok(onboarding.includes('api.getWeightTarget()'));
  assert.ok(onboarding.includes('setMacroTarget(macro: "carbs"'));
  assert.ok(onboarding.includes('setMacroTarget(macro: "fat"'));
  assert.ok(onboarding.includes('setMacroTarget(macro: "workout_calories"'));
  assert.ok(onboarding.includes('setMacroTarget(macro: "sleep_hours"'));
  assert.equal(onboarding.includes('Current weight'), false);
  assert.equal(onboarding.includes('addWeight(weight, loggedAt:'), false);
  assert.ok(onboarding.includes('setWeightTarget(targetWeight: weight'));
  assert.ok(onboarding.includes('ReminderScheduler.shared.setEnabled'));
  assert.ok(reminders.includes('UNUserNotificationCenter'));
  assert.ok(settings.includes('Daily Reminder'));
  assert.ok(settings.includes('@AppStorage("onboarding_complete")'));
  assert.ok(settings.includes('Reset Setup Tutorial'));
  assert.ok(settings.includes('onboardingComplete = false'));
  assert.ok(settings.includes('Offline Queue'));
  assert.ok(settings.includes('Export Diagnostics'));
  assert.ok(offline.includes('struct PendingMutation'));
  assert.ok(api.includes('queueMutation(path: "/entries/bulk"'));
  assert.ok(api.includes('func flushPendingMutations()'));
  assert.ok(diagnostics.includes('Logger(subsystem: "com.dailymacros.app"'));
});

test('meal logging surfaces barcode lookup beside photo and camera', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const macros = read('ios/DailyMacros/DailyMacros/MacrosView.swift');
  const api = read('ios/DailyMacros/DailyMacros/APIClient.swift');
  const models = read('ios/DailyMacros/DailyMacros/Models.swift');
  const project = read('ios/DailyMacros/DailyMacros.xcodeproj/project.pbxproj');
  const scanner = read('ios/DailyMacros/DailyMacros/BarcodeScannerView.swift');

  assert.equal(html.includes('id="barcode-lookup-btn"'), true);
  assert.equal(script.includes('const barcodeLookupBtnEl'), true);
  assert.equal(script.includes('/api/barcode/${encodeURIComponent(barcode)}'), true);
  assert.equal(macros.includes('Label') && macros.includes('barcode.viewfinder'), true);
  assert.equal(macros.includes('BarcodeScannerView'), true);
  assert.equal(macros.includes('lookupBarcode(code)'), true);
  assert.equal(api.includes('func lookupBarcode'), true);
  assert.equal(models.includes('struct BarcodeLookupResponse'), true);
  assert.equal(project.includes('BarcodeScannerView.swift in Sources'), true);
  assert.equal(scanner.includes('AVCaptureMetadataOutputObjectsDelegate'), true);
  assert.equal(scanner.includes('.ean13'), true);
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

test('sleep entries capture quality on web and iOS', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const health = read('ios/DailyMacros/DailyMacros/HealthView.swift');
  const api = read('ios/DailyMacros/DailyMacros/APIClient.swift');
  const models = read('ios/DailyMacros/DailyMacros/Models.swift');

  assert.equal(html.includes('id="sleep-quality"'), true);
  assert.equal(html.includes('<option value="3" selected>Okay</option>'), true);
  assert.equal(script.includes('const sleepQualityEl'), true);
  assert.equal(script.includes('SLEEP_QUALITY_LABELS'), true);
  assert.equal(script.includes('body: JSON.stringify({ durationHours, wakeUps, quality, loggedAt })'), true);
  assert.equal(script.includes('qualityLabel = quality ? ` · ${sleepQualityLabel(quality)} sleep` : \'\''), true);
  assert.equal(models.includes('let quality: Int?'), true);
  assert.equal(api.includes('func addSleepEntry(durationHours: Double, wakeUps: Int, quality: Int? = nil'), true);
  assert.equal(api.includes('payload["quality"] = quality.map { $0 as Any } ?? NSNull()'), true);
  assert.equal(health.includes('@State private var sleepQuality = "3"'), true);
  assert.equal(health.includes('sleepQualityPicker(selection: $sleepQuality)'), true);
  assert.equal(health.includes('sleepQualityPicker(selection: $editSleepQuality)'), true);
  assert.equal(health.includes('sleepQualityLabel(_ quality: Int?)'), true);
  assert.equal(health.includes('let qualityChanged = sleepQualityValue(from: editSleepQuality) != entry.quality'), true);
});
