const adminState = {
  accounts: [],
  pagination: {
    limit: 20,
    offset: 0,
    total: 0,
    returned: 0,
    hasMore: false
  },
  search: '',
  currentUser: null,
  loading: false
};

const adminBannerEl = document.getElementById('admin-banner');
const adminUserChipEl = document.getElementById('admin-user-chip');
const adminResultSummaryEl = document.getElementById('admin-result-summary');
const adminSearchFormEl = document.getElementById('admin-search-form');
const adminSearchEl = document.getElementById('admin-account-search');
const adminAccountListEl = document.getElementById('admin-account-list');
const adminPrevPageEl = document.getElementById('admin-prev-page');
const adminNextPageEl = document.getElementById('admin-next-page');
const adminPageLabelEl = document.getElementById('admin-page-label');

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

function setAdminBanner(message, type = 'info') {
  if (!adminBannerEl) {
    return;
  }
  adminBannerEl.textContent = message;
  adminBannerEl.dataset.type = type;
  adminBannerEl.hidden = !message;
}

async function adminApi(path, options = {}) {
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
    const requestId = body.requestId || res.headers.get('x-request-id') || '';
    const message = body.error || `Request failed (${res.status})`;
    throw new Error(message + (requestId ? ` Reference: ${requestId}` : ''));
  }
  return body;
}

function formatDateTime(isoString) {
  if (!isoString) {
    return 'Never';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function latestIso(values) {
  let latest = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    if (!latest || date > latest) {
      latest = date;
    }
  }
  return latest ? latest.toISOString() : null;
}

function accountStats(account) {
  return [
    ['Last login', formatDateTime(account.lastLoginAt)],
    ['Tutorial reset', formatDateTime(account.setupTutorialResetAt)],
    ['Logins', formatCount(account.loginCount)],
    ['Items', formatCount(account.itemCount)],
    ['Saved items', formatCount(account.savedItemCount)],
    ['Workouts', formatCount(account.workoutEntryCount)],
    ['Weigh-ins', formatCount(account.weightEntryCount)],
    ['Sleep logs', formatCount(account.sleepEntryCount)],
    ['Sexual logs', formatCount(account.sexualActivityEntryCount)],
    ['Reports', formatCount(account.analysisReportCount)],
    ['API tokens', formatCount(account.apiTokenCount)],
    ['AI usage 7d', formatCount(account.dailyUsageCount7d)],
    ['Latest activity', formatDateTime(latestIso([
      account.lastItemAt,
      account.lastWorkoutAt,
      account.lastWeightAt,
      account.lastSleepAt,
      account.lastSexualActivityAt,
      account.lastApiTokenUsedAt,
      account.lastAuditAt
    ]))]
  ];
}

function renderStat(label, value) {
  return `
    <div class="admin-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderAccount(account) {
  const displayName = account.name || account.email || account.id;
  const email = account.email || 'No email';
  const disabled = Boolean(account.isDisabled);
  const sexualEnabled = Boolean(account.sexualActivityEnabled);
  const isCurrentUser = account.id === adminState.currentUser?.id;
  const stats = accountStats(account).map(([label, value]) => renderStat(label, value)).join('');

  return `
    <article class="admin-account-row" data-account-id="${escapeAttr(account.id)}">
      <div class="admin-account-main">
        <div class="admin-account-identity">
          <div class="admin-account-title-row">
            <h2>${escapeHtml(displayName)}</h2>
            <span class="admin-status-pill ${disabled ? 'is-danger' : 'is-success'}">${disabled ? 'Disabled' : 'Active'}</span>
            <span class="admin-status-pill ${sexualEnabled ? 'is-info' : 'is-muted'}">${sexualEnabled ? 'Sexual view on' : 'Sexual view off'}</span>
          </div>
          <p>${escapeHtml(email)}</p>
          <small>${escapeHtml(account.id)}</small>
        </div>
        <div class="admin-account-plan">
          <span>${escapeHtml(account.plan || 'free')}</span>
          <small>${escapeHtml(account.subscriptionStatus || 'active')}</small>
        </div>
      </div>

      <div class="admin-stat-grid">
        ${stats}
      </div>

      <div class="admin-account-controls" aria-label="Account controls">
        <label class="admin-switch ${isCurrentUser ? 'is-disabled' : ''}">
          <input
            type="checkbox"
            data-admin-control="isDisabled"
            ${disabled ? 'checked' : ''}
            ${isCurrentUser ? 'disabled' : ''}
          />
          <span>Disable account</span>
        </label>
        <label class="admin-switch">
          <input
            type="checkbox"
            data-admin-control="sexualActivityEnabled"
            ${sexualEnabled ? 'checked' : ''}
          />
          <span>Sexual activity view</span>
        </label>
        <button
          type="button"
          class="btn-secondary admin-reset-tutorial-btn"
          data-admin-action="resetSetupTutorial"
        >Reset setup tutorial</button>
      </div>
    </article>
  `;
}

function renderAccounts() {
  const pagination = adminState.pagination;
  const page = Math.floor(pagination.offset / pagination.limit) + 1;
  const start = pagination.total === 0 ? 0 : pagination.offset + 1;
  const end = Math.min(pagination.offset + pagination.returned, pagination.total);

  if (adminResultSummaryEl) {
    adminResultSummaryEl.textContent = adminState.loading
      ? 'Loading accounts...'
      : `${start}-${end} of ${formatCount(pagination.total)} accounts`;
  }
  if (adminPageLabelEl) {
    adminPageLabelEl.textContent = `Page ${page}`;
  }
  if (adminPrevPageEl) {
    adminPrevPageEl.disabled = adminState.loading || pagination.offset <= 0;
  }
  if (adminNextPageEl) {
    adminNextPageEl.disabled = adminState.loading || !pagination.hasMore;
  }
  if (!adminAccountListEl) {
    return;
  }
  if (adminState.loading) {
    adminAccountListEl.innerHTML = '<p class="empty-note">Loading accounts...</p>';
    return;
  }
  if (!adminState.accounts.length) {
    adminAccountListEl.innerHTML = '<p class="empty-note">No accounts match that search.</p>';
    return;
  }
  adminAccountListEl.innerHTML = adminState.accounts.map(renderAccount).join('');
}

async function loadCurrentUser() {
  const me = await adminApi('/api/me');
  adminState.currentUser = me.user || null;
  if (adminUserChipEl) {
    adminUserChipEl.textContent = adminState.currentUser?.email || adminState.currentUser?.name || 'Admin';
  }
}

async function loadAccounts() {
  adminState.loading = true;
  setAdminBanner('');
  renderAccounts();

  try {
    const params = new URLSearchParams({
      limit: String(adminState.pagination.limit),
      offset: String(adminState.pagination.offset)
    });
    if (adminState.search) {
      params.set('search', adminState.search);
    }
    const data = await adminApi(`/api/admin/accounts?${params.toString()}`);
    adminState.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    adminState.pagination = {
      ...adminState.pagination,
      ...(data.pagination || {})
    };
  } catch (error) {
    setAdminBanner(error.message, 'error');
    adminState.accounts = [];
    adminState.pagination = {
      ...adminState.pagination,
      total: 0,
      returned: 0,
      hasMore: false
    };
  } finally {
    adminState.loading = false;
    renderAccounts();
  }
}

async function updateAccountControl(accountId, field, value, inputEl) {
  inputEl.disabled = true;
  try {
    await adminApi(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: value })
    });
    setAdminBanner('Account updated.', 'success');
    await loadAccounts();
  } catch (error) {
    inputEl.checked = !value;
    inputEl.disabled = false;
    setAdminBanner(error.message, 'error');
  }
}

async function resetSetupTutorial(accountId, buttonEl) {
  buttonEl.disabled = true;
  try {
    await adminApi(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ resetSetupTutorial: true })
    });
    setAdminBanner('Setup tutorial reset for that user.', 'success');
    await loadAccounts();
  } catch (error) {
    buttonEl.disabled = false;
    setAdminBanner(error.message, 'error');
  }
}

if (adminSearchFormEl) {
  adminSearchFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    adminState.search = String(adminSearchEl?.value || '').trim();
    adminState.pagination.offset = 0;
    await loadAccounts();
  });
}

let searchTimer = null;
if (adminSearchEl) {
  adminSearchEl.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      adminState.search = String(adminSearchEl.value || '').trim();
      adminState.pagination.offset = 0;
      await loadAccounts();
    }, 250);
  });
}

if (adminPrevPageEl) {
  adminPrevPageEl.addEventListener('click', async () => {
    adminState.pagination.offset = Math.max(0, adminState.pagination.offset - adminState.pagination.limit);
    await loadAccounts();
  });
}

if (adminNextPageEl) {
  adminNextPageEl.addEventListener('click', async () => {
    if (!adminState.pagination.hasMore) {
      return;
    }
    adminState.pagination.offset += adminState.pagination.limit;
    await loadAccounts();
  });
}

if (adminAccountListEl) {
  adminAccountListEl.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const field = input.dataset.adminControl;
    const accountRow = input.closest('[data-account-id]');
    const accountId = accountRow?.dataset.accountId;
    if (!field || !accountId) {
      return;
    }
    await updateAccountControl(accountId, field, input.checked, input);
  });

  adminAccountListEl.addEventListener('click', async (event) => {
    const button = event.target instanceof HTMLElement
      ? event.target.closest('[data-admin-action="resetSetupTutorial"]')
      : null;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const accountRow = button.closest('[data-account-id]');
    const accountId = accountRow?.dataset.accountId;
    if (!accountId) {
      return;
    }
    await resetSetupTutorial(accountId, button);
  });
}

(async function initAdminPage() {
  try {
    await loadCurrentUser();
    await loadAccounts();
  } catch (error) {
    setAdminBanner(error.message, 'error');
  }
})();
