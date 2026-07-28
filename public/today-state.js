(function initTodayState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.DailyMacrosTodayState = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function todayStateFactory() {
  const SNAPSHOT_STALE_MINUTES = 15;

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function displayNumber(value, digits = 1) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '—';
    if (Math.abs(Math.round(parsed) - parsed) < 0.05) {
      return String(Math.round(parsed));
    }
    return parsed.toFixed(digits).replace(/\.0$/, '');
  }

  function parsedDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function relativeAge(value, now) {
    const date = parsedDate(value);
    if (!date) return 'at an unknown time';
    const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  function buildTodayPresentation({
    summary,
    online = true,
    error = null,
    lastUpdatedAt = null,
    now = new Date()
  } = {}) {
    const currentTime = parsedDate(now) || new Date();
    const updatedAt = parsedDate(lastUpdatedAt || summary?.generatedAt);
    const snapshotAgeMinutes = updatedAt
      ? Math.max(0, Math.floor((currentTime.getTime() - updatedAt.getTime()) / 60000))
      : null;
    const hasSnapshot = Boolean(summary);
    const connectionFailed = !online || Boolean(error);
    const staleSnapshot = hasSnapshot
      && snapshotAgeMinutes != null
      && snapshotAgeMinutes > SNAPSHOT_STALE_MINUTES;

    let freshness;
    if (connectionFailed) {
      freshness = {
        tone: 'warning',
        title: hasSnapshot ? 'Showing saved Today data' : 'Offline',
        detail: hasSnapshot
          ? `Last updated ${relativeAge(updatedAt, currentTime)}. Refresh when the connection returns.`
          : 'Connect to load your account snapshot. Quick logging remains available.'
      };
    } else if (staleSnapshot) {
      freshness = {
        tone: 'warning',
        title: 'Showing an older snapshot',
        detail: `Last updated ${relativeAge(updatedAt, currentTime)}. Refresh for current totals.`
      };
    } else if (hasSnapshot) {
      freshness = {
        tone: 'success',
        title: 'Today is up to date',
        detail: `Updated ${relativeAge(updatedAt, currentTime)} from your account data.`
      };
    } else {
      freshness = {
        tone: 'loading',
        title: 'Loading today',
        detail: 'Gathering the latest account facts.'
      };
    }

    const macros = summary?.macros || {};
    const macroTotals = macros.totals || {};
    const macroTargets = macros.targets || {};
    const macroRemaining = macros.remaining || {};
    const recovery = summary?.recovery || {};
    const workout = summary?.workout || {};
    const weight = summary?.weight || {};

    const workoutTarget = number(workout.targetPerWeek);
    const weightDaysSince = number(weight.daysSinceLast);
    const weightCadenceDays = Math.max(1, number(weight.cadenceDays, 7));
    const weightDaysRemaining = Math.max(0, weightCadenceDays - weightDaysSince);
    const wakeUps = number(recovery.wakeUps);
    const recoverySourceLabel = recovery.sourceLabel && recovery.sourceLabel !== 'No source'
      ? recovery.sourceLabel
      : recovery.ouraStatus === 'connected' || recovery.ouraStatus === 'stale'
        ? 'Oura'
        : null;
    const recoveryFreshness = recovery.lastLoggedAt
      ? `updated ${relativeAge(recovery.lastLoggedAt, currentTime)}`
      : null;
    const recoverySourceParts = [
      recoverySourceLabel,
      recoveryFreshness,
      recovery.ouraStatus === 'disconnected' ? 'Oura not connected' : null
    ].filter(Boolean);

    return {
      hasSnapshot,
      empty: Boolean(summary?.empty),
      freshness,
      macro: {
        needsTargets: macros.state === 'needs_targets' || !hasSnapshot,
        remainingCalories: macroRemaining.calories == null
          ? '—'
          : displayNumber(macroRemaining.calories),
        remainingProtein: macroRemaining.protein == null
          ? '—'
          : `${displayNumber(macroRemaining.protein)}g`,
        detail: macros.state === 'needs_targets'
          ? 'Set calorie and protein targets to see what remains.'
          : `${displayNumber(macroTotals.carbs)}g carbs · ${displayNumber(macroTotals.fat)}g fat`,
        bars: [
          {
            label: 'Calories',
            current: number(macroTotals.calories),
            target: number(macroTargets.calories),
            unit: 'cal'
          },
          {
            label: 'Protein',
            current: number(macroTotals.protein),
            target: number(macroTargets.protein),
            unit: 'g'
          }
        ]
      },
      recovery: {
        value: recovery.sleepHours == null ? 'No data' : `${displayNumber(recovery.sleepHours)} hr`,
        detail: recovery.state === 'stale'
          ? `Sleep data is stale${recovery.ageHours == null ? '' : ` (${Math.floor(number(recovery.ageHours) / 24)} days old)`}.`
          : recovery.sleepHours == null
            ? 'Log sleep to establish a recovery baseline.'
            : `${displayNumber(wakeUps)} wake-up${wakeUps === 1 ? '' : 's'}`,
        source: recoverySourceParts.length
          ? recoverySourceParts.join(' · ')
          : recovery.ouraStatus === 'connected' || recovery.ouraStatus === 'stale'
            ? 'Recovery source: Oura'
            : 'No connected recovery source',
        actionLabel: recovery.sleepHours == null ? 'Log Sleep' : 'View Sleep'
      },
      workout: {
        value: workout.state === 'logged'
          ? workout.latestDescription || 'Workout logged'
          : 'Not logged',
        detail: workout.state === 'logged'
          ? `${displayNumber(workout.activeCalories)} active cal today`
          : `${number(workout.weeklyActiveDays)} of ${displayNumber(workoutTarget)} target days this week`,
        actionLabel: workout.state === 'logged' ? 'View Workouts' : 'Log Workout'
      },
      weight: {
        value: weight.latestWeight == null ? 'No baseline' : `${displayNumber(weight.latestWeight)} lb`,
        detail: weight.state === 'due'
          ? `Check-in due after ${weightDaysSince} day${weightDaysSince === 1 ? '' : 's'}.`
          : weight.state === 'on_cadence'
            ? `Next check-in in ${weightDaysRemaining} day${weightDaysRemaining === 1 ? '' : 's'}.`
            : 'One weigh-in starts the cadence.',
        actionLabel: weight.state === 'due' || weight.state === 'empty' ? 'Log Weight' : 'View Weight'
      },
      sync: connectionFailed
        ? {
          tone: 'warning',
          value: 'Offline',
          detail: 'Web logging needs a connection. Your saved account data remains visible.'
        }
        : {
          tone: 'success',
          value: 'All caught up',
          detail: 'No pending web changes.'
        }
    };
  }

  return {
    SNAPSHOT_STALE_MINUTES,
    buildTodayPresentation,
    displayNumber,
    relativeAge
  };
});
