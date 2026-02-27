const state = {
  parsedMeal: null,
  savedItems: [],
  historyQuickItems: [],
  editingEntryId: null,
  quickEditMode: false,
  mealImageDataUrl: '',
  mealImagePreviewUrl: '',
  mealImageName: '',
  mealImageLoading: false,
  selectedEntriesDay: '',
  dashboardData: null,
  selectedTrendMacro: 'calories',
  selectedPage: 'macros',
  weightEditingEntryId: null,
  workoutEditingEntryId: null,
  pendingWorkout: null,
  weightChartRows: [],
  workoutChartRows: [],
  analysisReport: null,
  analysisAutoRan: false
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
const quickSaveBtnEl = document.getElementById('quick-save-btn');
const quickDeleteBtnEl = document.getElementById('quick-delete-btn');
const quickEditorEl = document.getElementById('quick-add-editor');
const quickEditNameEl = document.getElementById('quick-edit-name');
const quickEditQuantityEl = document.getElementById('quick-edit-quantity');
const quickEditUnitEl = document.getElementById('quick-edit-unit');
const quickEditCaloriesEl = document.getElementById('quick-edit-calories');
const quickEditProteinEl = document.getElementById('quick-edit-protein');
const quickEditCarbsEl = document.getElementById('quick-edit-carbs');
const quickEditFatEl = document.getElementById('quick-edit-fat');
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
const macroTargetCards = Array.from(document.querySelectorAll('.macro-target-card'));
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
const brandMenuBtnEl = document.getElementById('brand-menu-btn');
const brandMenuPopoverEl = document.getElementById('brand-menu-popover');
const pageMenuItems = Array.from(document.querySelectorAll('.brand-menu-item'));
const appPages = {
  macros: document.getElementById('macros-page'),
  weight: document.getElementById('weight-page'),
  workout: document.getElementById('workout-page'),
  analysis: document.getElementById('analysis-page')
};
const weightLoggedAtEl = document.getElementById('weight-logged-at');
const weightValueEl = document.getElementById('weight-value');
const saveWeightBtnEl = document.getElementById('save-weight-btn');
const weightNoteEl = document.getElementById('weight-note');
const weightCanvasEl = document.getElementById('weight-canvas');
const weightAverageValueEl = document.getElementById('weight-average-value');
const weightLogListEl = document.getElementById('weight-log-list');
const workoutTextEl = document.getElementById('workout-text');
const parseWorkoutBtnEl = document.getElementById('parse-workout-btn');
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
const analysisDaysEl = document.getElementById('analysis-days');
const analysisGoalEl = document.getElementById('analysis-goal');
const analysisPlannedWorkoutsEl = document.getElementById('analysis-planned-workouts');
const analysisGenerateBtnEl = document.getElementById('analysis-generate-btn');
const analysisNoteEl = document.getElementById('analysis-note');
const analysisMetaEl = document.getElementById('analysis-meta');
const analysisSummaryEl = document.getElementById('analysis-summary');
const analysisGoalListEl = document.getElementById('analysis-goal-list');
const analysisAdherenceListEl = document.getElementById('analysis-adherence-list');
const analysisWowListEl = document.getElementById('analysis-wow-list');
const analysisNutritionListEl = document.getElementById('analysis-nutrition-list');
const analysisRecoveryListEl = document.getElementById('analysis-recovery-list');
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
let macroTargetBound = false;
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

async function promptAndSaveMacroTarget(macro) {
  const current = Number(state.dashboardData?.targets?.[macro] || 0);
  const unit = macroUnit(macro);
  const input = window.prompt(
    `Set ${macro} target (${unit}). Leave blank to clear target.`,
    current > 0 ? String(current) : ''
  );

  if (input === null) {
    return;
  }

  const trimmed = String(input).trim();
  const nextTarget = trimmed ? Number(trimmed) : 0;
  if (!Number.isFinite(nextTarget) || nextTarget < 0) {
    setActionBanner('Target must be a number greater than or equal to 0.', 'error');
    return;
  }

  try {
    await api(`/api/macro-targets/${macro}`, {
      method: 'PUT',
      body: JSON.stringify({ target: nextTarget })
    });
    if (state.dashboardData) {
      state.dashboardData.targets = state.dashboardData.targets || {};
      state.dashboardData.targets[macro] = nextTarget;
      renderDashboard(state.dashboardData);
    }
    setActionBanner('Macro target updated.', 'success');
  } catch (error) {
    setActionBanner(error.message, 'error');
  }
}

function bindMacroTargetCards() {
  if (macroTargetBound) {
    return;
  }

  for (const card of macroTargetCards) {
    const macro = String(card.dataset.targetMacro || '');
    if (!macro) {
      continue;
    }

    card.addEventListener('click', () => {
      promptAndSaveMacroTarget(macro);
    });

    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      promptAndSaveMacroTarget(macro);
    });
  }

  macroTargetBound = true;
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

  const threshold = persist ? 42 : 20;
  if (!nearest || minDist > threshold) {
    hideTrendTooltip();
    return;
  }

  const trendMacro = getTrendMacroConfig();
  trendTooltipEl.textContent = `${formatIsoDayLabel(nearest.day)}: ${fmtNumber(nearest.value)} ${trendMacro.unit}`;
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
        mealPhotoPreviewImageEl.src = state.mealImagePreviewUrl || state.mealImageDataUrl;
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
  return `${fmtNumber(item.calories)} cal | P ${fmtNumber(item.protein)}g | C ${fmtNumber(item.carbs)}g | F ${fmtNumber(item.fat)}g`;
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

function getAnalysisContext() {
  return {
    goal: String(analysisGoalEl?.value || 'maintain').toLowerCase(),
    plannedWorkoutsPerWeek: Number(analysisPlannedWorkoutsEl?.value || 5)
  };
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
    fillAnalysisList(analysisRecoveryListEl, []);
    fillAnalysisList(analysisConfidenceListEl, []);
    fillAnalysisList(analysisProgressListEl, []);
    fillAnalysisList(analysisNeedsListEl, []);
    fillAnalysisList(analysisNextWeekListEl, []);
    return;
  }

  if (analysisMetaEl) {
    const periodDays = Number(record.periodDays || 0);
    const generatedAt = formatDateTimeLabel(record.createdAt);
    const confidence = String(report.confidence || '').trim();
    analysisMetaEl.textContent =
      `Generated ${generatedAt} using ${periodDays} days of data` +
      (confidence ? ` (${confidence} confidence).` : '.');
  }
  if (analysisSummaryEl) {
    analysisSummaryEl.textContent = String(report.summary || '').trim();
  }
  const goalAlignment = report.goalAlignment || {};
  const adherence = report.adherence || {};
  const wow = report.weekOverWeek || {};
  const nutrition = report.nutritionSignals || {};
  const recovery = report.recoveryContext || {};
  const confidence = report.dataConfidence || {};
  fillAnalysisList(analysisGoalListEl, [
    `Goal: ${goalAlignment.goal || 'n/a'}`,
    `Status: ${String(goalAlignment.status || 'n/a').replaceAll('_', ' ')}`,
    `Score: ${Math.round(Number(goalAlignment.score || 0))}/100`,
    String(goalAlignment.reason || '')
  ]);
  fillAnalysisList(analysisAdherenceListEl, [
    `Meal logging: ${toPercent(adherence.mealLoggingPct)}`,
    `Calories target hit: ${toPercent(adherence.calorieTargetHitPct)}`,
    `Protein target hit: ${toPercent(adherence.proteinTargetHitPct)}`,
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
  fillAnalysisList(analysisRecoveryListEl, [
    `Provided: ${recovery.dataAvailable ? 'Yes' : 'No'}`
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
      body: JSON.stringify({
        days,
        ...getAnalysisContext()
      })
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

  parsedMeal.items.forEach((item, index) => {
    const wrapper = document.createElement('article');
    wrapper.className = 'parsed-item';

    const details = document.createElement('p');
    details.textContent = 'Edit values before saving. Confidence: ' + item.confidence;

    const table = document.createElement('table');
    table.className = 'parsed-edit-table';
    const tbody = document.createElement('tbody');

    function addField(labelText, field, value, options = {}) {
      const row = document.createElement('tr');
      const labelCell = document.createElement('th');
      labelCell.scope = 'row';
      labelCell.textContent = labelText;
      const valueCell = document.createElement('td');
      const input = document.createElement('input');
      input.dataset.parseIndex = String(index);
      input.dataset.parseField = field;
      input.type = options.type || 'text';
      if (options.step) {
        input.step = options.step;
      }
      if (options.min !== undefined) {
        input.min = String(options.min);
      }
      input.placeholder = options.placeholder || field;
      input.value = value ?? '';
      valueCell.appendChild(input);
      row.appendChild(labelCell);
      row.appendChild(valueCell);
      tbody.appendChild(row);
    }

    addField('Item', 'itemName', item.itemName, { placeholder: 'Item' });
    addField('Quantity', 'quantity', item.quantity, { type: 'number', step: '0.1', min: 0, placeholder: 'Qty' });
    addField('Unit', 'unit', item.unit || '', { placeholder: 'Unit' });
    addField('Calories', 'calories', item.calories, { type: 'number', step: '0.1', min: 0, placeholder: 'Cal' });
    addField('Protein', 'protein', item.protein, { type: 'number', step: '0.1', min: 0, placeholder: 'P' });
    addField('Carbs', 'carbs', item.carbs, { type: 'number', step: '0.1', min: 0, placeholder: 'C' });
    addField('Fat', 'fat', item.fat, { type: 'number', step: '0.1', min: 0, placeholder: 'F' });
    table.appendChild(tbody);

    const label = document.createElement('label');
    label.className = 'inline-check';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.index = String(index);

    const text = document.createElement('span');
    text.textContent = 'Save this as a quick-add item';

    label.appendChild(checkbox);
    label.appendChild(text);

    wrapper.appendChild(details);
    wrapper.appendChild(table);
    wrapper.appendChild(label);
    parsedItemsContainerEl.appendChild(wrapper);
  });

  saveParsedBtnEl.disabled = parsedMeal.items.length === 0;
}

function collectParsedItemsFromUi() {
  if (!state.parsedMeal || !Array.isArray(state.parsedMeal.items)) {
    return [];
  }

  return state.parsedMeal.items.map((item, index) => {
    const getValue = (field, fallback = '') => {
      const el = parsedItemsContainerEl.querySelector(
        '[data-parse-index="' + index + '"][data-parse-field="' + field + '"]'
      );
      return el ? el.value : fallback;
    };

    const toNumber = (value, fallback = 0) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    return {
      itemName: String(getValue('itemName', item.itemName || '')).trim() || item.itemName || 'Item',
      quantity: toNumber(getValue('quantity', item.quantity), Number(item.quantity || 0)),
      unit: String(getValue('unit', item.unit || 'serving')).trim() || 'serving',
      calories: toNumber(getValue('calories', item.calories), Number(item.calories || 0)),
      protein: toNumber(getValue('protein', item.protein), Number(item.protein || 0)),
      carbs: toNumber(getValue('carbs', item.carbs), Number(item.carbs || 0)),
      fat: toNumber(getValue('fat', item.fat), Number(item.fat || 0)),
      confidence: item.confidence
    };
  });
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

function setQuickEditMode(isEditing) {
  const selected = getSelectedSavedItem();
  const selectedTemplate = getSelectedQuickTemplate();
  const hasSelection = Boolean(selectedTemplate);
  state.quickEditMode = isEditing;
  quickEditorEl.hidden = !isEditing;
  quickEditToggleBtnEl.textContent = isEditing ? 'Cancel' : 'Edit';
  quickSaveBtnEl.classList.toggle('is-visible', Boolean(isEditing && hasSelection));
  quickDeleteBtnEl.classList.toggle('is-visible', Boolean(isEditing && selected));
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

function buildHistoryQuickItems(entries) {
  const historyBySignature = new Map();
  for (const entry of entries || []) {
    const signature = [
      String(entry.itemName || '').trim().toLowerCase(),
      String(entry.unit || 'serving').trim().toLowerCase(),
      Number(entry.quantity || 0).toFixed(3),
      Number(entry.calories || 0).toFixed(3),
      Number(entry.protein || 0).toFixed(3),
      Number(entry.carbs || 0).toFixed(3),
      Number(entry.fat || 0).toFixed(3)
    ].join('|');
    const existing = historyBySignature.get(signature);
    if (existing) {
      existing.count += 1;
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
      count: 1,
      lastUsedAt: entry.consumedAt
    });
  }

  return Array.from(historyBySignature.values())
    .sort((a, b) => {
      const countDiff = Number(b.count || 0) - Number(a.count || 0);
      if (countDiff !== 0) {
        return countDiff;
      }
      const timeDiff = new Date(b.lastUsedAt || 0).getTime() - new Date(a.lastUsedAt || 0).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, 60);
}

function fillQuickEditor(item) {
  if (!item) {
    quickEditNameEl.value = '';
    quickEditQuantityEl.value = '';
    quickEditUnitEl.value = '';
    quickEditCaloriesEl.value = '';
    quickEditProteinEl.value = '';
    quickEditCarbsEl.value = '';
    quickEditFatEl.value = '';
    return;
  }

  quickEditNameEl.value = item.name;
  quickEditQuantityEl.value = item.quantity;
  quickEditUnitEl.value = item.unit || 'serving';
  quickEditCaloriesEl.value = item.calories;
  quickEditProteinEl.value = item.protein;
  quickEditCarbsEl.value = item.carbs;
  quickEditFatEl.value = item.fat;
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
    quickSaveBtnEl.disabled = true;
    quickSaveBtnEl.classList.remove('is-visible');
    quickDeleteBtnEl.disabled = true;
    quickDeleteBtnEl.classList.remove('is-visible');
    setQuickEditMode(false);
    fillQuickEditor(null);
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
  quickSaveBtnEl.disabled = !selectedTemplate;
  quickSaveBtnEl.classList.toggle('is-visible', Boolean(selectedTemplate && state.quickEditMode));
  quickDeleteBtnEl.disabled = !selected;
  quickDeleteBtnEl.classList.toggle('is-visible', Boolean(selected && state.quickEditMode));

  if (!selectedTemplate) {
    setQuickEditMode(false);
  }

  fillQuickEditor(selected || selectedTemplate);
}

function renderReadOnlyRow(entry) {
  return `
    <td data-label="Item">${entry.itemName}</td>
    <td data-label="Quantity">${fmtNumber(entry.quantity)} ${entry.unit || ''}</td>
    <td data-label="Calories">${fmtNumber(entry.calories)}</td>
    <td data-label="Protein">${fmtNumber(entry.protein)}</td>
    <td data-label="Carbs">${fmtNumber(entry.carbs)}</td>
    <td data-label="Fat">${fmtNumber(entry.fat)}</td>
    <td data-label="Time">${new Date(entry.consumedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
    <td data-label="Actions">
      <div class="action-row">
        <button type="button" class="btn-warning table-action-btn" data-action="edit" data-id="${entry.id}">Edit</button>
      </div>
    </td>
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

function drawTrend(entries, baseIsoDay = shiftIsoDay(getLocalIsoDay(), -1)) {
  if (!trendCanvasEl) {
    return;
  }
  const targetLineColor = 'rgba(231, 122, 49, 0.95)';
  const averageLineColor = 'rgba(10, 138, 102, 0.95)';
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

  const map = new Map();
  for (const entry of entries || []) {
    const day = getLocalIsoDay(entry.consumedAt);
    map.set(day, Number(map.get(day) || 0) + Number(entry[state.selectedTrendMacro] || 0));
  }

  const points = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = shiftIsoDay(baseIsoDay, -i);
    points.push({ day, value: map.get(day) || 0, hasData: map.has(day) });
  }

  const selectedMacroTarget = Number(state.dashboardData?.targets?.[state.selectedTrendMacro] || 0);
  const targetValue = selectedMacroTarget > 0 ? selectedMacroTarget : 0;
  const max = Math.max(...points.map((p) => p.value), targetValue, 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const range = Math.max(max - min, 1);
  const trendMacro = getTrendMacroConfig();

  const padX = 34;
  const padY = 14;
  const usableW = w - padX * 2;
  const usableH = h - padY * 2;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * usableW;
    const y = padY + ((max - p.value) / range) * usableH;
    return { ...p, x, y };
  });

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(15,95,206,0.32)');
  grad.addColorStop(1, 'rgba(15,95,206,0.03)');

  let targetY = null;
  if (targetValue > 0) {
    targetY = padY + ((max - targetValue) / range) * usableH;
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
  ctx.lineTo(coords[coords.length - 1].x, h - padY + 4);
  ctx.lineTo(coords[0].x, h - padY + 4);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i += 1) {
    ctx.lineTo(coords[i].x, coords[i].y);
  }
  ctx.strokeStyle = '#0f5fce';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.fillStyle = '#0f5fce';
  for (const p of coords) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Show a horizontal weekly average line using days that have logged data.
  let avgY = null;
  let average = 0;
  let hasAverage = false;
  const trendSource = points.filter((p) => p.hasData);
  if (trendSource.length >= 1) {
    hasAverage = true;
    average = trendSource.reduce((sum, point) => sum + point.value, 0) / trendSource.length;
    avgY = padY + ((max - average) / range) * usableH;

    ctx.save();
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
  ctx.strokeStyle = 'rgba(53, 81, 114, 0.22)';
  ctx.fillStyle = 'rgba(40, 63, 92, 0.9)';
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

  ctx.strokeStyle = 'rgba(53, 81, 114, 0.45)';
  ctx.beginPath();
  ctx.moveTo(padX, padY);
  ctx.lineTo(padX, h - padY);
  ctx.stroke();
  ctx.restore();

  trendPointCoords = coords;
  if (trendCanvasEl) {
    const trendMacro = getTrendMacroConfig();
    trendCanvasEl.setAttribute('aria-label', `7-day ${trendMacro.label.toLowerCase()} trend`);
  }
  bindTrendInteractions();
}

function bindTrendResize() {
  if (trendResizeBound) {
    return;
  }

  window.addEventListener('resize', () => {
    if (!state.dashboardData) {
      return;
    }
    drawTrend(state.dashboardData.entries);
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
  if (state.dashboardData) {
    drawTrend(state.dashboardData.entries);
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

function renderDashboard(data) {
  const compactMobile = isCompactMobileView();

  drawTrend(data.entries);

  const avgBaseDay = shiftIsoDay(getLocalIsoDay(), -1);
  const avgWindowDays = new Set(Array.from({ length: 7 }, (_, i) => shiftIsoDay(avgBaseDay, -i)));
  const avgTotalsByDay = new Map();
  for (const entry of data.entries) {
    const day = getLocalIsoDay(entry.consumedAt);
    if (!avgWindowDays.has(day)) {
      continue;
    }
    const current = avgTotalsByDay.get(day) || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    current.calories += Number(entry.calories || 0);
    current.protein += Number(entry.protein || 0);
    current.carbs += Number(entry.carbs || 0);
    current.fat += Number(entry.fat || 0);
    avgTotalsByDay.set(day, current);
  }

  const daysWithData = avgTotalsByDay.size;
  let avgCalories = 0;
  let avgProtein = 0;
  let avgCarbs = 0;
  let avgFat = 0;
  if (daysWithData > 0) {
    for (const totals of avgTotalsByDay.values()) {
      avgCalories += totals.calories;
      avgProtein += totals.protein;
      avgCarbs += totals.carbs;
      avgFat += totals.fat;
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
    {
      calories: avgCalories,
      protein: avgProtein,
      carbs: avgCarbs,
      fat: avgFat
    },
    data.targets || {}
  );
  setText(
    weeklyAvgNoteEl,
    daysWithData > 0
      ? `Based on ${daysWithData} day${daysWithData === 1 ? '' : 's'} with entries in the last 7 days.`
      : 'No entries in the last 7 days.'
  );

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

  if (state.editingEntryId && !dayItems.some((entry) => entry.id === state.editingEntryId)) {
    state.editingEntryId = null;
  }

  entriesByDayEl.innerHTML = '';
  if (!dayItems.length) {
    entriesByDayEl.textContent = 'No entries for this day.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'table';
  table.innerHTML = compactMobile
    ? '<thead><tr><th>Item</th><th>Qty</th><th>Cal</th><th>P</th><th>C</th><th>F</th><th>Time</th><th>Act</th></tr></thead>'
    : '<thead><tr><th>Item</th><th>Quantity</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Time</th><th>Actions</th></tr></thead>';

  const tbody = document.createElement('tbody');
  for (const item of dayItems) {
    const row = document.createElement('tr');
    row.dataset.entryId = String(item.id);
    row.innerHTML = state.editingEntryId === item.id ? renderEditRow(item) : renderReadOnlyRow(item);
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  entriesByDayEl.appendChild(table);
}

async function refreshDashboard() {
  const [dashboard, saved, me] = await Promise.all([
    api('/api/dashboard'),
    api('/api/saved-items'),
    api('/api/me')
  ]);
  state.savedItems = saved;
  state.historyQuickItems = buildHistoryQuickItems(dashboard.entries);
  state.dashboardData = dashboard;
  renderProfile(me.user || null);
  renderSavedItems();
  renderDashboard(dashboard);
  bindTrendResize();
  bindTrendMacroCards();
  bindMacroTargetCards();
}

parseBtnEl.addEventListener('click', async () => {
  if (state.mealImageLoading) {
    const message = 'Photo is still processing. Please wait a moment and try again.';
    parseNoteEl.textContent = message;
    setActionBanner(message, 'info');
    return;
  }

  parseNoteEl.textContent = 'Parsing meal...';
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
    parseNoteEl.textContent = parsed.notes || 'Meal parsed.';
    setActionBanner(parseNoteEl.textContent, 'success');
  } catch (error) {
    parseNoteEl.textContent = error.message;
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
  const saveChecks = Array.from(parsedItemsContainerEl.querySelectorAll('input[type="checkbox"]'));

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

  const mealTextLower = String(mealTextEl.value || '').toLowerCase();

  const saveItems = saveChecks
    .filter((box) => box.checked)
    .map((box) => {
      const parsedItem = editedItems[Number(box.dataset.index)] || state.parsedMeal.items[Number(box.dataset.index)];

      const rawQuantity = Number(parsedItem.quantity) > 0 ? Number(parsedItem.quantity) : 1;
      const unitRaw = String(parsedItem.unit || 'serving').trim() || 'serving';
      const unitLower = unitRaw.toLowerCase();
      const nameLower = String(parsedItem.itemName || '').toLowerCase();

      let baseQuantity = 1;
      let baseUnit = unitRaw;
      let divisor = rawQuantity;

      const isMlUnit = ['ml', 'milliliter', 'milliliters'].includes(unitLower);
      const isBottleMentioned = /\bbottle(s)?\b/.test(mealTextLower) || /\bbottle(s)?\b/.test(nameLower);
      const isWineLike = /(wine|cabernet|merlot|pinot|chardonnay|sauvignon|riesling|malbec|prosecco|champagne)/.test(nameLower);

      if (isMlUnit && isBottleMentioned) {
        const bottleSizeMl = isWineLike ? 750 : 500;
        const bottleQty = rawQuantity / bottleSizeMl;

        if (bottleQty > 0.1 && bottleQty <= 4) {
          baseQuantity = 1;
          baseUnit = 'bottle';
          divisor = bottleQty;
        }
      } else {
        const tinyBaseUnits = new Set(['ml', 'milliliter', 'milliliters', 'g', 'gram', 'grams']);
        if (tinyBaseUnits.has(unitLower) && rawQuantity >= 50) {
          baseQuantity = rawQuantity;
          baseUnit = unitRaw;
          divisor = 1;
        }
      }

      const perUnit = (value) => Number((Number(value || 0) / (divisor || 1)).toFixed(2));

      return {
        name: parsedItem.itemName,
        quantity: Number(baseQuantity.toFixed(2)),
        unit: baseUnit,
        calories: perUnit(parsedItem.calories),
        protein: perUnit(parsedItem.protein),
        carbs: perUnit(parsedItem.carbs),
        fat: perUnit(parsedItem.fat)
      };
    });

  try {
    await api('/api/entries/bulk', {
      method: 'POST',
      body: JSON.stringify({
        consumedAt,
        items,
        saveItems
      })
    });

    parseNoteEl.textContent = 'Saved parsed items.';
    setActionBanner('Saved parsed items.', 'success');
    mealTextEl.value = '';
    state.parsedMeal = null;
    clearMealImageSelection();
    parsedItemsContainerEl.innerHTML = '';
    saveParsedBtnEl.disabled = true;
    await refreshDashboard();
  } catch (error) {
    parseNoteEl.textContent = error.message;
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
    parseNoteEl.textContent = error.message;
    setActionBanner(error.message, 'error');
  }
});

savedSelectEl.addEventListener('change', () => {
  const selected = getSelectedSavedItem();
  const selectedTemplate = getSelectedQuickTemplate();
  fillQuickEditor(selected || selectedTemplate);
  if (!selected) {
    setQuickEditMode(false);
  }
});

quickEditToggleBtnEl.addEventListener('click', () => {
  const selectedTemplate = getSelectedQuickTemplate();
  if (!selectedTemplate) {
    return;
  }

  const willEdit = !state.quickEditMode;
  setQuickEditMode(willEdit);
  if (willEdit) {
    fillQuickEditor(selectedTemplate);
  }
});

quickDeleteBtnEl.addEventListener('click', async () => {
  const selected = getSelectedSavedItem();
  if (!selected) {
    return;
  }

  const confirmed = window.confirm(`Delete quick add item \"${selected.name}\"?`);
  if (!confirmed) {
    return;
  }

  try {
    await api(`/api/saved-items/${selected.id}`, { method: 'DELETE' });
    setQuickEditMode(false);
    parseNoteEl.textContent = 'Quick add item deleted.';
    setActionBanner('Quick add item deleted.', 'success');
    await refreshDashboard();
  } catch (error) {
    parseNoteEl.textContent = error.message;
    setActionBanner(error.message, 'error');
  }
});

quickSaveBtnEl.addEventListener('click', async () => {
  const selected = getSelectedSavedItem();
  const selectedTemplate = getSelectedQuickTemplate();
  if (!selected) {
    if (!selectedTemplate) {
      return;
    }
  }

  const payload = {
    name: quickEditNameEl.value.trim(),
    quantity: Number(quickEditQuantityEl.value || 1),
    unit: quickEditUnitEl.value.trim() || 'serving',
    calories: Number(quickEditCaloriesEl.value || 0),
    protein: Number(quickEditProteinEl.value || 0),
    carbs: Number(quickEditCarbsEl.value || 0),
    fat: Number(quickEditFatEl.value || 0)
  };

  try {
    if (selected) {
      await api(`/api/saved-items/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      parseNoteEl.textContent = 'Quick add item updated.';
      setActionBanner('Quick add item updated.', 'success');
    } else {
      await api('/api/saved-items', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      parseNoteEl.textContent = 'Quick add item saved.';
      setActionBanner('Quick add item saved.', 'success');
    }

    setQuickEditMode(false);
    await refreshDashboard();
  } catch (error) {
    parseNoteEl.textContent = error.message;
    setActionBanner(error.message, 'error');
  }
});

entriesByDayEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  const entryId = Number(target.dataset.id);

  if (!action || !entryId) {
    return;
  }

  if (action === 'edit') {
    state.editingEntryId = entryId;
    await refreshDashboard();
    return;
  }

  if (action === 'cancel') {
    state.editingEntryId = null;
    await refreshDashboard();
    return;
  }

  if (action === 'delete') {
    const confirmed = window.confirm('Delete this log entry?');
    if (!confirmed) {
      return;
    }

    try {
      await api(`/api/entries/${entryId}`, { method: 'DELETE' });
      state.editingEntryId = null;
      parseNoteEl.textContent = 'Entry deleted.';
      setActionBanner('Entry deleted.', 'success');
      await refreshDashboard();
    } catch (error) {
      parseNoteEl.textContent = error.message;
    setActionBanner(error.message, 'error');
    }
    return;
  }

  if (action === 'save') {
    const row = target.closest('tr[data-entry-id]');
    if (!row) {
      return;
    }

    const payload = {
      itemName: row.querySelector('[data-field="itemName"]')?.value || '',
      quantity: Number(row.querySelector('[data-field="quantity"]')?.value || 0),
      unit: row.querySelector('[data-field="unit"]')?.value || 'serving',
      calories: Number(row.querySelector('[data-field="calories"]')?.value || 0),
      protein: Number(row.querySelector('[data-field="protein"]')?.value || 0),
      carbs: Number(row.querySelector('[data-field="carbs"]')?.value || 0),
      fat: Number(row.querySelector('[data-field="fat"]')?.value || 0),
      consumedAt: asIso(row.querySelector('[data-field="consumedAt"]')?.value)
    };

    try {
      await api(`/api/entries/${entryId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      state.editingEntryId = null;
      parseNoteEl.textContent = 'Entry updated.';
      setActionBanner('Entry updated.', 'success');
      await refreshDashboard();
    } catch (error) {
      parseNoteEl.textContent = error.message;
    setActionBanner(error.message, 'error');
    }
  }
});

entriesByDayEl.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (target.dataset.field !== 'quantity') {
    return;
  }

  const row = target.closest('tr[data-entry-id]');
  if (!row) {
    return;
  }
  syncEditMacrosWithQuantity(row, target);
});



function setBrandMenuOpen(isOpen) {
  if (!brandMenuPopoverEl || !brandMenuBtnEl) {
    return;
  }
  const open = Boolean(isOpen);
  brandMenuPopoverEl.hidden = !open;
  brandMenuBtnEl.setAttribute('aria-expanded', String(open));
}

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
    ctx.fillStyle = '#6e819e';
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
  const values = rows.map((row) => Number(row[valueKey] || 0));
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values);
  const yMin = baseline === 'range' ? minValue : 0;
  const yMax = baseline === 'range' ? maxValue : maxValue;
  const hasFlatRange = baseline === 'range' && Math.abs(yMax - yMin) < 0.0001;
  const ySpan = hasFlatRange ? 1 : Math.max(yMax - yMin, 1);

  if (showYAxis) {
    ctx.save();
    ctx.strokeStyle = 'rgba(53, 81, 114, 0.22)';
    ctx.fillStyle = 'rgba(40, 63, 92, 0.9)';
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

    ctx.strokeStyle = 'rgba(53, 81, 114, 0.45)';
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = '#d7e2f2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();
  }

  ctx.strokeStyle = '#0f5fce';
  ctx.lineWidth = 2;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = pad.left + (index / Math.max(rows.length - 1, 1)) * plotW;
    const value = Number(row[valueKey] || 0);
    const y = hasFlatRange
      ? pad.top + plotH / 2
      : pad.top + plotH - ((value - yMin) / ySpan) * plotH;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  if (showTrendLine && rows.length >= 2) {
    if (trendLineMode === 'average') {
      const average = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0) / rows.length;
      const avgY = hasFlatRange
        ? pad.top + plotH / 2
        : pad.top + plotH - ((average - yMin) / ySpan) * plotH;

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(pad.left, avgY);
      ctx.lineTo(pad.left + plotW, avgY);
      ctx.strokeStyle = 'rgba(10, 138, 102, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
      if (averageValueEl) {
        averageValueEl.textContent = fmtNumber(average);
      } else {
        ctx.fillStyle = 'rgba(10, 138, 102, 0.95)';
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Avg ${fmtNumber(average)}`, width - pad.right, Math.max(12, avgY - 3));
      }
      ctx.restore();
      return;
    }

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
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(pad.left, startY);
      ctx.lineTo(pad.left + plotW, endY);
      ctx.strokeStyle = 'rgba(231, 122, 49, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  if (averageValueEl) {
    averageValueEl.textContent = 'none';
  }

  if (showXAxisLabels) {
    ctx.fillStyle = '#6e819e';
    ctx.font = '11px sans-serif';
    ctx.fillText(String(rows[0][labelKey] || ''), pad.left, height - 6);
    ctx.textAlign = 'right';
    ctx.fillText(String(rows[rows.length - 1][labelKey] || ''), width - pad.right, height - 6);
    ctx.textAlign = 'left';
  }
}

function renderWeightChart() {
  drawSimpleLineChart(weightCanvasEl, state.weightChartRows, 'label', 'value', {
    baseline: 'range',
    showYAxis: true,
    showXAxisLabels: false,
    yTickCount: 4,
    showTrendLine: true,
    trendLineMode: 'average',
    averageValueEl: weightAverageValueEl
  });
}

function renderWorkoutChart() {
  drawSimpleLineChart(workoutCanvasEl, state.workoutChartRows, 'label', 'value');
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
      }
    }, 80);
  });

  pageChartsResizeBound = true;
}

function renderWeightReadOnlyRow(entry) {
  return `
    <td data-label="Date/Time">${new Date(entry.loggedAt).toLocaleString()}</td>
    <td data-label="Weight">${fmtNumber(entry.weight)}</td>
    <td data-label="Actions">
      <div class="action-row">
        <button type="button" class="btn-warning table-action-btn" data-weight-action="edit" data-weight-id="${entry.id}">Edit</button>
      </div>
    </td>
  `;
}

function renderWeightEditRow(entry) {
  const loggedAtValue = isoToLocalInputValue(entry.loggedAt);
  return `
    <td data-label="Edit" colspan="3">
      <table class="edit-vertical-table">
        <tbody>
          <tr><th>Logged At</th><td><input type="datetime-local" data-weight-field="loggedAt" value="${loggedAtValue}" /></td></tr>
          <tr><th>Weight</th><td><input type="number" step="0.1" min="0" data-weight-field="weight" value="${entry.weight}" /></td></tr>
          <tr>
            <th>Actions</th>
            <td>
              <div class="edit-vertical-actions">
                <button type="button" class="btn-success table-action-btn" data-weight-action="save" data-weight-id="${entry.id}">Save</button>
                <button type="button" class="btn-warning table-action-btn" data-weight-action="cancel" data-weight-id="${entry.id}">Cancel</button>
                <button type="button" class="btn-danger table-action-btn" data-weight-action="delete" data-weight-id="${entry.id}">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </td>
  `;
}

function renderWorkoutReadOnlyRow(entry) {
  const loggedAt = new Date(entry.loggedAt);
  const dateText = loggedAt.toLocaleDateString();
  const intensity = normalizeWorkoutIntensity(entry.intensity);
  return `
    <td data-label="Dt">${dateText}</td>
    <td data-label="Desc">${entry.description}</td>
    <td data-label="Int">${intensity}</td>
    <td data-label="Dur">${fmtNumber(entry.durationHours)} hr</td>
    <td data-label="Cal">${fmtNumber(entry.caloriesBurned)}</td>
    <td data-label="Act">
      <div class="action-row">
        <button type="button" class="btn-warning table-action-btn" data-workout-action="edit" data-workout-id="${entry.id}">Edit</button>
      </div>
    </td>
  `;
}

function renderWorkoutEditRow(entry) {
  const loggedAtDate = new Date(entry.loggedAt).toISOString().slice(0, 10);
  const intensity = normalizeWorkoutIntensity(entry.intensity);
  return `
    <td data-label="Edit" colspan="6">
      <table class="edit-vertical-table">
        <tbody>
          <tr><th>Date</th><td><input type="date" data-workout-field="loggedAtDate" value="${loggedAtDate}" /></td></tr>
          <tr><th>Description</th><td><input data-workout-field="description" value="${entry.description}" /></td></tr>
          <tr>
            <th>Intensity</th>
            <td>
              <select data-workout-field="intensity">
                <option value="low" ${intensity === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${intensity === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="high" ${intensity === 'high' ? 'selected' : ''}>High</option>
              </select>
            </td>
          </tr>
          <tr><th>Hours</th><td><input type="number" step="0.25" min="0" data-workout-field="durationHours" value="${entry.durationHours}" data-base-duration-hours="${entry.durationHours}" data-base-calories-burned="${entry.caloriesBurned}" /></td></tr>
          <tr><th>Calories</th><td><input type="number" step="1" min="0" data-workout-field="caloriesBurned" value="${entry.caloriesBurned}" /></td></tr>
          <tr>
            <th>Actions</th>
            <td>
              <div class="edit-vertical-actions">
                <button type="button" class="btn-success table-action-btn" data-workout-action="save" data-workout-id="${entry.id}">Save</button>
                <button type="button" class="btn-warning table-action-btn" data-workout-action="cancel" data-workout-id="${entry.id}">Cancel</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </td>
  `;
}

function syncWorkoutCaloriesWithDuration(row, durationInput) {
  if (!row || !durationInput) {
    return;
  }

  const nextDuration = Number(durationInput.value || 0);
  const baseDuration = Number(durationInput.dataset.baseDurationHours || 0);
  const baseCalories = Number(durationInput.dataset.baseCaloriesBurned || 0);
  if (!Number.isFinite(nextDuration) || nextDuration < 0) {
    return;
  }
  if (!Number.isFinite(baseDuration) || baseDuration <= 0 || !Number.isFinite(baseCalories) || baseCalories < 0) {
    return;
  }

  const factor = nextDuration / baseDuration;
  const caloriesInput = row.querySelector('[data-workout-field="caloriesBurned"]');
  if (!(caloriesInput instanceof HTMLInputElement)) {
    return;
  }
  caloriesInput.value = String(Math.round(baseCalories * factor));
}

async function refreshWeightData() {
  if (!weightLogListEl) {
    return;
  }
  try {
    const response = await api('/api/weights?scope=week');
    const entries = Array.isArray(response.entries) ? response.entries : [];

    if (!entries.length) {
      weightLogListEl.innerHTML = '<p class="empty-note">No weight entries yet.</p>';
    } else {
      weightLogListEl.innerHTML = `
        <table class="table" aria-label="Past week logged weight entries">
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Weight</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((entry) => {
              const rowHtml = state.weightEditingEntryId === entry.id
                ? renderWeightEditRow(entry)
                : renderWeightReadOnlyRow(entry);
              return `<tr data-weight-row-id="${entry.id}">${rowHtml}</tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    const sorted = entries.slice().reverse().map((entry) => ({
      label: new Date(entry.loggedAt).toLocaleDateString(),
      value: Number(entry.weight || 0)
    }));
    state.weightChartRows = sorted;
    renderWeightChart();
  } catch (error) {
    weightNoteEl.textContent = error.message;
  }
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
    const data = await api('/api/workouts');
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const dailyCalories = Array.isArray(data.dailyCalories) ? data.dailyCalories : [];

    workoutLogListEl.innerHTML = entries.length
      ? `
        <table class="table" aria-label="Logged workout entries">
          <thead>
            <tr>
              <th>Dt</th>
              <th>Desc</th>
              <th>Int</th>
              <th>Dur</th>
              <th>Cal</th>
              <th>Act</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((entry) => {
              const rowHtml = state.workoutEditingEntryId === entry.id
                ? renderWorkoutEditRow(entry)
                : renderWorkoutReadOnlyRow(entry);
              return `<tr data-workout-row-id="${entry.id}">${rowHtml}</tr>`;
            }).join('')}
          </tbody>
        </table>
      `
      : '<p class="empty-note">No workouts logged yet.</p>';

    renderWorkoutQuickAdds(entries);
    const chartRows = dailyCalories.map((row) => ({ label: row.day, value: row.calories }));
    state.workoutChartRows = chartRows;
    renderWorkoutChart();
  } catch (error) {
    setActionBanner(error.message, 'error');
  }
}

if (brandMenuBtnEl) {
  brandMenuBtnEl.addEventListener('click', (event) => {
    event.stopPropagation();
    setBrandMenuOpen(brandMenuPopoverEl.hidden);
  });
}

for (const item of pageMenuItems) {
  item.addEventListener('click', async () => {
    const page = item.dataset.page;
    if (!page) {
      return;
    }
    renderActivePage(page);
    setBrandMenuOpen(false);
    if (page === 'weight') {
      await refreshWeightData();
    }
    if (page === 'workout') {
      await refreshWorkoutData();
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
      state.weightEditingEntryId = null;
      weightNoteEl.textContent = 'Weight saved.';
      if (weightValueEl) {
        weightValueEl.value = '';
      }
      setActionBanner('Weight saved.', 'success');
      await refreshWeightData();
    } catch (error) {
      weightNoteEl.textContent = error.message;
      setActionBanner(error.message, 'error');
    }
  });
}

if (weightLogListEl) {
  weightLogListEl.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.weightAction;
    const entryId = Number(target.dataset.weightId);
    if (!action || !entryId) {
      return;
    }

    if (action === 'edit') {
      state.weightEditingEntryId = entryId;
      await refreshWeightData();
      return;
    }

    if (action === 'cancel') {
      state.weightEditingEntryId = null;
      await refreshWeightData();
      return;
    }

    if (action === 'delete') {
      const confirmed = window.confirm('Delete this weight entry?');
      if (!confirmed) {
        return;
      }

      try {
        await deleteWeightEntryApi(entryId);
        state.weightEditingEntryId = null;
        weightNoteEl.textContent = 'Weight entry deleted.';
        setActionBanner('Weight entry deleted.', 'success');
        await refreshWeightData();
      } catch (error) {
        weightNoteEl.textContent = error.message;
        setActionBanner(error.message, 'error');
      }
      return;
    }

    if (action === 'save') {
      const row = target.closest('tr[data-weight-row-id]');
      if (!row) {
        return;
      }

      const payload = {
        weight: parseWeightInputValue(row.querySelector('[data-weight-field="weight"]')?.value),
        loggedAt: asIso(row.querySelector('[data-weight-field="loggedAt"]')?.value || toDateTimeLocalValue())
      };

      try {
        await api(`/api/weights/${entryId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        state.weightEditingEntryId = null;
        weightNoteEl.textContent = 'Weight entry updated.';
        setActionBanner('Weight entry updated.', 'success');
        await refreshWeightData();
      } catch (error) {
        weightNoteEl.textContent = error.message;
        setActionBanner(error.message, 'error');
      }
    }
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
      state.workoutEditingEntryId = null;
      setActionBanner('Workout logged.', 'success');
      await refreshWorkoutData();
    } catch (error) {
      setActionBanner(error.message, 'error');
    }
  });
}

if (workoutLogListEl) {
  workoutLogListEl.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.dataset.workoutField !== 'durationHours') {
      return;
    }

    const row = target.closest('tr[data-workout-row-id]');
    if (!row) {
      return;
    }
    syncWorkoutCaloriesWithDuration(row, target);
  });

  workoutLogListEl.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.workoutAction;
    const entryId = Number(target.dataset.workoutId);
    if (!action || !entryId) {
      return;
    }

    if (action === 'edit') {
      state.workoutEditingEntryId = entryId;
      await refreshWorkoutData();
      return;
    }

    if (action === 'cancel') {
      state.workoutEditingEntryId = null;
      await refreshWorkoutData();
      return;
    }

    if (action === 'save') {
      const row = target.closest('tr[data-workout-row-id]');
      if (!row) {
        return;
      }

      const loggedAtDate = String(row.querySelector('[data-workout-field="loggedAtDate"]')?.value || '').trim();
      const description = String(row.querySelector('[data-workout-field="description"]')?.value || '').trim();
      const intensity = normalizeWorkoutIntensity(row.querySelector('[data-workout-field="intensity"]')?.value);
      const durationHours = Number(row.querySelector('[data-workout-field="durationHours"]')?.value || 0);
      const caloriesBurned = Number(row.querySelector('[data-workout-field="caloriesBurned"]')?.value || 0);
      const loggedAt = loggedAtDate ? new Date(`${loggedAtDate}T09:00:00`).toISOString() : new Date().toISOString();

      try {
        await updateWorkoutEntryApi(entryId, {
          description,
          intensity,
          durationHours,
          caloriesBurned,
          loggedAt
        });
        state.workoutEditingEntryId = null;
        setActionBanner('Workout updated.', 'success');
        await refreshWorkoutData();
      } catch (error) {
        setActionBanner(error.message, 'error');
      }
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
  parseNoteEl.textContent = error.message;
    setActionBanner(error.message, 'error');
});

if (profileChipEl) {
  profileChipEl.addEventListener('click', (event) => {
    event.stopPropagation();
    setProfileMenuOpen(profilePopoverEl.hidden);
  });
}

document.addEventListener('click', (event) => {
  if (brandMenuPopoverEl && !brandMenuPopoverEl.hidden && !brandMenuPopoverEl.contains(event.target) && !brandMenuBtnEl?.contains(event.target)) {
    setBrandMenuOpen(false);
  }

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
