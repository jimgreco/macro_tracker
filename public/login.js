const params = new URLSearchParams(window.location.search);
const errorEl = document.getElementById('error');
const versionEl = document.getElementById('login-version');
const googleLoginBtnEl = document.getElementById('google-login-btn');
const appleLoginBtnEl = document.getElementById('apple-login-btn');
const BUILD_HASH_DIGITS = 7;

function formatBuildLabel(build) {
  const value = String(build || '').trim();
  if (/^[0-9a-f]{8,40}$/i.test(value)) {
    return value.slice(-BUILD_HASH_DIGITS);
  }
  return value;
}

if (params.get('error') && errorEl) {
  errorEl.hidden = false;
}

if (googleLoginBtnEl) {
  googleLoginBtnEl.addEventListener('click', () => {
    window.location.href = '/auth/google';
  });
}

if (appleLoginBtnEl) {
  appleLoginBtnEl.addEventListener('click', () => {
    window.location.href = '/auth/apple';
  });
}

(async () => {
  try {
    const res = await fetch('/version', { cache: 'no-store' });
    if (!res.ok || !versionEl) {
      return;
    }

    const data = await res.json();
    const build = formatBuildLabel(data.appBuild);
    const startedAt = String(data.startedAt || '').trim();
    if (!build && !startedAt) {
      return;
    }

    let text = '';
    if (build) {
      text += `Build ${build}`;
    }

    if (startedAt) {
      const ts = new Date(startedAt);
      if (!Number.isNaN(ts.getTime())) {
        text += (text ? ' • ' : '') + ts.toLocaleString();
      }
    }

    if (!text) {
      return;
    }

    versionEl.textContent = text;
    versionEl.hidden = false;
  } catch (_error) {
    // Keep login UI clean if version fetch fails.
  }
})();
