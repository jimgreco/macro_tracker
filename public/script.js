const state = {
  parsedMeal: null,
  savedItems: [],
  historyQuickItems: [],
  editingEntryId: null,
  mealImageDataUrl: '',
  mealImagePreviewUrl: '',
  mealImageName: '',
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
  analysisAutoRan: false,
  macroSnapshotPeriod: 'weekly',
  weightSnapshotPeriod: 'weekly',
  workoutSnapshotPeriod: 'weekly',
  healthSnapshotPeriod: 'weekly',
  healthEntries: [],
  weightEntries: [],
  workoutEntries: [],
  expandedMealGroups: new Set(),
  selectedEntryIds: new Set(),
  selectedMealGroups: new Set(),
  editingEntries: false
};

const mealTextEl = document.getElementById('meal-text');
const consumedAtEl = document.getElementById('consumed-at');
const parseBtnEl = document.getElementById('parse-btn');
const saveParsedBtnEl = document.getElementById('save-parsed-btn');
const addPhotoBtnEl = document.getElementById('add-photo-btn');
const useCameraBtnEl = document.getElementById('use-camera-btn');
const mealPhotoInputEl = document.getElementById('meal-photo-input');
const mealCameraInputEl = document.getElementById('meal-camera-input');
const mealPhotoPreviewWrapEl = document.getElementById('meal-photo-preview-wrap');
const mealPhotoPreviewImageEl = document.getElementById('meal-photo-preview-image');
const removePhotoBtnEl = document.getElementById('remove-photo-btn');
const parseNoteEl = document.getElementById('parse-note');
const parsedItemsContainerEl = document.getElementById('parsed-items-container');
const savedSelectEl = document.getElementById('saved-item-select');
const quickMultiplierEl = document.getElementById('quick-multiplier');
const quickAddBtnEl = document.getElementById('quick-add-btn');
const quickEditToggleBtnEl = document.getElementById('quick-edit-toggle-btn');
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
const logoutBtnEl = document.getElementById('logout-btn');
const pageMenuItems = Array.from(document.querySelectorAll('.nav-tab'));
const appPages = {
  macros: document.getElementById('macros-page'),
  weight: document.getElementById('weight-page'),
  workout: document.getElementById('workout-page'),
  health: document.getElementById('health-page'),
  analysis: document.getElementById('analysis-page')
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
const saveSleepBtnEl = document.getElementById('save-sleep-btn');
const sleepLogListEl = document.getElementById('sleep-log-list');
const sleepCanvasEl = document.getElementById('sleep-canvas');
const sleepSnapshotHeadingEl = document.getElementById('sleep-snapshot-heading');
const sleepPeriodToggleEl = document.getElementById('sleep-period-toggle');
const sleepAverageValueEl = document.getElementById('sleep-average-value');
const sleepTooltipEl = document.getElementById('sleep-tooltip');
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

function getLocalIsoDay(dateLike = new Date()) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch (_e) {
    return 'America/New_York';
  }
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
      <input id="target-modal-${m}" type="number" step="1" min="0" value="${val > 0 ? val : ''}" placeholder="No target" />`;
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
          body: JSON.stringify({ target: updates[m] })
        });
      }
      if (state.dashboardData) {
        state.dashboardData.targets = state.dashboardData.targets || {};
        Object.assign(state.dashboardData.targets, updates);
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
      <input id="wkt-modal-target" type="number" min="0" max="14" step="1" value="${currentWorkouts}" placeholder="No target" />
      <label for="wkt-modal-cal-target">Calories burned per week</label>
      <input id="wkt-modal-cal-target" type="number" min="0" step="50" value="${currentCals}" placeholder="No target" />
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
          body: JSON.stringify({ target: roundedWorkouts })
        }),
        api('/api/macro-targets/workout_calories', {
          method: 'PUT',
          body: JSON.stringify({ target: roundedCals })
        })
      ]);
      if (state.dashboardData) {
        state.dashboardData.targets = state.dashboardData.targets || {};
        state.dashboardData.targets.workouts = roundedWorkouts;
        state.dashboardData.targets.workout_calories = roundedCals;
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
  const file = event.target?.files?.[0];
  if (!file) {
    return;
  }

  state.mealImageLoading = true;
  setActionBanner('Processing selected photo...', 'info');
  try {
    const dataUrl = await readFileAsDataUrl(file);
    if (state.mealImagePreviewUrl && state.mealImagePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.mealImagePreviewUrl);
    }
    try {
      state.mealImagePreviewUrl = URL.createObjectURL(file);
    } catch (_error) {
      state.mealImagePreviewUrl = '';
    }
    let selectedMessage = sourceLabel + ' selected.';
    if (isHeicLikeFile(file)) {
      state.mealImageName = file.name || sourceLabel + ' image';
      selectedMessage = sourceLabel + ' selected (HEIC/HEIF). It will be converted on the server.';
    } else {
      state.mealImageName = file.name || sourceLabel + ' image';
      selectedMessage = sourceLabel + ' selected: ' + state.mealImageName + '.';
    }
    state.mealImageDataUrl = dataUrl;
    renderMealImagePreview();
    setActionBanner(selectedMessage + ' You can add an optional description.', 'info');
  } catch (error) {
    setActionBanner(error.message, 'error');
  } finally {
    state.mealImageLoading = false;
  }
}

function applyMealInputMode() {
  if (!mealTextEl) {
    return;
  }
  mealTextEl.disabled = false;
  mealTextEl.placeholder = state.mealImageDataUrl
    ? 'Optional: add a description, or parse from photo only.'
    : defaultMealTextPlaceholder;
}

function renderMealImagePreview() {
  const hasImage = Boolean(state.mealImageDataUrl);
  if (mealPhotoPreviewWrapEl) {
    mealPhotoPreviewWrapEl.hidden = !hasImage;
  }
  if (hasImage) {
    if (mealPhotoPreviewImageEl) {
      try {
        mealPhotoPreviewImageEl.src = state.mealImageDataUrl;
      } catch (_error) {
        mealPhotoPreviewImageEl.removeAttribute('src');
      }
    }
  } else {
    if (mealPhotoPreviewImageEl) {
      mealPhotoPreviewImageEl.removeAttribute('src');
    }
  }
  applyMealInputMode();
}

function clearMealImageSelection() {
  if (state.mealImagePreviewUrl && state.mealImagePreviewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(state.mealImagePreviewUrl);
  }
  state.mealImageDataUrl = '';
  state.mealImagePreviewUrl = '';
  state.mealImageName = '';
  state.mealImageLoading = false;
  if (mealPhotoInputEl) {
    mealPhotoInputEl.value = '';
  }
  if (mealCameraInputEl) {
    mealCameraInputEl.value = '';
  }
  renderMealImagePreview();
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

if (removePhotoBtnEl) {
  removePhotoBtnEl.addEventListener('click', () => {
    clearMealImageSelection();
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
    setProfileMenuOpen(false);
    return;
  }

  profileNameEl.textContent = user.name || 'Google User';
  profileEmailEl.textContent = user.email || '';
  if (user.picture) {
    profileAvatarEl.src = user.picture;
  }
}

function formatMacros(item) {
  return `${fmtNumber(item.calories)} cal | ${fmtNumber(item.protein)}g protein | ${fmtNumber(item.carbs)}g carbs | ${fmtNumber(item.fat)}g fat`;
}

function isCompactMobileView() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function formatSavedItemOption(item) {
  if (!isCompactMobileView()) {
    return `${item.name} (${formatMacros(item)})`;
  }

  const maxName = 22;
  const name = String(item.name || 'Item');
  const compactName = name.length > maxName ? `${name.slice(0, maxName - 1)}…` : name;
  return `${compactName} (${fmtNumber(item.calories)}cal/${fmtNumber(item.protein)}P/${fmtNumber(item.carbs)}C/${fmtNumber(item.fat)}F)`;
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
    throw new Error(body.error || fallback);
  }
  return body;
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
      acc.calories += Number(it.calories || 0);
      acc.protein += Number(it.protein || 0);
      acc.carbs += Number(it.carbs || 0);
      acc.fat += Number(it.fat || 0);
      return acc;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

    const header = document.createElement('div');
    header.className = 'parsed-meal-header parsed-item-card';
    header.innerHTML = `
      <div class="parsed-item-summary">
        <span class="parsed-item-name">${parsedMeal.mealName || 'Meal'}</span>
        <span class="parsed-item-macros">${fmtNumber(mealQty)} ${mealUnit} &middot; ${fmtNumber(totals.calories)} cal &middot; ${fmtNumber(totals.protein)}g protein &middot; ${fmtNumber(totals.carbs)}g carbs &middot; ${fmtNumber(totals.fat)}g fat</span>
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
    summary.innerHTML = `
      <span class="parsed-item-name">${item.itemName}</span>
      <span class="parsed-item-macros">${fmtNumber(item.calories)} cal &middot; ${fmtNumber(item.protein)}g protein &middot; ${fmtNumber(item.carbs)}g carbs &middot; ${fmtNumber(item.fat)}g fat</span>
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
    confidence: item.confidence
  }));
}

function getSelectedSavedItem() {
  const raw = String(savedSelectEl.value || '');
  if (!raw.startsWith('saved:')) {
    return null;
  }
  const id = Number(raw.slice('saved:'.length));
  return state.savedItems.find((item) => item.id === id) || null;
}

function getSelectedQuickTemplate() {
  const raw = String(savedSelectEl.value || '');
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
          consumedAt
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
  const selectedBefore = savedSelectEl.value;
  savedSelectEl.innerHTML = '';

  if (!state.savedItems.length && !state.historyQuickItems.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No quick add history yet';
    savedSelectEl.appendChild(option);
    quickAddBtnEl.disabled = true;
    quickEditToggleBtnEl.disabled = true;
    return;
  }

  for (const item of state.savedItems) {
    const option = document.createElement('option');
    option.value = 'saved:' + String(item.id);
    option.textContent = formatSavedItemOption(item);
    savedSelectEl.appendChild(option);
  }

  if (state.historyQuickItems.length && state.savedItems.length) {
    const divider = document.createElement('option');
    divider.disabled = true;
    divider.textContent = '--- Recent from previous days ---';
    savedSelectEl.appendChild(divider);
  }
  for (const item of state.historyQuickItems) {
    const option = document.createElement('option');
    option.value = item.key;
    option.textContent = formatSavedItemOption(item);
    savedSelectEl.appendChild(option);
  }

  const validValues = new Set([
    ...state.savedItems.map((item) => 'saved:' + String(item.id)),
    ...state.historyQuickItems.map((item) => item.key)
  ]);
  if (validValues.has(selectedBefore)) {
    savedSelectEl.value = selectedBefore;
  }

  const selected = getSelectedSavedItem();
  const selectedTemplate = getSelectedQuickTemplate();
  quickAddBtnEl.disabled = false;
  quickEditToggleBtnEl.disabled = !selectedTemplate;
}

function renderMacroCard(entry) {
  const checked = state.selectedEntryIds.has(entry.id) ? 'checked' : '';
  const inGroup = Boolean(entry.mealGroup);
  const timeStr = new Date(entry.consumedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `
    <div class="macro-card" data-entry-id="${entry.id}">
      <div class="macro-card-check"><input type="checkbox" class="entry-checkbox" data-entry-id="${entry.id}" ${inGroup ? `data-in-group="1" data-meal-group="${entry.mealGroup}"` : ''} ${checked} /></div>
      <div class="macro-card-body" data-edit-entry-id="${entry.id}">
        <div class="macro-card-title">${entry.itemName}</div>
        <div class="entry-card-chips">
          <span class="entry-card-chip">${fmtNumber(entry.quantity)} ${entry.unit || ''}</span>
          <span class="entry-card-chip entry-card-chip--accent">${fmtNumber(entry.calories)} cal</span>
          <span class="entry-card-chip">${fmtNumber(entry.protein)}g protein</span>
          <span class="entry-card-chip">${fmtNumber(entry.carbs)}g carbs</span>
          <span class="entry-card-chip">${fmtNumber(entry.fat)}g fat</span>
        </div>
      </div>
      <div class="macro-card-time">${timeStr}</div>
    </div>
  `;
}

function renderEditRowMobile(entry) {
  const consumedAtValue = isoToLocalInputValue(entry.consumedAt);
  return `
    <td data-label="Edit" colspan="8">
      <table class="edit-vertical-table">
        <tbody>
          <tr><th>Item</th><td><input data-field="itemName" value="${entry.itemName}" /></td></tr>
          <tr><th>Quantity</th><td><input type="number" step="0.1" data-field="quantity" value="${entry.quantity}" data-base-quantity="${entry.quantity}" data-base-calories="${entry.calories}" data-base-protein="${entry.protein}" data-base-carbs="${entry.carbs}" data-base-fat="${entry.fat}" /></td></tr>
          <tr><th>Unit</th><td><input data-field="unit" value="${entry.unit || ''}" /></td></tr>
          <tr><th>Calories</th><td><input type="number" step="0.1" data-field="calories" value="${entry.calories}" /></td></tr>
          <tr><th>Protein</th><td><input type="number" step="0.1" data-field="protein" value="${entry.protein}" /></td></tr>
          <tr><th>Carbs</th><td><input type="number" step="0.1" data-field="carbs" value="${entry.carbs}" /></td></tr>
          <tr><th>Fat</th><td><input type="number" step="0.1" data-field="fat" value="${entry.fat}" /></td></tr>
          <tr><th>Time</th><td><input type="datetime-local" data-field="consumedAt" value="${consumedAtValue}" /></td></tr>
          <tr>
            <th>Actions</th>
            <td>
              <div class="edit-vertical-actions">
                <button type="button" class="btn-success table-action-btn" data-action="save" data-id="${entry.id}">Save</button>
                <button type="button" class="btn-warning table-action-btn" data-action="cancel" data-id="${entry.id}">Cancel</button>
                <button type="button" class="btn-danger table-action-btn" data-action="delete" data-id="${entry.id}">Delete</button>
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

  if (period === 'annual') {
    const points = [];
    for (let w = 51; w >= 0; w -= 1) {
      const weekEndDay = shiftIsoDay(baseIsoDay, -w * 7);
      const weekStartDay = shiftIsoDay(weekEndDay, -6);
      let total = 0;
      let daysWithData = 0;
      for (let d = 0; d <= 6; d += 1) {
        const day = shiftIsoDay(weekStartDay, d);
        if (dayMap.has(day)) {
          total += dayMap.get(day);
          daysWithData += 1;
        }
      }
      const hasData = daysWithData > 0;
      const value = hasData ? total / daysWithData : 0;
      const startDate = fromIsoDayLocal(weekStartDay);
      const label = 'Week of ' + startDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      points.push({ day: weekStartDay, label, value, hasData });
    }
    return points;
  }

  const numDays = period === 'monthly' ? 30 : 7;
  const points = [];
  for (let i = numDays - 1; i >= 0; i -= 1) {
    const day = shiftIsoDay(baseIsoDay, -i);
    points.push({ day, value: dayMap.get(day) || 0, hasData: dayMap.has(day) });
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

  const selectedMacroTarget = Number(state.dashboardData?.targets?.[state.selectedTrendMacro] || 0);
  const targetValue = selectedMacroTarget > 0 ? selectedMacroTarget : 0;
  const max = Math.max(...points.map((p) => p.value), targetValue, 1);
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

  if (targetValue > 0) {
    const targetY = padY + ((max - targetValue) / range) * usableH;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.moveTo(padX, targetY);
    ctx.lineTo(w - padX, targetY);
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
  updateTrendLegend(average, hasAverage, targetValue, targetValue > 0, trendMacro.unit);

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
    drawTrend(state.macroDailyTotals);
    renderSnapshotStats(state.macroDailyTotals, state.dashboardData.targets);
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
  renderWeeklyTargets(
    { calories: avgCalories, protein: avgProtein, carbs: avgCarbs, fat: avgFat },
    targets || {}
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

      let childrenHtml = '';
      for (const child of groupItems) {
        rendered.add(child.id);
        const childChecked = state.selectedEntryIds.has(child.id) ? 'checked' : '';
        childrenHtml += `
          <div class="macro-card-child" data-entry-id="${child.id}" data-meal-group="${item.mealGroup}">
            <div class="macro-card-check"><input type="checkbox" class="entry-checkbox" data-entry-id="${child.id}" data-in-group="1" data-meal-group="${child.mealGroup}" ${childChecked} /></div>
            <div class="macro-card-child-body" data-edit-entry-id="${child.id}">
              <span class="macro-card-child-name">${child.itemName}</span>
              <span class="macro-card-child-detail">${fmtNumber(child.quantity)} ${child.unit || ''} · ${fmtNumber(child.calories)} cal · ${fmtNumber(child.protein)}g protein · ${fmtNumber(child.carbs)}g carbs · ${fmtNumber(child.fat)}g fat</span>
            </div>
          </div>
        `;
      }

      const mealCard = document.createElement('div');
      mealCard.className = 'macro-card macro-card--meal' + (isExpanded ? ' expanded' : '');
      mealCard.dataset.mealGroup = item.mealGroup;
      mealCard.innerHTML = `
        <div class="meal-group-header" data-meal-group="${item.mealGroup}">
          <div class="macro-card-check"><input type="checkbox" class="meal-group-checkbox" data-meal-group="${item.mealGroup}" ${mealGroupChecked} /></div>
          <div class="macro-card-toggle">${isExpanded ? '\u25BC' : '\u25B6'}</div>
          <div class="macro-card-body" data-edit-meal-group="${item.mealGroup}">
            <div class="macro-card-title"><strong>${item.mealName || 'Meal'}</strong></div>
            <div class="entry-card-chips">
              <span class="entry-card-chip">${fmtNumber(mealQty)} ${mealUnit}</span>
              <span class="entry-card-chip entry-card-chip--accent">${fmtNumber(totals.calories)} cal</span>
              <span class="entry-card-chip">${fmtNumber(totals.protein)}g protein</span>
              <span class="entry-card-chip">${fmtNumber(totals.carbs)}g carbs</span>
              <span class="entry-card-chip">${fmtNumber(totals.fat)}g fat</span>
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
    html += '<button type="button" class="btn-info table-action-btn" data-sel-action="split-meal">Split</button>';
  } else if (mode === 'sub-items') {
    html += `<span class="selection-count">${entryCount} item${entryCount > 1 ? 's' : ''} selected</span>`;
    html += '<button type="button" class="btn-info table-action-btn" data-sel-action="remove-from-meal">Remove</button>';
  } else {
    html += `<span class="selection-count">${entryCount} item${entryCount > 1 ? 's' : ''} selected</span>`;
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
      }
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
      }
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

  let overlay = document.getElementById('combine-modal-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'combine-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal">
      <h3>${title}</h3>
      <label for="combine-name">Meal Name</label>
      <input id="combine-name" type="text" value="${String(defaultName).replace(/"/g, '&quot;')}" />
      <label for="combine-qty">Quantity</label>
      <input id="combine-qty" type="number" step="0.1" min="0.1" value="${defaultQty}" />
      <label for="combine-unit">Unit</label>
      <input id="combine-unit" type="text" value="${String(defaultUnit).replace(/"/g, '&quot;')}" />
      ${isEdit ? '<label class="inline-check entry-modal-quickadd"><input type="checkbox" id="combine-save-quickadd" /><span>Save as quick add</span></label>' : ''}
      <div class="combine-modal-actions">
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
          const totals = subItems.reduce((acc, e) => {
            acc.calories += Number(e.calories) || 0;
            acc.protein += Number(e.protein) || 0;
            acc.carbs += Number(e.carbs) || 0;
            acc.fat += Number(e.fat) || 0;
            return acc;
          }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
          await api('/api/saved-items', {
            method: 'POST',
            body: JSON.stringify({
              name: mealName,
              quantity,
              unit,
              calories: totals.calories,
              protein: totals.protein,
              carbs: totals.carbs,
              fat: totals.fat
            })
          });
          setActionBanner('Quick add item saved.', 'success');
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

function showEntryModal(entry, { onSave, onDelete, title } = {}) {
  let overlay = document.getElementById('entry-modal-overlay');
  if (overlay) overlay.remove();

  const consumedAtValue = entry.consumedAt ? isoToLocalInputValue(entry.consumedAt) : '';

  overlay = document.createElement('div');
  overlay.id = 'entry-modal-overlay';
  overlay.className = 'combine-modal-overlay';
  overlay.innerHTML = `
    <div class="combine-modal entry-modal">
      <h3>${title || 'Edit Item'}</h3>
      <label for="entry-modal-name">Item</label>
      <input id="entry-modal-name" type="text" value="${(entry.itemName || '').replace(/"/g, '&quot;')}" />
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="entry-modal-qty">Quantity</label>
          <input id="entry-modal-qty" type="number" step="0.1" min="0" value="${entry.quantity || 1}" />
        </div>
        <div class="entry-modal-field">
          <label for="entry-modal-unit">Unit</label>
          <input id="entry-modal-unit" type="text" value="${(entry.unit || 'serving').replace(/"/g, '&quot;')}" />
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="entry-modal-cal">Calories</label>
          <input id="entry-modal-cal" type="number" step="0.1" min="0" value="${entry.calories || 0}" />
        </div>
        <div class="entry-modal-field">
          <label for="entry-modal-protein">Protein</label>
          <input id="entry-modal-protein" type="number" step="0.1" min="0" value="${entry.protein || 0}" />
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="entry-modal-carbs">Carbs</label>
          <input id="entry-modal-carbs" type="number" step="0.1" min="0" value="${entry.carbs || 0}" />
        </div>
        <div class="entry-modal-field">
          <label for="entry-modal-fat">Fat</label>
          <input id="entry-modal-fat" type="number" step="0.1" min="0" value="${entry.fat || 0}" />
        </div>
      </div>
      ${consumedAtValue ? `<label for="entry-modal-time">Time</label><input id="entry-modal-time" type="datetime-local" value="${consumedAtValue}" />` : ''}
      <label class="inline-check entry-modal-quickadd"><input type="checkbox" id="entry-modal-save-quickadd" /><span>Save as quick add</span></label>
      <div class="combine-modal-actions">
        ${onDelete ? '<button type="button" class="btn-danger table-action-btn" id="entry-modal-delete-btn">Delete</button>' : ''}
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
      <input id="weight-modal-weight" type="number" step="0.1" min="0" value="${entry.weight}" />
      <label for="weight-modal-time">Logged At</label>
      <input id="weight-modal-time" type="datetime-local" value="${loggedAtValue}" />
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
      <input id="workout-modal-desc" type="text" value="${(entry.description || '').replace(/"/g, '&quot;')}" />
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="workout-modal-date">Date</label>
          <input id="workout-modal-date" type="date" value="${loggedAtDate}" />
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
          <input id="workout-modal-duration" type="number" step="0.25" min="0" value="${entry.durationHours}" />
        </div>
        <div class="entry-modal-field">
          <label for="workout-modal-calories">Calories</label>
          <input id="workout-modal-calories" type="number" step="1" min="0" value="${entry.caloriesBurned}" />
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
  const [dashboard, saved, me] = await Promise.all([
    api(`/api/dashboard?tz=${tz}`),
    api('/api/saved-items'),
    api('/api/me')
  ]);
  state.savedItems = saved;
  state.historyQuickItems = buildHistoryQuickItems(dashboard.entries, state.savedItems);
  state.dashboardData = dashboard;
  renderProfile(me.user || null);
  renderSavedItems();
  renderDashboard(dashboard);
  bindTrendResize();
  bindTrendMacroCards();
  bindEditTargetsLink();
  bindSnapshotToggles();
  await refreshMacroSnapshotData();
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
        imageDataUrl: state.mealImageDataUrl || undefined
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

  const items = editedItems.map((item) => ({
    itemName: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    consumedAt
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
        fat: perUnit(item.fat)
      });
    } else {
      const mealQty = state.parsedMeal.mealQuantity || 1;
      const totals = editedItems.reduce((acc, item) => {
        acc.calories += Number(item.calories || 0);
        acc.protein += Number(item.protein || 0);
        acc.carbs += Number(item.carbs || 0);
        acc.fat += Number(item.fat || 0);
        return acc;
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
      const perUnit = (v) => Number((v / mealQty).toFixed(2));
      saveItems.push({
        name: state.parsedMeal.mealName || 'Meal',
        quantity: 1,
        unit: state.parsedMeal.mealUnit || 'serving',
        calories: perUnit(totals.calories),
        protein: perUnit(totals.protein),
        carbs: perUnit(totals.carbs),
        fat: perUnit(totals.fat)
      });
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
        mealUnit: state.parsedMeal.mealUnit || undefined
      })
    });

    setActionBanner('Saved parsed items.', 'success');
    mealTextEl.value = '';
    state.parsedMeal = null;
    clearMealImageSelection();
    parsedItemsContainerEl.innerHTML = '';
    saveParsedBtnEl.disabled = true;
    await refreshDashboard();
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

savedSelectEl.addEventListener('change', () => {
  const selectedTemplate = getSelectedQuickTemplate();
  quickEditToggleBtnEl.disabled = !selectedTemplate;
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
          fat: values.fat
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
  const targetValue = Number.isFinite(options.targetValue) && options.targetValue > 0
    ? options.targetValue : null;
  let yMin = baseline === 'range' ? minValue : 0;
  let yMax = baseline === 'range' ? maxValue : maxValue;
  if (targetValue !== null) {
    yMin = Math.min(yMin, targetValue);
    yMax = Math.max(yMax, targetValue);
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

  // Optional amber target line (always in range because yMin/yMax were extended above)
  if (targetValue !== null) {
    const targetY = hasFlatRange
      ? pad.top + plotH / 2
      : pad.top + plotH - ((targetValue - yMin) / ySpan) * plotH;
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
  const recent = (entries || []).filter((e) => new Date(e.loggedAt) >= cutoff);
  const weeks = 30 / 7;
  const avgWorkouts = recent.length / weeks;
  const avgCal = recent.reduce((sum, e) => sum + Number(e.caloriesBurned || 0), 0) / weeks;
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
    workoutDays.add(getLocalIsoDay(entry.loggedAt));
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
  // Convert weekly target to daily for the chart
  const dailyTarget = calTarget > 0 ? Math.round(calTarget / 7) : 0;
  drawSimpleLineChart(workoutCalCanvasEl, rows, 'label', 'value', {
    baseline: 'zero',
    showYAxis: true,
    showXAxisLabels: false,
    yTickCount: 4,
    showTrendLine: true,
    trendLineMode: 'average',
    averageValueEl: workoutCalAverageValueEl,
    targetValue: dailyTarget > 0 ? dailyTarget : undefined,
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
  drawWorkoutOccurrenceChart(state.workoutEntries, state.workoutSnapshotPeriod || 'weekly');
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
      } else if (state.selectedPage === 'health') {
        drawHealthOccurrenceChart(state.healthEntries, state.healthSnapshotPeriod || 'weekly');
      }
    }, 80);
  });

  pageChartsResizeBound = true;
}

function renderWeightCard(entry) {
  const loggedAt = new Date(entry.loggedAt);
  const dateText = loggedAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeText = loggedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `
    <div class="entry-card" data-weight-action="edit" data-weight-id="${entry.id}">
      <div class="entry-card-icon entry-card-icon--weight">⚖</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${dateText}</div>
        <div class="entry-card-sub">${timeText}</div>
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
  return `
    <div class="entry-card" data-workout-action="edit" data-workout-id="${entry.id}">
      <div class="entry-card-icon entry-card-icon--${intensity}">${intensityIcon}</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${entry.description || 'Workout'}</div>
        <div class="entry-card-chips">
          <span class="entry-card-chip">${dateText}</span>
          <span class="entry-card-chip">${fmtNumber(entry.durationHours)} hr</span>
          <span class="entry-card-chip entry-card-chip--accent">${fmtNumber(entry.caloriesBurned)} cal</span>
        </div>
      </div>
    </div>
  `;
}


async function refreshWeightData() {
  if (!weightLogListEl) {
    return;
  }
  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const weightScope = periodToScope[state.weightSnapshotPeriod] || 'week';
    const tz = encodeURIComponent(getTimezone());
    const [response, target] = await Promise.all([
      api(`/api/weights?scope=${weightScope}&tz=${tz}`),
      api('/api/weight-target')
    ]);
    const entries = Array.isArray(response.entries) ? response.entries : [];
    state.weightEntries = entries;

    state.weightTargetData = target;
    const tw = Number(target?.targetWeight);
    state.weightTarget = Number.isFinite(tw) && tw > 0 ? tw : null;

    const tenDaysCutoff = new Date();
    tenDaysCutoff.setDate(tenDaysCutoff.getDate() - 10);
    tenDaysCutoff.setHours(0, 0, 0, 0);
    const recentEntries = entries.filter((e) => new Date(e.loggedAt) >= tenDaysCutoff);

    if (!recentEntries.length) {
      weightLogListEl.innerHTML = '<p class="empty-note">No weight entries in the last 10 days.</p>';
    } else {
      weightLogListEl.innerHTML = `<div class="entry-cards">${recentEntries.map((entry) => renderWeightCard(entry)).join('')}</div>`;
    }

    const sorted = entries.slice().reverse().map((entry) => ({
      label: new Date(entry.loggedAt).toLocaleDateString(),
      value: Number(entry.weight || 0),
      time: new Date(entry.loggedAt).getTime()
    }));
    state.weightChartRows = sorted;
    renderWeightChart();
  } catch (error) {
    setActionBanner(error.message, 'error');
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
      <input id="wt-modal-weight" type="number" step="0.1" min="0" value="${currentWeight}" placeholder="Target" />
      <label for="wt-modal-date">Target Date</label>
      <input id="wt-modal-date" type="date" value="${currentDate}" />
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
        body: JSON.stringify({ targetWeight, targetDate })
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

function renderSleepCard(entry) {
  const loggedAt = new Date(entry.loggedAt);
  const dateText = loggedAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const hours = Number(entry.durationHours || 0);
  const wakeUps = Number(entry.wakeUps || 0);
  const hoursLabel = hours === 1 ? '1 hour' : `${fmtNumber(hours)} hours`;
  const wakeUpsLabel = wakeUps > 0 ? ` · ${wakeUps} wake-up${wakeUps === 1 ? '' : 's'}` : '';
  return `
    <div class="entry-card" data-sleep-action="edit" data-sleep-id="${entry.id}">
      <div class="entry-card-icon entry-card-icon--health" style="background:#7c4dff22;color:#7c4dff">●</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${hoursLabel}${wakeUpsLabel}</div>
        <div class="entry-card-sub">${dateText}</div>
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
          <input id="sleep-modal-date" type="datetime-local" value="${loggedAtValue}" />
        </div>
      </div>
      <div class="entry-modal-row">
        <div class="entry-modal-field">
          <label for="sleep-modal-hours">Hours</label>
          <input id="sleep-modal-hours" type="number" step="0.25" min="0" max="24" value="${entry.durationHours}" />
        </div>
        <div class="entry-modal-field">
          <label for="sleep-modal-wake-ups">Wake-ups</label>
          <input id="sleep-modal-wake-ups" type="number" step="1" min="0" max="99" value="${entry.wakeUps || 0}" />
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
      await api(`/api/sleep/${entry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ durationHours, wakeUps, loggedAt })
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

async function refreshSleepData() {
  if (!sleepLogListEl) return;
  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const scope = periodToScope[state.sleepSnapshotPeriod] || 'week';
    const data = await api(`/api/sleep?scope=${scope}&tz=${encodeURIComponent(getTimezone())}`);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    state.sleepEntries = entries;

    const tenDaysCutoff = new Date();
    tenDaysCutoff.setDate(tenDaysCutoff.getDate() - 10);
    tenDaysCutoff.setHours(0, 0, 0, 0);
    const recentEntries = entries.filter((e) => new Date(e.loggedAt) >= tenDaysCutoff);

    if (!recentEntries.length) {
      sleepLogListEl.innerHTML = '<p class="empty-note">No sleep entries in the last 10 days.</p>';
    } else {
      sleepLogListEl.innerHTML = `<div class="entry-cards">${recentEntries.map((entry) => renderSleepCard(entry)).join('')}</div>`;
    }

    const dailyTotals = Array.isArray(data.dailyTotals) ? data.dailyTotals : [];
    state.sleepChartRows = dailyTotals.map((d) => ({
      label: new Date(d.day + 'T00:00:00').toLocaleDateString(),
      value: Number(d.totalHours || 0),
      time: new Date(d.day + 'T00:00:00').getTime()
    }));
    renderSleepChart();
  } catch (error) {
    setActionBanner(error.message, 'error');
  }
}

function renderSleepChart() {
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
    targetValue: 8
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
  const typeLabel = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
  const color = EJACULATION_TYPE_COLORS[entry.type] || '#c48aff';
  return `
    <div class="entry-card" data-health-action="edit" data-health-id="${entry.id}">
      <div class="entry-card-icon entry-card-icon--health" style="background:${color}22;color:${color}">●</div>
      <div class="entry-card-body">
        <div class="entry-card-title">${typeLabel}</div>
        <div class="entry-card-sub">${dateText}</div>
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
          <input id="health-modal-date" type="datetime-local" value="${loggedAtValue}" />
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
    const day = getLocalIsoDay(entry.loggedAt);
    if (!dayTypesMap.has(day)) dayTypesMap.set(day, new Set());
    dayTypesMap.get(day).add(entry.type || 'other');
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

  // Priority order for which color to show when multiple types on same day
  const typePriority = ['vaginal sex', 'oral sex', 'masturbation', 'other'];

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

async function refreshHealthData() {
  if (!healthLogListEl) return;
  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const scope = periodToScope[state.healthSnapshotPeriod] || 'week';
    const data = await api(`/api/sexual-activity?scope=${scope}&tz=${encodeURIComponent(getTimezone())}`);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    state.healthEntries = entries;

    const tenDaysCutoff = new Date();
    tenDaysCutoff.setDate(tenDaysCutoff.getDate() - 10);
    tenDaysCutoff.setHours(0, 0, 0, 0);
    const recentEntries = entries.filter((e) => new Date(e.loggedAt) >= tenDaysCutoff);

    if (!recentEntries.length) {
      healthLogListEl.innerHTML = '<p class="empty-note">No entries in the last 10 days.</p>';
    } else {
      healthLogListEl.innerHTML = `<div class="entry-cards">${recentEntries.map((entry) => renderHealthCard(entry)).join('')}</div>`;
    }

    drawHealthOccurrenceChart(entries, state.healthSnapshotPeriod || 'weekly');
  } catch (error) {
    setActionBanner(error.message, 'error');
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
  workoutQuickListEl.innerHTML = quickItems.map((item) => `<button type="button" class="chip-action" data-workout-quick='${JSON.stringify({description:item.description,intensity:normalizeWorkoutIntensity(item.intensity),durationHours:item.durationHours,caloriesBurned:item.caloriesBurned}).replace(/'/g, '&apos;')}' >${item.description}</button>`).join('') || '<p class="empty-note">No quick workouts yet.</p>';
}

async function refreshWorkoutData() {
  if (!workoutLogListEl) {
    return;
  }
  try {
    const periodToScope = { weekly: 'week', monthly: 'month', annual: 'year' };
    const workoutScope = periodToScope[state.workoutSnapshotPeriod] || 'week';
    const data = await api(`/api/workouts?scope=${workoutScope}&tz=${encodeURIComponent(getTimezone())}`);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const dailyCalories = Array.isArray(data.dailyCalories) ? data.dailyCalories : [];

    const tenDaysCutoff = new Date();
    tenDaysCutoff.setDate(tenDaysCutoff.getDate() - 10);
    tenDaysCutoff.setHours(0, 0, 0, 0);
    const recentWorkouts = entries.filter((e) => new Date(e.loggedAt) >= tenDaysCutoff);

    workoutLogListEl.innerHTML = recentWorkouts.length
      ? `<div class="entry-cards">${recentWorkouts.map((entry) => renderWorkoutCard(entry)).join('')}</div>`
      : '<p class="empty-note">No workouts logged in the last 10 days.</p>';

    renderWorkoutQuickAdds(entries);
    state.workoutEntries = entries;
    state.workoutCalChartRows = dailyCalories.map((d) => ({
      label: new Date(d.day + 'T00:00:00').toLocaleDateString(),
      value: Number(d.calories || 0)
    }));
    renderWorkoutStats(entries);
    renderWorkoutChart();
  } catch (error) {
    setActionBanner(error.message, 'error');
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
    if (page === 'health') {
      await refreshHealthData();
      await refreshSleepData();
    }
    if (page === 'analysis') {
      await refreshAnalysisData();
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
      await api('/api/sleep', {
        method: 'POST',
        body: JSON.stringify({
          loggedAt: asIso(sleepLoggedAtEl?.value || toDateTimeLocalValue()),
          durationHours,
          wakeUps
        })
      });
      if (sleepHoursEl) sleepHoursEl.value = '';
      if (sleepWakeUpsEl) sleepWakeUpsEl.value = '';
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

refreshDashboard().catch((error) => {
  setActionBanner(error.message, 'error');
});

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
