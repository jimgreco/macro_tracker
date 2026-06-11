const state = {
  parsedMeal: null,
  savedItems: [],
  historyQuickItems: [],
  quickEntriesLoading: false,
  quickEntriesLoaded: false,
  quickEntriesError: '',
  quickSearchQuery: '',
  quickSelectedKey: '',
  quickPickerOpen: false,
  quickPickerShowAll: false,
  quickPickerActiveIndex: -1,
  editingEntryId: null,
  mealImageAttachments: [],
  mealImageLoading: false,
  selectedEntriesDay: '',
  dashboardData: null,
  selectedTrendMacro: 'calories',
  selectedPage: 'macros',
  pendingWorkout: null,
  weightChartRows: [],
  weightTarget: null,
  workoutChartRows: [],
  workoutCalChartRows: [],
  analysisReport: null,
  weeklyRecap: null,
  analysisAutoRan: false,
  macroTargetHistory: [],
  macroTargetHistoryByDay: new Map(),
  macroSnapshotPeriod: 'weekly',
  weightSnapshotPeriod: 'weekly',
  workoutSnapshotPeriod: 'weekly',
  healthSnapshotPeriod: 'weekly',
  sleepSnapshotPeriod: 'weekly',
  sleepTargetHours: 8,
  healthEntries: [],
  healthOccurrenceRows: [],
  sleepEntries: [],
  sleepChartRows: [],
  weightEntries: [],
  weightChartEntries: [],
  workoutEntries: [],
  workoutOccurrenceRows: [],
  coachDismissalsLoaded: false,
  coachDismissals: {
    today: new Map(),
    pattern: new Set()
  },
  visibleCoachSuggestions: {},
  disabledCoachCategories: new Set(),
  expandedMealGroups: new Set(),
  selectedEntryIds: new Set(),
  selectedMealGroups: new Set(),
  editingEntries: false,
  appVersion: null,
  currentUser: null,
  features: {
    sexualActivity: false
  },
  sexualActivityPageVisible: true,
  logPaging: {
    weight: { offset: 0, hasMore: true, loading: false },
    workout: { offset: 0, hasMore: true, loading: false },
    sleep: { offset: 0, hasMore: true, loading: false },
    health: { offset: 0, hasMore: true, loading: false }
  }
};

const BUILD_HASH_DIGITS = 7;
const LOG_PAGE_SIZE = 30;
const MAX_MEAL_PARSE_IMAGES = 4;
const WEB_COACH_DISABLED_CATEGORIES_KEY = 'daily_macros_coach_disabled_categories';
const WEB_SEXUAL_ACTIVITY_PAGE_VISIBLE_KEY = 'daily_macros_sexual_activity_page_visible';

function formatBuildLabel(build) {
  const value = String(build || '').trim();
  if (/^[0-9a-f]{8,40}$/i.test(value)) {
    return value.slice(0, BUILD_HASH_DIGITS);
  }
  return value;
}

state.disabledCoachCategories = readDisabledCoachCategories();
state.sexualActivityPageVisible = readSexualActivityPageVisible();

const mealTextEl = document.getElementById('meal-text');
const consumedAtEl = document.getElementById('consumed-at');
const parseBtnEl = document.getElementById('parse-btn');
const saveParsedBtnEl = document.getElementById('save-parsed-btn');
const addPhotoBtnEl = document.getElementById('add-photo-btn');
const useCameraBtnEl = document.getElementById('use-camera-btn');
const barcodeLookupBtnEl = document.getElementById('barcode-lookup-btn');
const mealPhotoInputEl = document.getElementById('meal-photo-input');
const mealCameraInputEl = document.getElementById('meal-camera-input');
const mealPhotoPreviewWrapEl = document.getElementById('meal-photo-preview-wrap');
const parseNoteEl = document.getElementById('parse-note');
const parsedItemsContainerEl = document.getElementById('parsed-items-container');
const quickComboboxEl = document.getElementById('quick-entry-combobox');
const quickSearchEl = document.getElementById('quick-entry-search');
const quickEntryListboxEl = document.getElementById('quick-entry-listbox');
const quickEntryToggleBtnEl = document.getElementById('quick-entry-toggle-btn');
const quickMultiplierEl = document.getElementById('quick-multiplier');
const quickAddBtnEl = document.getElementById('quick-add-btn');
const quickEditToggleBtnEl = document.getElementById('quick-edit-toggle-btn');
const copyYesterdayBtnEl = document.getElementById('copy-yesterday-btn');
const todayCaloriesEl = document.getElementById('today-calories');
const todayProteinEl = document.getElementById('today-protein');
const todayCarbsEl = document.getElementById('today-carbs');
const todayFatEl = document.getElementById('today-fat');
const todayCaloriesTargetEl = document.getElementById('today-calories-target');
const todayProteinTargetEl = document.getElementById('today-protein-target');
const todayCarbsTargetEl = document.getElementById('today-carbs-target');
const todayFatTargetEl = document.getElementById('today-fat-target');
const todayCaloriesProgressEl = document.getElementById('today-calories-progress');
const todayProteinProgressEl = document.getElementById('today-protein-progress');
const todayCarbsProgressEl = document.getElementById('today-carbs-progress');
const todayFatProgressEl = document.getElementById('today-fat-progress');
const editTargetsLinkEl = document.getElementById('edit-targets-link');
const avgCaloriesEl = document.getElementById('avg-calories');
const avgProteinEl = document.getElementById('avg-protein');
const avgCarbsEl = document.getElementById('avg-carbs');
const avgFatEl = document.getElementById('avg-fat');
const avgCaloriesTargetEl = document.getElementById('avg-calories-target');
const avgProteinTargetEl = document.getElementById('avg-protein-target');
const avgCarbsTargetEl = document.getElementById('avg-carbs-target');
const avgFatTargetEl = document.getElementById('avg-fat-target');
const avgCaloriesProgressEl = document.getElementById('avg-calories-progress');
const avgProteinProgressEl = document.getElementById('avg-protein-progress');
const avgCarbsProgressEl = document.getElementById('avg-carbs-progress');
const avgFatProgressEl = document.getElementById('avg-fat-progress');
const weeklyAvgNoteEl = document.getElementById('weekly-avg-note');
const trendMacroCards = Array.from(document.querySelectorAll('.trend-macro-card'));
const macroProgressCards = Array.from(document.querySelectorAll('.macro-progress-card'));
const trendCanvasEl = document.getElementById('trend-canvas');
const trendTooltipEl = document.getElementById('trend-tooltip');
const trendAverageValueEl = document.getElementById('trend-average-value');
const trendTargetValueEl = document.getElementById('trend-target-value');
const macroSnapshotHeadingEl = document.getElementById('stats-heading');
const macroPeriodToggleEl = document.getElementById('macro-period-toggle');
const weightSnapshotHeadingEl = document.getElementById('weight-snapshot-heading');
const weightPeriodToggleEl = document.getElementById('weight-period-toggle');
const workoutSnapshotHeadingEl = document.getElementById('workout-snapshot-heading');
const workoutPeriodToggleEl = document.getElementById('workout-period-toggle');
const workoutOccurrenceStatEl = document.getElementById('workout-occurrence-stat');
const avgWorkoutsPerWeekEl = document.getElementById('avg-workouts-per-week');
const avgCalBurnedPerWeekEl = document.getElementById('avg-cal-burned-per-week');
const workoutStatTargetEl = document.getElementById('workout-stat-target');
const workoutCalStatTargetEl = document.getElementById('workout-cal-stat-target');
const workoutStatsNoteEl = document.getElementById('workout-stats-note');
const entriesByDayEl = document.getElementById('entries-by-day');
const entriesPrevDayBtnEl = document.getElementById('entries-prev-day-btn');
const entriesNextDayBtnEl = document.getElementById('entries-next-day-btn');
const entriesDayLabelEl = document.getElementById('entries-day-label');
const actionBannerEl = document.getElementById('action-banner');
const profileMenuEl = document.getElementById('profile-menu');
const profileChipEl = document.getElementById('profile-chip');
const profilePopoverEl = document.getElementById('profile-popover');
const profileAvatarEl = document.getElementById('profile-avatar');
const profileNameEl = document.getElementById('profile-name');
const profileEmailEl = document.getElementById('profile-email');
const accountInfoBtnEl = document.getElementById('account-info-btn');
const adminPageBtnEl = document.getElementById('admin-page-btn');
const logoutBtnEl = document.getElementById('logout-btn');
const pageMenuItems = Array.from(document.querySelectorAll('.nav-tab'));
const sexualActivityFeatureEls = Array.from(document.querySelectorAll('.sexual-activity-feature'));
const appPages = {
  macros: document.getElementById('macros-page'),
  weight: document.getElementById('weight-page'),
  workout: document.getElementById('workout-page'),
  sleep: document.getElementById('sleep-page'),
  'sexual-activity': document.getElementById('sexual-activity-page'),
  analysis: document.getElementById('analysis-page')
};
const coachSlotEls = {
  macros: document.getElementById('macros-coach'),
  workout: document.getElementById('workout-coach'),
  weight: document.getElementById('weight-coach'),
  sleep: document.getElementById('sleep-coach')
};
const weightLoggedAtEl = document.getElementById('weight-logged-at');
const weightValueEl = document.getElementById('weight-value');
const saveWeightBtnEl = document.getElementById('save-weight-btn');
const editWeightTargetLinkEl = document.getElementById('edit-weight-target-link');
const weightNoteEl = document.getElementById('weight-note');
const weightCanvasEl = document.getElementById('weight-canvas');
const weightAverageValueEl = document.getElementById('weight-average-value');
const weightTargetDisplayEl = document.getElementById('weight-target-display');
const weightLogListEl = document.getElementById('weight-log-list');
const workoutTextEl = document.getElementById('workout-text');
const parseWorkoutBtnEl = document.getElementById('parse-workout-btn');
const syncWorkoutsBtnEl = document.getElementById('sync-workouts-btn');
const workoutEditorEl = document.getElementById('workout-editor');
const workoutDescriptionEl = document.getElementById('workout-description');
const workoutHoursEl = document.getElementById('workout-hours');
const workoutCaloriesEl = document.getElementById('workout-calories');
const workoutIntensityEl = document.getElementById('workout-intensity');
const workoutLoggedAtEl = document.getElementById('workout-logged-at');
const saveWorkoutBtnEl = document.getElementById('save-workout-btn');
const workoutQuickListEl = document.getElementById('workout-quick-list');
const workoutLogListEl = document.getElementById('workout-log-list');
const workoutCanvasEl = document.getElementById('workout-canvas');
const workoutCalCanvasEl = document.getElementById('workout-cal-canvas');
const weightTooltipEl = document.getElementById('weight-tooltip');
const workoutCalTooltipEl = document.getElementById('workout-cal-tooltip');
const workoutCalAverageValueEl = document.getElementById('workout-cal-average-value');
const workoutCalTargetDisplayEl = document.getElementById('workout-cal-target-display');
const editWorkoutTargetLinkEl = document.getElementById('edit-workout-target-link');
const sleepLoggedAtEl = document.getElementById('sleep-logged-at');
const sleepHoursEl = document.getElementById('sleep-hours');
const sleepWakeUpsEl = document.getElementById('sleep-wake-ups');
const sleepQualityEl = document.getElementById('sleep-quality');
const sleepNotesEl = document.getElementById('sleep-notes');
const saveSleepBtnEl = document.getElementById('save-sleep-btn');
const sleepLogListEl = document.getElementById('sleep-log-list');
const sleepCanvasEl = document.getElementById('sleep-canvas');
const sleepSnapshotHeadingEl = document.getElementById('sleep-snapshot-heading');
const sleepPeriodToggleEl = document.getElementById('sleep-period-toggle');
const sleepAverageValueEl = document.getElementById('sleep-average-value');
const sleepTargetValueEl = document.getElementById('sleep-target-value');
const sleepTooltipEl = document.getElementById('sleep-tooltip');
const editSleepTargetLinkEl = document.getElementById('edit-sleep-target-link');
const healthLoggedAtEl = document.getElementById('health-logged-at');
const healthActivityTypeEl = document.getElementById('health-activity-type');
const saveHealthBtnEl = document.getElementById('save-health-btn');
const healthNoteEl = document.getElementById('health-note');
const healthLogListEl = document.getElementById('health-log-list');
const healthCanvasEl = document.getElementById('health-canvas');
const healthSnapshotHeadingEl = document.getElementById('health-snapshot-heading');
const healthPeriodToggleEl = document.getElementById('health-period-toggle');
const healthOccurrenceStatEl = document.getElementById('health-occurrence-stat');
const analysisDaysEl = document.getElementById('analysis-days');
const analysisGenerateBtnEl = document.getElementById('analysis-generate-btn');
const analysisNoteEl = document.getElementById('analysis-note');
const analysisMetaEl = document.getElementById('analysis-meta');
const analysisSummaryEl = document.getElementById('analysis-summary');
const analysisGoalListEl = document.getElementById('analysis-goal-list');
const analysisAdherenceListEl = document.getElementById('analysis-adherence-list');
const analysisWowListEl = document.getElementById('analysis-wow-list');
const analysisNutritionListEl = document.getElementById('analysis-nutrition-list');
const analysisConfidenceListEl = document.getElementById('analysis-confidence-list');
const analysisProgressListEl = document.getElementById('analysis-progress-list');
const analysisNeedsListEl = document.getElementById('analysis-needs-list');
const analysisNextWeekListEl = document.getElementById('analysis-nextweek-list');
const weeklyRecapMetaEl = document.getElementById('weekly-recap-meta');
const weeklyRecapSummaryEl = document.getElementById('weekly-recap-summary');
const weeklyRecapWinsListEl = document.getElementById('weekly-recap-wins');
const weeklyRecapFocusListEl = document.getElementById('weekly-recap-focus');
const weeklyRecapActionsListEl = document.getElementById('weekly-recap-actions');
const defaultMealTextPlaceholder = mealTextEl ? mealTextEl.placeholder : '';

function toDateTimeLocalValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function isoToLocalInputValue(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return toDateTimeLocalValue();
  }
  return toDateTimeLocalValue(date);
}

function asIso(localValue) {
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function fmtNumber(value) {
  return Number(value || 0).toFixed(1).replace('.0', '');
}

function parseWeightInputValue(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function setText(el, value) {
  if (el) {
    el.textContent = value;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeJsonAttr(value) {
  return escapeAttr(JSON.stringify(value));
}

function safeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? String(id) : '';
}

function getLocalIsoDay(dateLike = new Date()) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch (_e) {
    return 'America/New_York';
  }
}

function getTimezone() {
  return state.currentUser?.timezone || detectBrowserTimezone();
}

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Athens',
  'Europe/Istanbul',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Pacific/Auckland'
];

function supportedTimezones() {
  let zones = [];
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      zones = Intl.supportedValuesOf('timeZone');
    }
  } catch (_error) {
    zones = [];
  }
  return zones.length ? zones : FALLBACK_TIMEZONES;
}

function renderTimezoneOptions(selectedTimezone, browserTimezone) {
  const zones = new Set(supportedTimezones());
  if (selectedTimezone) zones.add(selectedTimezone);
  if (browserTimezone) zones.add(browserTimezone);
  return Array.from(zones)
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => `<option value="${escapeAttr(zone)}"${zone === selectedTimezone ? ' selected' : ''}>${escapeHtml(zone)}</option>`)
    .join('');
}

function fromIsoDayLocal(isoDay) {
  const [year, month, day] = String(isoDay).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function shiftIsoDay(isoDay, deltaDays) {
  const date = fromIsoDayLocal(isoDay);
  date.setDate(date.getDate() + deltaDays);
  return getLocalIsoDay(date);
}

function formatIsoDayLabel(isoDay) {
  const date = fromIsoDayLocal(isoDay);
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

let actionBannerTimer = null;
let trendPointCoords = [];
let trendInteractionsBound = false;
let trendResizeBound = false;
let trendMacroBound = false;
let editTargetsBound = false;
let pageChartsResizeBound = false;
let pageChartsResizeTimer = null;

function getTrendMacroConfig(macro = state.selectedTrendMacro) {
  const configs = {
    calories: { label: 'Calories', unit: 'cal' },
    protein: { label: 'Protein', unit: 'g' },
    carbs: { label: 'Carbs', unit: 'g' },
    fat: { label: 'Fat', unit: 'g' }
  };
  return configs[macro] || configs.calories;
}

function setActionBanner(message, type = 'success') {
  if (actionBannerTimer) {
    clearTimeout(actionBannerTimer);
    actionBannerTimer = null;
  }

  actionBannerEl.textContent = message;
  actionBannerEl.className = 'action-banner ' + type;
  actionBannerEl.hidden = !message;

  if (message) {
    actionBannerTimer = setTimeout(() => {
      actionBannerEl.hidden = true;
      actionBannerTimer = null;
    }, 3200);
  }
}

function macroUnit(macro) {
  return macro === 'calories' ? 'cal' : 'g';
}

function setMacroTargetHistory(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  state.macroTargetHistory = normalizedRows;
  state.macroTargetHistoryByDay = new Map(
    normalizedRows
      .filter((row) => row && row.day && row.targets)
      .map((row) => [row.day, row.targets])
  );
}

function targetsForDay(day, fallback = state.dashboardData?.targets || {}) {
  return state.macroTargetHistoryByDay.get(day) || fallback || {};
}

function averageTargetsForRows(rows, fallback = state.dashboardData?.targets || {}) {
  const sourceRows = (rows || []).filter((row) => row && row.day);
  if (!sourceRows.length) {
    return fallback || {};
  }

  const totals = {};
  for (const macro of ['calories', 'protein', 'carbs', 'fat', 'workouts', 'workout_calories', 'sleep_hours']) {
    let sum = 0;
    let count = 0;
    for (const row of sourceRows) {
      const rowTargets = row.targets || targetsForDay(row.day, fallback);
      const value = Number(rowTargets?.[macro] || 0);
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    totals[macro] = count > 0 ? sum / count : Number(fallback?.[macro] || 0);
  }
  return totals;
}

function mergeTodayTargets(updates) {
  const day = getLocalIsoDay();
  const current = targetsForDay(day, state.dashboardData?.targets || {});
  const nextTargets = { ...current, ...(updates || {}) };
  setMacroTargetHistory([
    ...state.macroTargetHistory.filter((row) => row?.day !== day),
    { day, targets: nextTargets }
  ]);
}

function getMacroTargetElements() {
  return {
    calories: todayCaloriesTargetEl,
    protein: todayProteinTargetEl,
    carbs: todayCarbsTargetEl,
    fat: todayFatTargetEl
  };
}

function getDayProgressElements() {
  return {
    calories: todayCaloriesProgressEl,
    protein: todayProteinProgressEl,
    carbs: todayCarbsProgressEl,
    fat: todayFatProgressEl
  };
}

function applyMacroProgressCard(macro, currentValue, targetValue) {
  const card = macroProgressCards.find((item) => item.dataset.progressMacro === macro);
  if (!card) {
    return;
  }

  const target = Number(targetValue || 0);
  const current = Number(currentValue || 0);
  const progress = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0;

  card.style.setProperty('--macro-progress', `${progress}%`);
}

function renderMacroTargets(dayTotals, targets) {
  const targetMap = targets || {};
  const labelEls = getMacroTargetElements();
  const progressEls = getDayProgressElements();
  for (const macro of ['calories', 'protein', 'carbs', 'fat']) {
    const target = Number(targetMap[macro] || 0);
    const current = Number(dayTotals[macro] || 0);
    const labelEl = labelEls[macro];
    const progressEl = progressEls[macro];
    if (labelEl) {
      if (target > 0) {
        labelEl.textContent = `Target: ${fmtNumber(target)} ${macroUnit(macro)}`;
      } else {
        labelEl.textContent = 'Target: none';
      }
    }
    if (progressEl) {
      if (target > 0) {
        const pct = Math.max(0, Math.min(999, (current / target) * 100));
        progressEl.textContent = `${Math.round(pct)}%`;
      } else {
        progressEl.textContent = '';
      }
    }
    applyMacroProgressCard(macro, current, target);
  }
}

function renderWeeklyTargets(weeklyAverages, targets) {
  const targetMap = targets || {};
  const labelEls = {
    calories: avgCaloriesTargetEl,
    protein: avgProteinTargetEl,
    carbs: avgCarbsTargetEl,
    fat: avgFatTargetEl
  };
  const progressEls = {
    calories: avgCaloriesProgressEl,
    protein: avgProteinProgressEl,
    carbs: avgCarbsProgressEl,
    fat: avgFatProgressEl
  };

  for (const macro of ['calories', 'protein', 'carbs', 'fat']) {
    const target = Number(targetMap[macro] || 0);
    const current = Number(weeklyAverages[macro] || 0);
    const labelEl = labelEls[macro];
    const progressEl = progressEls[macro];
    if (labelEl) {
      if (target > 0) {
        labelEl.textContent = `Target: ${fmtNumber(target)} ${macroUnit(macro)}`;
      } else {
        labelEl.textContent = 'Target: none';
      }
    }
    if (progressEl) {
      if (target > 0) {
        const pct = Math.max(0, Math.min(999, (current / target) * 100));
        progressEl.textContent = `${Math.round(pct)}%`;
      } else {
        progressEl.textContent = '';
      }
    }
    applyMacroProgressCard(macro, current, target);
  }
}

function showEditTargetsModal() {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const targets = state.dashboardData?.targets || {};
  const macros = ['calories', 'protein', 'carbs', 'fat'];

  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Macro Targets</h3>
      ${macros.map((m) => {
        const val = Number(targets[m] || 0);
        return `<label for="target-modal-${m}">${m.charAt(0).toUpperCase() + m.slice(1)} (${macroUnit(m)})</label>
      <input id="target-modal-${m}" type="number" step="1" min="0" value="${escapeAttr(val > 0 ? val : '')}" placeholder="No target" />`;
      }).join('\n      ')}
      <div class="combine-modal-actions">
        <button type="button" class="btn-muted table-action-btn" id="target-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="target-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('target-modal-calories').focus();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('target-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  document.getElementById('target-modal-save-btn').addEventListener('click', async () => {
    const updates = {};
    for (const m of macros) {
      const raw = document.getElementById(`target-modal-${m}`).value.trim();
      const val = raw ? Number(raw) : 0;
      if (raw && (!Number.isFinite(val) || val < 0)) {
        setActionBanner(`${m} target must be a number >= 0.`, 'error');
        return;
      }
      updates[m] = val;
    }
    overlay.remove();
    try {
      for (const m of macros) {
        await api(`/api/macro-targets/${m}`, {
          method: 'PUT',
          body: JSON.stringify({ target: updates[m], effectiveDate: getLocalIsoDay(), tz: getTimezone() })
        });
      }
      if (state.dashboardData) {
        state.dashboardData.targets = state.dashboardData.targets || {};
        Object.assign(state.dashboardData.targets, updates);
        mergeTodayTargets(updates);
        renderDashboard(state.dashboardData);
      }
      setActionBanner('Macro targets updated.', 'success');
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('target-modal-save-btn').click(); }
    if (e.key === 'Escape') overlay.remove();
  });
}

function bindEditTargetsLink() {
  if (editTargetsBound) return;
  if (editTargetsLinkEl) {
    editTargetsLinkEl.addEventListener('click', (e) => {
      e.preventDefault();
      showEditTargetsModal();
    });
  }
  editTargetsBound = true;
}

function showWorkoutTargetModal() {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const wTarget = Number(state.dashboardData?.targets?.workouts);
  const currentWorkouts = Number.isFinite(wTarget) && wTarget > 0 ? wTarget : '';
  const cTarget = Number(state.dashboardData?.targets?.workout_calories);
  const currentCals = Number.isFinite(cTarget) && cTarget > 0 ? cTarget : '';

  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Workout Targets</h3>
      <label for="wkt-modal-target">Workouts per week</label>
      <input id="wkt-modal-target" type="number" min="0" max="14" step="1" value="${escapeAttr(currentWorkouts)}" placeholder="No target" />
      <label for="wkt-modal-cal-target">Calories burned per week</label>
      <input id="wkt-modal-cal-target" type="number" min="0" step="50" value="${escapeAttr(currentCals)}" placeholder="No target" />
      <div class="combine-modal-actions">
        <button type="button" class="btn-muted table-action-btn" id="wkt-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="wkt-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('wkt-modal-target').focus();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('wkt-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  document.getElementById('wkt-modal-save-btn').addEventListener('click', async () => {
    const rawWorkouts = document.getElementById('wkt-modal-target').value.trim();
    const rawCals = document.getElementById('wkt-modal-cal-target').value.trim();
    const nextWorkouts = rawWorkouts ? Number(rawWorkouts) : 0;
    const nextCals = rawCals ? Number(rawCals) : 0;
    if (rawWorkouts && (!Number.isFinite(nextWorkouts) || nextWorkouts < 0)) {
      setActionBanner('Workouts target must be a number >= 0.', 'error');
      return;
    }
    if (rawCals && (!Number.isFinite(nextCals) || nextCals < 0)) {
      setActionBanner('Calories target must be a number >= 0.', 'error');
      return;
    }
    const roundedWorkouts = Math.max(0, Math.min(14, Math.round(nextWorkouts)));
    const roundedCals = Math.max(0, Math.round(nextCals));
    overlay.remove();
    try {
      await Promise.all([
        api('/api/macro-targets/workouts', {
          method: 'PUT',
          body: JSON.stringify({ target: roundedWorkouts, effectiveDate: getLocalIsoDay(), tz: getTimezone() })
        }),
        api('/api/macro-targets/workout_calories', {
          method: 'PUT',
          body: JSON.stringify({ target: roundedCals, effectiveDate: getLocalIsoDay(), tz: getTimezone() })
        })
      ]);
      if (state.dashboardData) {
        state.dashboardData.targets = state.dashboardData.targets || {};
        state.dashboardData.targets.workouts = roundedWorkouts;
        state.dashboardData.targets.workout_calories = roundedCals;
        mergeTodayTargets({ workouts: roundedWorkouts, workout_calories: roundedCals });
      }
      renderWorkoutCalChart();
      setActionBanner('Workout targets updated.', 'success');
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('wkt-modal-save-btn').click(); }
    if (e.key === 'Escape') overlay.remove();
  });
}

function setSleepTargetFromTargets(targets) {
  const targetHours = Number(targets?.sleep_hours);
  if (Number.isFinite(targetHours) && targetHours > 0) {
    state.sleepTargetHours = targetHours;
  }
}

function getSleepTargetHours() {
  const targetHours = Number(state.sleepTargetHours);
  return Number.isFinite(targetHours) && targetHours > 0 ? targetHours : 8;
}

function renderSleepTargetLegend() {
  const targetHours = getSleepTargetHours();
  setText(sleepTargetValueEl, `${fmtNumber(targetHours)} hr${targetHours === 1 ? '' : 's'}`);
}

function showSleepTargetModal() {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const currentTarget = getSleepTargetHours();
  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Sleep Target</h3>
      <label for="sleep-target-modal-hours">Target hours per night</label>
      <input id="sleep-target-modal-hours" type="number" min="0.25" max="24" step="0.25" value="${escapeAttr(fmtNumber(currentTarget))}" placeholder="8" />
      <div class="combine-modal-actions">
        <button type="button" class="btn-muted table-action-btn" id="sleep-target-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="sleep-target-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = document.getElementById('sleep-target-modal-hours');
  input.focus();
  input.select();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('sleep-target-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  document.getElementById('sleep-target-modal-save-btn').addEventListener('click', async () => {
    const raw = input.value.trim();
    const targetHours = Number(raw);
    if (!raw || !Number.isFinite(targetHours) || targetHours <= 0 || targetHours > 24) {
      setActionBanner('Sleep target must be greater than 0 and no more than 24 hours.', 'error');
      return;
    }
    const roundedTarget = Math.round(targetHours * 4) / 4;
    overlay.remove();
    try {
      await api('/api/macro-targets/sleep_hours', {
        method: 'PUT',
        body: JSON.stringify({ target: roundedTarget, effectiveDate: getLocalIsoDay(), tz: getTimezone() })
      });
      state.sleepTargetHours = roundedTarget;
      state.dashboardData = state.dashboardData || {};
      state.dashboardData.targets = state.dashboardData.targets || {};
      state.dashboardData.targets.sleep_hours = roundedTarget;
      mergeTodayTargets({ sleep_hours: roundedTarget });
      renderSleepChart();
      setActionBanner('Sleep target updated.', 'success');
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sleep-target-modal-save-btn').click(); }
    if (e.key === 'Escape') overlay.remove();
  });
}


function hideTrendTooltip() {
  if (!trendTooltipEl) {
    return;
  }
  trendTooltipEl.hidden = true;
}

function showTrendTooltipFromClient(clientX, clientY, persist = false) {
  if (!trendCanvasEl || !trendTooltipEl || !trendPointCoords.length) {
    return;
  }

  const rect = trendCanvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const scaleX = trendCanvasEl.width / rect.width;
  const scaleY = trendCanvasEl.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;

  let nearest = null;
  let minDist = Number.POSITIVE_INFINITY;
  for (const point of trendPointCoords) {
    const dx = point.x - x;
    const dy = point.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) {
      minDist = dist;
      nearest = point;
    }
  }

  const threshold = persist ? 42 : 40;
  if (!nearest || minDist > threshold) {
    hideTrendTooltip();
    return;
  }

  const trendMacro = getTrendMacroConfig();
  const pointLabel = nearest.label || formatIsoDayLabel(nearest.day);
  trendTooltipEl.textContent = `${pointLabel}: ${fmtNumber(nearest.value)} ${trendMacro.unit}`;
  trendTooltipEl.hidden = false;

  const wrap = trendCanvasEl.parentElement;
  if (!wrap) {
    return;
  }

  const wrapRect = wrap.getBoundingClientRect();
  const canvasOffsetX = rect.left - wrapRect.left;
  const canvasOffsetY = rect.top - wrapRect.top;
  const cssX = nearest.x / scaleX;
  const cssY = nearest.y / scaleY;

  const tipW = trendTooltipEl.offsetWidth || 0;
  const tipH = trendTooltipEl.offsetHeight || 0;
  const minLeft = tipW / 2 + 8;
  const maxLeft = wrap.clientWidth - tipW / 2 - 8;

  const left = Math.min(Math.max(canvasOffsetX + cssX, minLeft), maxLeft);
  const top = Math.max(canvasOffsetY + cssY, tipH + 10);

  trendTooltipEl.style.left = `${left}px`;
  trendTooltipEl.style.top = `${top}px`;
}

function bindTrendInteractions() {
  if (!trendCanvasEl || trendInteractionsBound) {
    return;
  }

  trendCanvasEl.addEventListener('mousemove', (event) => {
    showTrendTooltipFromClient(event.clientX, event.clientY);
  });

  trendCanvasEl.addEventListener('mouseleave', () => {
    hideTrendTooltip();
  });

  trendCanvasEl.addEventListener('click', (event) => {
    showTrendTooltipFromClient(event.clientX, event.clientY, true);
  });

  trendCanvasEl.addEventListener('touchstart', (event) => {
    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }
    showTrendTooltipFromClient(touch.clientX, touch.clientY, true);
    event.preventDefault();
  }, { passive: false });

  trendInteractionsBound = true;
}

function inferImageMimeType(file) {
  const rawType = String(file?.type || '').toLowerCase();
  if (rawType.startsWith('image/')) {
    return rawType;
  }

  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  return '';
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function readFileAsDataUrl(file) {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const mimeType = inferImageMimeType(file);
    if (!mimeType) {
      throw new Error('Unsupported image type. Use JPEG, PNG, WEBP, GIF, or HEIC.');
    }
    return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  } catch (_error) {
    throw new Error('Unable to read selected image.');
  }
}

function isHeicLikeFile(file) {
  const mimeType = String(file?.type || '').toLowerCase();
  if (mimeType === 'image/heic' || mimeType === 'image/heif' || mimeType === 'image/heic-sequence' || mimeType === 'image/heif-sequence') {
    return true;
  }
  const name = String(file?.name || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

async function handleMealImageSelect(event, sourceLabel) {
  const files = Array.from(event.target?.files || []);
  if (!files.length) {
    return;
  }

  state.mealImageLoading = true;
  setActionBanner(files.length > 1 ? 'Processing selected photos...' : 'Processing selected photo...', 'info');
  try {
    const addedNames = [];
    let heicSelected = false;
    let skippedForLimit = 0;

    for (const file of files) {
      if (state.mealImageAttachments.length >= MAX_MEAL_PARSE_IMAGES) {
        skippedForLimit += 1;
        continue;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const name = file.name || sourceLabel + ' image';
      state.mealImageAttachments.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        dataUrl,
        name
      });
      addedNames.push(name);
      heicSelected = heicSelected || isHeicLikeFile(file);
    }

    renderMealImagePreview();
    if (addedNames.length) {
      const countLabel = addedNames.length === 1 ? '1 image' : `${addedNames.length} images`;
      const selectedMessage = heicSelected
        ? `${countLabel} attached. HEIC/HEIF images will be converted on the server.`
        : `${countLabel} attached.`;
      setActionBanner(selectedMessage + ' You can add an optional description.', 'info');
    }
    if (skippedForLimit > 0) {
      setActionBanner(`A meal parse can include at most ${MAX_MEAL_PARSE_IMAGES} photos or screenshots.`, addedNames.length ? 'info' : 'error');
    }
  } catch (error) {
    setActionBanner(error.message, 'error');
  } finally {
    state.mealImageLoading = false;
    if (event.target) {
      event.target.value = '';
    }
  }
}

function applyMealInputMode() {
  if (!mealTextEl) {
    return;
  }
  mealTextEl.disabled = false;
  mealTextEl.placeholder = state.mealImageAttachments.length
    ? 'Optional: add a description, or parse from photo only.'
    : defaultMealTextPlaceholder;
}

function renderMealImagePreview() {
  const hasImage = state.mealImageAttachments.length > 0;
  if (mealPhotoPreviewWrapEl) {
    mealPhotoPreviewWrapEl.hidden = !hasImage;
    mealPhotoPreviewWrapEl.innerHTML = '';
  }

  if (hasImage && mealPhotoPreviewWrapEl) {
    state.mealImageAttachments.forEach((attachment, index) => {
      const item = document.createElement('div');
      item.className = 'meal-photo-preview-item';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'meal-photo-remove';
      removeBtn.setAttribute('aria-label', `Remove attached photo ${index + 1}`);
      removeBtn.dataset.removeMealImageId = attachment.id;
      removeBtn.textContent = '×';

      const image = document.createElement('img');
      image.alt = attachment.name ? `Attached meal photo preview: ${attachment.name}` : `Attached meal photo preview ${index + 1}`;
      try {
        image.src = attachment.dataUrl;
      } catch (_error) {
        image.removeAttribute('src');
      }

      item.appendChild(removeBtn);
      item.appendChild(image);
      mealPhotoPreviewWrapEl.appendChild(item);
    });
  }
  applyMealInputMode();
}

function removeMealImageAttachment(id) {
  state.mealImageAttachments = state.mealImageAttachments.filter((attachment) => attachment.id !== id);
  renderMealImagePreview();
}

function clearMealImageSelection() {
  state.mealImageAttachments = [];
  state.mealImageLoading = false;
  if (mealPhotoInputEl) {
    mealPhotoInputEl.value = '';
  }
  if (mealCameraInputEl) {
    mealCameraInputEl.value = '';
  }
  renderMealImagePreview();
}

function scaleParsedMealItemsToConsumedTotals(parsedMeal) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items : [];
  const scale = items.length > 1 ? Math.max(Number(parsedMeal.mealQuantity || 1), 0.0001) : 1;
  return items.map((item) => ({
    ...item,
    quantity: Number(item.quantity || 0) * scale,
    calories: Number(item.calories || 0) * scale,
    protein: Number(item.protein || 0) * scale,
    carbs: Number(item.carbs || 0) * scale,
    fat: Number(item.fat || 0) * scale
  }));
}

function appendBarcodeItemToParsedMeal(result, barcode) {
  const item = result.item;
  const productName = result.productName || item.itemName;
  const existingItems = scaleParsedMealItemsToConsumedTotals(state.parsedMeal);
  const nextItems = existingItems.concat([item]);
  const existingName = String(state.parsedMeal?.mealName || '').trim();
  const mealName = existingItems.length
    ? (existingName && existingName !== productName ? existingName : 'Scanned Items')
    : productName;

  state.parsedMeal = {
    mealName,
    mealQuantity: 1,
    mealUnit: nextItems.length > 1 ? 'meal' : 'serving',
    notes: `Loaded ${productName} from barcode ${barcode}.`,
    items: nextItems
  };
  renderParsedItems(state.parsedMeal);
}

async function lookupBarcode(codeInput) {
  const barcode = String(codeInput || '').replace(/\D/g, '');
  if (!/^\d{6,18}$/.test(barcode)) {
    setActionBanner('Enter a 6 to 18 digit barcode.', 'error');
    return;
  }

  setActionBanner('Looking up barcode...', 'info');
  try {
    const result = await api(`/api/barcode/${encodeURIComponent(barcode)}`);
    if (!result.item) {
      throw new Error(result.message || 'Product was found, but nutrition data was incomplete.');
    }

    appendBarcodeItemToParsedMeal(result, barcode);
    setActionBanner(state.parsedMeal.notes, 'success');
  } catch (error) {
    setActionBanner(error.message, 'error');
  }
}


consumedAtEl.value = toDateTimeLocalValue();
renderMealImagePreview();

if (addPhotoBtnEl && mealPhotoInputEl) {
  addPhotoBtnEl.addEventListener('click', () => {
    mealPhotoInputEl.click();
  });

  mealPhotoInputEl.addEventListener('change', (event) => {
    handleMealImageSelect(event, 'Photo');
  });
}

if (useCameraBtnEl && mealCameraInputEl) {
  useCameraBtnEl.addEventListener('click', () => {
    mealCameraInputEl.click();
  });

  mealCameraInputEl.addEventListener('change', (event) => {
    handleMealImageSelect(event, 'Camera');
  });
}

if (barcodeLookupBtnEl) {
  barcodeLookupBtnEl.addEventListener('click', () => {
    const code = window.prompt('Barcode');
    if (code) {
      lookupBarcode(code);
    }
  });
}

if (mealPhotoPreviewWrapEl) {
  mealPhotoPreviewWrapEl.addEventListener('click', (event) => {
    const removeBtn = event.target?.closest?.('[data-remove-meal-image-id]');
    if (!removeBtn) {
      return;
    }
    removeMealImageAttachment(removeBtn.dataset.removeMealImageId);
    setActionBanner('Attached photo removed.', 'info');
  });
}

if (entriesPrevDayBtnEl) {
  entriesPrevDayBtnEl.addEventListener('click', () => {
    if (!state.selectedEntriesDay || !state.dashboardData) {
      return;
    }

    state.selectedEntriesDay = shiftIsoDay(state.selectedEntriesDay, -1);
    renderDashboard(state.dashboardData);
  });
}

if (entriesNextDayBtnEl) {
  entriesNextDayBtnEl.addEventListener('click', () => {
    if (!state.selectedEntriesDay || !state.dashboardData) {
      return;
    }

    const baseDay = getLocalIsoDay();
    if (state.selectedEntriesDay >= baseDay) {
      return;
    }

    state.selectedEntriesDay = shiftIsoDay(state.selectedEntriesDay, 1);
    renderDashboard(state.dashboardData);
  });
}

function setProfileMenuOpen(isOpen) {
  if (!profilePopoverEl || !profileChipEl) {
    return;
  }

  const open = Boolean(isOpen);
  profilePopoverEl.hidden = !open;
  profileChipEl.setAttribute('aria-expanded', String(open));
}

function renderProfile(user) {
  if (!user) {
    profileNameEl.textContent = 'Signed in';
    profileEmailEl.textContent = '';
    profileAvatarEl.removeAttribute('src');
    if (adminPageBtnEl) adminPageBtnEl.hidden = true;
    setProfileMenuOpen(false);
    return;
  }

  profileNameEl.textContent = user.name || 'Google User';
  profileEmailEl.textContent = user.email || '';
  if (adminPageBtnEl) {
    adminPageBtnEl.hidden = !user.isAdmin;
  }
  if (user.picture) {
    try {
      const avatarUrl = new URL(user.picture);
      if (avatarUrl.protocol === 'https:') {
        profileAvatarEl.src = avatarUrl.href;
      } else {
        profileAvatarEl.removeAttribute('src');
      }
    } catch (_error) {
      profileAvatarEl.removeAttribute('src');
    }
  } else {
    profileAvatarEl.removeAttribute('src');
  }
}

function syncFeatureVisibility() {
  const sexualActivityEnabled = Boolean(state.features?.sexualActivity);
  const sexualActivityVisible = sexualActivityEnabled && state.sexualActivityPageVisible !== false;
  for (const el of sexualActivityFeatureEls) {
    el.hidden = !sexualActivityVisible;
  }
  if (!sexualActivityVisible && state.selectedPage === 'sexual-activity') {
    renderActivePage('sleep');
  }
  if (!sexualActivityVisible) {
    state.healthEntries = [];
    state.healthOccurrenceRows = [];
    resetLogPaging('health');
    if (healthLogListEl) {
      healthLogListEl.innerHTML = '';
    }
    if (healthOccurrenceStatEl) {
      healthOccurrenceStatEl.textContent = '—';
    }
    const ctx = healthCanvasEl?.getContext('2d');
    if (ctx && healthCanvasEl) {
      ctx.clearRect(0, 0, healthCanvasEl.width, healthCanvasEl.height);
    }
  }
}

function readSexualActivityPageVisible() {
  try {
    return localStorage.getItem(WEB_SEXUAL_ACTIVITY_PAGE_VISIBLE_KEY) !== 'false';
  } catch (_error) {
    return true;
  }
}

function writeSexualActivityPageVisible(visible) {
  state.sexualActivityPageVisible = Boolean(visible);
  try {
    localStorage.setItem(WEB_SEXUAL_ACTIVITY_PAGE_VISIBLE_KEY, visible ? 'true' : 'false');
  } catch (_error) {
    // Local preference storage is best-effort; keep the in-session value.
  }
}

function canViewCoachSourceDetails() {
  return state.currentUser?.isAdmin === true;
}

function formatMacros(item) {
  return `${fmtNumber(item.calories)} cal | ${fmtNumber(item.protein)}g protein | ${fmtNumber(item.carbs)}g carbs | ${fmtNumber(item.fat)}g fat`;
}

function isCompactMobileView() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function formatSavedItemOption(item) {
  const components = savedItemComponents(item);
  const itemType = components.length ? ` · ${components.length} items` : '';
  if (!isCompactMobileView()) {
    return `${item.name}${itemType} (${formatMacros(item)})`;
  }

  const maxName = 22;
  const name = String(item.name || 'Item');
  const compactName = name.length > maxName ? `${name.slice(0, maxName - 1)}…` : name;
  return `${compactName}${components.length ? `/${components.length}i` : ''} (${fmtNumber(item.calories)}cal/${fmtNumber(item.protein)}P/${fmtNumber(item.carbs)}C/${fmtNumber(item.fat)}F)`;
}

function normalizeQuickSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function quickEntrySearchText(item) {
  const componentText = savedItemComponents(item)
    .map((component) => `${component.itemName || component.name || ''} ${component.unit || ''}`)
    .join(' ');
  return normalizeQuickSearch([
    item.name,
    item.unit,
    componentText,
    fmtNumber(item.calories),
    fmtNumber(item.protein),
    fmtNumber(item.carbs),
    fmtNumber(item.fat),
    'cal',
    'protein',
    'carbs',
    'fat'
  ].join(' '));
}

function matchesQuickSearch(item, query) {
  const normalizedQuery = normalizeQuickSearch(query);
  if (!normalizedQuery) {
    return true;
  }
  const haystack = quickEntrySearchText(item);
  return normalizedQuery.split(/\s+/).every((token) => haystack.includes(token));
}

function syncHistoryQuickItems() {
  state.historyQuickItems = buildHistoryQuickItems(state.dashboardData?.entries || [], state.savedItems);
}

let quickEntriesRequestId = 0;

async function loadQuickEntries({ force = false } = {}) {
  if (state.quickEntriesLoading && !force) {
    return;
  }
  if (state.quickEntriesLoaded && !force) {
    syncHistoryQuickItems();
    renderSavedItems();
    return;
  }

  const requestId = quickEntriesRequestId + 1;
  quickEntriesRequestId = requestId;
  state.quickEntriesLoading = true;
  state.quickEntriesError = '';
  renderSavedItems();

  try {
    const saved = await api('/api/saved-items');
    if (requestId !== quickEntriesRequestId) {
      return;
    }
    state.savedItems = Array.isArray(saved) ? saved : [];
    state.quickEntriesLoaded = true;
    syncHistoryQuickItems();
  } catch (error) {
    if (requestId !== quickEntriesRequestId) {
      return;
    }
    state.quickEntriesError = error.message || 'Could not load quick entries.';
  } finally {
    if (requestId === quickEntriesRequestId) {
      state.quickEntriesLoading = false;
      renderSavedItems();
    }
  }
}

async function refreshProfile() {
  const me = await api('/api/me');
  state.currentUser = me.user || null;
  state.features = {
    sexualActivity: Boolean(me.user?.features?.sexualActivity)
  };
  syncFeatureVisibility();
  renderProfile(state.currentUser);
  renderAllCoachSlots();
}

async function refreshAppVersion() {
  try {
    state.appVersion = await api('/api/version');
  } catch (_error) {
    state.appVersion = null;
  }
}

const diagnosticRecentKeys = new Map();

function sendClientDiagnostic(level, category, message, details = {}) {
  const key = `${level}:${category}:${String(message || '').slice(0, 160)}`;
  const now = Date.now();
  const lastSentAt = diagnosticRecentKeys.get(key) || 0;
  if (now - lastSentAt < 60_000) {
    return;
  }
  diagnosticRecentKeys.set(key, now);
  const payload = {
    level,
    category,
    message: String(message || 'Client diagnostic').slice(0, 1000),
    details,
    userAgent: window.navigator.userAgent,
    appPlatform: 'web',
    appVersion: state.appVersion?.appBuild || 'web'
  };
  fetch('/api/diagnostics/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {});
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const raw = await res.text();
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch (_error) {
      body = {};
    }
  }

  if (!res.ok) {
    const fallback = `Request failed (${res.status})`;
    const requestId = body.requestId || res.headers.get('x-request-id') || '';
    const err = new Error((body.error || fallback) + (requestId ? ` Reference: ${requestId}` : ''));
    err.requestId = requestId;
    if (!String(path).includes('/diagnostics/client')) {
      sendClientDiagnostic('error', 'api', body.error || fallback, {
        path: String(path).slice(0, 300),
        status: res.status,
        requestId
      });
    }
    throw err;
  }
  return body;
}

window.addEventListener('error', (event) => {
  sendClientDiagnostic('error', 'window_error', event.message || 'Unhandled browser error', {
    source: event.filename || '',
    line: event.lineno || 0,
    column: event.colno || 0
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  sendClientDiagnostic('error', 'unhandled_rejection', reason?.message || String(reason || 'Unhandled promise rejection'), {
    stack: String(reason?.stack || '').slice(0, 1000)
  });
});

const WEB_COACH_LOCAL_DISMISSALS_KEY = 'dailyMacrosCompassDismissals:v1';

function coachEndOfTodayIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
}

function readLocalCoachDismissals() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WEB_COACH_LOCAL_DISMISSALS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeLocalCoachDismissals(records) {
  try {
    window.localStorage.setItem(WEB_COACH_LOCAL_DISMISSALS_KEY, JSON.stringify(records || []));
  } catch (_error) {
    // Local storage is best-effort; synced backend dismissals remain authoritative.
  }
}

function currentCoachDismissalRecords() {
  const records = [];
  for (const key of state.coachDismissals.pattern) {
    records.push({ type: 'pattern', key, dismissedUntil: null });
  }
  for (const [key, untilMs] of state.coachDismissals.today) {
    if (untilMs > Date.now()) {
      records.push({
        type: 'today',
        key,
        dismissedUntil: untilMs === Number.MAX_SAFE_INTEGER ? null : new Date(untilMs).toISOString()
      });
    }
  }
  return records;
}

function mergeCoachDismissalRecords(records) {
  const now = Date.now();
  for (const record of records || []) {
    if (!record || (record.type !== 'today' && record.type !== 'pattern') || !record.key) {
      continue;
    }
    const dismissedUntil = record.dismissedUntil || null;
    const untilMs = dismissedUntil ? new Date(dismissedUntil).getTime() : null;
    if (untilMs && untilMs <= now) {
      continue;
    }
    if (record.type === 'pattern') {
      state.coachDismissals.pattern.add(record.key);
    } else {
      const existing = state.coachDismissals.today.get(record.key);
      if (!existing || !untilMs || untilMs > existing) {
        state.coachDismissals.today.set(record.key, untilMs || Number.MAX_SAFE_INTEGER);
      }
    }
  }
  writeLocalCoachDismissals(currentCoachDismissalRecords());
}

async function refreshCoachDismissals() {
  if (state.coachDismissalsLoaded) {
    return;
  }
  state.coachDismissals = {
    today: new Map(),
    pattern: new Set()
  };
  const localRecords = readLocalCoachDismissals();
  mergeCoachDismissalRecords(localRecords);
  try {
    const response = await api('/api/coach/dismissals');
    state.coachDismissals = {
      today: new Map(),
      pattern: new Set()
    };
    mergeCoachDismissalRecords([...(response.dismissals || []), ...localRecords]);
  } catch (error) {
    console.warn('Failed to load coach dismissals:', error);
  } finally {
    state.coachDismissalsLoaded = true;
  }
}

function isCoachSuggestionDismissed(suggestion) {
  const rules = window.DailyMacrosCoachRules;
  if (rules?.isSuggestionDismissed) {
    return rules.isSuggestionDismissed(suggestion, state.coachDismissals, new Date());
  }
  if (!suggestion) {
    return true;
  }
  if (state.coachDismissals.pattern.has(suggestion.patternKey)) {
    return true;
  }
  const todayUntil = state.coachDismissals.today.get(suggestion.todayKey);
  return Boolean(todayUntil && todayUntil > Date.now());
}

function coachCategoryControlDefinitions() {
  return [
    { id: 'trends', label: 'Trend coaching', categories: ['trend', 'steering', 'goal_tracking', 'plateau', 'cross_page', 'recovery'] },
    { id: 'reminders', label: 'Logging reminders', categories: ['reminder'] },
    { id: 'habitSuggestions', label: 'Habit quick adds', categories: ['quick_add'] },
    { id: 'congratulations', label: 'Celebrations', categories: ['congratulations', 'maintenance'] },
    { id: 'alcohol', label: 'Alcohol coaching', categories: ['alcohol'] },
    { id: 'cleanup', label: 'Cleanup prompts', categories: ['cleanup'] }
  ];
}

function readDisabledCoachCategories() {
  try {
    const raw = window.localStorage?.getItem(WEB_COACH_DISABLED_CATEGORIES_KEY) || '[]';
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeDisabledCoachCategories(disabledCategories) {
  const next = new Set(disabledCategories || []);
  state.disabledCoachCategories = next;
  try {
    window.localStorage?.setItem(WEB_COACH_DISABLED_CATEGORIES_KEY, JSON.stringify([...next].sort()));
  } catch {
    // Local coach controls should still work for the session if storage is unavailable.
  }
}

function isCoachCategoryDisabled(suggestion) {
  if (!suggestion || !state.disabledCoachCategories?.size) {
    return false;
  }
  return coachCategoryControlDefinitions().some((control) => (
    state.disabledCoachCategories.has(control.id) && control.categories.includes(suggestion.category)
  ));
}

function buildCoachContext() {
  return {
    today: getLocalIsoDay(),
    now: new Date(),
    dashboardData: state.dashboardData || {},
    savedItems: state.savedItems || [],
    macroDailyTotals: state.macroDailyTotals || [],
    workoutEntries: state.workoutEntries || [],
    weightEntries: state.weightEntries || [],
    weightChartEntries: state.weightChartEntries || [],
    weightTargetData: state.weightTargetData || null,
    weightTarget: state.weightTarget || null,
    sleepChartRows: state.sleepChartRows || [],
    sleepTargetHours: getSleepTargetHours()
  };
}

function buildCoachCandidates(pageKey) {
  const rules = window.DailyMacrosCoachRules;
  if (!rules?.buildCoachCandidates) {
    return [];
  }
  return rules.buildCoachCandidates(pageKey, buildCoachContext());
}

function renderCoachForPage(pageKey) {
  const slot = coachSlotEls[pageKey];
  if (!slot) {
    return;
  }
  const suggestion = buildCoachCandidates(pageKey)
    .filter((candidate) => candidate.confidence >= 0.85)
    .filter((candidate) => !isCoachCategoryDisabled(candidate))
    .sort((a, b) => b.priority - a.priority)
    .find((candidate) => !isCoachSuggestionDismissed(candidate));

  state.visibleCoachSuggestions[pageKey] = suggestion || null;
  if (!suggestion) {
    slot.hidden = true;
    slot.innerHTML = '';
    return;
  }

  const actionButton = suggestion.action
    ? `<button type="button" class="coach-action-btn" data-coach-action="${escapeAttr(suggestion.action.type)}">${escapeHtml(suggestion.action.label)}</button>`
    : '';
  const sourcePill = canViewCoachSourceDetails()
    ? `<span class="coach-pill">${escapeHtml(coachSourceLabel(suggestion.modelSource))}</span>`
    : '';
  slot.innerHTML = `
    <div class="coach-icon" role="img" aria-label="Coach Tony P. suggestion">✦</div>
    <div class="coach-body">
      <div class="coach-title-row">
        <div>
          <h2 class="coach-title">${escapeHtml(suggestion.title)}</h2>
          <div class="coach-meta">
            <span>Coach Tony P.</span>
            ${sourcePill}
            <span class="coach-pill">High confidence</span>
          </div>
        </div>
      </div>
      <p class="coach-message">${escapeHtml(suggestion.message)}</p>
      <p class="coach-evidence">${escapeHtml(suggestion.evidence.join(' '))}</p>
      <div class="coach-actions">
        ${actionButton}
        <button type="button" class="coach-dismiss-btn" data-coach-why="1">Why?</button>
        <button type="button" class="coach-dismiss-btn" data-coach-dismiss="today">Dismiss today</button>
        <button type="button" class="coach-dismiss-btn" data-coach-dismiss="pattern">Hide pattern</button>
        <button type="button" class="coach-dismiss-btn" data-coach-dismiss="pattern">Not useful</button>
      </div>
    </div>
  `;
  slot.hidden = false;
}

function coachSourceLabel(source) {
  if (source === 'local_rules') {
    return 'Local rules';
  }
  if (source === 'afm_local') {
    return 'Local AI';
  }
  return source ? String(source) : 'Local rules';
}

function renderAllCoachSlots() {
  for (const pageKey of Object.keys(coachSlotEls)) {
    renderCoachForPage(pageKey);
  }
}

function showCoachWhyModal(suggestion) {
  if (!suggestion) {
    return;
  }
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const confidence = Number(suggestion.confidence || 0);
  const evidenceItems = (suggestion.evidence || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const sourceRow = canViewCoachSourceDetails()
    ? `<p><strong>Source</strong><span>${escapeHtml(coachSourceLabel(suggestion.modelSource))}</span></p>`
    : '';
  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal coach-why-modal">
      <h3>Why am I seeing this?</h3>
      <p class="coach-why-reason">${escapeHtml(suggestion.message)}</p>
      <div class="coach-why-grid">
        <p><strong>Confidence</strong><span>${Math.round(confidence * 100)}%</span></p>
        ${sourceRow}
        <p><strong>Surface</strong><span>${escapeHtml(suggestion.page || 'coach')}</span></p>
        <p><strong>Category</strong><span>${escapeHtml(suggestion.category || 'general')}</span></p>
      </div>
      <div class="coach-why-evidence">
        <strong>Evidence</strong>
        <ul>${evidenceItems}</ul>
      </div>
      <div class="coach-why-key">
        <strong>Dismissal pattern</strong>
        <code>${escapeHtml(suggestion.patternKey || '')}</code>
      </div>
      <div class="combine-modal-actions">
        <button type="button" class="btn-muted table-action-btn" id="coach-why-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.getElementById('coach-why-close-btn').addEventListener('click', () => overlay.remove());
}

function runCoachAction(actionType) {
  if (actionType === 'focus-meal') {
    mealTextEl?.focus();
  } else if (actionType === 'focus-quick-add') {
    quickSearchEl?.focus();
  } else if (actionType === 'focus-workout') {
    workoutTextEl?.focus();
  } else if (actionType === 'focus-weight') {
    weightValueEl?.focus();
  } else if (actionType === 'focus-sleep') {
    sleepHoursEl?.focus();
  }
}

async function dismissVisibleCoachSuggestion(pageKey, dismissalType) {
  const suggestion = state.visibleCoachSuggestions[pageKey];
  if (!suggestion) {
    return;
  }
  const isPattern = dismissalType === 'pattern';
  const record = {
    type: isPattern ? 'pattern' : 'today',
    key: isPattern ? suggestion.patternKey : suggestion.todayKey,
    dismissedUntil: isPattern ? null : coachEndOfTodayIso()
  };
  mergeCoachDismissalRecords([record]);
  renderCoachForPage(pageKey);
  try {
    const response = await api('/api/coach/dismissals', {
      method: 'PUT',
      body: JSON.stringify({ dismissals: [record] })
    });
    state.coachDismissals = {
      today: new Map(),
      pattern: new Set()
    };
    mergeCoachDismissalRecords(response.dismissals || []);
  } catch (error) {
    console.warn('Failed to sync coach dismissal:', error);
  }
}

function bindCoachSlots() {
  for (const [pageKey, slot] of Object.entries(coachSlotEls)) {
    if (!slot) {
      continue;
    }
    slot.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-coach-action], [data-coach-dismiss], [data-coach-why]');
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const actionType = target.dataset.coachAction;
      const dismissalType = target.dataset.coachDismiss;
      if (target.dataset.coachWhy) {
        showCoachWhyModal(state.visibleCoachSuggestions[pageKey]);
        return;
      }
      if (actionType) {
        runCoachAction(actionType);
        return;
      }
      if (dismissalType) {
        await dismissVisibleCoachSuggestion(pageKey, dismissalType);
      }
    });
  }
}

function getLogPaging(kind) {
  state.logPaging = state.logPaging || {};
  if (!state.logPaging[kind]) {
    state.logPaging[kind] = { offset: 0, hasMore: true, loading: false };
  }
  return state.logPaging[kind];
}

function resetLogPaging(kind) {
  state.logPaging = state.logPaging || {};
  state.logPaging[kind] = { offset: 0, hasMore: true, loading: false };
  return state.logPaging[kind];
}

function appendUniqueById(existingEntries, nextEntries) {
  const existingIds = new Set((existingEntries || []).map((entry) => entry.id));
  return [
    ...(existingEntries || []),
    ...(nextEntries || []).filter((entry) => !existingIds.has(entry.id))
  ];
}

function buildLogPageUrl(path, params, paging) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') {
      query.set(key, value);
    }
  }
  query.set('limit', String(LOG_PAGE_SIZE));
  query.set('offset', String(paging.offset || 0));
  return `${path}?${query.toString()}`;
}

function renderPagedLogList({ kind, listEl, entries, renderCard, emptyText }) {
  if (!listEl) {
    return;
  }

  const paging = getLogPaging(kind);
  const cardsHtml = entries?.length
    ? `<div class="entry-cards">${entries.map((entry) => renderCard(entry)).join('')}</div>`
    : paging.loading
      ? '<p class="entry-page-status" aria-live="polite">Loading...</p>'
      : `<p class="empty-note">${escapeHtml(emptyText)}</p>`;
  const statusHtml = paging.loading && entries?.length
    ? '<p class="entry-page-status" aria-live="polite">Loading...</p>'
    : '';
  const sentinelHtml = paging.hasMore
    ? `<div class="entry-page-sentinel" data-log-page="${escapeAttr(kind)}" aria-hidden="true"></div>`
    : '';

  listEl.innerHTML = `${cardsHtml}${statusHtml}${sentinelHtml}`;
  observeLogPageSentinels();
}

let logPageObserver = null;

function observeLogPageSentinels() {
  if (typeof IntersectionObserver === 'undefined') {
    return;
  }
  if (!logPageObserver) {
    logPageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const kind = entry.target?.dataset?.logPage;
        if (kind) {
          loadMoreLogEntries(kind);
        }
      }
    }, { rootMargin: '360px 0px' });
  }

  logPageObserver.disconnect();
  for (const sentinel of document.querySelectorAll('.entry-page-sentinel[data-log-page]')) {
    logPageObserver.observe(sentinel);
  }
}

function loadMoreLogEntries(kind) {
  const paging = getLogPaging(kind);
  if (!paging.hasMore || paging.loading) {
    return;
  }

  if (kind === 'weight') {
    refreshWeightData({ reset: false });
  } else if (kind === 'workout') {
    refreshWorkoutData({ reset: false });
  } else if (kind === 'sleep') {
    refreshSleepData({ reset: false });
  } else if (kind === 'health') {
    refreshHealthData({ reset: false });
  }
}

async function exportAccountData() {
  const data = await api('/api/account/export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'daily-macros-account-export.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function deleteAccount() {
  if (!window.confirm('Delete your account and all app data? This cannot be undone.')) {
    return;
  }
  await api('/api/account', { method: 'DELETE' });
  window.location.href = '/login';
}

async function addStarterQuickAdds() {
  const result = await api('/api/starter-quick-adds', { method: 'POST' });
  await loadQuickEntries({ force: true });
  renderSavedItems();
  return result;
}

async function copyYesterdayEntries() {
  const targetDay = getLocalIsoDay();
  const sourceDay = shiftIsoDay(targetDay, -1);
  const result = await api('/api/entries/copy-day', {
    method: 'POST',
    body: JSON.stringify({
      sourceDay,
      targetDay,
      tz: getTimezone()
    })
  });
  await refreshDashboard();
  return result;
}

function canCopyEntryToToday(entry) {
  return Boolean(entry?.consumedAt) && getLocalIsoDay(entry.consumedAt) < getLocalIsoDay();
}

async function copyEntryOrMealToToday(payload) {
  const body = {
    targetDay: getLocalIsoDay(),
    tz: getTimezone()
  };
  if (payload?.mealGroup) {
    body.mealGroup = payload.mealGroup;
  } else {
    body.entryId = payload?.entryId;
  }
  const result = await api('/api/entries/copy-to-today', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  await refreshDashboard();
  return result;
}

function buildCopyEntryToTodayHandler(entry) {
  if (!entry || !canCopyEntryToToday(entry)) {
    return null;
  }
  return async () => {
    try {
      const result = await copyEntryOrMealToToday({ entryId: entry.id });
      setActionBanner(result.copiedCount > 0 ? 'Copied item to today.' : 'No item copied.', result.copiedCount > 0 ? 'success' : 'info');
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  };
}

function buildCopyMealToTodayHandler(mealGroup, mealEntry) {
  if (!mealGroup || !mealEntry || !canCopyEntryToToday(mealEntry)) {
    return null;
  }
  return async () => {
    try {
      const result = await copyEntryOrMealToToday({ mealGroup });
      setActionBanner(result.copiedCount > 0 ? 'Copied meal to today.' : 'No meal copied.', result.copiedCount > 0 ? 'success' : 'info');
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  };
}

function showAccountPrivacyModal() {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const version = state.appVersion || {};
  const build = formatBuildLabel(version.appBuild || 'local');
  const packageVersion = version.packageVersion || 'unknown';
  const sexualActivityCopy = state.features?.sexualActivity
    ? 'sexual activity entries, '
    : 'sexual activity entries only if an admin enables that view, ';
  const aiProcessingCopy = canViewCoachSourceDetails()
    ? 'Meal text, workout text, and meal photos may be sent to OpenAI only when you ask the app to parse or analyze them. Coach Tony P. uses local rule gates for eligible coach cards; on supported iOS versions, the on-device Apple model may rank or phrase those cards.'
    : 'Meal text, workout text, and meal photos may be sent to OpenAI only when you ask the app to parse or analyze them. Coach Tony P. suggestions are generated from your app data for routine coaching, not sent to OpenAI.';
  const sexualActivityPageControl = state.features?.sexualActivity
    ? `
      <fieldset class="account-preference-controls">
        <legend>Sexual Activity</legend>
        <label class="account-preference-toggle">
          <input id="account-sexual-activity-page-toggle" type="checkbox"${state.sexualActivityPageVisible !== false ? ' checked' : ''} />
          <span class="account-setting-label">Show page</span>
          <span class="account-setting-check" aria-hidden="true"></span>
        </label>
      </fieldset>
    `
    : '';
  const currentTimezone = state.currentUser?.timezone || getTimezone();
  const browserTimezone = detectBrowserTimezone();
  const timezoneOptions = renderTimezoneOptions(currentTimezone, browserTimezone);
  const coachCategoryControls = coachCategoryControlDefinitions().map((control) => {
    const checked = state.disabledCoachCategories.has(control.id) ? '' : ' checked';
    return `
      <label class="account-coach-category-toggle">
        <input type="checkbox" data-coach-category="${escapeAttr(control.id)}"${checked} />
        <span class="account-setting-label">${escapeHtml(control.label)}</span>
        <span class="account-setting-check" aria-hidden="true"></span>
      </label>
    `;
  }).join('');

  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal account-privacy-modal">
      <h3>Account & Privacy</h3>
      <div class="account-privacy-copy">
        <p><strong>Support</strong><span>Contact the person who invited you. Include any request reference shown in an error message and the build details below.</span></p>
        <p><strong>Your data</strong><span>Daily Macros stores nutrition, weight, workouts, sleep, ${sexualActivityCopy}meal photos you submit for parsing, account details, and app usage needed to run the beta.</span></p>
        <p><strong>AI processing</strong><span>${escapeHtml(aiProcessingCopy)}</span></p>
        <p><strong>Controls</strong><span>You can export a JSON copy of your account data or permanently delete your account from here. <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></span></p>
      </div>
      ${sexualActivityPageControl}
      <fieldset class="account-preference-controls">
        <legend>Preferences</legend>
        <div class="account-preference-row">
          <label for="account-timezone-select">Timezone</label>
          <select id="account-timezone-select">
            ${timezoneOptions}
          </select>
        </div>
        <div class="account-preference-actions">
          <button type="button" class="btn-secondary table-action-btn" id="account-use-browser-timezone-btn">Use ${escapeHtml(browserTimezone)}</button>
          <button type="button" class="btn-success table-action-btn" id="account-save-timezone-btn">Save Timezone</button>
        </div>
      </fieldset>
      <fieldset class="account-preference-controls">
        <legend>Setup Shortcuts</legend>
        <div class="account-preference-actions">
          <button type="button" class="btn-secondary table-action-btn" id="account-starter-quick-adds-btn">Add Starter Quick Adds</button>
        </div>
      </fieldset>
      <fieldset class="account-coach-category-controls">
        <legend>Coach Tony P. Cards</legend>
        <div class="account-coach-category-grid">
          ${coachCategoryControls}
        </div>
      </fieldset>
      <div class="account-build-meta">
        <span>Web ${escapeHtml(packageVersion)}</span>
        <span>Build ${escapeHtml(build)}</span>
      </div>
      <div class="combine-modal-actions">
        <button type="button" class="btn-info table-action-btn" id="account-export-btn">Export Data</button>
        <button type="button" class="btn-danger table-action-btn" id="account-delete-btn">Delete Account</button>
        <span style="flex:1"></span>
        <button type="button" class="btn-muted table-action-btn" id="account-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  const sexualActivityPageToggleEl = overlay.querySelector('#account-sexual-activity-page-toggle');
  if (sexualActivityPageToggleEl) {
    sexualActivityPageToggleEl.addEventListener('change', () => {
      writeSexualActivityPageVisible(sexualActivityPageToggleEl.checked);
      syncFeatureVisibility();
    });
  }
  overlay.querySelectorAll('[data-coach-category]').forEach((input) => {
    input.addEventListener('change', () => {
      const category = input.dataset.coachCategory;
      if (!category) return;
      const disabled = new Set(state.disabledCoachCategories);
      if (input.checked) {
        disabled.delete(category);
      } else {
        disabled.add(category);
      }
      writeDisabledCoachCategories(disabled);
      for (const pageKey of Object.keys(coachSlotEls)) {
        renderCoachForPage(pageKey);
      }
    });
  });
  document.getElementById('account-close-btn').addEventListener('click', () => overlay.remove());
  const timezoneSelectEl = document.getElementById('account-timezone-select');
  document.getElementById('account-use-browser-timezone-btn')?.addEventListener('click', () => {
    if (timezoneSelectEl) {
      timezoneSelectEl.value = detectBrowserTimezone();
    }
  });
  document.getElementById('account-save-timezone-btn')?.addEventListener('click', async () => {
    const timezone = String(timezoneSelectEl?.value || '').trim();
    try {
      const response = await api('/api/account/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ timezone })
      });
      state.currentUser = response.user || state.currentUser;
      setActionBanner('Timezone saved.', 'success');
      await refreshDashboard();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
  document.getElementById('account-starter-quick-adds-btn')?.addEventListener('click', async () => {
    try {
      const result = await addStarterQuickAdds();
      setActionBanner(
        result.addedCount > 0 ? `Added ${result.addedCount} starter quick add${result.addedCount === 1 ? '' : 's'}.` : 'Starter quick adds already exist.',
        'success'
      );
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
  document.getElementById('account-export-btn').addEventListener('click', async () => {
    try {
      await exportAccountData();
      setActionBanner('Account export created.', 'success');
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
  document.getElementById('account-delete-btn').addEventListener('click', async () => {
    try {
      await deleteAccount();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') overlay.remove();
  });
}

function formatDateTimeLabel(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function fillAnalysisList(listEl, items) {
  if (!listEl) {
    return;
  }
  listEl.innerHTML = '';
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    const li = document.createElement('li');
    li.textContent = 'No data yet.';
    listEl.appendChild(li);
    return;
  }
  for (const item of rows) {
    const li = document.createElement('li');
    li.textContent = String(item || '').trim();
    listEl.appendChild(li);
  }
}

function toPercent(value) {
  const num = Number(value || 0);
  return `${Math.round(num)}%`;
}

function fmtSigned(value, decimals = 1) {
  const num = Number(value || 0);
  const fixed = num.toFixed(decimals);
  return num > 0 ? `+${fixed}` : fixed;
}

function renderAnalysisReport(record) {
  state.analysisReport = record || null;
  const report = record?.report || null;
  if (!report) {
    if (analysisMetaEl) analysisMetaEl.textContent = 'No analysis yet.';
    if (analysisSummaryEl) analysisSummaryEl.textContent = '';
    fillAnalysisList(analysisGoalListEl, []);
    fillAnalysisList(analysisAdherenceListEl, []);
    fillAnalysisList(analysisWowListEl, []);
    fillAnalysisList(analysisNutritionListEl, []);
    fillAnalysisList(analysisConfidenceListEl, []);
    fillAnalysisList(analysisProgressListEl, []);
    fillAnalysisList(analysisNeedsListEl, []);
    fillAnalysisList(analysisNextWeekListEl, []);
    return;
  }

  if (analysisMetaEl) {
    const windowDays = Number(record.periodDays || 0);
    const trackedDays = Number(report.stats?.periodDays || 0);
    const generatedAt = formatDateTimeLabel(record.createdAt);
    const confidence = String(report.confidence || '').trim();
    const coverageLabel = trackedDays > 0 && windowDays > 0 && trackedDays < windowDays
      ? `${trackedDays} tracked day${trackedDays === 1 ? '' : 's'} in a ${windowDays}-day window`
      : `${windowDays || trackedDays} days of data`;
    analysisMetaEl.textContent =
      `Generated ${generatedAt} using ${coverageLabel}` +
      (confidence ? ` (${confidence} confidence).` : '.');
  }
  if (analysisSummaryEl) {
    analysisSummaryEl.textContent = String(report.summary || '').trim();
  }
  const goalAlignment = report.goalAlignment || {};
  const adherence = report.adherence || {};
  const wow = report.weekOverWeek || {};
  const nutrition = report.nutritionSignals || {};
  const confidence = report.dataConfidence || {};
  fillAnalysisList(analysisGoalListEl, [
    `Goal: ${goalAlignment.goal || 'n/a'}`,
    `Status: ${String(goalAlignment.status || 'n/a').replaceAll('_', ' ')}`,
    `Score: ${Math.round(Number(goalAlignment.score || 0))}/100`,
    String(goalAlignment.reason || '')
  ]);
  fillAnalysisList(analysisAdherenceListEl, [
    `Meal logging: ${toPercent(adherence.mealLoggingPct)}`,
    adherence.calorieTargetSet
      ? `Calories vs target: ${fmtSigned(adherence.calorieTargetDelta, 1)} cal (${fmtSigned(adherence.calorieTargetDeltaPct, 1)}%)`
      : 'Calories vs target: No target set',
    adherence.proteinTargetSet
      ? `Protein vs target: ${fmtSigned(adherence.proteinTargetDelta, 1)}g (${fmtSigned(adherence.proteinTargetDeltaPct, 1)}%)`
      : 'Protein vs target: No target set',
    `Workouts: ${Number(adherence.completedWorkoutCount || 0)} / ${Number(adherence.plannedWorkoutCount || 0)}`
  ]);
  fillAnalysisList(analysisWowListEl, [
    `Weight change delta: ${fmtSigned(wow.weightChangeDelta, 2)}`,
    `Avg calories delta: ${fmtSigned(wow.avgCaloriesDelta, 1)}`,
    `Avg protein delta: ${fmtSigned(wow.avgProteinDelta, 1)}g`,
    `Workout hours delta: ${fmtSigned(wow.workoutHoursDelta, 2)}`
  ]);
  fillAnalysisList(analysisNutritionListEl, [
    `Protein consistency: ${nutrition.proteinConsistency || 'n/a'}`,
    `Calorie volatility: ${fmtSigned(nutrition.calorieVolatility, 1)}`,
    `Late-night eating: ${toPercent(nutrition.lateNightEatingPct)}`,
    `Weekend calorie drift: ${fmtSigned(nutrition.weekendCalorieDrift, 1)}`
  ]);
  fillAnalysisList(analysisConfidenceListEl, [
    `Score: ${Math.round(Number(confidence.score || 0))}/100`,
    String(confidence.notes || '')
  ]);
  fillAnalysisList(analysisProgressListEl, report.progress);
  fillAnalysisList(analysisNeedsListEl, report.needsImprovement);
  fillAnalysisList(analysisNextWeekListEl, report.nextWeekPlan);
}

async function refreshAnalysisData() {
  if (!analysisMetaEl) {
    return;
  }
  const response = await api('/api/analysis/latest');
  renderAnalysisReport(response.report || null);
}

function renderWeeklyRecap(recap) {
  state.weeklyRecap = recap || null;
  if (!weeklyRecapMetaEl) {
    return;
  }
  if (!recap) {
    weeklyRecapMetaEl.textContent = 'No recap yet.';
    if (weeklyRecapSummaryEl) weeklyRecapSummaryEl.textContent = '';
    fillAnalysisList(weeklyRecapWinsListEl, []);
    fillAnalysisList(weeklyRecapFocusListEl, []);
    fillAnalysisList(weeklyRecapActionsListEl, []);
    return;
  }
  const generatedAt = formatDateTimeLabel(recap.generatedAt);
  weeklyRecapMetaEl.textContent = `Generated ${generatedAt} (${recap.confidence || 'low'} confidence).`;
  if (weeklyRecapSummaryEl) {
    weeklyRecapSummaryEl.textContent = String(recap.summary || '');
  }
  fillAnalysisList(weeklyRecapWinsListEl, recap.wins);
  fillAnalysisList(weeklyRecapFocusListEl, recap.focus);
  fillAnalysisList(weeklyRecapActionsListEl, recap.nextActions);
}

async function refreshWeeklyRecap() {
  if (!weeklyRecapMetaEl) {
    return;
  }
  try {
    const response = await api(`/api/coach/weekly-recap?tz=${encodeURIComponent(getTimezone())}`);
    renderWeeklyRecap(response.recap || null);
  } catch (error) {
    state.weeklyRecap = null;
    weeklyRecapMetaEl.textContent = error.message;
    if (weeklyRecapSummaryEl) weeklyRecapSummaryEl.textContent = '';
    fillAnalysisList(weeklyRecapWinsListEl, []);
    fillAnalysisList(weeklyRecapFocusListEl, []);
    fillAnalysisList(weeklyRecapActionsListEl, []);
  }
}

async function generateAnalysis() {
  if (!analysisGenerateBtnEl) {
    return;
  }
  const days = Number(analysisDaysEl?.value || 30);
  analysisGenerateBtnEl.disabled = true;
  if (analysisNoteEl) {
    analysisNoteEl.textContent = 'Generating analysis...';
  }
  try {
    const response = await api('/api/analysis', {
      method: 'POST',
      body: JSON.stringify({ days, tz: getTimezone() })
    });

    renderAnalysisReport(response.report || null);
    if (analysisNoteEl) {
      analysisNoteEl.textContent = 'Analysis generated.';
    }
    setActionBanner('Analysis generated.', 'success');
  } catch (error) {
    if (analysisNoteEl) {
      analysisNoteEl.textContent = error.message;
    }
    setActionBanner(error.message, 'error');
  } finally {
    analysisGenerateBtnEl.disabled = false;
  }
}

function isAnalysisDueWeekly(record) {
  const createdAtMs = new Date(record?.createdAt || '').getTime();
  if (!Number.isFinite(createdAtMs)) {
    return true;
  }
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - createdAtMs >= weekMs;
}

function renderParsedItems(parsedMeal) {
  parsedItemsContainerEl.innerHTML = '';

  if (parsedMeal.items.length > 1) {
    const mealQty = parsedMeal.mealQuantity || 1;
    const mealUnit = parsedMeal.mealUnit || 'serving';
    const totals = parsedMeal.items.reduce((acc, it) => {
      acc.calories += Number(it.calories || 0) * mealQty;
      acc.protein += Number(it.protein || 0) * mealQty;
      acc.carbs += Number(it.carbs || 0) * mealQty;
      acc.fat += Number(it.fat || 0) * mealQty;
      return acc;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

    const header = document.createElement('div');
    header.className = 'parsed-meal-header parsed-item-card';
    header.innerHTML = `
      <div class="parsed-item-summary">
        <span class="parsed-item-name">${escapeHtml(parsedMeal.mealName || 'Meal')}</span>
        <span class="parsed-item-macros">${fmtNumber(mealQty)} ${escapeHtml(mealUnit)} &middot; ${fmtNumber(totals.calories)} cal &middot; ${fmtNumber(totals.protein)}g protein &middot; ${fmtNumber(totals.carbs)}g carbs &middot; ${fmtNumber(totals.fat)}g fat</span>
      </div>
      <div class="parsed-item-right">
        <div class="parsed-item-btn-row">
          <button type="button" class="btn-warning table-action-btn" id="parsed-meal-edit-btn">Edit</button>
          <button type="button" class="btn-success table-action-btn" id="parsed-meal-save-btn">Save</button>
        </div>
        <label class="inline-check parsed-item-quickadd"><input type="checkbox" id="parsed-meal-save-quickadd" /><span>Save as quick-add</span></label>
      </div>
    `;
    parsedItemsContainerEl.appendChild(header);

    document.getElementById('parsed-meal-edit-btn').addEventListener('click', () => {
      showCombineModal(null, {
        name: parsedMeal.mealName || 'Meal',
        quantity: parsedMeal.mealQuantity || 1,
        unit: parsedMeal.mealUnit || 'serving',
        onSave: (name, qty, unit) => {
          parsedMeal.mealName = name;
          parsedMeal.mealQuantity = qty;
          parsedMeal.mealUnit = unit;
          renderParsedItems(parsedMeal);
        }
      });
    });

    document.getElementById('parsed-meal-save-btn').addEventListener('click', () => {
      saveParsedBtnEl.click();
    });
  }

  parsedMeal.items.forEach((item, index) => {
    const wrapper = document.createElement('article');
    wrapper.className = 'parsed-item parsed-item-card';

    const summary = document.createElement('div');
    summary.className = 'parsed-item-summary';
    const quality = renderNutritionQualityChips(item);
    summary.innerHTML = `
      <span class="parsed-item-name">${escapeHtml(item.itemName)}</span>
      <span class="parsed-item-macros">${fmtNumber(item.quantity)} ${escapeHtml(item.unit || 'serving')} &middot; ${fmtNumber(item.calories)} cal &middot; ${fmtNumber(item.protein)}g protein &middot; ${fmtNumber(item.carbs)}g carbs &middot; ${fmtNumber(item.fat)}g fat</span>
      ${quality ? `<span class="parsed-quality-row">${quality}</span>` : ''}
    `;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-warning table-action-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      const currentItem = parsedMeal.items[index];
      showEntryModal(currentItem, {
        title: 'Edit Parsed Item',
        onSave: (updated) => {
          parsedMeal.items[index] = { ...currentItem, ...updated };
          renderParsedItems(parsedMeal);
        }
      });
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-danger table-action-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      parsedMeal.items.splice(index, 1);
      renderParsedItems(parsedMeal);
    });

    const actions = document.createElement('div');
    actions.className = 'parsed-item-btn-row';
    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);

    if (parsedMeal.items.length === 1) {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-success table-action-btn';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => saveParsedBtnEl.click());
      actions.appendChild(saveBtn);

      const label = document.createElement('label');
      label.className = 'inline-check parsed-item-quickadd';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'parsed-meal-save-quickadd';
      const text = document.createElement('span');
      text.textContent = 'Save as quick-add';
      label.appendChild(checkbox);
      label.appendChild(text);

      const rightCol = document.createElement('div');
      rightCol.className = 'parsed-item-right';
      rightCol.appendChild(actions);
      rightCol.appendChild(label);
      wrapper.appendChild(summary);
      wrapper.appendChild(rightCol);
    } else {
      wrapper.appendChild(summary);
      wrapper.appendChild(actions);
    }
    parsedItemsContainerEl.appendChild(wrapper);
  });

  saveParsedBtnEl.disabled = parsedMeal.items.length === 0;
}

function collectParsedItemsFromUi() {
  if (!state.parsedMeal || !Array.isArray(state.parsedMeal.items)) {
    return [];
  }
  return state.parsedMeal.items.map((item) => ({
    itemName: String(item.itemName || 'Item').trim() || 'Item',
    quantity: Number(item.quantity || 0),
    unit: String(item.unit || 'serving').trim() || 'serving',
    calories: Number(item.calories || 0),
    protein: Number(item.protein || 0),
    carbs: Number(item.carbs || 0),
    fat: Number(item.fat || 0),
    confidence: item.confidence,
    source: item.source,
    sourceDetail: item.sourceDetail,
    needsReview: item.needsReview
  }));
}

function roundSavedMacro(value) {
  return Number(Number(value || 0).toFixed(2));
}

function savedItemComponents(item) {
  return Array.isArray(item?.components) ? item.components : [];
}

function buildSavedMealQuickAddPayload({ name, quantity, unit, components, source, sourceDetail }) {
  const mealQuantity = Math.max(Number(quantity || 1), 0.0001);
  const normalizedComponents = (components || []).map((component) => ({
    itemName: String(component.itemName || component.name || 'Item').trim() || 'Item',
    quantity: Math.max(Number(component.quantity || 0), 0.0001),
    unit: String(component.unit || 'serving').trim() || 'serving',
    calories: roundSavedMacro(component.calories),
    protein: roundSavedMacro(component.protein),
    carbs: roundSavedMacro(component.carbs),
    fat: roundSavedMacro(component.fat)
  }));
  const perUnitTotals = normalizedComponents.reduce((acc, component) => {
    acc.calories += Number(component.calories || 0);
    acc.protein += Number(component.protein || 0);
    acc.carbs += Number(component.carbs || 0);
    acc.fat += Number(component.fat || 0);
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  return {
    name: String(name || 'Meal').trim() || 'Meal',
    quantity: mealQuantity,
    unit: String(unit || 'serving').trim() || 'serving',
    calories: roundSavedMacro(perUnitTotals.calories * mealQuantity),
    protein: roundSavedMacro(perUnitTotals.protein * mealQuantity),
    carbs: roundSavedMacro(perUnitTotals.carbs * mealQuantity),
    fat: roundSavedMacro(perUnitTotals.fat * mealQuantity),
    components: normalizedComponents,
    source: source || undefined,
    sourceDetail: sourceDetail || undefined
  };
}

function buildSavedMealQuickAddPayloadFromEntries(entries, { name, quantity, unit }) {
  const sourceMealQuantity = Math.max(Number(entries?.[0]?.mealQuantity || 1), 0.0001);
  const components = (entries || []).map((entry) => ({
    itemName: entry.itemName,
    quantity: Number(entry.quantity || 0) / sourceMealQuantity,
    unit: entry.unit || 'serving',
    calories: Number(entry.calories || 0) / sourceMealQuantity,
    protein: Number(entry.protein || 0) / sourceMealQuantity,
    carbs: Number(entry.carbs || 0) / sourceMealQuantity,
    fat: Number(entry.fat || 0) / sourceMealQuantity
  }));
  return buildSavedMealQuickAddPayload({ name, quantity, unit, components });
}

function getSelectedSavedItem() {
  const raw = String(state.quickSelectedKey || '');
  if (!raw.startsWith('saved:')) {
    return null;
  }
  const id = Number(raw.slice('saved:'.length));
  return state.savedItems.find((item) => item.id === id) || null;
}

function getSelectedQuickTemplate() {
  const raw = String(state.quickSelectedKey || '');
  if (raw.startsWith('saved:')) {
    const item = getSelectedSavedItem();
    if (!item) {
      return null;
    }
    return {
      type: 'saved',
      key: raw,
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity || 0),
      unit: item.unit || 'serving',
      calories: Number(item.calories || 0),
      protein: Number(item.protein || 0),
      carbs: Number(item.carbs || 0),
      fat: Number(item.fat || 0),
      components: savedItemComponents(item),
      usageCount: Number(item.usageCount || 0),
      count: Number(item.usageCount || 0),
      lastUsedAt: ''
    };
  }
  if (raw.startsWith('entry:')) {
    const exact = state.historyQuickItems.find((item) => item.key === raw);
    if (exact) {
      return exact;
    }

    const safeDecode = (value) => {
      try {
        return decodeURIComponent(value);
      } catch (_error) {
        return value;
      }
    };

    const rawSuffix = raw.slice('entry:'.length);
    const decodedRawSuffix = safeDecode(rawSuffix);
    return state.historyQuickItems.find((item) => {
      if (!String(item.key || '').startsWith('entry:')) {
        return false;
      }
      const keySuffix = String(item.key).slice('entry:'.length);
      const decodedKeySuffix = safeDecode(keySuffix);
      return (
        keySuffix === rawSuffix ||
        keySuffix === decodedRawSuffix ||
        decodedKeySuffix === rawSuffix ||
        decodedKeySuffix === decodedRawSuffix
      );
    }) || null;
  }
  return null;
}

function quickPickerOptionGroups(query) {
  const normalizedQuery = normalizeQuickSearch(query);
  const savedMatches = state.savedItems.filter((item) => matchesQuickSearch(item, normalizedQuery));
  const historyMatches = state.historyQuickItems.filter((item) => matchesQuickSearch(item, normalizedQuery));
  const groups = [];
  if (savedMatches.length) {
    groups.push({
      label: 'Saved quick entries',
      items: savedMatches.map((item) => ({
        key: 'saved:' + String(item.id),
        label: formatSavedItemOption(item)
      }))
    });
  }
  if (historyMatches.length) {
    groups.push({
      label: 'Recent from previous days',
      items: historyMatches.map((item) => ({
        key: item.key,
        label: formatSavedItemOption(item)
      }))
    });
  }
  return groups;
}

function flattenQuickPickerGroups(groups) {
  return groups.flatMap((group) => group.items);
}

function findQuickPickerOption(key) {
  return flattenQuickPickerGroups(quickPickerOptionGroups('')).find((option) => option.key === key) || null;
}

function setQuickPickerOpen(open) {
  state.quickPickerOpen = Boolean(open);
  if (quickSearchEl) {
    quickSearchEl.setAttribute('aria-expanded', String(state.quickPickerOpen));
  }
  if (quickEntryToggleBtnEl) {
    quickEntryToggleBtnEl.setAttribute('aria-expanded', String(state.quickPickerOpen));
  }
  if (quickEntryListboxEl) {
    quickEntryListboxEl.hidden = !state.quickPickerOpen;
  }
}

function selectQuickEntry(key, { updateInput = true } = {}) {
  const option = findQuickPickerOption(key);
  state.quickSelectedKey = option ? option.key : '';
  state.quickSearchQuery = '';
  state.quickPickerShowAll = false;
  state.quickPickerActiveIndex = -1;
  if (updateInput && quickSearchEl) {
    quickSearchEl.value = option ? option.label : '';
  }
  setQuickPickerOpen(false);
  const selectedTemplate = getSelectedQuickTemplate();
  quickAddBtnEl.disabled = !selectedTemplate;
  quickEditToggleBtnEl.disabled = !selectedTemplate;
}

function renderQuickEntryList() {
  if (!quickEntryListboxEl) {
    return;
  }

  const hasKnownEntries = Boolean(state.savedItems.length || state.historyQuickItems.length);
  const query = state.quickPickerShowAll ? '' : (quickSearchEl?.value || state.quickSearchQuery || '');
  const groups = quickPickerOptionGroups(query);
  const options = flattenQuickPickerGroups(groups);

  quickEntryListboxEl.innerHTML = '';

  if (state.quickEntriesLoading && !hasKnownEntries) {
    quickEntryListboxEl.innerHTML = '<div class="quick-entry-empty">Loading quick entries...</div>';
    state.quickPickerActiveIndex = -1;
    return;
  }
  if (state.quickEntriesError && !hasKnownEntries) {
    quickEntryListboxEl.innerHTML = '<div class="quick-entry-empty">Quick entries unavailable</div>';
    state.quickPickerActiveIndex = -1;
    return;
  }
  if (!hasKnownEntries) {
    quickEntryListboxEl.innerHTML = '<div class="quick-entry-empty">No quick add history yet</div>';
    state.quickPickerActiveIndex = -1;
    return;
  }
  if (!options.length) {
    quickEntryListboxEl.innerHTML = `<div class="quick-entry-empty">${query ? 'No matching quick entries' : 'No quick entries'}</div>`;
    state.quickPickerActiveIndex = -1;
    return;
  }

  if (state.quickPickerActiveIndex < 0 || state.quickPickerActiveIndex >= options.length) {
    state.quickPickerActiveIndex = 0;
  }

  let optionIndex = 0;
  for (const group of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'quick-entry-group';
    groupEl.innerHTML = `<div class="quick-entry-group-label">${escapeHtml(group.label)}</div>`;
    for (const option of group.items) {
      const optionEl = document.createElement('button');
      const selected = option.key === state.quickSelectedKey;
      const active = optionIndex === state.quickPickerActiveIndex;
      optionEl.type = 'button';
      optionEl.className = 'quick-entry-option' + (selected ? ' is-selected' : '') + (active ? ' is-active' : '');
      optionEl.id = `quick-entry-option-${optionIndex}`;
      optionEl.dataset.quickEntryKey = option.key;
      optionEl.setAttribute('role', 'option');
      optionEl.setAttribute('aria-selected', selected ? 'true' : 'false');
      optionEl.textContent = option.label;
      optionEl.addEventListener('mousedown', (event) => event.preventDefault());
      optionEl.addEventListener('click', () => {
        selectQuickEntry(option.key);
        quickSearchEl?.focus();
      });
      groupEl.appendChild(optionEl);
      optionIndex += 1;
    }
    quickEntryListboxEl.appendChild(groupEl);
  }

  if (quickSearchEl) {
    quickSearchEl.setAttribute('aria-activedescendant', `quick-entry-option-${state.quickPickerActiveIndex}`);
  }
}


function quickAddById(savedItemId) {
  return api('/api/quick-add', {
    method: 'POST',
    body: JSON.stringify({
      savedItemId,
      multiplier: Number(quickMultiplierEl.value || 1),
      consumedAt: asIso(consumedAtEl.value)
    })
  });
}

function quickAddByTemplate(template) {
  const multiplier = Number(quickMultiplierEl.value || 1);
  const consumedAt = asIso(consumedAtEl.value);
  const components = savedItemComponents(template);
  if (components.length) {
    return api('/api/entries/bulk', {
      method: 'POST',
      body: JSON.stringify({
        consumedAt,
        items: components.map((component) => ({
          itemName: component.itemName || component.name || 'Item',
          quantity: Number(component.quantity || 0),
          unit: component.unit || 'serving',
          calories: Number(component.calories || 0),
          protein: Number(component.protein || 0),
          carbs: Number(component.carbs || 0),
          fat: Number(component.fat || 0),
          consumedAt,
          source: 'quick_add',
          sourceDetail: template.savedItemId ? `saved_item:${template.savedItemId}` : 'recent_history'
        })),
        mealName: template.name || 'Meal',
        mealQuantity: Math.max(Number(template.quantity || 1) * multiplier, 0.0001),
        mealUnit: template.unit || 'serving',
        itemsAreMealUnit: true,
        source: 'quick_add',
        sourceDetail: template.savedItemId ? `saved_item:${template.savedItemId}` : 'recent_history'
      })
    });
  }

  return api('/api/entries/bulk', {
    method: 'POST',
    body: JSON.stringify({
      consumedAt,
      items: [
        {
          itemName: template.name,
          quantity: Number(template.quantity || 0) * multiplier,
          unit: template.unit || 'serving',
          calories: Number(template.calories || 0) * multiplier,
          protein: Number(template.protein || 0) * multiplier,
          carbs: Number(template.carbs || 0) * multiplier,
          fat: Number(template.fat || 0) * multiplier,
          consumedAt,
          source: 'quick_add',
          sourceDetail: template.savedItemId ? `saved_item:${template.savedItemId}` : 'recent_history'
        }
      ]
    })
  });
}

function buildHistoryQuickItems(entries, savedItems) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  cutoff.setHours(0, 0, 0, 0);

  const savedSignatures = new Set(
    (savedItems || []).map((item) =>
      [
        String(item.name || '').trim().toLowerCase(),
        String(item.unit || 'serving').trim().toLowerCase(),
        Number(item.quantity || 0).toFixed(3),
        Number(item.calories || 0).toFixed(3),
        Number(item.protein || 0).toFixed(3),
        Number(item.carbs || 0).toFixed(3),
        Number(item.fat || 0).toFixed(3)
      ].join('|')
    )
  );

  const historyBySignature = new Map();
  for (const entry of entries || []) {
    if (new Date(entry.consumedAt) < cutoff) {
      continue;
    }
    const signature = [
      String(entry.itemName || '').trim().toLowerCase(),
      String(entry.unit || 'serving').trim().toLowerCase(),
      Number(entry.quantity || 0).toFixed(3),
      Number(entry.calories || 0).toFixed(3),
      Number(entry.protein || 0).toFixed(3),
      Number(entry.carbs || 0).toFixed(3),
      Number(entry.fat || 0).toFixed(3)
    ].join('|');
    if (savedSignatures.has(signature)) {
      continue;
    }
    const existing = historyBySignature.get(signature);
    if (existing) {
      if (new Date(entry.consumedAt).getTime() > new Date(existing.lastUsedAt).getTime()) {
        existing.lastUsedAt = entry.consumedAt;
      }
      continue;
    }
    historyBySignature.set(signature, {
      type: 'entry',
      key: 'entry:' + encodeURIComponent(signature),
      name: entry.itemName,
      quantity: Number(entry.quantity || 0),
      unit: entry.unit || 'serving',
      calories: Number(entry.calories || 0),
      protein: Number(entry.protein || 0),
      carbs: Number(entry.carbs || 0),
      fat: Number(entry.fat || 0),
      lastUsedAt: entry.consumedAt
    });
  }

  return Array.from(historyBySignature.values())
    .sort((a, b) => new Date(b.lastUsedAt || 0).getTime() - new Date(a.lastUsedAt || 0).getTime());
}


function renderSavedItems() {
  const selectedBefore = state.quickSelectedKey;
  const hasKnownEntries = Boolean(state.savedItems.length || state.historyQuickItems.length);

  if (quickSearchEl) {
    quickSearchEl.disabled = !hasKnownEntries && state.quickEntriesLoading;
    quickSearchEl.placeholder = state.quickEntriesLoading && !hasKnownEntries
      ? 'Loading quick entries...'
      : 'Search quick entries';
  }
  if (quickEntryToggleBtnEl) {
    quickEntryToggleBtnEl.disabled = !hasKnownEntries && state.quickEntriesLoading;
  }

  if (state.quickEntriesLoading && !hasKnownEntries) {
    state.quickSelectedKey = '';
    quickAddBtnEl.disabled = true;
    quickEditToggleBtnEl.disabled = true;
    renderQuickEntryList();
    return;
  }

  if (state.quickEntriesError && !hasKnownEntries) {
    state.quickSelectedKey = '';
    quickAddBtnEl.disabled = true;
    quickEditToggleBtnEl.disabled = true;
    renderQuickEntryList();
    return;
  }

  if (!state.savedItems.length && !state.historyQuickItems.length) {
    state.quickSelectedKey = '';
    quickAddBtnEl.disabled = true;
    quickEditToggleBtnEl.disabled = true;
    if (quickSearchEl) {
      quickSearchEl.value = '';
    }
    renderQuickEntryList();
    return;
  }

  const allOptions = flattenQuickPickerGroups(quickPickerOptionGroups(''));
  const selectedOption = allOptions.find((option) => option.key === selectedBefore) || allOptions[0] || null;
  state.quickSelectedKey = selectedOption ? selectedOption.key : '';
  if (quickSearchEl && !state.quickPickerOpen) {
    quickSearchEl.value = selectedOption ? selectedOption.label : '';
  }

  renderQuickEntryList();
  const selectedTemplate = getSelectedQuickTemplate();
  quickAddBtnEl.disabled = !selectedTemplate;
  quickEditToggleBtnEl.disabled = !selectedTemplate;
}

function renderMacroCard(entry) {
  const checked = state.selectedEntryIds.has(entry.id) ? 'checked' : '';
  const inGroup = Boolean(entry.mealGroup);
  const timeStr = new Date(entry.consumedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const entryId = safeId(entry.id);
  const mealGroup = escapeAttr(entry.mealGroup || '');
  const qualityChips = renderNutritionQualityChips(entry);
  return `
    <div class="macro-card" data-entry-id="${entryId}">
      <div class="macro-card-check"><input type="checkbox" class="entry-checkbox" data-entry-id="${entryId}" ${inGroup ? `data-in-group="1" data-meal-group="${mealGroup}"` : ''} ${checked} /></div>
      <div class="macro-card-body" data-edit-entry-id="${entryId}">
        <div class="macro-card-title">${escapeHtml(entry.itemName)}</div>
        <div class="entry-card-chips">
          <span class="entry-card-chip">${fmtNumber(entry.quantity)} ${escapeHtml(entry.unit || '')}</span>
          <span class="entry-card-chip entry-card-chip--accent">${fmtNumber(entry.calories)} cal</span>
          <span class="entry-card-chip">${fmtNumber(entry.protein)}g protein</span>
          <span class="entry-card-chip">${fmtNumber(entry.carbs)}g carbs</span>
          <span class="entry-card-chip">${fmtNumber(entry.fat)}g fat</span>
          ${qualityChips}
        </div>
      </div>
      <div class="macro-card-time">${timeStr}</div>
    </div>
  `;
}

function nutritionSourceLabel(source) {
  const labels = {
    manual: 'Manual',
    ai_text: 'AI parse',
    ai_photo: 'Photo parse',
    barcode: 'Barcode',
    quick_add: 'Quick Add',
    copy_day: 'Copied',
    starter_template: 'Starter',
    manual_correction: 'Corrected',
    food_correction: 'Remembered'
  };
  return labels[source] || 'Manual';
}

function renderNutritionQualityChips(entry) {
  const source = String(entry?.source || 'manual');
  const chips = [];
  if (source && source !== 'manual') {
    chips.push(`<span class="entry-card-chip entry-card-chip--source">${escapeHtml(nutritionSourceLabel(source))}</span>`);
  }
  if (entry?.needsReview) {
    chips.push('<span class="entry-card-chip entry-card-chip--review">Review</span>');
  }
  return chips.join('');
}

function renderMealQualityChips(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    return '';
  }
  if (rows.some((entry) => entry?.needsReview)) {
    return '<span class="entry-card-chip entry-card-chip--review">Review</span>';
  }
  const source = rows.find((entry) => entry?.source && entry.source !== 'manual')?.source;
  if (!source) {
    return '';
  }
  return `<span class="entry-card-chip entry-card-chip--source">${escapeHtml(nutritionSourceLabel(source))}</span>`;
}

function renderEditRowMobile(entry) {
  const consumedAtValue = isoToLocalInputValue(entry.consumedAt);
  const entryId = safeId(entry.id);
  return `
    <td data-label="Edit" colspan="8">
      <table class="edit-vertical-table">
        <tbody>
          <tr><th>Item</th><td><input data-field="itemName" value="${escapeAttr(entry.itemName)}" /></td></tr>
          <tr><th>Quantity</th><td><input type="number" step="0.1" data-field="quantity" value="${escapeAttr(entry.quantity)}" data-base-quantity="${escapeAttr(entry.quantity)}" data-base-calories="${escapeAttr(entry.calories)}" data-base-protein="${escapeAttr(entry.protein)}" data-base-carbs="${escapeAttr(entry.carbs)}" data-base-fat="${escapeAttr(entry.fat)}" /></td></tr>
          <tr><th>Unit</th><td><input data-field="unit" value="${escapeAttr(entry.unit || '')}" /></td></tr>
          <tr><th>Calories</th><td><input type="number" step="0.1" data-field="calories" value="${escapeAttr(entry.calories)}" /></td></tr>
          <tr><th>Protein</th><td><input type="number" step="0.1" data-field="protein" value="${escapeAttr(entry.protein)}" /></td></tr>
          <tr><th>Carbs</th><td><input type="number" step="0.1" data-field="carbs" value="${escapeAttr(entry.carbs)}" /></td></tr>
          <tr><th>Fat</th><td><input type="number" step="0.1" data-field="fat" value="${escapeAttr(entry.fat)}" /></td></tr>
          <tr><th>Time</th><td><input type="datetime-local" data-field="consumedAt" value="${escapeAttr(consumedAtValue)}" /></td></tr>
          <tr>
            <th>Actions</th>
            <td>
              <div class="edit-vertical-actions">
                <button type="button" class="btn-success table-action-btn" data-action="save" data-id="${entryId}">Save</button>
                <button type="button" class="btn-warning table-action-btn" data-action="cancel" data-id="${entryId}">Cancel</button>
                <button type="button" class="btn-danger table-action-btn" data-action="delete" data-id="${entryId}">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </td>
  `;
}

function renderEditRow(entry) {
  return renderEditRowMobile(entry);
}

function formatScaledMacroValue(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return (Math.round(value * 100) / 100).toString();
}

function updateTrendLegend(average, hasAverage, targetValue, hasTarget, unit) {
  if (trendAverageValueEl) {
    trendAverageValueEl.textContent = hasAverage ? `${fmtNumber(average)} ${unit}` : 'none';
  }
  if (trendTargetValueEl) {
    trendTargetValueEl.textContent = hasTarget ? `${fmtNumber(targetValue)} ${unit}` : 'none';
  }
}

function syncEditMacrosWithQuantity(row, quantityInput) {
  if (!row || !quantityInput) {
    return;
  }

  const nextQuantity = Number(quantityInput.value || 0);
  const baseQuantity = Number(quantityInput.dataset.baseQuantity || 0);
  if (!Number.isFinite(nextQuantity) || nextQuantity < 0 || !Number.isFinite(baseQuantity) || baseQuantity <= 0) {
    return;
  }

  const factor = nextQuantity / baseQuantity;
  const macroFields = ['calories', 'protein', 'carbs', 'fat'];
  for (const field of macroFields) {
    const input = row.querySelector(`[data-field="${field}"]`);
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }
    const baseValue = Number(quantityInput.dataset[`base${field.charAt(0).toUpperCase()}${field.slice(1)}`] || 0);
    input.value = formatScaledMacroValue(baseValue * factor);
  }
}

function buildTrendPoints(dailyTotals, period, baseIsoDay) {
  const dayMap = new Map();
  for (const dt of dailyTotals || []) {
    dayMap.set(dt.day, Number(dt[state.selectedTrendMacro] || 0));
  }
  const macro = state.selectedTrendMacro;
  const targetForDay = (day) => {
    const target = Number(targetsForDay(day)?.[macro] || 0);
    return Number.isFinite(target) && target > 0 ? target : 0;
  };

  if (period === 'annual') {
    const points = [];
    for (let w = 51; w >= 0; w -= 1) {
      const weekEndDay = shiftIsoDay(baseIsoDay, -w * 7);
      const weekStartDay = shiftIsoDay(weekEndDay, -6);
      let total = 0;
      let daysWithData = 0;
      let targetTotal = 0;
      for (let d = 0; d <= 6; d += 1) {
        const day = shiftIsoDay(weekStartDay, d);
        if (dayMap.has(day)) {
          total += dayMap.get(day);
          daysWithData += 1;
        }
        targetTotal += targetForDay(day);
      }
      const hasData = daysWithData > 0;
      const value = hasData ? total / daysWithData : 0;
      const targetValue = targetTotal / 7;
      const startDate = fromIsoDayLocal(weekStartDay);
      const label = 'Week of ' + startDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      points.push({ day: weekStartDay, label, value, targetValue, hasData });
    }
    return points;
  }

  const numDays = period === 'monthly' ? 30 : 7;
  const points = [];
  for (let i = numDays - 1; i >= 0; i -= 1) {
    const day = shiftIsoDay(baseIsoDay, -i);
    points.push({ day, value: dayMap.get(day) || 0, targetValue: targetForDay(day), hasData: dayMap.has(day) });
  }
  return points;
}

function drawTrend(dailyTotals, baseIsoDay = shiftIsoDay(getLocalIsoDay(), -1)) {
  if (!trendCanvasEl) {
    return;
  }
  const period = state.macroSnapshotPeriod || 'weekly';
  const targetLineColor = 'rgba(255, 202, 40, 0.95)';
  const averageLineColor = 'rgba(5, 255, 161, 0.95)';
  const cssWidth = Math.max(1, Math.floor(trendCanvasEl.clientWidth || 0));
  const cssHeight = 120;
  if (cssWidth > 0 && (trendCanvasEl.width !== cssWidth || trendCanvasEl.height !== cssHeight)) {
    trendCanvasEl.width = cssWidth;
    trendCanvasEl.height = cssHeight;
  }

  const ctx = trendCanvasEl.getContext('2d');
  const w = trendCanvasEl.width;
  const h = trendCanvasEl.height;
  ctx.clearRect(0, 0, w, h);

  const points = buildTrendPoints(dailyTotals, period, baseIsoDay);

  const targetValues = points.map((p) => Number(p.targetValue || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const max = Math.max(...points.map((p) => p.value), ...targetValues, 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const range = Math.max(max - min, 1);
  const trendMacro = getTrendMacroConfig();

  const padX = 34;
  const padY = 14;
  const xLabelH = period !== 'weekly' ? 14 : 0;
  const usableW = w - padX * 2;
  const usableH = h - padY * 2 - xLabelH;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * usableW;
    const y = padY + ((max - p.value) / range) * usableH;
    return { ...p, x, y };
  });

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,207,255,0.28)');
  grad.addColorStop(1, 'rgba(0,207,255,0.02)');

  if (targetValues.length) {
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    let startedTargetLine = false;
    for (let i = 0; i < coords.length; i += 1) {
      const pointTarget = Number(coords[i].targetValue || 0);
      if (!Number.isFinite(pointTarget) || pointTarget <= 0) {
        startedTargetLine = false;
        continue;
      }
      const targetY = padY + ((max - pointTarget) / range) * usableH;
      if (!startedTargetLine) {
        ctx.moveTo(coords[i].x, targetY);
        startedTargetLine = true;
      } else {
        ctx.lineTo(coords[i].x, targetY);
      }
    }
    ctx.strokeStyle = targetLineColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i += 1) {
    ctx.lineTo(coords[i].x, coords[i].y);
  }
  ctx.lineTo(coords[coords.length - 1].x, h - padY - xLabelH + 4);
  ctx.lineTo(coords[0].x, h - padY - xLabelH + 4);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.shadowBlur = 14;
  ctx.shadowColor = 'rgba(0, 207, 255, 0.75)';
  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i += 1) {
    ctx.lineTo(coords[i].x, coords[i].y);
  }
  ctx.strokeStyle = '#00cfff';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.fillStyle = '#00cfff';
  for (const p of coords) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Average line over points that have logged data.
  let average = 0;
  let hasAverage = false;
  const trendSource = points.filter((p) => p.hasData);
  if (trendSource.length >= 1) {
    hasAverage = true;
    average = trendSource.reduce((sum, point) => sum + point.value, 0) / trendSource.length;
    const avgY = padY + ((max - average) / range) * usableH;

    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(5, 255, 161, 0.8)';
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.moveTo(padX, avgY);
    ctx.lineTo(w - padX, avgY);
    ctx.strokeStyle = averageLineColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  const avgTargetValue = targetValues.length
    ? targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length
    : 0;
  updateTrendLegend(average, hasAverage, avgTargetValue, targetValues.length > 0, trendMacro.unit);

  const tickCount = 4;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillStyle = 'rgba(160, 180, 204, 0.85)';
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= tickCount; i += 1) {
    const ratio = i / tickCount;
    const value = max - ratio * range;
    const y = padY + ratio * usableH;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
    ctx.fillText(fmtNumber(value), padX - 6, y);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.moveTo(padX, padY);
  ctx.lineTo(padX, h - padY - xLabelH);
  ctx.stroke();
  ctx.restore();

  // X-axis date labels for monthly and annual views.
  if (period !== 'weekly' && points.length > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(160, 180, 204, 0.65)';
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'bottom';
    const labelY = h - 2;

    if (period === 'monthly') {
      const fmtShort = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      ctx.textAlign = 'left';
      ctx.fillText(fmtShort(fromIsoDayLocal(points[0].day)), padX + 2, labelY);
      ctx.textAlign = 'right';
      ctx.fillText(fmtShort(fromIsoDayLocal(points[points.length - 1].day)), w - padX - 2, labelY);
    } else {
      // Annual: one label per month at the first weekly point in that month.
      let lastMonthShown = -1;
      for (let i = 0; i < points.length; i += 1) {
        const d = fromIsoDayLocal(points[i].day);
        const month = d.getMonth();
        if (month !== lastMonthShown) {
          lastMonthShown = month;
          const x = padX + (i / (points.length - 1)) * usableW;
          ctx.textAlign = i === 0 ? 'left' : (i >= points.length - 2 ? 'right' : 'center');
          ctx.fillText(d.toLocaleDateString([], { month: 'short' }), x, labelY);
        }
      }
    }
    ctx.restore();
  }

  trendPointCoords = coords;
  const periodLabel = period === 'annual' ? '52-week' : period === 'monthly' ? '30-day' : '7-day';
  trendCanvasEl.setAttribute('aria-label', `${periodLabel} ${trendMacro.label.toLowerCase()} trend`);
  bindTrendInteractions();
}

function bindTrendResize() {
  if (trendResizeBound) {
    return;
  }

  window.addEventListener('resize', () => {
    if (!state.macroDailyTotals) {
      return;
    }
    drawTrend(state.macroDailyTotals);
  });

  trendResizeBound = true;
}

function syncTrendMacroCards() {
  for (const card of trendMacroCards) {
    const isActive = card.dataset.trendMacro === state.selectedTrendMacro;
    card.classList.toggle('is-active', isActive);
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function setTrendMacro(macro) {
  const allowed = new Set(['calories', 'protein', 'carbs', 'fat']);
  if (!allowed.has(macro) || state.selectedTrendMacro === macro) {
    return;
  }
  state.selectedTrendMacro = macro;
  syncTrendMacroCards();
  hideTrendTooltip();
  if (state.macroDailyTotals) {
    drawTrend(state.macroDailyTotals);
  }
}

function bindTrendMacroCards() {
  if (trendMacroBound) {
    return;
  }

  for (const card of trendMacroCards) {
    card.addEventListener('click', () => {
      setTrendMacro(card.dataset.trendMacro || '');
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      setTrendMacro(card.dataset.trendMacro || '');
    });
  }

  syncTrendMacroCards();
  trendMacroBound = true;
}

const PERIOD_HEADING = {
  weekly: 'Weekly Snapshot',
  monthly: 'Monthly Snapshot',
  annual: 'Annual Snapshot'
};

let snapshotToggleBound = false;

function syncPeriodToggle(toggleEl, period) {
  if (!toggleEl) {
    return;
  }
  for (const btn of toggleEl.querySelectorAll('.period-btn')) {
    const active = btn.dataset.period === period;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
}

async function refreshMacroSnapshotData() {
  const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
  const scope = periodToScope[state.macroSnapshotPeriod] || 'week';
  try {
    const data = await api(`/api/daily-totals?scope=${scope}&tz=${encodeURIComponent(getTimezone())}`);
    state.macroDailyTotals = data.dailyTotals || [];
    if (data.targets) {
      state.dashboardData.targets = data.targets;
    }
    if (data.targetHistory) {
      setMacroTargetHistory(data.targetHistory);
    }
    drawTrend(state.macroDailyTotals);
    renderSnapshotStats(state.macroDailyTotals, state.dashboardData.targets);
    renderCoachForPage('macros');
  } catch (error) {
    console.error('Failed to refresh macro snapshot:', error);
  }
}

function bindSnapshotToggles() {
  if (snapshotToggleBound) {
    return;
  }

  if (macroPeriodToggleEl) {
    for (const btn of macroPeriodToggleEl.querySelectorAll('.period-btn')) {
      btn.addEventListener('click', async () => {
        const period = btn.dataset.period;
        if (!period || period === state.macroSnapshotPeriod) {
          return;
        }
        state.macroSnapshotPeriod = period;
        syncPeriodToggle(macroPeriodToggleEl, period);
        if (macroSnapshotHeadingEl) {
          macroSnapshotHeadingEl.textContent = PERIOD_HEADING[period] || 'Snapshot';
        }
        hideTrendTooltip();
        await refreshMacroSnapshotData();
      });
    }
  }

  if (weightPeriodToggleEl) {
    for (const btn of weightPeriodToggleEl.querySelectorAll('.period-btn')) {
      btn.addEventListener('click', async () => {
        const period = btn.dataset.period;
        if (!period || period === state.weightSnapshotPeriod) {
          return;
        }
        state.weightSnapshotPeriod = period;
        syncPeriodToggle(weightPeriodToggleEl, period);
        if (weightSnapshotHeadingEl) {
          weightSnapshotHeadingEl.textContent = PERIOD_HEADING[period] || 'Snapshot';
        }
        await refreshWeightData();
      });
    }
  }

  if (workoutPeriodToggleEl) {
    for (const btn of workoutPeriodToggleEl.querySelectorAll('.period-btn')) {
      btn.addEventListener('click', async () => {
        const period = btn.dataset.period;
        if (!period || period === state.workoutSnapshotPeriod) {
          return;
        }
        state.workoutSnapshotPeriod = period;
        syncPeriodToggle(workoutPeriodToggleEl, period);
        if (workoutSnapshotHeadingEl) {
          workoutSnapshotHeadingEl.textContent = PERIOD_HEADING[period] || 'Snapshot';
        }
        await refreshWorkoutData();
      });
    }
  }

  snapshotToggleBound = true;
}

function renderSnapshotStats(dailyTotals, targets) {
  const period = state.macroSnapshotPeriod || 'weekly';
  const numDays = period === 'annual' ? 364 : period === 'monthly' ? 30 : 7;
  const periodLabel = period === 'annual' ? '52 weeks' : `${numDays} days`;

  const daysWithData = (dailyTotals || []).length;
  let avgCalories = 0;
  let avgProtein = 0;
  let avgCarbs = 0;
  let avgFat = 0;
  if (daysWithData > 0) {
    for (const dt of dailyTotals) {
      avgCalories += dt.calories;
      avgProtein += dt.protein;
      avgCarbs += dt.carbs;
      avgFat += dt.fat;
    }
    avgCalories /= daysWithData;
    avgProtein /= daysWithData;
    avgCarbs /= daysWithData;
    avgFat /= daysWithData;
  }

  setText(avgCaloriesEl, fmtNumber(avgCalories));
  setText(avgProteinEl, `${fmtNumber(avgProtein)}g`);
  setText(avgCarbsEl, `${fmtNumber(avgCarbs)}g`);
  setText(avgFatEl, `${fmtNumber(avgFat)}g`);
  const effectiveTargets = averageTargetsForRows(dailyTotals || [], targets || {});
  renderWeeklyTargets(
    { calories: avgCalories, protein: avgProtein, carbs: avgCarbs, fat: avgFat },
    effectiveTargets
  );
  setText(
    weeklyAvgNoteEl,
    daysWithData > 0
      ? `Based on ${daysWithData} day${daysWithData === 1 ? '' : 's'} with entries in the last ${periodLabel}.`
      : `No entries in the last ${periodLabel}.`
  );
}

function renderDashboard(data) {
  const compactMobile = isCompactMobileView();
  setSleepTargetFromTargets(data.targets || {});

  if (state.macroDailyTotals) {
    drawTrend(state.macroDailyTotals);
    renderSnapshotStats(state.macroDailyTotals, data.targets);
  }

  const baseDay = getLocalIsoDay();
  if (!state.selectedEntriesDay) {
    state.selectedEntriesDay = baseDay;
  }
  if (state.selectedEntriesDay > baseDay) {
    state.selectedEntriesDay = baseDay;
  }

  if (entriesDayLabelEl) {
    entriesDayLabelEl.textContent = formatIsoDayLabel(state.selectedEntriesDay);
  }
  if (entriesNextDayBtnEl) {
    entriesNextDayBtnEl.disabled = state.selectedEntriesDay >= baseDay;
  }

  const dayItems = data.entries
    .filter((entry) => getLocalIsoDay(entry.consumedAt) === state.selectedEntriesDay)
    .sort((a, b) => new Date(b.consumedAt).getTime() - new Date(a.consumedAt).getTime());
  const dayTotals = dayItems.reduce((acc, entry) => {
    acc.calories += Number(entry.calories || 0);
    acc.protein += Number(entry.protein || 0);
    acc.carbs += Number(entry.carbs || 0);
    acc.fat += Number(entry.fat || 0);
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  setText(todayCaloriesEl, fmtNumber(dayTotals.calories));
  setText(todayProteinEl, `${fmtNumber(dayTotals.protein)}g`);
  setText(todayCarbsEl, `${fmtNumber(dayTotals.carbs)}g`);
  setText(todayFatEl, `${fmtNumber(dayTotals.fat)}g`);
  renderMacroTargets(dayTotals, data.targets || {});
  renderCoachForPage('macros');


  entriesByDayEl.innerHTML = '';
  if (!dayItems.length) {
    entriesByDayEl.textContent = 'No entries for this day.';
    return;
  }

  // Edit meals link
  const editBar = document.createElement('div');
  editBar.className = 'macro-cards-header';
  editBar.innerHTML = `<a href="#" class="edit-items-link" data-edit-entries>${state.editingEntries ? '(done)' : '(edit meals)'}</a>`;
  entriesByDayEl.appendChild(editBar);

  const container = document.createElement('div');
  container.className = 'entry-cards';

  const rendered = new Set();
  for (const item of dayItems) {
    if (rendered.has(item.id)) continue;

    if (item.mealGroup) {
      const groupItems = dayItems.filter((e) => e.mealGroup === item.mealGroup);
      if (groupItems.every((e) => rendered.has(e.id))) continue;

      const totals = groupItems.reduce((acc, e) => {
        acc.calories += Number(e.calories || 0);
        acc.protein += Number(e.protein || 0);
        acc.carbs += Number(e.carbs || 0);
        acc.fat += Number(e.fat || 0);
        return acc;
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      const isExpanded = state.expandedMealGroups && state.expandedMealGroups.has(item.mealGroup);
      const timeStr = new Date(item.consumedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const mealQty = item.mealQuantity || 1;
      const mealUnit = item.mealUnit || 'serving';
      const mealGroupChecked = state.selectedMealGroups.has(item.mealGroup) ? 'checked' : '';
      const mealQualityChips = renderMealQualityChips(groupItems);

      let childrenHtml = '';
      for (const child of groupItems) {
        rendered.add(child.id);
        const childChecked = state.selectedEntryIds.has(child.id) ? 'checked' : '';
        const childId = safeId(child.id);
        const groupId = escapeAttr(item.mealGroup);
        const childGroupId = escapeAttr(child.mealGroup);
        const unitScale = mealQty > 0 ? mealQty : 1;
        const childQuantity = Number(child.quantity || 0) / unitScale;
        const childCalories = Number(child.calories || 0) / unitScale;
        const childProtein = Number(child.protein || 0) / unitScale;
        const childCarbs = Number(child.carbs || 0) / unitScale;
        const childFat = Number(child.fat || 0) / unitScale;
        childrenHtml += `
          <div class="macro-card-child" data-entry-id="${childId}" data-meal-group="${groupId}">
            <div class="macro-card-check"><input type="checkbox" class="entry-checkbox" data-entry-id="${childId}" data-in-group="1" data-meal-group="${childGroupId}" ${childChecked} /></div>
            <div class="macro-card-child-body" data-edit-entry-id="${childId}">
              <span class="macro-card-child-name">${escapeHtml(child.itemName)}</span>
              <span class="macro-card-child-detail">${fmtNumber(childQuantity)} ${escapeHtml(child.unit || '')} · ${fmtNumber(childCalories)} cal · ${fmtNumber(childProtein)}g protein · ${fmtNumber(childCarbs)}g carbs · ${fmtNumber(childFat)}g fat</span>
            </div>
          </div>
        `;
      }

      const mealCard = document.createElement('div');
      mealCard.className = 'macro-card macro-card--meal' + (isExpanded ? ' expanded' : '');
      mealCard.dataset.mealGroup = item.mealGroup;
      const mealGroupAttr = escapeAttr(item.mealGroup);
      mealCard.innerHTML = `
        <div class="meal-group-header" data-meal-group="${mealGroupAttr}">
          <div class="macro-card-check"><input type="checkbox" class="meal-group-checkbox" data-meal-group="${mealGroupAttr}" ${mealGroupChecked} /></div>
          <div class="macro-card-toggle">${isExpanded ? '\u25BC' : '\u25B6'}</div>
          <div class="macro-card-body" data-edit-meal-group="${mealGroupAttr}">
            <div class="macro-card-title"><strong>${escapeHtml(item.mealName || 'Meal')}</strong></div>
            <div class="entry-card-chips">
              <span class="entry-card-chip">${fmtNumber(mealQty)} ${escapeHtml(mealUnit)}</span>
              <span class="entry-card-chip entry-card-chip--accent">${fmtNumber(totals.calories)} cal</span>
              <span class="entry-card-chip">${fmtNumber(totals.protein)}g protein</span>
              <span class="entry-card-chip">${fmtNumber(totals.carbs)}g carbs</span>
              <span class="entry-card-chip">${fmtNumber(totals.fat)}g fat</span>
              ${mealQualityChips}
            </div>
          </div>
          <div class="macro-card-time">${timeStr}</div>
        </div>
        <div class="macro-card-children" ${isExpanded ? '' : 'style="display:none"'}>
          ${childrenHtml}
        </div>
      `;
      container.appendChild(mealCard);
    } else {
      rendered.add(item.id);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderMacroCard(item);
      container.appendChild(wrapper.firstElementChild);
    }
  }

  entriesByDayEl.appendChild(container);

  renderSelectionActions();
}

function getSelectionMode() {
  if (state.selectedMealGroups.size > 0) return 'meals';
  if (state.selectedEntryIds.size > 0) {
    const entries = state.dashboardData?.entries || [];
    const anyInGroup = [...state.selectedEntryIds].some((id) => {
      const entry = entries.find((e) => e.id === id);
      return entry && entry.mealGroup;
    });
    return anyInGroup ? 'sub-items' : 'items';
  }
  return null;
}

function clearSelection() {
  state.selectedEntryIds.clear();
  state.selectedMealGroups.clear();
}

function renderSelectionActions() {
  let bar = document.getElementById('selection-action-bar');
  const mode = getSelectionMode();
  const entryCount = state.selectedEntryIds.size;
  const mealCount = state.selectedMealGroups.size;

  if (!mode) {
    if (bar) bar.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'selection-action-bar';
    bar.className = 'selection-action-bar';
    entriesByDayEl.appendChild(bar);
  }

  let html = '';

  if (mode === 'meals') {
    html += `<span class="selection-count">${mealCount} meal${mealCount > 1 ? 's' : ''} selected</span>`;
    html += '<button type="button" class="btn-danger table-action-btn" data-sel-action="delete-meal">Delete</button>';
    html += '<button type="button" class="btn-info table-action-btn" data-sel-action="split-meal">Split</button>';
  } else if (mode === 'sub-items') {
    html += `<span class="selection-count">${entryCount} item${entryCount > 1 ? 's' : ''} selected</span>`;
    html += '<button type="button" class="btn-danger table-action-btn" data-sel-action="delete-item">Delete</button>';
    html += '<button type="button" class="btn-info table-action-btn" data-sel-action="remove-from-meal">Remove</button>';
  } else {
    html += `<span class="selection-count">${entryCount} item${entryCount > 1 ? 's' : ''} selected</span>`;
    html += '<button type="button" class="btn-danger table-action-btn" data-sel-action="delete-item">Delete</button>';
    if (entryCount === 1) {
      html += '<button type="button" class="btn-info table-action-btn" data-sel-action="edit-item">Edit</button>';
    }
    if (entryCount >= 2) {
      html += '<button type="button" class="btn-success table-action-btn" data-sel-action="combine">Combine</button>';
    }
  }

  bar.innerHTML = html;
}

function toggleEditEntries() {
  state.editingEntries = !state.editingEntries;
  entriesByDayEl.classList.toggle('editing', state.editingEntries);
  entriesByDayEl.querySelectorAll('[data-edit-entries]').forEach(el => {
    el.textContent = state.editingEntries ? '(done)' : '(edit meals)';
  });
  if (!state.editingEntries) {
    clearSelection();
    renderSelectionActions();
  }
}

entriesByDayEl.addEventListener('click', (event) => {
  const editLink = event.target.closest('[data-edit-entries]');
  if (editLink) {
    event.preventDefault();
    toggleEditEntries();
    return;
  }

  // Pencil icon: edit individual entry
  const editEntryIcon = event.target.closest('[data-edit-entry-id]');
  if (editEntryIcon) {
    event.preventDefault();
    event.stopPropagation();
    const entryId = Number(editEntryIcon.dataset.editEntryId);
    const entries = state.dashboardData?.entries || [];
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    showEntryModal(entry, {
      title: 'Edit Item',
      onSave: async (updated) => {
        try {
          await api(`/api/entries/${entryId}`, {
            method: 'PUT',
            body: JSON.stringify(updated)
          });
          setActionBanner('Entry updated.', 'success');
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      },
      onDelete: async () => {
        if (!window.confirm('Delete this entry?')) return;
        try {
          await api(`/api/entries/${entryId}`, { method: 'DELETE' });
          setActionBanner('Entry deleted.', 'success');
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      },
      onCopyToToday: buildCopyEntryToTodayHandler(entry)
    });
    return;
  }

  // Pencil icon: edit meal group
  const editMealIcon = event.target.closest('[data-edit-meal-group]');
  if (editMealIcon) {
    event.preventDefault();
    event.stopPropagation();
    const groupId = editMealIcon.dataset.editMealGroup;
    const mealEntry = (state.dashboardData?.entries || []).find(e => e.mealGroup === groupId);
    if (!mealEntry) return;
    showCombineModal([], {
      name: mealEntry.mealName || 'Meal',
      quantity: mealEntry.mealQuantity || 1,
      unit: mealEntry.mealUnit || 'serving',
      mealGroup: groupId,
      onCopyToToday: buildCopyMealToTodayHandler(groupId, mealEntry),
      onSave: async (name, quantity, unit) => {
        try {
          await api(`/api/meal-group/${encodeURIComponent(groupId)}/scale`, {
            method: 'PUT',
            body: JSON.stringify({ quantity, unit, name: name || undefined })
          });
          setActionBanner('Meal updated.', 'success');
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      }
    });
    return;
  }
});

entriesByDayEl.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.classList.contains('meal-group-checkbox')) {
    const groupId = target.dataset.mealGroup;
    if (!groupId) return;

    // Don't allow mixing meals and individual items
    if (target.checked && state.selectedEntryIds.size > 0) {
      // Check if any selected entries are NOT in a group (standalone items)
      const entries = state.dashboardData?.entries || [];
      const anyStandalone = [...state.selectedEntryIds].some((id) => {
        const e = entries.find((entry) => entry.id === id);
        return e && !e.mealGroup;
      });
      if (anyStandalone) {
        target.checked = false;
        setActionBanner('Cannot mix meal and item selections.', 'info');
        return;
      }
    }

    if (target.checked) {
      state.selectedMealGroups.add(groupId);
    } else {
      state.selectedMealGroups.delete(groupId);
    }
    renderSelectionActions();
    return;
  }

  if (target.classList.contains('entry-checkbox')) {
    const entryId = Number(target.dataset.entryId);
    if (!entryId) return;

    const inGroup = target.dataset.inGroup === '1';

    // Don't allow mixing meals and individual items
    if (target.checked) {
      if (inGroup && state.selectedEntryIds.size > 0) {
        const entries = state.dashboardData?.entries || [];
        const anyStandalone = [...state.selectedEntryIds].some((id) => {
          const e = entries.find((entry) => entry.id === id);
          return e && !e.mealGroup;
        });
        if (anyStandalone) {
          target.checked = false;
          setActionBanner('Cannot mix meal sub-items and standalone item selections.', 'info');
          return;
        }
      }
      if (!inGroup && state.selectedEntryIds.size > 0) {
        const entries = state.dashboardData?.entries || [];
        const anyInGroup = [...state.selectedEntryIds].some((id) => {
          const e = entries.find((entry) => entry.id === id);
          return e && e.mealGroup;
        });
        if (anyInGroup) {
          target.checked = false;
          setActionBanner('Cannot mix standalone items and meal sub-item selections.', 'info');
          return;
        }
      }
      if (!inGroup && state.selectedMealGroups.size > 0) {
        target.checked = false;
        setActionBanner('Cannot mix meal and item selections.', 'info');
        return;
      }
      if (inGroup && state.selectedMealGroups.size > 0) {
        target.checked = false;
        setActionBanner('Cannot mix meal and sub-item selections.', 'info');
        return;
      }
    }

    if (target.checked) {
      state.selectedEntryIds.add(entryId);
    } else {
      state.selectedEntryIds.delete(entryId);
    }
    renderSelectionActions();
    return;
  }
});

entriesByDayEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const selAction = target.dataset.selAction;
  if (!selAction) return;

  if (selAction === 'clear') {
    clearSelection();
    renderDashboard(state.dashboardData);
    return;
  }

  if (selAction === 'edit-item') {
    const entryId = [...state.selectedEntryIds][0];
    if (!entryId) return;
    const entries = state.dashboardData?.entries || [];
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    clearSelection();
    renderDashboard(state.dashboardData);
    showEntryModal(entry, {
      title: 'Edit Item',
      onSave: async (updated) => {
        try {
          await api(`/api/entries/${entryId}`, {
            method: 'PUT',
            body: JSON.stringify(updated)
          });
          setActionBanner('Entry updated.', 'success');
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      },
      onDelete: async () => {
        if (!window.confirm('Delete this entry?')) return;
        try {
          await api(`/api/entries/${entryId}`, { method: 'DELETE' });
          setActionBanner('Entry deleted.', 'success');
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      },
      onCopyToToday: buildCopyEntryToTodayHandler(entry)
    });
    return;
  }

  if (selAction === 'edit-meal') {
    const groupId = [...state.selectedMealGroups][0];
    if (!groupId) return;
    const mealEntry = (state.dashboardData?.entries || []).find(e => e.mealGroup === groupId);
    showCombineModal([], {
      name: mealEntry?.mealName || 'Meal',
      quantity: mealEntry?.mealQuantity || 1,
      unit: mealEntry?.mealUnit || 'serving',
      mealGroup: groupId,
      onCopyToToday: buildCopyMealToTodayHandler(groupId, mealEntry),
      onSave: async (name, quantity, unit) => {
        try {
          await api(`/api/meal-group/${encodeURIComponent(groupId)}/scale`, {
            method: 'PUT',
            body: JSON.stringify({ quantity, unit, name: name || undefined })
          });
          clearSelection();
          setActionBanner('Meal updated.', 'success');
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      }
    });
    return;
  }

  if (selAction === 'delete-item') {
    const ids = [...state.selectedEntryIds];
    const confirmed = window.confirm(`Delete ${ids.length} entr${ids.length > 1 ? 'ies' : 'y'}?`);
    if (!confirmed) return;
    try {
      for (const id of ids) {
        await api(`/api/entries/${id}`, { method: 'DELETE' });
      }
      clearSelection();
      setActionBanner(`${ids.length} entr${ids.length > 1 ? 'ies' : 'y'} deleted.`, 'success');
      await refreshDashboard();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
    return;
  }

  if (selAction === 'delete-meal') {
    const groups = [...state.selectedMealGroups];
    const confirmed = window.confirm(`Delete ${groups.length} meal${groups.length > 1 ? 's' : ''} and all their items?`);
    if (!confirmed) return;
    try {
      const entries = state.dashboardData?.entries || [];
      for (const groupId of groups) {
        const groupEntries = entries.filter((e) => e.mealGroup === groupId);
        for (const e of groupEntries) {
          await api(`/api/entries/${e.id}`, { method: 'DELETE' });
        }
      }
      clearSelection();
      setActionBanner('Meal(s) deleted.', 'success');
      await refreshDashboard();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
    return;
  }

  if (selAction === 'split-meal') {
    const groups = [...state.selectedMealGroups];
    try {
      for (const groupId of groups) {
        await api(`/api/meal-group/${encodeURIComponent(groupId)}/split`, { method: 'POST' });
      }
      clearSelection();
      setActionBanner('Meal(s) split into individual items.', 'success');
      await refreshDashboard();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
    return;
  }

  if (selAction === 'remove-from-meal') {
    const ids = [...state.selectedEntryIds];
    try {
      for (const id of ids) {
        await api(`/api/entries/${id}/remove-from-group`, { method: 'POST' });
      }
      clearSelection();
      setActionBanner('Item(s) removed from meal.', 'success');
      await refreshDashboard();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
    return;
  }

  if (selAction === 'combine') {
    showCombineModal([...state.selectedEntryIds]);
    return;
  }
});

function showCombineModal(entryIds, options) {
  const isEdit = options && options.onSave;
  const title = isEdit ? 'Edit Meal' : 'Combine into Meal';
  const btnLabel = isEdit ? 'Save' : 'Combine';
  const defaultName = (options && options.name) || 'Meal';
  const defaultQty = (options && options.quantity) || 1;
  const defaultUnit = (options && options.unit) || 'serving';
  const canCopyToToday = Boolean(isEdit && options?.onCopyToToday);

  let overlay = document.getElementById('combine-modal-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'combine-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal">
      <h3>${escapeHtml(title)}</h3>
      <label for="combine-name">Meal Name</label>
      <input id="combine-name" type="text" value="${escapeAttr(defaultName)}" />
      <label for="combine-qty">Quantity</label>
      <input id="combine-qty" type="number" step="0.1" min="0.1" value="${escapeAttr(defaultQty)}" />
      <label for="combine-unit">Unit</label>
      <input id="combine-unit" type="text" value="${escapeAttr(defaultUnit)}" />
      ${isEdit ? '<label class="inline-check entry-modal-quickadd"><input type="checkbox" id="combine-save-quickadd" /><span>Save as quick add</span></label>' : ''}
      <div class="combine-modal-actions">
        ${canCopyToToday ? '<button type="button" class="btn-info table-action-btn" id="combine-copy-today-btn">Copy to Today</button><span style="flex:1"></span>' : ''}
        <button type="button" class="btn-muted table-action-btn" id="combine-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="combine-confirm-btn">${btnLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = document.getElementById('combine-name');
  nameInput.focus();
  nameInput.select();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('combine-cancel-btn').addEventListener('click', () => overlay.remove());

  if (canCopyToToday) {
    document.getElementById('combine-copy-today-btn').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      overlay.remove();
      await options.onCopyToToday();
    });
  }

  document.getElementById('combine-confirm-btn').addEventListener('click', async () => {
    const mealName = nameInput.value.trim() || 'Meal';
    const quantity = Number(document.getElementById('combine-qty').value) || 1;
    const unit = document.getElementById('combine-unit').value.trim() || 'serving';
    const saveQuickAdd = isEdit && document.getElementById('combine-save-quickadd')?.checked;
    overlay.remove();

    if (isEdit) {
      if (saveQuickAdd && options.mealGroup) {
        try {
          const entries = state.dashboardData?.entries || [];
          const subItems = entries.filter(e => e.mealGroup === options.mealGroup);
          const payload = buildSavedMealQuickAddPayloadFromEntries(subItems, {
            name: mealName,
            quantity,
            unit
          });
          await api('/api/saved-items', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          setActionBanner('Quick add item saved.', 'success');
          loadQuickEntries({ force: true });
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      }
      options.onSave(mealName, quantity, unit);
      return;
    }

    try {
      await api('/api/entries/combine', {
        method: 'POST',
        body: JSON.stringify({ entryIds, mealName, quantity, unit })
      });
      clearSelection();
      setActionBanner('Items combined into a meal.', 'success');
      await refreshDashboard();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('combine-confirm-btn').click();
    }
    if (e.key === 'Escape') {
      overlay.remove();
    }
  });
}

function showEntryModal(entry, { onSave, onDelete, onCopyToToday, title } = {}) {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const consumedAtValue = entry.consumedAt ? isoToLocalInputValue(entry.consumedAt) : '';
  const canCopyToToday = Boolean(onCopyToToday);

  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>${escapeHtml(title || 'Edit Item')}</h3>
      <label for="entry-modal-name">Item</label>
      <input id="entry-modal-name" type="text" value="${escapeAttr(entry.itemName || '')}" />
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="entry-modal-qty">Quantity</label>
          <input id="entry-modal-qty" type="number" step="0.1" min="0" value="${escapeAttr(entry.quantity || 1)}" />
        </div>
        <div class="entry-modal-field">
          <label for="entry-modal-unit">Unit</label>
          <input id="entry-modal-unit" type="text" value="${escapeAttr(entry.unit || 'serving')}" />
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="entry-modal-cal">Calories</label>
          <input id="entry-modal-cal" type="number" step="0.1" min="0" value="${escapeAttr(entry.calories || 0)}" />
        </div>
        <div class="entry-modal-field">
          <label for="entry-modal-protein">Protein</label>
          <input id="entry-modal-protein" type="number" step="0.1" min="0" value="${escapeAttr(entry.protein || 0)}" />
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="entry-modal-carbs">Carbs</label>
          <input id="entry-modal-carbs" type="number" step="0.1" min="0" value="${escapeAttr(entry.carbs || 0)}" />
        </div>
        <div class="entry-modal-field">
          <label for="entry-modal-fat">Fat</label>
          <input id="entry-modal-fat" type="number" step="0.1" min="0" value="${escapeAttr(entry.fat || 0)}" />
        </div>
      </div>
      ${consumedAtValue ? `<label for="entry-modal-time">Time</label><input id="entry-modal-time" type="datetime-local" value="${escapeAttr(consumedAtValue)}" />` : ''}
      <label class="inline-check entry-modal-quickadd"><input type="checkbox" id="entry-modal-save-quickadd" /><span>Save as quick add</span></label>
      <div class="combine-modal-actions">
        ${onDelete ? '<button type="button" class="btn-danger table-action-btn" id="entry-modal-delete-btn">Delete</button>' : ''}
        ${canCopyToToday ? '<button type="button" class="btn-info table-action-btn" id="entry-modal-copy-today-btn">Copy to Today</button>' : ''}
        <span style="flex:1"></span>
        <button type="button" class="btn-muted table-action-btn" id="entry-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="entry-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('entry-modal-name').focus();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('entry-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  if (onDelete) {
    document.getElementById('entry-modal-delete-btn').addEventListener('click', () => {
      overlay.remove();
      onDelete();
    });
  }

  if (canCopyToToday) {
    document.getElementById('entry-modal-copy-today-btn').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      overlay.remove();
      await onCopyToToday();
    });
  }

  // Quantity-based macro scaling
  const qtyInput = document.getElementById('entry-modal-qty');
  const baseQty = Number(entry.quantity || 1);
  const baseCal = Number(entry.calories || 0);
  const basePro = Number(entry.protein || 0);
  const baseCarb = Number(entry.carbs || 0);
  const baseFat = Number(entry.fat || 0);
  qtyInput.addEventListener('input', () => {
    const newQty = Number(qtyInput.value || 0);
    if (!Number.isFinite(newQty) || newQty < 0 || baseQty <= 0) return;
    const factor = newQty / baseQty;
    document.getElementById('entry-modal-cal').value = formatScaledMacroValue(baseCal * factor);
    document.getElementById('entry-modal-protein').value = formatScaledMacroValue(basePro * factor);
    document.getElementById('entry-modal-carbs').value = formatScaledMacroValue(baseCarb * factor);
    document.getElementById('entry-modal-fat').value = formatScaledMacroValue(baseFat * factor);
  });

  document.getElementById('entry-modal-save-btn').addEventListener('click', async () => {
    const result = {
      itemName: document.getElementById('entry-modal-name').value.trim() || 'Item',
      quantity: Number(document.getElementById('entry-modal-qty').value) || 1,
      unit: document.getElementById('entry-modal-unit').value.trim() || 'serving',
      calories: Number(document.getElementById('entry-modal-cal').value) || 0,
      protein: Number(document.getElementById('entry-modal-protein').value) || 0,
      carbs: Number(document.getElementById('entry-modal-carbs').value) || 0,
      fat: Number(document.getElementById('entry-modal-fat').value) || 0
    };
    const timeEl = document.getElementById('entry-modal-time');
    if (timeEl) {
      result.consumedAt = asIso(timeEl.value);
    }
    const saveQuickAdd = document.getElementById('entry-modal-save-quickadd').checked;
    overlay.remove();
    if (saveQuickAdd) {
      try {
        await api('/api/saved-items', {
          method: 'POST',
          body: JSON.stringify({
            name: result.itemName,
            quantity: result.quantity,
            unit: result.unit,
            calories: result.calories,
            protein: result.protein,
            carbs: result.carbs,
            fat: result.fat
          })
        });
        setActionBanner('Quick add item saved.', 'success');
        loadQuickEntries({ force: true });
      } catch (error) {
        setActionBanner(error.message, 'error');
      }
    }
    if (onSave) onSave(result);
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('entry-modal-save-btn').click();
    }
    if (e.key === 'Escape') {
      overlay.remove();
    }
  });
}

function showWeightEditModal(entry) {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const loggedAtValue = isoToLocalInputValue(entry.loggedAt);
  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Weight</h3>
      <label for="weight-modal-weight">Weight</label>
      <input id="weight-modal-weight" type="number" step="0.1" min="0" value="${escapeAttr(entry.weight)}" />
      <label for="weight-modal-time">Logged At</label>
      <input id="weight-modal-time" type="datetime-local" value="${escapeAttr(loggedAtValue)}" />
      <div class="combine-modal-actions">
        <button type="button" class="btn-danger table-action-btn" id="weight-modal-delete-btn">Delete</button>
        <span style="flex:1"></span>
        <button type="button" class="btn-muted table-action-btn" id="weight-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="weight-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('weight-modal-weight').focus();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('weight-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  document.getElementById('weight-modal-delete-btn').addEventListener('click', async () => {
    if (!window.confirm('Delete this weight entry?')) return;
    overlay.remove();
    try {
      await deleteWeightEntryApi(entry.id);
      setActionBanner('Weight entry deleted.', 'success');
      await refreshWeightData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  document.getElementById('weight-modal-save-btn').addEventListener('click', async () => {
    const payload = {
      weight: parseWeightInputValue(document.getElementById('weight-modal-weight').value),
      loggedAt: asIso(document.getElementById('weight-modal-time').value || toDateTimeLocalValue())
    };
    overlay.remove();
    try {
      await api(`/api/weights/${entry.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setActionBanner('Weight entry updated.', 'success');
      await refreshWeightData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('weight-modal-save-btn').click(); }
    if (e.key === 'Escape') overlay.remove();
  });
}

function showWorkoutEditModal(entry) {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const loggedAtDate = new Date(entry.loggedAt).toISOString().slice(0, 10);
  const intensity = normalizeWorkoutIntensity(entry.intensity);
  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Workout</h3>
      <label for="workout-modal-desc">Description</label>
      <input id="workout-modal-desc" type="text" value="${escapeAttr(entry.description || '')}" />
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="workout-modal-date">Date</label>
          <input id="workout-modal-date" type="date" value="${escapeAttr(loggedAtDate)}" />
        </div>
        <div class="entry-modal-field">
          <label for="workout-modal-intensity">Intensity</label>
          <select id="workout-modal-intensity">
            <option value="low" ${intensity === 'low' ? 'selected' : ''}>Low</option>
            <option value="medium" ${intensity === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high" ${intensity === 'high' ? 'selected' : ''}>High</option>
          </select>
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="workout-modal-duration">Hours</label>
          <input id="workout-modal-duration" type="number" step="0.25" min="0" value="${escapeAttr(entry.durationHours)}" />
        </div>
        <div class="entry-modal-field">
          <label for="workout-modal-calories">Calories</label>
          <input id="workout-modal-calories" type="number" step="1" min="0" value="${escapeAttr(entry.caloriesBurned)}" />
        </div>
      </div>
      <div class="combine-modal-actions">
        <button type="button" class="btn-danger table-action-btn" id="workout-modal-delete-btn">Delete</button>
        <span style="flex:1"></span>
        <button type="button" class="btn-muted table-action-btn" id="workout-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="workout-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('workout-modal-desc').focus();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('workout-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  // Duration → calories sync
  const baseDuration = Number(entry.durationHours || 0);
  const baseCalories = Number(entry.caloriesBurned || 0);
  document.getElementById('workout-modal-duration').addEventListener('input', (e) => {
    const newDur = Number(e.target.value || 0);
    if (baseDuration > 0 && Number.isFinite(newDur) && newDur >= 0) {
      document.getElementById('workout-modal-calories').value = String(Math.round(baseCalories * (newDur / baseDuration)));
    }
  });

  document.getElementById('workout-modal-delete-btn').addEventListener('click', async () => {
    if (!window.confirm('Delete this workout?')) return;
    overlay.remove();
    try {
      await api(`/api/workouts/${entry.id}`, { method: 'DELETE' });
      setActionBanner('Workout deleted.', 'success');
      await refreshWorkoutData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  document.getElementById('workout-modal-save-btn').addEventListener('click', async () => {
    const loggedAtDateVal = document.getElementById('workout-modal-date').value;
    const loggedAt = loggedAtDateVal ? new Date(`${loggedAtDateVal}T09:00:00`).toISOString() : new Date().toISOString();
    const payload = {
      description: document.getElementById('workout-modal-desc').value.trim(),
      intensity: normalizeWorkoutIntensity(document.getElementById('workout-modal-intensity').value),
      durationHours: Number(document.getElementById('workout-modal-duration').value || 0),
      caloriesBurned: Number(document.getElementById('workout-modal-calories').value || 0),
      loggedAt
    };
    overlay.remove();
    try {
      await updateWorkoutEntryApi(entry.id, payload);
      setActionBanner('Workout updated.', 'success');
      await refreshWorkoutData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('workout-modal-save-btn').click(); }
    if (e.key === 'Escape') overlay.remove();
  });
}

async function refreshDashboard() {
  const tz = encodeURIComponent(getTimezone());
  await refreshCoachDismissals();
  const dashboard = await api(`/api/dashboard?tz=${tz}`);
  state.dashboardData = dashboard;
  syncHistoryQuickItems();
  renderSavedItems();
  renderDashboard(dashboard);
  bindTrendResize();
  bindTrendMacroCards();
  bindEditTargetsLink();
  bindSnapshotToggles();
  refreshMacroSnapshotData().catch((error) => {
    console.error('Failed to refresh macro snapshot:', error);
  });
}

parseBtnEl.addEventListener('click', async () => {
  if (state.mealImageLoading) {
    const message = 'Photo is still processing. Please wait a moment and try again.';
    setActionBanner(message, 'info');
    return;
  }

  setActionBanner('Parsing meal...', 'info');

  try {
    const parsed = await api('/api/parse-meal', {
      method: 'POST',
      body: JSON.stringify({
        text: mealTextEl.value,
        consumedAt: asIso(consumedAtEl.value),
        imageDataUrls: state.mealImageAttachments.length
          ? state.mealImageAttachments.map((attachment) => attachment.dataUrl)
          : undefined
      })
    });

    state.parsedMeal = parsed;
    renderParsedItems(parsed);
    setActionBanner(parsed.notes || 'Meal parsed.', 'success');
  } catch (error) {
    setActionBanner(error.message, 'error');
    state.parsedMeal = null;
    parsedItemsContainerEl.innerHTML = '';
    saveParsedBtnEl.disabled = true;
  }
});

saveParsedBtnEl.addEventListener('click', async () => {
  if (!state.parsedMeal) {
    return;
  }

  const consumedAt = asIso(consumedAtEl.value);
  const editedItems = collectParsedItemsFromUi();
  const parseSource = state.parsedMeal?.review?.source || (state.mealImageAttachments.length ? 'ai_photo' : 'ai_text');
  const parseSourceDetail = state.mealImageAttachments.length ? 'OpenAI meal photo parse' : 'OpenAI meal text parse';

  const items = editedItems.map((item) => ({
    itemName: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    consumedAt,
    source: item.source || parseSource,
    sourceDetail: item.sourceDetail || parseSourceDetail,
    confidence: item.confidence,
    needsReview: item.needsReview !== false
  }));

  const saveQuickAdd = document.getElementById('parsed-meal-save-quickadd');
  const saveItems = [];
  if (saveQuickAdd && saveQuickAdd.checked) {
    if (editedItems.length === 1) {
      const item = editedItems[0];
      const qty = Number(item.quantity) || 1;
      const perUnit = (v) => Number((Number(v || 0) / qty).toFixed(2));
      saveItems.push({
        name: item.itemName,
        quantity: 1,
        unit: item.unit || 'serving',
        calories: perUnit(item.calories),
        protein: perUnit(item.protein),
        carbs: perUnit(item.carbs),
        fat: perUnit(item.fat),
        source: parseSource,
        sourceDetail: 'Saved from parsed meal'
      });
    } else {
      saveItems.push(buildSavedMealQuickAddPayload({
        name: state.parsedMeal.mealName || 'Meal',
        quantity: state.parsedMeal.mealQuantity || 1,
        unit: state.parsedMeal.mealUnit || 'serving',
        components: editedItems,
        source: parseSource,
        sourceDetail: 'Saved from parsed meal'
      }));
    }
  }

  try {
    await api('/api/entries/bulk', {
      method: 'POST',
      body: JSON.stringify({
        consumedAt,
        items,
        saveItems,
        mealName: state.parsedMeal.mealName || undefined,
        mealQuantity: state.parsedMeal.mealQuantity || undefined,
        mealUnit: state.parsedMeal.mealUnit || undefined,
        itemsAreMealUnit: items.length > 1,
        source: parseSource,
        sourceDetail: parseSourceDetail
      })
    });

    setActionBanner('Saved parsed items.', 'success');
    mealTextEl.value = '';
    state.parsedMeal = null;
    clearMealImageSelection();
    parsedItemsContainerEl.innerHTML = '';
    saveParsedBtnEl.disabled = true;
    await refreshDashboard();
    if (saveItems.length) {
      loadQuickEntries({ force: true });
    }
  } catch (error) {
    setActionBanner(error.message, 'error');
  }
});

quickAddBtnEl.addEventListener('click', async () => {
  const selectedTemplate = getSelectedQuickTemplate();
  if (!selectedTemplate) {
    return;
  }

  try {
    if (selectedTemplate.type === 'saved') {
      await quickAddById(selectedTemplate.id);
    } else {
      await quickAddByTemplate(selectedTemplate);
    }
    setActionBanner('Quick add logged.', 'success');
    await refreshDashboard();
  } catch (error) {
    setActionBanner(error.message, 'error');
  }
});

if (copyYesterdayBtnEl) {
  copyYesterdayBtnEl.addEventListener('click', async () => {
    copyYesterdayBtnEl.disabled = true;
    try {
      const result = await copyYesterdayEntries();
      setActionBanner(
        result.copiedCount > 0 ? `Copied ${result.copiedCount} item${result.copiedCount === 1 ? '' : 's'} from yesterday.` : 'No entries found for yesterday.',
        result.copiedCount > 0 ? 'success' : 'info'
      );
    } catch (error) {
      setActionBanner(error.message, 'error');
    } finally {
      copyYesterdayBtnEl.disabled = false;
    }
  });
}

if (quickSearchEl) {
  quickSearchEl.addEventListener('input', () => {
    state.quickSearchQuery = quickSearchEl.value;
    state.quickSelectedKey = '';
    state.quickPickerShowAll = false;
    state.quickPickerActiveIndex = 0;
    quickAddBtnEl.disabled = true;
    quickEditToggleBtnEl.disabled = true;
    setQuickPickerOpen(true);
    renderQuickEntryList();
  });

  quickSearchEl.addEventListener('focus', () => {
    if (!state.savedItems.length && !state.historyQuickItems.length && !state.quickEntriesLoading) {
      return;
    }
    if (!state.quickPickerOpen) {
      state.quickPickerShowAll = false;
    }
    setQuickPickerOpen(true);
    renderQuickEntryList();
    quickSearchEl.select();
  });

  quickSearchEl.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
      return;
    }

    const query = state.quickPickerShowAll ? '' : quickSearchEl.value;
    const options = flattenQuickPickerGroups(quickPickerOptionGroups(query));

    if (event.key === 'Escape') {
      setQuickPickerOpen(false);
      state.quickPickerShowAll = false;
      quickSearchEl.removeAttribute('aria-activedescendant');
      return;
    }

    if (!options.length) {
      return;
    }

    event.preventDefault();

    if (!state.quickPickerOpen) {
      setQuickPickerOpen(true);
    }

    if (event.key === 'ArrowDown') {
      state.quickPickerActiveIndex = Math.min(options.length - 1, Math.max(0, state.quickPickerActiveIndex + 1));
      renderQuickEntryList();
      return;
    }

    if (event.key === 'ArrowUp') {
      state.quickPickerActiveIndex = Math.max(0, state.quickPickerActiveIndex - 1);
      renderQuickEntryList();
      return;
    }

    if (event.key === 'Enter') {
      const active = options[Math.max(0, state.quickPickerActiveIndex)];
      if (active) {
        selectQuickEntry(active.key);
      }
    }
  });
}

if (quickEntryToggleBtnEl) {
  quickEntryToggleBtnEl.addEventListener('click', () => {
    const nextOpen = !state.quickPickerOpen;
    state.quickPickerShowAll = nextOpen;
    state.quickPickerActiveIndex = 0;
    setQuickPickerOpen(nextOpen);
    renderQuickEntryList();
    if (nextOpen) {
      quickSearchEl?.focus();
    }
  });
}

document.addEventListener('mousedown', (event) => {
  if (!quickComboboxEl || quickComboboxEl.contains(event.target)) {
    return;
  }
  setQuickPickerOpen(false);
  state.quickPickerShowAll = false;
  quickSearchEl?.removeAttribute('aria-activedescendant');
});

quickEditToggleBtnEl.addEventListener('click', () => {
  const selectedTemplate = getSelectedQuickTemplate();
  if (!selectedTemplate) return;

  const selected = getSelectedSavedItem();

  showEntryModal(
    {
      itemName: selectedTemplate.name,
      quantity: selectedTemplate.quantity,
      unit: selectedTemplate.unit || 'serving',
      calories: selectedTemplate.calories,
      protein: selectedTemplate.protein,
      carbs: selectedTemplate.carbs,
      fat: selectedTemplate.fat
    },
    {
      title: 'Edit Quick Add',
      onDelete: selected ? async () => {
        const confirmed = window.confirm(`Delete quick add item "${selected.name}"?`);
        if (!confirmed) return;
        try {
          await api(`/api/saved-items/${selected.id}`, { method: 'DELETE' });
          setActionBanner('Quick add item deleted.', 'success');
          await loadQuickEntries({ force: true });
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      } : null,
      onSave: async (values) => {
        const payload = {
          name: values.itemName,
          quantity: values.quantity,
          unit: values.unit,
          calories: values.calories,
          protein: values.protein,
          carbs: values.carbs,
          fat: values.fat,
          components: savedItemComponents(selectedTemplate)
        };
        try {
          if (selected) {
            await api(`/api/saved-items/${selected.id}`, {
              method: 'PUT',
              body: JSON.stringify(payload)
            });
            setActionBanner('Quick add item updated.', 'success');
          } else {
            await api('/api/saved-items', {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            setActionBanner('Quick add item saved.', 'success');
          }
          await loadQuickEntries({ force: true });
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      }
    }
  );
});

entriesByDayEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const groupAction = target.dataset.action;
  const groupId = target.dataset.mealGroup;

  if (groupAction === 'edit-group' && groupId) {
    const mealEntry = (state.dashboardData?.entries || []).find(e => e.mealGroup === groupId);
    showCombineModal([], {
      name: mealEntry?.mealName || 'Meal',
      quantity: mealEntry?.mealQuantity || 1,
      unit: mealEntry?.mealUnit || 'serving',
      mealGroup: groupId,
      onCopyToToday: buildCopyMealToTodayHandler(groupId, mealEntry),
      onSave: async (name, quantity, unit) => {
        try {
          await api(`/api/meal-group/${encodeURIComponent(groupId)}/scale`, {
            method: 'PUT',
            body: JSON.stringify({ quantity, unit, name: name || undefined })
          });
          setActionBanner('Meal updated.', 'success');
          await refreshDashboard();
        } catch (error) {
          setActionBanner(error.message, 'error');
        }
      }
    });
    return;
  }

  const groupHeader = target.closest('.meal-group-header');
  if (groupHeader && !target.closest('button') && !target.closest('input')) {
    const toggleGroupId = groupHeader.dataset.mealGroup;
    if (toggleGroupId) {
      if (state.expandedMealGroups.has(toggleGroupId)) {
        state.expandedMealGroups.delete(toggleGroupId);
      } else {
        state.expandedMealGroups.add(toggleGroupId);
      }
      renderDashboard(state.dashboardData);
      return;
    }
  }

});




function renderActivePage(pageKey) {
  if (pageKey === 'sexual-activity' && !(state.features?.sexualActivity && state.sexualActivityPageVisible !== false)) {
    pageKey = 'sleep';
  }
  state.selectedPage = pageKey;
  for (const [key, section] of Object.entries(appPages)) {
    if (!section) {
      continue;
    }
    const active = key === pageKey;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  }
  for (const item of pageMenuItems) {
    item.classList.toggle('is-active', item.dataset.page === pageKey);
  }
  renderCoachForPage(pageKey);
}

function drawSimpleLineChart(canvasEl, rows, labelKey, valueKey, options = {}) {
  if (!canvasEl) {
    return;
  }
  const ctx = canvasEl.getContext('2d');
  if (!ctx) {
    return;
  }
  const baseline = options.baseline === 'range' ? 'range' : 'zero';
  const showYAxis = Boolean(options.showYAxis);
  const showXAxisLabels = options.showXAxisLabels !== false;
  const yTickCount = Math.max(2, Number(options.yTickCount || 4));
  const showTrendLine = options.showTrendLine !== false;
  const trendLineMode = options.trendLineMode === 'average' ? 'average' : 'regression';
  const averageValueEl = options.averageValueEl || null;
  const tooltipEl = options.tooltipEl || null;
  const tooltipUnit = options.tooltipUnit || '';
  const timeKey = options.timeKey || null;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(
    200,
    Math.floor(canvasEl.clientWidth || canvasEl.parentElement?.clientWidth || 0)
  );
  const height = 130;
  canvasEl.style.width = '100%';
  canvasEl.style.height = `${height}px`;
  canvasEl.width = width * dpr;
  canvasEl.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (!rows.length) {
    if (averageValueEl) {
      averageValueEl.textContent = 'none';
    }
    ctx.fillStyle = 'rgba(160, 180, 204, 0.85)';
    ctx.font = '13px sans-serif';
    ctx.fillText('No data yet', 12, 24);
    return;
  }

  const pad = {
    top: 16,
    right: 14,
    bottom: showXAxisLabels ? 24 : 10,
    left: showYAxis ? 48 : 30
  };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Time-based x positioning
  let tMin = 0, tSpan = 1;
  if (timeKey && rows.length >= 2) {
    const times = rows.map(r => Number(r[timeKey] || 0));
    tMin = Math.min(...times);
    const tMax = Math.max(...times);
    tSpan = Math.max(tMax - tMin, 1);
  }
  function xForIndex(index) {
    if (timeKey && rows.length >= 2) {
      const t = Number(rows[index][timeKey] || 0);
      return pad.left + ((t - tMin) / tSpan) * plotW;
    }
    return pad.left + (index / Math.max(rows.length - 1, 1)) * plotW;
  }

  const values = rows.map((row) => Number(row[valueKey] || 0));
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values);
  // Extract target early so the Y axis always encompasses it
  const targetKey = options.targetKey || null;
  const rowTargetValues = targetKey
    ? rows.map((row) => Number(row[targetKey] || 0)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const targetValue = Number.isFinite(options.targetValue) && options.targetValue > 0
    ? options.targetValue : null;
  let yMin = baseline === 'range' ? minValue : 0;
  let yMax = baseline === 'range' ? maxValue : maxValue;
  const yTargetValues = rowTargetValues.length ? rowTargetValues : (targetValue !== null ? [targetValue] : []);
  if (yTargetValues.length) {
    yMin = Math.min(yMin, ...yTargetValues);
    yMax = Math.max(yMax, ...yTargetValues);
  }
  const hasFlatRange = baseline === 'range' && Math.abs(yMax - yMin) < 0.0001;
  const ySpan = hasFlatRange ? 1 : Math.max(yMax - yMin, 1);

  if (showYAxis) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillStyle = 'rgba(160, 180, 204, 0.85)';
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= yTickCount; i += 1) {
      const ratio = i / yTickCount;
      const tickValue = yMax - ratio * ySpan;
      const y = pad.top + ratio * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(fmtNumber(tickValue), pad.left - 6, y);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();
  }

  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgba(0, 207, 255, 0.75)';
  ctx.strokeStyle = '#00cfff';
  ctx.lineWidth = 2;
  const coords = [];
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = xForIndex(index);
    const value = Number(row[valueKey] || 0);
    const y = hasFlatRange
      ? pad.top + plotH / 2
      : pad.top + plotH - ((value - yMin) / ySpan) * plotH;
    coords.push({ x, y, label: row[labelKey], value });
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const maxDotsForSize = 60;
  const dotRadius = coords.length > maxDotsForSize ? 1.5 : 2.4;
  ctx.fillStyle = '#00cfff';
  for (const p of coords) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Optional amber target line/path (always in range because yMin/yMax were extended above)
  if (rowTargetValues.length >= 2 && rows.length >= 2) {
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(255, 202, 40, 0.8)';
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    let startedTargetLine = false;
    for (let i = 0; i < rows.length; i += 1) {
      const pointTarget = Number(rows[i][targetKey] || 0);
      if (!Number.isFinite(pointTarget) || pointTarget <= 0) {
        startedTargetLine = false;
        continue;
      }
      const targetY = hasFlatRange
        ? pad.top + plotH / 2
        : pad.top + plotH - ((pointTarget - yMin) / ySpan) * plotH;
      if (!startedTargetLine) {
        ctx.moveTo(xForIndex(i), targetY);
        startedTargetLine = true;
      } else {
        ctx.lineTo(xForIndex(i), targetY);
      }
    }
    ctx.strokeStyle = 'rgba(255, 202, 40, 0.95)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else {
    const flatTargetValue = rowTargetValues.length ? rowTargetValues[rowTargetValues.length - 1] : targetValue;
    if (flatTargetValue !== null && Number.isFinite(flatTargetValue) && flatTargetValue > 0) {
      const targetY = hasFlatRange
        ? pad.top + plotH / 2
        : pad.top + plotH - ((flatTargetValue - yMin) / ySpan) * plotH;
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(255, 202, 40, 0.8)';
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(pad.left, targetY);
      ctx.lineTo(pad.left + plotW, targetY);
      ctx.strokeStyle = 'rgba(255, 202, 40, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  if (showTrendLine && rows.length >= 2) {
    if (trendLineMode === 'average') {
      const average = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0) / rows.length;
      const avgY = hasFlatRange
        ? pad.top + plotH / 2
        : pad.top + plotH - ((average - yMin) / ySpan) * plotH;

      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(5, 255, 161, 0.8)';
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(pad.left, avgY);
      ctx.lineTo(pad.left + plotW, avgY);
      ctx.strokeStyle = 'rgba(5, 255, 161, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
      if (averageValueEl) {
        averageValueEl.textContent = fmtNumber(average);
      } else {
        ctx.fillStyle = 'rgba(5, 255, 161, 0.95)';
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Avg ${fmtNumber(average)}`, width - pad.right, Math.max(12, avgY - 3));
      }
      ctx.restore();
    } else {

    const n = rows.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    for (let i = 0; i < n; i += 1) {
      const x = i;
      const y = Number(rows[i][valueKey] || 0);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const denominator = n * sumX2 - sumX * sumX;
    if (Math.abs(denominator) > 0.000001) {
      const slope = (n * sumXY - sumX * sumY) / denominator;
      const intercept = (sumY - slope * sumX) / n;
      const startValue = intercept;
      const endValue = slope * (n - 1) + intercept;
      const startY = hasFlatRange
        ? pad.top + plotH / 2
        : pad.top + plotH - ((startValue - yMin) / ySpan) * plotH;
      const endY = hasFlatRange
        ? pad.top + plotH / 2
        : pad.top + plotH - ((endValue - yMin) / ySpan) * plotH;

      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(255, 202, 40, 0.8)';
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(pad.left, startY);
      ctx.lineTo(pad.left + plotW, endY);
      ctx.strokeStyle = 'rgba(255, 202, 40, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    }
  }

  if (averageValueEl && !(showTrendLine && rows.length >= 2 && trendLineMode === 'average')) {
    averageValueEl.textContent = 'none';
  }

  if (showXAxisLabels) {
    ctx.fillStyle = 'rgba(160, 180, 204, 0.85)';
    ctx.font = '11px sans-serif';
    const xLabelCount = options.xLabelCount || 2;
    if (xLabelCount <= 2 || rows.length <= 2) {
      ctx.fillText(String(rows[0][labelKey] || ''), pad.left, height - 6);
      ctx.textAlign = 'right';
      ctx.fillText(String(rows[rows.length - 1][labelKey] || ''), width - pad.right, height - 6);
      ctx.textAlign = 'left';
    } else if (timeKey && rows.length >= 2) {
      // Place labels at evenly-spaced time intervals
      const count = Math.min(xLabelCount, rows.length);
      for (let i = 0; i < count; i++) {
        const tTarget = tMin + (i / (count - 1)) * tSpan;
        // Find the row closest to this time
        let bestIdx = 0, bestDist = Infinity;
        for (let j = 0; j < rows.length; j++) {
          const d = Math.abs(Number(rows[j][timeKey]) - tTarget);
          if (d < bestDist) { bestDist = d; bestIdx = j; }
        }
        const x = xForIndex(bestIdx);
        if (i === 0) ctx.textAlign = 'left';
        else if (i === count - 1) ctx.textAlign = 'right';
        else ctx.textAlign = 'center';
        ctx.fillText(String(rows[bestIdx][labelKey] || ''), x, height - 6);
      }
      ctx.textAlign = 'left';
    } else {
      const count = Math.min(xLabelCount, rows.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.round(i * (rows.length - 1) / (count - 1));
        const x = xForIndex(idx);
        if (i === 0) ctx.textAlign = 'left';
        else if (i === count - 1) ctx.textAlign = 'right';
        else ctx.textAlign = 'center';
        ctx.fillText(String(rows[idx][labelKey] || ''), x, height - 6);
      }
      ctx.textAlign = 'left';
    }
  }

  if (tooltipEl && coords.length) {
    bindSimpleChartTooltip(canvasEl, tooltipEl, coords, tooltipUnit);
  }
}

function bindSimpleChartTooltip(canvasEl, tooltipEl, coords, unit) {
  const key = '_simpleChartTooltipBound';
  // Store coords for reuse; always update on redraw
  canvasEl._tooltipCoords = coords;
  canvasEl._tooltipUnit = unit;
  canvasEl._tooltipEl = tooltipEl;

  if (canvasEl[key]) {
    return;
  }

  function showTooltip(clientX, clientY, persist) {
    const pts = canvasEl._tooltipCoords;
    const tip = canvasEl._tooltipEl;
    const u = canvasEl._tooltipUnit || '';
    if (!pts || !pts.length || !tip) return;

    const rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    let nearest = null;
    let minDist = Number.POSITIVE_INFINITY;
    for (const point of pts) {
      const dx = point.x - x;
      const dy = point.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        nearest = point;
      }
    }

    const threshold = persist ? 42 : 40;
    if (!nearest || minDist > threshold) {
      tip.hidden = true;
      return;
    }

    const suffix = u ? ` ${u}` : '';
    tip.textContent = `${nearest.label}: ${fmtNumber(nearest.value)}${suffix}`;
    tip.hidden = false;

    const wrap = canvasEl.parentElement;
    if (!wrap) return;

    const wrapRect = wrap.getBoundingClientRect();
    const canvasOffsetX = rect.left - wrapRect.left;
    const canvasOffsetY = rect.top - wrapRect.top;
    const cssX = nearest.x / scaleX;
    const cssY = nearest.y / scaleY;

    const tipW = tip.offsetWidth || 0;
    const tipH = tip.offsetHeight || 0;
    const minLeft = tipW / 2 + 8;
    const maxLeft = wrap.clientWidth - tipW / 2 - 8;

    const left = Math.min(Math.max(canvasOffsetX + cssX, minLeft), maxLeft);
    const top = Math.max(canvasOffsetY + cssY, tipH + 10);

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  canvasEl.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, false));
  canvasEl.addEventListener('mouseleave', () => { canvasEl._tooltipEl.hidden = true; });
  canvasEl.addEventListener('click', (e) => showTooltip(e.clientX, e.clientY, true));
  canvasEl.addEventListener('touchstart', (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    showTooltip(touch.clientX, touch.clientY, true);
    e.preventDefault();
  }, { passive: false });

  canvasEl[key] = true;
}

function renderWeightChart() {
  drawSimpleLineChart(weightCanvasEl, state.weightChartRows, 'label', 'value', {
    baseline: 'range',
    showYAxis: true,
    showXAxisLabels: true,
    xLabelCount: 4,
    timeKey: 'time',
    yTickCount: 4,
    showTrendLine: true,
    trendLineMode: 'average',
    averageValueEl: weightAverageValueEl,
    targetKey: 'targetValue',
    targetValue: state.weightTarget,
    tooltipEl: weightTooltipEl,
    tooltipUnit: 'lbs'
  });
  if (weightTargetDisplayEl) {
    if (state.weightTarget != null) {
      const dateStr = state.weightTargetData?.targetDate;
      const parsed = dateStr ? new Date(dateStr) : null;
      const datePart = parsed && !isNaN(parsed) ? ` (${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : '';
      weightTargetDisplayEl.textContent = `${fmtNumber(state.weightTarget)}${datePart}`;
    } else {
      weightTargetDisplayEl.textContent = '—';
    }
  }
}

function renderWorkoutStats(entries) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  cutoff.setHours(0, 0, 0, 0);
  const recent = (entries || []).filter((e) => {
    const rawDate = e.day ? `${e.day}T00:00:00` : e.loggedAt;
    return new Date(rawDate) >= cutoff;
  });
  const weeks = 30 / 7;
  const avgWorkouts = recent.length / weeks;
  const avgCal = recent.reduce((sum, e) => sum + Number(e.caloriesBurned ?? e.calories ?? 0), 0) / weeks;
  if (avgWorkoutsPerWeekEl) {
    avgWorkoutsPerWeekEl.textContent = recent.length ? avgWorkouts.toFixed(1) : '—';
  }
  if (avgCalBurnedPerWeekEl) {
    avgCalBurnedPerWeekEl.textContent = recent.length ? Math.round(avgCal).toLocaleString() : '—';
  }
  const targets = state.dashboardData?.targets || {};
  const wktTarget = Number(targets.workouts || 0);
  const calTarget = Number(targets.workout_calories || 0);
  if (workoutStatTargetEl) {
    workoutStatTargetEl.textContent = wktTarget > 0 ? `Target: ${wktTarget}/wk` : '—';
  }
  if (workoutCalStatTargetEl) {
    workoutCalStatTargetEl.textContent = calTarget > 0 ? `Target: ${fmtNumber(calTarget)}/wk` : '—';
  }
  if (workoutStatsNoteEl) {
    workoutStatsNoteEl.textContent = recent.length
      ? `Based on ${recent.length} workout${recent.length === 1 ? '' : 's'} in the last 30 days.`
      : '';
  }
}

function drawWorkoutOccurrenceChart(entries, period) {
  if (!workoutCanvasEl) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(200, Math.floor(workoutCanvasEl.clientWidth || workoutCanvasEl.parentElement?.clientWidth || 0));
  const cssHeight = 64;
  workoutCanvasEl.style.width = '100%';
  workoutCanvasEl.style.height = `${cssHeight}px`;
  workoutCanvasEl.width = cssWidth * dpr;
  workoutCanvasEl.height = cssHeight * dpr;

  const ctx = workoutCanvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const today = getLocalIsoDay();

  const workoutDays = new Set();
  for (const entry of entries || []) {
    if (entry.day) {
      workoutDays.add(entry.day);
    } else {
      workoutDays.add(getLocalIsoDay(entry.loggedAt));
    }
  }

  const points = [];
  if (period === 'annual') {
    for (let w = 51; w >= 0; w -= 1) {
      const weekEndDay = shiftIsoDay(today, -w * 7);
      const weekStartDay = shiftIsoDay(weekEndDay, -6);
      let count = 0;
      for (let d = 0; d <= 6; d += 1) {
        if (workoutDays.has(shiftIsoDay(weekStartDay, d))) {
          count += 1;
        }
      }
      points.push({ day: weekStartDay, active: count > 0, count });
    }
  } else {
    const numDays = period === 'monthly' ? 30 : 7;
    for (let i = numDays - 1; i >= 0; i -= 1) {
      const day = shiftIsoDay(today, -i);
      points.push({ day, active: workoutDays.has(day), isToday: day === today });
    }
  }

  const activeCount = points.filter((p) => p.active).length;
  if (workoutOccurrenceStatEl) {
    const total = points.length;
    const unit = period === 'annual' ? 'weeks active' : period === 'monthly' ? 'days active' : 'days active';
    workoutOccurrenceStatEl.textContent = `${activeCount} / ${total} ${unit}`;
  }

  const padX = 10;
  const labelH = 14;
  const plotH = cssHeight - labelH;
  const dotY = plotH / 2;
  const plotW = cssWidth - padX * 2;
  const maxDotR = period === 'weekly' ? 10 : period === 'monthly' ? 5 : 4;
  const spacingRaw = points.length > 1 ? plotW / (points.length - 1) : plotW;
  const dotR = Math.min(maxDotR, spacingRaw / 2 - 1);

  const activeColor = 'rgba(5, 255, 161, 0.95)';
  const inactiveStroke = 'rgba(255, 255, 255, 0.13)';
  const todayStroke = 'rgba(0, 207, 255, 0.45)';

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const x = padX + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);

    if (p.active) {
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(5, 255, 161, 0.65)';
      ctx.beginPath();
      ctx.arc(x, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = activeColor;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(x, dotY, dotR, 0, Math.PI * 2);
      ctx.strokeStyle = p.isToday ? todayStroke : inactiveStroke;
      ctx.lineWidth = p.isToday ? 1.5 : 1;
      ctx.stroke();
    }
  }

  ctx.fillStyle = 'rgba(160, 180, 204, 0.6)';
  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'bottom';
  const labelY = cssHeight - 1;
  const DAY_ABBREVS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  if (period === 'weekly') {
    for (let i = 0; i < points.length; i += 1) {
      const x = padX + (i / (points.length - 1)) * plotW;
      const d = fromIsoDayLocal(points[i].day);
      ctx.textAlign = 'center';
      ctx.fillText(DAY_ABBREVS[d.getDay()], x, labelY);
    }
  } else if (period === 'monthly') {
    ctx.textAlign = 'left';
    ctx.fillText(fromIsoDayLocal(points[0].day).toLocaleDateString([], { month: 'short', day: 'numeric' }), padX, labelY);
    ctx.textAlign = 'right';
    ctx.fillText(fromIsoDayLocal(points[points.length - 1].day).toLocaleDateString([], { month: 'short', day: 'numeric' }), cssWidth - padX, labelY);
  } else {
    let lastMonth = -1;
    for (let i = 0; i < points.length; i += 1) {
      const d = fromIsoDayLocal(points[i].day);
      const month = d.getMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        const x = padX + (i / (points.length - 1)) * plotW;
        ctx.textAlign = i === 0 ? 'left' : i >= points.length - 2 ? 'right' : 'center';
        ctx.fillText(d.toLocaleDateString([], { month: 'short' }), x, labelY);
      }
    }
  }

  workoutCanvasEl.setAttribute('aria-label', `${period === 'annual' ? '52-week' : period === 'monthly' ? '30-day' : '7-day'} workout occurrence chart`);
}

function renderWorkoutCalChart() {
  const rows = state.workoutCalChartRows || [];
  const calTarget = Number(state.dashboardData?.targets?.workout_calories || 0);
  drawSimpleLineChart(workoutCalCanvasEl, rows, 'label', 'value', {
    baseline: 'zero',
    showYAxis: true,
    showXAxisLabels: false,
    yTickCount: 4,
    showTrendLine: true,
    trendLineMode: 'average',
    averageValueEl: workoutCalAverageValueEl,
    targetKey: 'targetValue',
    tooltipEl: workoutCalTooltipEl,
    tooltipUnit: 'cal'
  });
  if (workoutCalTargetDisplayEl) {
    workoutCalTargetDisplayEl.textContent = calTarget > 0
      ? `${fmtNumber(calTarget)} cal/wk`
      : '—';
  }
}

function renderWorkoutChart() {
  drawWorkoutOccurrenceChart(state.workoutOccurrenceRows || state.workoutEntries, state.workoutSnapshotPeriod || 'weekly');
  renderWorkoutCalChart();
}

function bindPageChartsResize() {
  if (pageChartsResizeBound) {
    return;
  }

  window.addEventListener('resize', () => {
    if (pageChartsResizeTimer) {
      window.clearTimeout(pageChartsResizeTimer);
    }
    pageChartsResizeTimer = window.setTimeout(() => {
      pageChartsResizeTimer = null;
      if (state.selectedPage === 'weight') {
        renderWeightChart();
      } else if (state.selectedPage === 'workout') {
        renderWorkoutChart();
      } else if (state.selectedPage === 'sleep') {
        renderSleepChart();
      } else if (state.selectedPage === 'sexual-activity') {
        drawHealthOccurrenceChart(state.healthOccurrenceRows || state.healthEntries, state.healthSnapshotPeriod || 'weekly');
      }
    }, 80);
  });

  pageChartsResizeBound = true;
}

function renderWeightCard(entry) {
  const loggedAt = new Date(entry.loggedAt);
  const dateText = loggedAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeText = loggedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const entryId = safeId(entry.id);
  return `
    <div class="entry-card" data-weight-action="edit" data-weight-id="${entryId}">
      <div class="entry-card-icon entry-card-icon--weight">⚖</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${escapeHtml(dateText)}</div>
        <div class="entry-card-sub">${escapeHtml(timeText)}</div>
      </div>
      <div class="entry-card-value">${fmtNumber(entry.weight)}<small>lbs</small></div>
    </div>
  `;
}


function renderWorkoutCard(entry) {
  const loggedAt = new Date(entry.loggedAt);
  const dateText = loggedAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const intensity = normalizeWorkoutIntensity(entry.intensity);
  const intensityIcon = intensity === 'high' ? '🔥' : intensity === 'medium' ? '⚡' : '🌿';
  const entryId = safeId(entry.id);
  return `
    <div class="entry-card" data-workout-action="edit" data-workout-id="${entryId}">
      <div class="entry-card-icon entry-card-icon--${escapeAttr(intensity)}">${intensityIcon}</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${escapeHtml(entry.description || 'Workout')}</div>
        <div class="entry-card-chips">
          <span class="entry-card-chip">${escapeHtml(dateText)}</span>
          <span class="entry-card-chip">${fmtNumber(entry.durationHours)} hr</span>
          <span class="entry-card-chip entry-card-chip--accent">${fmtNumber(entry.caloriesBurned)} cal</span>
        </div>
      </div>
    </div>
  `;
}


async function refreshWeightData(options = {}) {
  if (!weightLogListEl) {
    return;
  }
  const reset = options.reset !== false;
  const paging = reset ? resetLogPaging('weight') : getLogPaging('weight');
  if (paging.loading) {
    return;
  }
  if (reset) {
    state.weightEntries = [];
  }
  paging.loading = true;
  renderPagedLogList({
    kind: 'weight',
    listEl: weightLogListEl,
    entries: state.weightEntries,
    renderCard: renderWeightCard,
    emptyText: 'No weight entries.'
  });

  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const weightScope = periodToScope[state.weightSnapshotPeriod] || 'week';
    const tz = getTimezone();
    const [response, target, chartResponse] = await Promise.all([
      api(buildLogPageUrl('/api/weights', { scope: weightScope, tz }, paging)),
      reset ? api(`/api/weight-target?tz=${encodeURIComponent(tz)}`) : Promise.resolve(state.weightTargetData || {}),
      reset ? api(`/api/weights?scope=${encodeURIComponent(weightScope)}&tz=${encodeURIComponent(tz)}`) : Promise.resolve({ entries: state.weightChartEntries || [] })
    ]);
    const entries = Array.isArray(response.entries) ? response.entries : [];
    state.weightEntries = reset ? entries : appendUniqueById(state.weightEntries, entries);
    paging.offset += entries.length;
    paging.hasMore = entries.length === LOG_PAGE_SIZE;

    if (reset) {
      state.weightTargetData = target;
      const tw = Number(target?.targetWeight);
      state.weightTarget = Number.isFinite(tw) && tw > 0 ? tw : null;

      const chartEntries = Array.isArray(chartResponse.entries) ? chartResponse.entries : [];
      state.weightChartEntries = chartEntries;
      state.weightChartRows = chartEntries.slice().reverse().map((entry) => ({
        label: new Date(entry.loggedAt).toLocaleDateString(),
        value: Number(entry.weight || 0),
        targetValue: Number(entry.targetWeight || 0),
        time: new Date(entry.loggedAt).getTime()
      }));
      renderWeightChart();
    }
  } catch (error) {
    setActionBanner(error.message, 'error');
  } finally {
    paging.loading = false;
    renderPagedLogList({
      kind: 'weight',
      listEl: weightLogListEl,
      entries: state.weightEntries,
      renderCard: renderWeightCard,
      emptyText: 'No weight entries.'
    });
    renderCoachForPage('weight');
  }
}


function showWeightTargetModal() {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const currentWeight = state.weightTargetData?.targetWeight || '';
  const rawDate = state.weightTargetData?.targetDate;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  const currentDate = parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString().slice(0, 10) : getLocalIsoDay();

  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Weight Target</h3>
      <label for="wt-modal-weight">Target Weight</label>
      <input id="wt-modal-weight" type="number" step="0.1" min="0" value="${escapeAttr(currentWeight)}" placeholder="Target" />
      <label for="wt-modal-date">Target Date</label>
      <input id="wt-modal-date" type="date" value="${escapeAttr(currentDate)}" />
      <div class="combine-modal-actions">
        <button type="button" class="btn-muted table-action-btn" id="wt-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="wt-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('wt-modal-weight').focus();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('wt-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  document.getElementById('wt-modal-save-btn').addEventListener('click', async () => {
    const targetWeight = parseWeightInputValue(document.getElementById('wt-modal-weight').value);
    const targetDate = String(document.getElementById('wt-modal-date').value || '').trim();
    if (!Number.isFinite(targetWeight) || targetWeight <= 0) {
      setActionBanner('Target weight must be greater than 0.', 'error');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setActionBanner('Target date must be in YYYY-MM-DD format.', 'error');
      return;
    }
    overlay.remove();
    try {
      const response = await api('/api/weight-target', {
        method: 'PUT',
        body: JSON.stringify({ targetWeight, targetDate, effectiveDate: getLocalIsoDay(), tz: getTimezone() })
      });
      state.weightTargetData = response;
      setActionBanner('Weight target updated.', 'success');
      await refreshWeightData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('wt-modal-save-btn').click(); }
    if (e.key === 'Escape') overlay.remove();
  });
}

async function deleteWeightEntryApi(entryId) {
  try {
    await api(`/api/weights/${entryId}/delete`, { method: 'POST' });
  } catch (error) {
    const firstNotFound = String(error?.message || '').includes('Request failed (404)');
    if (!firstNotFound) {
      throw error;
    }
    try {
      await api(`/api/weights/${entryId}`, { method: 'DELETE' });
    } catch (deleteError) {
      const secondNotFound = String(deleteError?.message || '').includes('Request failed (404)');
      if (!secondNotFound) {
        throw deleteError;
      }
      await api('/api/weights/delete', {
        method: 'POST',
        body: JSON.stringify({ id: entryId })
      });
    }
  }
}

async function updateWorkoutEntryApi(entryId, payload) {
  try {
    await api(`/api/workouts/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (!String(error?.message || '').includes('Request failed (404)')) {
      throw error;
    }
    await api(`/api/workouts/${entryId}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
}

function estimateWorkoutCalories(text, hours) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('run') || lower.includes('cycling') || lower.includes('bike')) {
    return Math.round(hours * 650);
  }
  if (lower.includes('lift') || lower.includes('strength')) {
    return Math.round(hours * 420);
  }
  return Math.round(hours * 500);
}

function normalizeWorkoutDescription(text) {
  const cleaned = String(text || '')
    .replace(/\bwork\s*out\b/gi, 'workout')
    .replace(/\b(?:high|low|medium|moderate|intense|intensity|vigorous|light|easy|recovery|hiit)\b/gi, ' ')
    .replace(/\b(?:workout|training|session)\b/gi, ' ')
    .replace(/\bof\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function normalizeWorkoutIntensity(intensity, fallback = 'medium') {
  const normalized = String(intensity || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return fallback;
}

function parseWorkoutIntensity(text) {
  const lower = String(text || '').toLowerCase();
  if (/\b(high|vigorous|intense|hiit)\b/.test(lower)) {
    return 'high';
  }
  if (/\b(low|light|easy|recovery)\b/.test(lower)) {
    return 'low';
  }
  if (/\b(medium|moderate)\b/.test(lower)) {
    return 'medium';
  }
  return 'medium';
}

function parseWorkoutInput(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { description: '', intensity: 'medium', durationHours: 1 };
  }

  let durationHours = 0;
  let description = raw;

  // Pattern: "1.5 Leg work out"
  const leadingHoursWithUnit = raw.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hour)s?\b\s+(.+)$/i);
  if (leadingHoursWithUnit) {
    const parsedHours = Number(leadingHoursWithUnit[1]);
    if (Number.isFinite(parsedHours) && parsedHours > 0) {
      durationHours = parsedHours;
      description = leadingHoursWithUnit[2];
    }
  }

  // Pattern: "45 minute chest workout"
  const leadingMinutesWithUnit = raw.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute)s?\b\s+(.+)$/i);
  if (leadingMinutesWithUnit) {
    const parsedMinutes = Number(leadingMinutesWithUnit[1]);
    if (!durationHours && Number.isFinite(parsedMinutes) && parsedMinutes > 0) {
      durationHours = parsedMinutes / 60;
      description = leadingMinutesWithUnit[2];
    }
  }

  const leadingHours = raw.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (leadingHours) {
    const parsedHours = Number(leadingHours[1]);
    if (!durationHours && Number.isFinite(parsedHours) && parsedHours > 0 && parsedHours <= 12) {
      durationHours = parsedHours;
      description = leadingHours[2];
    }
  }

  // Pattern: "Leg workout 1.5h"
  if (!durationHours) {
    const inlineHours = raw.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)s?\b/i);
    if (inlineHours) {
      const parsedHours = Number(inlineHours[1]);
      if (Number.isFinite(parsedHours) && parsedHours > 0) {
        durationHours = parsedHours;
        description = raw.replace(inlineHours[0], ' ');
      }
    }
  }

  if (!durationHours) {
    const inlineMinutes = raw.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute)s?\b/i);
    if (inlineMinutes) {
      const parsedMinutes = Number(inlineMinutes[1]);
      if (Number.isFinite(parsedMinutes) && parsedMinutes > 0) {
        durationHours = parsedMinutes / 60;
        description = raw.replace(inlineMinutes[0], ' ');
      }
    }
  }

  if (!durationHours) {
    durationHours = 1;
  }

  const normalizedDescription = normalizeWorkoutDescription(description || raw);
  return {
    description: normalizedDescription || normalizeWorkoutDescription(raw) || 'General',
    intensity: parseWorkoutIntensity(raw),
    durationHours
  };
}

// ── Sleep Tracking ──

const SLEEP_QUALITY_LABELS = {
  1: 'Poor',
  2: 'Fair',
  3: 'Okay',
  4: 'Good',
  5: 'Great'
};

function normalizeSleepQuality(value) {
  if (value == null || value === '') return null;
  const quality = Number(value);
  if (!Number.isInteger(quality) || quality < 1 || quality > 5) return null;
  return quality;
}

function sleepQualityLabel(value) {
  const quality = normalizeSleepQuality(value);
  return quality ? SLEEP_QUALITY_LABELS[quality] : 'Not rated';
}

function sleepQualityOptions(selectedValue) {
  const selectedQuality = normalizeSleepQuality(selectedValue);
  return Object.entries(SLEEP_QUALITY_LABELS)
    .map(([value, label]) => {
      const selected = Number(value) === selectedQuality ? ' selected' : '';
      return `<option value="${escapeAttr(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function normalizeSleepNotes(value) {
  const notes = String(value ?? '').trim();
  return notes ? notes : null;
}

function renderSleepCard(entry) {
  const loggedAt = new Date(entry.loggedAt);
  const dateText = loggedAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const hours = Number(entry.durationHours || 0);
  const wakeUps = Number(entry.wakeUps || 0);
  const quality = normalizeSleepQuality(entry.quality);
  const notes = normalizeSleepNotes(entry.notes);
  const hoursLabel = hours === 1 ? '1 hour' : `${fmtNumber(hours)} hours`;
  const wakeUpsLabel = wakeUps > 0 ? ` · ${wakeUps} wake-up${wakeUps === 1 ? '' : 's'}` : '';
  const qualityLabel = quality ? ` · ${sleepQualityLabel(quality)} sleep` : '';
  const entryId = safeId(entry.id);
  return `
    <div class="entry-card" data-sleep-action="edit" data-sleep-id="${entryId}">
      <div class="entry-card-icon entry-card-icon--health" style="background:#7c4dff22;color:#7c4dff">●</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${escapeHtml(hoursLabel + wakeUpsLabel + qualityLabel)}</div>
        <div class="entry-card-sub">${escapeHtml(dateText)}</div>
        ${notes ? `<div class="entry-card-sub entry-card-notes">${escapeHtml(notes)}</div>` : ''}
      </div>
    </div>
  `;
}

function showSleepEditModal(entry) {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const loggedAtValue = isoToLocalInputValue(entry.loggedAt);
  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Sleep Entry</h3>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="sleep-modal-date">Date/Time</label>
          <input id="sleep-modal-date" type="datetime-local" value="${escapeAttr(loggedAtValue)}" />
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="sleep-modal-hours">Hours</label>
          <input id="sleep-modal-hours" type="number" step="0.25" min="0" max="24" value="${escapeAttr(entry.durationHours)}" />
        </div>
        <div class="entry-modal-field">
          <label for="sleep-modal-wake-ups">Wake-ups</label>
          <input id="sleep-modal-wake-ups" type="number" step="1" min="0" max="99" value="${escapeAttr(entry.wakeUps || 0)}" />
        </div>
        <div class="entry-modal-field">
          <label for="sleep-modal-quality">Quality</label>
          <select id="sleep-modal-quality">
            <option value="">Not rated</option>
            ${sleepQualityOptions(entry.quality)}
          </select>
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="sleep-modal-notes">Notes</label>
          <textarea id="sleep-modal-notes" rows="3" maxlength="1000" placeholder="Notes (optional)">${escapeHtml(entry.notes || '')}</textarea>
        </div>
      </div>
      <div class="combine-modal-actions">
        <button id="sleep-modal-cancel-btn" class="btn-secondary">Cancel</button>
        <button id="sleep-modal-delete-btn" class="btn-danger">Delete</button>
        <button id="sleep-modal-save-btn" class="btn-success">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.getElementById('sleep-modal-cancel-btn').addEventListener('click', () => overlay.remove());
  document.getElementById('sleep-modal-save-btn').addEventListener('click', async () => {
    try {
      const loggedAt = asIso(document.getElementById('sleep-modal-date').value);
      const durationHours = Number(document.getElementById('sleep-modal-hours').value);
      const wakeUps = Number(document.getElementById('sleep-modal-wake-ups').value) || 0;
      const quality = normalizeSleepQuality(document.getElementById('sleep-modal-quality').value);
      const notes = normalizeSleepNotes(document.getElementById('sleep-modal-notes').value);
      await api(`/api/sleep/${entry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ durationHours, wakeUps, quality, notes, loggedAt })
      });
      overlay.remove();
      setActionBanner('Sleep entry updated.', 'success');
      await refreshSleepData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
  document.getElementById('sleep-modal-delete-btn').addEventListener('click', async () => {
    if (!window.confirm('Delete this sleep entry?')) return;
    try {
      await api(`/api/sleep/${entry.id}`, { method: 'DELETE' });
      overlay.remove();
      setActionBanner('Sleep entry deleted.', 'success');
      await refreshSleepData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
}

async function refreshSleepData(options = {}) {
  if (!sleepLogListEl) return;
  const reset = options.reset !== false;
  const paging = reset ? resetLogPaging('sleep') : getLogPaging('sleep');
  if (paging.loading) {
    return;
  }
  if (reset) {
    state.sleepEntries = [];
  }
  paging.loading = true;
  renderPagedLogList({
    kind: 'sleep',
    listEl: sleepLogListEl,
    entries: state.sleepEntries,
    renderCard: renderSleepCard,
    emptyText: 'No sleep entries.'
  });

  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const scope = periodToScope[state.sleepSnapshotPeriod] || 'week';
    const tz = getTimezone();
    const [data, targetData] = await Promise.all([
      api(buildLogPageUrl('/api/sleep', { scope, tz }, paging)),
      reset ? api(`/api/daily-totals?scope=week&tz=${encodeURIComponent(tz)}`) : Promise.resolve(null)
    ]);
    if (reset && targetData?.targets) {
      setSleepTargetFromTargets(targetData.targets);
      if (targetData.targetHistory) {
        setMacroTargetHistory(targetData.targetHistory);
      }
      state.dashboardData = state.dashboardData || {};
      state.dashboardData.targets = {
        ...(state.dashboardData.targets || {}),
        ...targetData.targets
      };
    }
    const entries = Array.isArray(data.entries) ? data.entries : [];
    state.sleepEntries = reset ? entries : appendUniqueById(state.sleepEntries, entries);
    paging.offset += entries.length;
    paging.hasMore = entries.length === LOG_PAGE_SIZE;

    if (reset) {
      const dailyTotals = Array.isArray(data.dailyTotals) ? data.dailyTotals : [];
      state.sleepChartRows = dailyTotals.map((d) => ({
        label: new Date(d.day + 'T00:00:00').toLocaleDateString(),
        value: Number(d.totalHours || 0),
        targetValue: Number(d.targetHours || 0),
        time: new Date(d.day + 'T00:00:00').getTime()
      }));
      renderSleepChart();
    }
  } catch (error) {
    setActionBanner(error.message, 'error');
  } finally {
    paging.loading = false;
    renderPagedLogList({
      kind: 'sleep',
      listEl: sleepLogListEl,
      entries: state.sleepEntries,
      renderCard: renderSleepCard,
      emptyText: 'No sleep entries.'
    });
    renderCoachForPage('sleep');
  }
}

function renderSleepChart() {
  renderSleepTargetLegend();
  drawSimpleLineChart(sleepCanvasEl, state.sleepChartRows || [], 'label', 'value', {
    baseline: 'zero',
    showYAxis: true,
    showXAxisLabels: true,
    yTickCount: 4,
    showTrendLine: true,
    trendLineMode: 'average',
    averageValueEl: sleepAverageValueEl,
    tooltipEl: sleepTooltipEl,
    tooltipUnit: 'hrs',
    timeKey: 'time',
    targetKey: 'targetValue',
    targetValue: getSleepTargetHours()
  });
}

// ── Health / Sexual Health ──

const EJACULATION_TYPE_COLORS = {
  'masturbation': '#ff6b9d',
  'oral sex': '#00cfff',
  'vaginal sex': '#05ffa1',
  'other': '#c48aff'
};

function renderHealthCard(entry) {
  const loggedAt = new Date(entry.loggedAt);
  const dateText = loggedAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const type = EJACULATION_TYPE_COLORS[entry.type] ? entry.type : 'other';
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const color = EJACULATION_TYPE_COLORS[type] || '#c48aff';
  const entryId = safeId(entry.id);
  return `
    <div class="entry-card" data-health-action="edit" data-health-id="${entryId}">
      <div class="entry-card-icon entry-card-icon--health" style="background:${color}22;color:${color}">●</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${escapeHtml(typeLabel)}</div>
        <div class="entry-card-sub">${escapeHtml(dateText)}</div>
      </div>
    </div>
  `;
}

function showHealthEditModal(entry) {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const loggedAtValue = isoToLocalInputValue(entry.loggedAt);
  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>Edit Entry</h3>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="health-modal-date">Date/Time</label>
          <input id="health-modal-date" type="datetime-local" value="${escapeAttr(loggedAtValue)}" />
        </div>
        <div class="entry-modal-field">
          <label for="health-modal-type">Type</label>
          <select id="health-modal-type">
            <option value="masturbation" ${entry.type === 'masturbation' ? 'selected' : ''}>Masturbation</option>
            <option value="oral sex" ${entry.type === 'oral sex' ? 'selected' : ''}>Oral Sex</option>
            <option value="vaginal sex" ${entry.type === 'vaginal sex' ? 'selected' : ''}>Vaginal Sex</option>
            <option value="other" ${entry.type === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
      </div>
      <div class="combine-modal-actions">
        <button type="button" class="btn-danger table-action-btn" id="health-modal-delete-btn">Delete</button>
        <span style="flex:1"></span>
        <button type="button" class="btn-muted table-action-btn" id="health-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-success table-action-btn" id="health-modal-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('health-modal-cancel-btn').addEventListener('click', () => overlay.remove());

  document.getElementById('health-modal-delete-btn').addEventListener('click', async () => {
    if (!window.confirm('Delete this entry?')) return;
    overlay.remove();
    try {
      await api(`/api/sexual-activity/${entry.id}`, { method: 'DELETE' });
      setActionBanner('Entry deleted.', 'success');
      await refreshHealthData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  document.getElementById('health-modal-save-btn').addEventListener('click', async () => {
    const loggedAt = asIso(document.getElementById('health-modal-date').value || toDateTimeLocalValue());
    const type = document.getElementById('health-modal-type').value;
    overlay.remove();
    try {
      await api(`/api/sexual-activity/${entry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ type, loggedAt })
      });
      setActionBanner('Entry updated.', 'success');
      await refreshHealthData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('health-modal-save-btn').click(); }
    if (e.key === 'Escape') overlay.remove();
  });
}

function drawHealthOccurrenceChart(entries, period) {
  if (!healthCanvasEl) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(200, Math.floor(healthCanvasEl.clientWidth || healthCanvasEl.parentElement?.clientWidth || 0));
  const cssHeight = 64;
  healthCanvasEl.style.width = '100%';
  healthCanvasEl.style.height = `${cssHeight}px`;
  healthCanvasEl.width = cssWidth * dpr;
  healthCanvasEl.height = cssHeight * dpr;

  const ctx = healthCanvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const today = getLocalIsoDay();

  // Build a map of day -> set of types
  const dayTypesMap = new Map();
  for (const entry of entries || []) {
    if (entry.day && Array.isArray(entry.types)) {
      dayTypesMap.set(entry.day, new Set(entry.types));
    } else {
      const day = getLocalIsoDay(entry.loggedAt);
      if (!dayTypesMap.has(day)) dayTypesMap.set(day, new Set());
      dayTypesMap.get(day).add(entry.type || 'other');
    }
  }

  const points = [];
  if (period === 'annual') {
    for (let w = 51; w >= 0; w -= 1) {
      const weekEndDay = shiftIsoDay(today, -w * 7);
      const weekStartDay = shiftIsoDay(weekEndDay, -6);
      const typesInWeek = new Set();
      for (let d = 0; d <= 6; d += 1) {
        const day = shiftIsoDay(weekStartDay, d);
        const types = dayTypesMap.get(day);
        if (types) types.forEach((t) => typesInWeek.add(t));
      }
      points.push({ day: weekStartDay, active: typesInWeek.size > 0, types: typesInWeek });
    }
  } else {
    const numDays = period === 'monthly' ? 30 : 7;
    for (let i = numDays - 1; i >= 0; i -= 1) {
      const day = shiftIsoDay(today, -i);
      const types = dayTypesMap.get(day) || new Set();
      points.push({ day, active: types.size > 0, types, isToday: day === today });
    }
  }

  const activeCount = points.filter((p) => p.active).length;
  if (healthOccurrenceStatEl) {
    const total = points.length;
    const unit = period === 'annual' ? 'weeks active' : 'days active';
    healthOccurrenceStatEl.textContent = `${activeCount} / ${total} ${unit}`;
  }

  const padX = 10;
  const labelH = 14;
  const plotH = cssHeight - labelH;
  const dotY = plotH / 2;
  const plotW = cssWidth - padX * 2;
  const maxDotR = period === 'weekly' ? 10 : period === 'monthly' ? 5 : 4;
  const spacingRaw = points.length > 1 ? plotW / (points.length - 1) : plotW;
  const dotR = Math.min(maxDotR, spacingRaw / 2 - 1);

  const inactiveStroke = 'rgba(255, 255, 255, 0.13)';
  const todayStroke = 'rgba(0, 207, 255, 0.45)';

  // Priority order for which color to show when multiple types are in the same dot.
  const typePriority = ['vaginal sex', 'oral sex', 'other', 'masturbation'];

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const x = padX + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);

    if (p.active) {
      // Pick the highest-priority type for the dot color
      let dotColor = EJACULATION_TYPE_COLORS['other'];
      for (const t of typePriority) {
        if (p.types.has(t)) {
          dotColor = EJACULATION_TYPE_COLORS[t];
          break;
        }
      }

      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = dotColor.replace(')', ', 0.65)').replace('rgb(', 'rgba(');
      ctx.beginPath();
      ctx.arc(x, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(x, dotY, dotR, 0, Math.PI * 2);
      ctx.strokeStyle = p.isToday ? todayStroke : inactiveStroke;
      ctx.lineWidth = p.isToday ? 1.5 : 1;
      ctx.stroke();
    }
  }

  // Labels
  ctx.fillStyle = 'rgba(160, 180, 204, 0.6)';
  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'bottom';
  const labelY = cssHeight - 1;
  const DAY_ABBREVS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  if (period === 'weekly') {
    for (let i = 0; i < points.length; i += 1) {
      const x = padX + (i / (points.length - 1)) * plotW;
      const d = fromIsoDayLocal(points[i].day);
      ctx.textAlign = 'center';
      ctx.fillText(DAY_ABBREVS[d.getDay()], x, labelY);
    }
  } else if (period === 'monthly') {
    ctx.textAlign = 'left';
    ctx.fillText(fromIsoDayLocal(points[0].day).toLocaleDateString([], { month: 'short', day: 'numeric' }), padX, labelY);
    ctx.textAlign = 'right';
    ctx.fillText(fromIsoDayLocal(points[points.length - 1].day).toLocaleDateString([], { month: 'short', day: 'numeric' }), cssWidth - padX, labelY);
  } else {
    let lastMonth = -1;
    for (let i = 0; i < points.length; i += 1) {
      const d = fromIsoDayLocal(points[i].day);
      const month = d.getMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        const x = padX + (i / (points.length - 1)) * plotW;
        ctx.textAlign = i === 0 ? 'left' : i >= points.length - 2 ? 'right' : 'center';
        ctx.fillText(d.toLocaleDateString([], { month: 'short' }), x, labelY);
      }
    }
  }
}

async function refreshHealthData(options = {}) {
  if (!healthLogListEl) return;
  if (!state.features?.sexualActivity) {
    syncFeatureVisibility();
    return;
  }
  const reset = options.reset !== false;
  const paging = reset ? resetLogPaging('health') : getLogPaging('health');
  if (paging.loading) {
    return;
  }
  if (reset) {
    state.healthEntries = [];
  }
  paging.loading = true;
  renderPagedLogList({
    kind: 'health',
    listEl: healthLogListEl,
    entries: state.healthEntries,
    renderCard: renderHealthCard,
    emptyText: 'No entries.'
  });

  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const scope = periodToScope[state.healthSnapshotPeriod] || 'week';
    const data = await api(buildLogPageUrl('/api/sexual-activity', { scope, tz: getTimezone() }, paging));
    const entries = Array.isArray(data.entries) ? data.entries : [];
    state.healthEntries = reset ? entries : appendUniqueById(state.healthEntries, entries);
    paging.offset += entries.length;
    paging.hasMore = entries.length === LOG_PAGE_SIZE;

    if (reset) {
      state.healthOccurrenceRows = Array.isArray(data.dailyTypes) ? data.dailyTypes : [];
      drawHealthOccurrenceChart(state.healthOccurrenceRows, state.healthSnapshotPeriod || 'weekly');
    }
  } catch (error) {
    setActionBanner(error.message, 'error');
  } finally {
    paging.loading = false;
    renderPagedLogList({
      kind: 'health',
      listEl: healthLogListEl,
      entries: state.healthEntries,
      renderCard: renderHealthCard,
      emptyText: 'No entries.'
    });
  }
}

function renderWorkoutQuickAdds(entries) {
  if (!workoutQuickListEl) {
    return;
  }
  const map = new Map();
  for (const item of entries) {
    const key = item.description.trim().toLowerCase();
    if (!key || map.has(key)) continue;
    map.set(key, item);
    if (map.size >= 6) break;
  }
  const quickItems = Array.from(map.values());
  workoutQuickListEl.innerHTML = quickItems.map((item) => {
    const payload = {
      description: item.description,
      intensity: normalizeWorkoutIntensity(item.intensity),
      durationHours: item.durationHours,
      caloriesBurned: item.caloriesBurned
    };
    return `<button type="button" class="chip-action" data-workout-quick="${escapeJsonAttr(payload)}">${escapeHtml(item.description)}</button>`;
  }).join('') || '<p class="empty-note">No quick workouts yet.</p>';
}

async function refreshWorkoutData(options = {}) {
  if (!workoutLogListEl) {
    return;
  }
  const reset = options.reset !== false;
  const paging = reset ? resetLogPaging('workout') : getLogPaging('workout');
  if (paging.loading) {
    return;
  }
  if (reset) {
    state.workoutEntries = [];
  }
  paging.loading = true;
  renderPagedLogList({
    kind: 'workout',
    listEl: workoutLogListEl,
    entries: state.workoutEntries,
    renderCard: renderWorkoutCard,
    emptyText: 'No workouts logged.'
  });

  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const workoutScope = periodToScope[state.workoutSnapshotPeriod] || 'week';
    const data = await api(buildLogPageUrl('/api/workouts', { scope: workoutScope, tz: getTimezone() }, paging));
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const dailyCalories = Array.isArray(data.dailyCalories) ? data.dailyCalories : [];
    state.workoutEntries = reset ? entries : appendUniqueById(state.workoutEntries, entries);
    paging.offset += entries.length;
    paging.hasMore = entries.length === LOG_PAGE_SIZE;

    renderWorkoutQuickAdds(state.workoutEntries);

    if (reset) {
      state.workoutOccurrenceRows = dailyCalories;
      state.workoutCalChartRows = dailyCalories.map((d) => ({
        label: new Date(d.day + 'T00:00:00').toLocaleDateString(),
        value: Number(d.calories || 0),
        targetValue: Number(d.targetCalories || 0) > 0 ? Number(d.targetCalories || 0) / 7 : 0
      }));
      renderWorkoutStats(dailyCalories);
      renderWorkoutChart();
    }
  } catch (error) {
    setActionBanner(error.message, 'error');
  } finally {
    paging.loading = false;
    renderPagedLogList({
      kind: 'workout',
      listEl: workoutLogListEl,
      entries: state.workoutEntries,
      renderCard: renderWorkoutCard,
      emptyText: 'No workouts logged.'
    });
    renderCoachForPage('workout');
  }
}

for (const item of pageMenuItems) {
  item.addEventListener('click', async () => {
    const page = item.dataset.page;
    if (!page) {
      return;
    }
    renderActivePage(page);
    if (page === 'weight') {
      await refreshWeightData();
    }
    if (page === 'workout') {
      await refreshWorkoutData();
    }
    if (page === 'sleep') {
      await refreshSleepData();
    }
    if (page === 'sexual-activity') {
      if (!(state.features?.sexualActivity && state.sexualActivityPageVisible !== false)) {
        renderActivePage('sleep');
        return;
      }
      await refreshHealthData();
    }
    if (page === 'analysis') {
      await Promise.all([refreshAnalysisData(), refreshWeeklyRecap()]);
      if (!state.analysisAutoRan && isAnalysisDueWeekly(state.analysisReport)) {
        state.analysisAutoRan = true;
        await generateAnalysis();
      }
    }
  });
}

if (analysisGenerateBtnEl) {
  analysisGenerateBtnEl.addEventListener('click', async () => {
    await generateAnalysis();
  });
}

if (saveWeightBtnEl) {
  if (weightLoggedAtEl) {
    weightLoggedAtEl.value = toDateTimeLocalValue();
  }
  saveWeightBtnEl.addEventListener('click', async () => {
    try {
      await api('/api/weights', {
        method: 'POST',
        body: JSON.stringify({
          loggedAt: asIso(weightLoggedAtEl?.value || toDateTimeLocalValue()),
          weight: parseWeightInputValue(weightValueEl?.value)
        })
      });
      if (weightValueEl) {
        weightValueEl.value = '';
      }
      setActionBanner('Weight saved.', 'success');
      await refreshWeightData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
}

if (editWeightTargetLinkEl) {
  editWeightTargetLinkEl.addEventListener('click', (e) => {
    e.preventDefault();
    showWeightTargetModal();
  });
}

if (weightLogListEl) {
  weightLogListEl.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-weight-action]');
    if (!target) return;

    event.preventDefault();
    const action = target.dataset.weightAction;
    const entryId = Number(target.dataset.weightId);
    if (!action || !entryId) return;

    if (action === 'edit') {
      const entry = (state.weightEntries || []).find(e => e.id === entryId);
      if (!entry) return;
      showWeightEditModal(entry);
    }
  });
}

// ── Sleep event wiring ──

if (saveSleepBtnEl) {
  if (sleepLoggedAtEl) {
    sleepLoggedAtEl.value = toDateTimeLocalValue();
  }
  saveSleepBtnEl.addEventListener('click', async () => {
    try {
      const durationHours = Number(sleepHoursEl?.value);
      if (!Number.isFinite(durationHours) || durationHours <= 0) {
        setActionBanner('Enter a valid number of hours.', 'error');
        return;
      }
      const wakeUps = Number(sleepWakeUpsEl?.value) || 0;
      const quality = normalizeSleepQuality(sleepQualityEl?.value);
      const notes = normalizeSleepNotes(sleepNotesEl?.value);
      await api('/api/sleep', {
        method: 'POST',
        body: JSON.stringify({
          loggedAt: asIso(sleepLoggedAtEl?.value || toDateTimeLocalValue()),
          durationHours,
          wakeUps,
          quality,
          notes
        })
      });
      if (sleepHoursEl) sleepHoursEl.value = '';
      if (sleepWakeUpsEl) sleepWakeUpsEl.value = '';
      if (sleepQualityEl) sleepQualityEl.value = '3';
      if (sleepNotesEl) sleepNotesEl.value = '';
      if (sleepLoggedAtEl) sleepLoggedAtEl.value = toDateTimeLocalValue();
      setActionBanner('Sleep logged.', 'success');
      await refreshSleepData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
}

if (sleepPeriodToggleEl) {
  for (const btn of sleepPeriodToggleEl.querySelectorAll('.period-btn')) {
    btn.addEventListener('click', async () => {
      const period = btn.dataset.period;
      if (!period || period === state.sleepSnapshotPeriod) return;
      state.sleepSnapshotPeriod = period;
      syncPeriodToggle(sleepPeriodToggleEl, period);
      if (sleepSnapshotHeadingEl) {
        sleepSnapshotHeadingEl.textContent = PERIOD_HEADING[period] || 'Snapshot';
      }
      await refreshSleepData();
    });
  }
}

if (editSleepTargetLinkEl) {
  editSleepTargetLinkEl.addEventListener('click', (event) => {
    event.preventDefault();
    showSleepTargetModal();
  });
}

if (sleepLogListEl) {
  sleepLogListEl.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-sleep-action]');
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.sleepAction;
    const entryId = Number(target.dataset.sleepId);
    if (!action || !entryId) return;
    if (action === 'edit') {
      const entry = (state.sleepEntries || []).find(e => e.id === entryId);
      if (!entry) return;
      showSleepEditModal(entry);
    }
  });
}

// ── Health / Sexual Activity event wiring ──

if (saveHealthBtnEl) {
  if (healthLoggedAtEl) {
    healthLoggedAtEl.value = toDateTimeLocalValue();
  }
  saveHealthBtnEl.addEventListener('click', async () => {
    if (!state.features?.sexualActivity) {
      setActionBanner('Sexual activity tracking is not enabled for this account.', 'error');
      return;
    }
    try {
      await api('/api/sexual-activity', {
        method: 'POST',
        body: JSON.stringify({
          loggedAt: asIso(healthLoggedAtEl?.value || toDateTimeLocalValue()),
          type: healthActivityTypeEl?.value || 'masturbation'
        })
      });
      if (healthLoggedAtEl) healthLoggedAtEl.value = toDateTimeLocalValue();
      setActionBanner('Entry saved.', 'success');
      await refreshHealthData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
}

if (healthPeriodToggleEl) {
  for (const btn of healthPeriodToggleEl.querySelectorAll('.period-btn')) {
    btn.addEventListener('click', async () => {
      const period = btn.dataset.period;
      if (!period || period === state.healthSnapshotPeriod) return;
      state.healthSnapshotPeriod = period;
      syncPeriodToggle(healthPeriodToggleEl, period);
      if (healthSnapshotHeadingEl) {
        healthSnapshotHeadingEl.textContent = PERIOD_HEADING[period] || 'Snapshot';
      }
      if (!state.features?.sexualActivity) {
        syncFeatureVisibility();
        return;
      }
      await refreshHealthData();
    });
  }
}

if (healthLogListEl) {
  healthLogListEl.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-health-action]');
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.healthAction;
    const entryId = Number(target.dataset.healthId);
    if (!action || !entryId) return;
    if (action === 'edit') {
      const entry = (state.healthEntries || []).find(e => e.id === entryId);
      if (!entry) return;
      showHealthEditModal(entry);
    }
  });
}

if (editWorkoutTargetLinkEl) {
  editWorkoutTargetLinkEl.addEventListener('click', (e) => {
    e.preventDefault();
    showWorkoutTargetModal();
  });
}

if (parseWorkoutBtnEl) {
  parseWorkoutBtnEl.addEventListener('click', async () => {
    const text = String(workoutTextEl?.value || '').trim();
    if (!text) {
      setActionBanner('Add a workout description first.', 'error');
      return;
    }

    parseWorkoutBtnEl.disabled = true;
    try {
      let parsed;
      try {
        parsed = await api('/api/parse-workout', {
          method: 'POST',
          body: JSON.stringify({ text })
        });
      } catch (_error) {
        const fallback = parseWorkoutInput(text);
        parsed = {
          description: fallback.description,
          intensity: fallback.intensity,
          durationHours: fallback.durationHours,
          caloriesBurned: estimateWorkoutCalories(fallback.description, fallback.durationHours)
        };
        setActionBanner('Used fallback workout parsing. You can edit values before saving.', 'info');
      }

      state.pendingWorkout = {
        description: String(parsed.description || '').trim(),
        intensity: normalizeWorkoutIntensity(parsed.intensity),
        durationHours: Number(parsed.durationHours || 1),
        caloriesBurned: Number(parsed.caloriesBurned || 0)
      };

      if (workoutDescriptionEl) workoutDescriptionEl.value = state.pendingWorkout.description;
      if (workoutHoursEl) workoutHoursEl.value = String(state.pendingWorkout.durationHours);
      if (workoutCaloriesEl) workoutCaloriesEl.value = String(state.pendingWorkout.caloriesBurned);
      if (workoutIntensityEl) workoutIntensityEl.value = state.pendingWorkout.intensity;
      if (workoutEditorEl) workoutEditorEl.hidden = false;
      if (saveWorkoutBtnEl) saveWorkoutBtnEl.disabled = false;
    } finally {
      parseWorkoutBtnEl.disabled = false;
    }
  });
}

if (syncWorkoutsBtnEl) {
  syncWorkoutsBtnEl.addEventListener('click', async () => {
    syncWorkoutsBtnEl.disabled = true;
    const originalText = syncWorkoutsBtnEl.textContent;
    syncWorkoutsBtnEl.textContent = 'Syncing...';

    try {
      const response = await fetch('/api/sync-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();

      if (response.ok) {
        setActionBanner(data.message || 'Sync complete!');
        if (data.syncedCount > 0) {
          // Refresh data if something was synced
          await refreshDashboard();
          await refreshWorkoutData();
        }
      } else {
        setActionBanner(data.error || 'Failed to sync workouts.', 'error');
      }
    } catch (error) {
      console.error('Sync error:', error);
      setActionBanner('An error occurred during sync.', 'error');
    } finally {
      syncWorkoutsBtnEl.disabled = false;
      syncWorkoutsBtnEl.textContent = originalText;
    }
  });
}

if (saveWorkoutBtnEl) {
  saveWorkoutBtnEl.disabled = true;
  if (workoutEditorEl) {
    workoutEditorEl.hidden = true;
  }
  if (workoutLoggedAtEl) {
    workoutLoggedAtEl.value = toDateTimeLocalValue();
  }

  saveWorkoutBtnEl.addEventListener('click', async () => {
    try {
      await api('/api/workouts', {
        method: 'POST',
        body: JSON.stringify({
          description: String(workoutDescriptionEl?.value || '').trim(),
          intensity: normalizeWorkoutIntensity(workoutIntensityEl?.value),
          durationHours: Number(workoutHoursEl?.value || 1),
          caloriesBurned: Number(workoutCaloriesEl?.value || 0),
          loggedAt: asIso(workoutLoggedAtEl?.value || toDateTimeLocalValue())
        })
      });
      if (workoutTextEl) workoutTextEl.value = '';
      if (workoutEditorEl) workoutEditorEl.hidden = true;
      saveWorkoutBtnEl.disabled = true;
      state.pendingWorkout = null;
      setActionBanner('Workout logged.', 'success');
      await refreshWorkoutData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
}

if (workoutLogListEl) {
  workoutLogListEl.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-workout-action]');
    if (!target) return;

    event.preventDefault();
    const action = target.dataset.workoutAction;
    const entryId = Number(target.dataset.workoutId);
    if (!action || !entryId) return;

    if (action === 'edit') {
      const entry = (state.workoutEntries || []).find(e => e.id === entryId);
      if (!entry) return;
      showWorkoutEditModal(entry);
    }
  });
}

if (workoutQuickListEl) {
  workoutQuickListEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const payload = target.dataset.workoutQuick;
    if (!payload) {
      return;
    }
    try {
      const parsed = JSON.parse(payload.replace(/&apos;/g, "'"));
      if (workoutDescriptionEl) workoutDescriptionEl.value = parsed.description || '';
      if (workoutIntensityEl) workoutIntensityEl.value = normalizeWorkoutIntensity(parsed.intensity);
      if (workoutHoursEl) workoutHoursEl.value = String(parsed.durationHours || 1);
      if (workoutCaloriesEl) workoutCaloriesEl.value = String(parsed.caloriesBurned || 0);
      if (workoutEditorEl) workoutEditorEl.hidden = false;
    } catch (_error) {
      setActionBanner('Could not load quick workout.', 'error');
    }
  });
}

renderActivePage('macros');
bindPageChartsResize();
bindCoachSlots();

refreshAppVersion();

loadQuickEntries({ force: true });

(async function initApp() {
  try {
    await refreshProfile();
  } catch (error) {
    console.error('Failed to refresh profile:', error);
  }

  try {
    await refreshDashboard();
  } catch (error) {
    setActionBanner(error.message, 'error');
  }
})();

if (profileChipEl) {
  profileChipEl.addEventListener('click', (event) => {
    event.stopPropagation();
    setProfileMenuOpen(profilePopoverEl.hidden);
  });
}

document.addEventListener('click', (event) => {
  if (profileMenuEl && !profilePopoverEl.hidden && !profileMenuEl.contains(event.target)) {
    setProfileMenuOpen(false);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setProfileMenuOpen(false);
  }
});

if (logoutBtnEl) {
  logoutBtnEl.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      await api('/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
}

if (accountInfoBtnEl) {
  accountInfoBtnEl.addEventListener('click', (event) => {
    event.stopPropagation();
    setProfileMenuOpen(false);
    showAccountPrivacyModal();
  });
}

if (adminPageBtnEl) {
  adminPageBtnEl.addEventListener('click', (event) => {
    event.stopPropagation();
    window.location.href = '/admin';
  });
}
