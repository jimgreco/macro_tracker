const CLIENT_DIAGNOSTIC_CATEGORIES = Object.freeze({
  api_error: {
    message: 'API request failed',
    details: new Set(['routeTemplate', 'status', 'requestId'])
  },
  window_error: {
    message: 'Unhandled browser error',
    details: new Set(['script', 'line', 'column'])
  },
  unhandled_rejection: {
    message: 'Unhandled promise rejection',
    details: new Set(['errorType'])
  },
  client_error: {
    message: 'Client error',
    details: new Set(['requestId'])
  }
});

const CATEGORY_ALIASES = Object.freeze({
  api: 'api_error',
  api_error: 'api_error',
  window_error: 'window_error',
  unhandled_rejection: 'unhandled_rejection',
  client: 'client_error',
  client_error: 'client_error'
});

const SAFE_REQUEST_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_APP_PLATFORMS = new Set(['web', 'ios']);
const SAFE_APP_VERSION = /^(?:local|web|screenshots|[0-9]+(?:\.[0-9]+){0,3}|[0-9a-f]{7,40})$/i;
const SAFE_SCRIPT_NAMES = new Set([
  'coach-rules.js',
  'login.js',
  'script.js',
  'today-state.js'
]);
const SAFE_ROUTE_RESOURCES = new Set([
  'account',
  'admin',
  'analysis',
  'auth',
  'barcode',
  'claim-legacy-data',
  'coach',
  'daily-totals',
  'dashboard',
  'day-completeness',
  'diagnostics',
  'entries',
  'macro-targets',
  'me',
  'meal-group',
  'parse-meal',
  'parse-workout',
  'quick-add',
  'saved-items',
  'sexual-activity',
  'sleep',
  'starter-quick-adds',
  'subscription',
  'sync-workouts',
  'today',
  'version',
  'weight-target',
  'weights',
  'workouts'
]);
const SAFE_ERROR_TYPES = new Set([
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError'
]);
const SAFE_ROUTE_ACTIONS = new Set([
  'accounts',
  'combine',
  'copy-day',
  'copy-to-today',
  'diagnostics',
  'dismissals',
  'preferences',
  'remove-from-group',
  'rotate',
  'scale',
  'sessions',
  'split',
  'tokens'
]);

function normalizeCategory(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CATEGORY_ALIASES[normalized] || 'client_error';
}

function sanitizeRequestReference(value) {
  const normalized = String(value || '').trim();
  return SAFE_REQUEST_REFERENCE.test(normalized) ? normalized : null;
}

function sanitizeRouteTemplate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let pathname;
  try {
    pathname = new URL(raw, 'https://diagnostics.invalid').pathname;
  } catch (_error) {
    return null;
  }

  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length || segments[0] !== 'api') {
    return null;
  }

  const resourceIndex = segments[1] === 'v1' ? 2 : 1;
  if (!SAFE_ROUTE_RESOURCES.has(segments[resourceIndex])) {
    return null;
  }
  const templated = segments.slice(0, 6).map((segment, index) => {
    if (index === 0 || (index === 1 && segment === 'v1')) {
      return segment;
    }
    if (index === resourceIndex) {
      return segment;
    }
    if (SAFE_ROUTE_ACTIONS.has(segment)) {
      return segment;
    }
    return ':id';
  });

  return `/${templated.join('/')}`;
}

function sanitizeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return null;
  }
  return number;
}

function sanitizeScriptName(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let pathname;
  try {
    pathname = new URL(raw, 'https://diagnostics.invalid').pathname;
  } catch (_error) {
    return null;
  }
  const basename = pathname.split('/').filter(Boolean).pop() || '';
  return SAFE_SCRIPT_NAMES.has(basename) ? basename : null;
}

function sanitizeAppPlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SAFE_APP_PLATFORMS.has(normalized) ? normalized : 'unknown';
}

function sanitizeAppVersion(value) {
  const normalized = String(value || '').trim();
  return SAFE_APP_VERSION.test(normalized) ? normalized : 'unknown';
}

function sanitizeDiagnosticDetails(category, rawDetails, fallbackRequestId) {
  const definition = CLIENT_DIAGNOSTIC_CATEGORIES[category];
  const input = rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)
    ? rawDetails
    : {};
  const details = {};

  if (definition.details.has('routeTemplate')) {
    const routeTemplate = sanitizeRouteTemplate(input.routeTemplate || input.path || input.route);
    if (routeTemplate) details.routeTemplate = routeTemplate;
  }
  if (definition.details.has('status')) {
    const status = sanitizeInteger(input.status, { min: 100, max: 599 });
    if (status != null) details.status = status;
  }
  if (definition.details.has('requestId')) {
    const requestId = sanitizeRequestReference(input.requestId || fallbackRequestId);
    if (requestId) details.requestId = requestId;
  }
  if (definition.details.has('script')) {
    const script = sanitizeScriptName(input.script || input.source);
    if (script) details.script = script;
  }
  if (definition.details.has('line')) {
    const line = sanitizeInteger(input.line, { min: 0, max: 10_000_000 });
    if (line != null) details.line = line;
  }
  if (definition.details.has('column')) {
    const column = sanitizeInteger(input.column, { min: 0, max: 1_000_000 });
    if (column != null) details.column = column;
  }
  if (definition.details.has('errorType')) {
    const errorType = String(input.errorType || '').trim();
    details.errorType = SAFE_ERROR_TYPES.has(errorType) ? errorType : 'Error';
  }

  return Object.keys(details).length ? details : null;
}

function sanitizeClientDiagnostic(input = {}, defaults = {}) {
  const category = normalizeCategory(input.category);
  const definition = CLIENT_DIAGNOSTIC_CATEGORIES[category];
  const detailRequestId = input.details && typeof input.details === 'object' && !Array.isArray(input.details)
    ? input.details.requestId
    : null;
  const requestId = sanitizeRequestReference(
    input.requestId || input.request_id || detailRequestId || defaults.requestId
  );
  const levelInput = String(input.level || 'error').trim().toLowerCase();
  const level = ['warning', 'error', 'fatal'].includes(levelInput) ? levelInput : 'error';
  const appPlatform = sanitizeAppPlatform(
    defaults.appPlatform || input.appPlatform || input.app_platform
  );
  const appVersion = sanitizeAppVersion(
    defaults.appVersion || input.appVersion || input.app_version
  );

  return {
    level,
    category,
    message: definition.message,
    details: sanitizeDiagnosticDetails(category, input.details, requestId),
    appPlatform,
    appVersion,
    requestId
  };
}

module.exports = {
  CLIENT_DIAGNOSTIC_CATEGORIES,
  sanitizeClientDiagnostic,
  sanitizeRequestReference,
  sanitizeRouteTemplate
};
