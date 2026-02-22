const state = {
  parsedMeal: null,
  savedItems: [],
  historyQuickItems: [],
  editingEntryId: null,
  quickEditMode: false,
  mealImageDataUrl: '',
  mealImageName: '',
  mealImageLoading: false,
  selectedEntriesDay: '',
  dashboardData: null,
  selectedTrendMacro: 'calories'
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
const quickFavoritesEl = document.getElementById('quick-favorites');
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
const avgCaloriesEl = document.getElementById('avg-calories');
const avgProteinEl = document.getElementById('avg-protein');
const avgCarbsEl = document.getElementById('avg-carbs');
const avgFatEl = document.getElementById('avg-fat');
const weeklyAvgNoteEl = document.getElementById('weekly-avg-note');
const trendMacroCards = Array.from(document.querySelectorAll('.trend-macro-card'));
const trendCanvasEl = document.getElementById('trend-canvas');
const trendTooltipEl = document.getElementById('trend-tooltip');
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
const mobileNavButtons = Array.from(document.querySelectorAll('.mobile-nav-btn'));
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

function getTrendMacroConfig(macro = state.selectedTrendMacro) {
  const configs = {
    calories: { label: 'Calories', unit: 'kcal' },
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read selected image.'));
    reader.readAsDataURL(file);
  });
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
    state.mealImageDataUrl = dataUrl;
    state.mealImageName = file.name || sourceLabel + ' image';
    renderMealImagePreview();
    setActionBanner(sourceLabel + ' selected: ' + state.mealImageName + '. You can add an optional description.', 'info');
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
      mealPhotoPreviewImageEl.src = state.mealImageDataUrl;
    }
  } else {
    if (mealPhotoPreviewImageEl) {
      mealPhotoPreviewImageEl.removeAttribute('src');
    }
  }
  applyMealInputMode();
}

function clearMealImageSelection() {
  state.mealImageDataUrl = '';
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

function setActiveMobileNav(targetId) {
  for (const btn of mobileNavButtons) {
    btn.classList.toggle('is-active', btn.dataset.navTarget === targetId);
  }
}

function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setActiveMobileNav(sectionId);
}

for (const btn of mobileNavButtons) {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.navTarget;
    if (!targetId) {
      return;
    }
    scrollToSection(targetId);
  });
}

setActiveMobileNav('log-section');

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
  return `${fmtNumber(item.calories)} kcal | P ${fmtNumber(item.protein)}g | C ${fmtNumber(item.carbs)}g | F ${fmtNumber(item.fat)}g`;
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
  return `${compactName} (${fmtNumber(item.calories)}kcal/${fmtNumber(item.protein)}P/${fmtNumber(item.carbs)}C/${fmtNumber(item.fat)}F)`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Request failed');
  }
  return body;
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
    return state.historyQuickItems.find((item) => item.key === raw) || null;
  }
  return null;
}

function setQuickEditMode(isEditing) {
  state.quickEditMode = isEditing;
  quickEditorEl.hidden = !isEditing;
  quickEditToggleBtnEl.textContent = isEditing ? 'Cancel' : 'Edit';
  quickSaveBtnEl.classList.toggle('is-visible', Boolean(isEditing));
  quickDeleteBtnEl.classList.toggle('is-visible', Boolean(isEditing));
}

function getTopQuickFavorites() {
  const historyByName = new Map();
  for (const item of state.historyQuickItems) {
    historyByName.set(String(item.name || '').toLowerCase(), item);
  }

  const merged = [];
  const seenNames = new Set();

  for (const item of state.savedItems) {
    const nameKey = String(item.name || '').toLowerCase();
    const history = historyByName.get(nameKey);
    merged.push({
      type: 'saved',
      key: 'saved:' + item.id,
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity || 0),
      unit: item.unit || 'serving',
      calories: Number(item.calories || 0),
      protein: Number(item.protein || 0),
      carbs: Number(item.carbs || 0),
      fat: Number(item.fat || 0),
      usageCount: Number(item.usageCount || 0),
      count: Math.max(Number(item.usageCount || 0), Number(history?.count || 0)),
      lastUsedAt: history?.lastUsedAt || ''
    });
    seenNames.add(nameKey);
  }

  for (const item of state.historyQuickItems) {
    const nameKey = String(item.name || '').toLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }
    merged.push(item);
  }

  return merged
    .sort((a, b) => {
      const usageDiff = Number(b.count || 0) - Number(a.count || 0);
      if (usageDiff !== 0) {
        return usageDiff;
      }
      const lastDiff = new Date(b.lastUsedAt || 0).getTime() - new Date(a.lastUsedAt || 0).getTime();
      if (lastDiff !== 0) {
        return lastDiff;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, 10);
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

function renderQuickFavorites() {
  if (!quickFavoritesEl) {
    return;
  }

  quickFavoritesEl.innerHTML = '';
  const favorites = getTopQuickFavorites();

  if (!favorites.length) {
    quickFavoritesEl.hidden = true;
    return;
  }

  quickFavoritesEl.hidden = false;

  for (const item of favorites) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-favorite-btn';
    btn.dataset.quickKey = String(item.key);
    btn.textContent = item.name;
    quickFavoritesEl.appendChild(btn);
  }
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
    if (quickFavoritesEl) {
      quickFavoritesEl.innerHTML = '';
      quickFavoritesEl.hidden = true;
    }
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
  quickEditToggleBtnEl.disabled = !selected;
  quickSaveBtnEl.disabled = !selected;
  quickSaveBtnEl.classList.toggle('is-visible', Boolean(selected && state.quickEditMode));
  quickDeleteBtnEl.disabled = !selected;
  quickDeleteBtnEl.classList.toggle('is-visible', Boolean(selected && state.quickEditMode));

  if (!selected) {
    setQuickEditMode(false);
  }

  fillQuickEditor(selected || selectedTemplate);
  renderQuickFavorites();
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
          <tr><th>Quantity</th><td><input type="number" step="0.1" data-field="quantity" value="${entry.quantity}" /></td></tr>
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
  if (isCompactMobileView()) {
    return renderEditRowMobile(entry);
  }

  const consumedAtValue = isoToLocalInputValue(entry.consumedAt);
  return `
    <td data-label="Item"><input data-field="itemName" value="${entry.itemName}" /></td>
    <td data-label="Qty/Unit">
      <div class="edit-grid">
        <input type="number" step="0.1" data-field="quantity" value="${entry.quantity}" />
        <input data-field="unit" value="${entry.unit || ''}" />
      </div>
    </td>
    <td data-label="Calories"><input type="number" step="0.1" data-field="calories" value="${entry.calories}" /></td>
    <td data-label="Protein"><input type="number" step="0.1" data-field="protein" value="${entry.protein}" /></td>
    <td data-label="Carbs"><input type="number" step="0.1" data-field="carbs" value="${entry.carbs}" /></td>
    <td data-label="Fat"><input type="number" step="0.1" data-field="fat" value="${entry.fat}" /></td>
    <td data-label="Time"><input type="datetime-local" data-field="consumedAt" value="${consumedAtValue}" /></td>
    <td data-label="Actions">
      <div class="action-row">
        <button type="button" class="btn-success table-action-btn" data-action="save" data-id="${entry.id}">Save</button>
        <button type="button" class="btn-warning table-action-btn" data-action="cancel" data-id="${entry.id}">Cancel</button>
        <button type="button" class="btn-danger table-action-btn" data-action="delete" data-id="${entry.id}">Delete</button>
      </div>
    </td>
  `;
}

function drawTrend(entries, baseIsoDay = shiftIsoDay(getLocalIsoDay(), -1)) {
  if (!trendCanvasEl) {
    return;
  }
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
    points.push({ day, value: map.get(day) || 0 });
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const range = Math.max(max - min, 1);

  const padX = 18;
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
  const selected = getSelectedSavedItem();
  if (!selected) {
    return;
  }

  const willEdit = !state.quickEditMode;
  setQuickEditMode(willEdit);
  if (willEdit) {
    fillQuickEditor(selected);
  }
});

quickFavoritesEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const quickKey = String(target.dataset.quickKey || '');
  if (!quickKey) {
    return;
  }
  const template =
    (quickKey.startsWith('saved:') && getTopQuickFavorites().find((item) => item.key === quickKey)) ||
    state.historyQuickItems.find((item) => item.key === quickKey);
  if (!template) {
    return;
  }

  try {
    if (template.type === 'saved') {
      await quickAddById(template.id);
    } else {
      await quickAddByTemplate(template);
    }
    setActionBanner('Quick add logged.', 'success');
    await refreshDashboard();
  } catch (error) {
    setActionBanner(error.message, 'error');
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
  if (!selected) {
    return;
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
    await api(`/api/saved-items/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    parseNoteEl.textContent = 'Quick add item updated.';
    setActionBanner('Quick add item updated.', 'success');
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
    const row = target.closest('tr');
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
  if (!profileMenuEl || profilePopoverEl.hidden) {
    return;
  }

  if (!profileMenuEl.contains(event.target)) {
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
