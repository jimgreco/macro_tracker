(function initCoachRules(root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = rules;
  }
  root.DailyMacrosCoachRules = rules;
})(typeof globalThis !== 'undefined' ? globalThis : window, function coachRulesFactory() {
  function fmtNumber(value) {
    return Number(value || 0).toFixed(1).replace('.0', '');
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

  function coachEndOfTodayIso(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  }

  function targetNumber(targets, key) {
    const value = Number(targets?.[key] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function macroRowsByDay(context) {
    const rows = new Map();
    for (const row of context.macroDailyTotals || []) {
      if (row?.day) rows.set(row.day, row);
    }
    for (const row of context.dashboardData?.previousDays || []) {
      if (row?.day && !rows.has(row.day)) rows.set(row.day, row);
    }
    const current = context.dashboardData?.currentDayTotals;
    if (current?.day && !rows.has(current.day)) {
      rows.set(current.day, current);
    }
    return Array.from(rows.values()).sort((a, b) => String(b.day).localeCompare(String(a.day)));
  }

  function recentCompleteMacroDays(context, count = 7) {
    const today = context.today || getLocalIsoDay(context.now || new Date());
    return macroRowsByDay(context)
      .filter((row) => row.day < today && Number(row.calories || 0) > 0)
      .slice(0, count);
  }

  function entriesForIsoDay(entries, isoDay) {
    return (entries || []).filter((entry) => getLocalIsoDay(entry.consumedAt || entry.loggedAt) === isoDay);
  }

  function entryHour(entry, field = 'consumedAt') {
    const date = new Date(entry?.[field]);
    return Number.isNaN(date.getTime()) ? null : date.getHours();
  }

  function daypartForHour(hour) {
    if (hour >= 5 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 15) return 'lunch';
    if (hour >= 16 && hour < 21) return 'dinner';
    return 'other';
  }

  function learnedDaypart(entries, daypart, context) {
    const today = context.today || getLocalIsoDay(context.now || new Date());
    const seenDays = new Set();
    let latestHour = -1;
    for (const entry of entries || []) {
      const hour = entryHour(entry);
      if (hour == null || daypartForHour(hour) !== daypart) {
        continue;
      }
      const day = getLocalIsoDay(entry.consumedAt);
      if (day === today) {
        continue;
      }
      seenDays.add(day);
      latestHour = Math.max(latestHour, hour);
    }
    return { count: seenDays.size, latestHour };
  }

  function buildCoachSuggestion(context, page, category, priority, title, message, evidence, action = null, confidence = 0.9) {
    const today = context.today || getLocalIsoDay(context.now || new Date());
    return {
      page,
      category,
      priority,
      title,
      message,
      evidence: Array.isArray(evidence) ? evidence : [evidence],
      action,
      confidence,
      modelSource: 'local_rules',
      todayKey: `web:${page}:${category}:${today}`,
      patternKey: `web:${page}:${category}`
    };
  }

  function buildMacroCoachSuggestions(context) {
    const suggestions = [];
    const dashboard = context.dashboardData || {};
    const targets = dashboard.targets || {};
    const entries = dashboard.entries || [];
    const completeDays = recentCompleteMacroDays(context, 7);
    const proteinTarget = targetNumber(targets, 'protein');
    const calorieTarget = targetNumber(targets, 'calories');
    const today = context.today || getLocalIsoDay(context.now || new Date());
    const nowDate = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
    const nowHour = nowDate.getHours();
    const todayEntries = entriesForIsoDay(entries, today);

    if (proteinTarget > 0 && completeDays.length >= 5) {
      const misses = completeDays.filter((day) => {
        const shortfall = proteinTarget - Number(day.protein || 0);
        return shortfall >= Math.max(25, proteinTarget * 0.18);
      });
      if (misses.length >= 4) {
        const avgShortfall = misses.reduce((sum, day) => sum + Math.max(0, proteinTarget - Number(day.protein || 0)), 0) / misses.length;
        suggestions.push(buildCoachSuggestion(
          context,
          'macros',
          'protein-shortfall',
          96,
          'Protein is lagging',
          `Protein has landed meaningfully short on ${misses.length} of the last ${completeDays.length} complete days. Make the next meal protein-first.`,
          `Based on ${misses.length} recent complete days below target; average shortfall ${Math.round(avgShortfall)}g.`,
          { type: 'focus-meal', label: 'Log protein' },
          0.92
        ));
      }
    }

    if (calorieTarget > 0 && completeDays.length >= 5) {
      const highDays = completeDays.filter((day) => Number(day.calories || 0) >= calorieTarget * 1.12);
      if (highDays.length >= 4) {
        suggestions.push(buildCoachSuggestion(
          context,
          'macros',
          'calorie-trend-high',
          90,
          'Calories are running high',
          `Calories have been more than 12% over target on ${highDays.length} of the last ${completeDays.length} complete days. Keep today boring and target-shaped.`,
          `Target ${Math.round(calorieTarget)} cal; ${highDays.length} recent complete days were above the guardrail.`,
          { type: 'focus-meal', label: 'Plan next meal' },
          0.9
        ));
      }
    }

    const alcoholTerms = /\b(beer|wine|cocktail|liquor|vodka|whiskey|bourbon|tequila|margarita|alcohol)\b/i;
    const recentAlcoholDays = new Set(entries
      .filter((entry) => entry.consumedAt && getLocalIsoDay(entry.consumedAt) >= shiftIsoDay(today, -7))
      .filter((entry) => alcoholTerms.test(entry.itemName || ''))
      .map((entry) => getLocalIsoDay(entry.consumedAt)));
    if (recentAlcoholDays.size >= 2) {
      suggestions.push(buildCoachSuggestion(
        context,
        'macros',
        'alcohol-repeated',
        88,
        'Alcohol is showing up repeatedly',
        'Alcohol has appeared on multiple recent days. If the goal is tighter macros, make the next few drinks intentional rather than automatic.',
        `Detected alcohol-like entries on ${recentAlcoholDays.size} days in the last week.`,
        null,
        0.86
      ));
    }

    for (const daypart of ['breakfast', 'lunch']) {
      const learned = learnedDaypart(entries, daypart, context);
      const daypartAlreadyLogged = todayEntries.some((entry) => daypartForHour(entryHour(entry) ?? -1) === daypart);
      const isLate = daypart === 'breakfast'
        ? nowHour >= Math.max(10, learned.latestHour + 1)
        : nowHour >= Math.max(14, learned.latestHour + 1);
      if (learned.count >= 3 && isLate && !daypartAlreadyLogged) {
        suggestions.push(buildCoachSuggestion(
          context,
          'macros',
          `missed-${daypart}`,
          daypart === 'breakfast' ? 94 : 92,
          `${daypart[0].toUpperCase()}${daypart.slice(1)} is still open`,
          `You usually log ${daypart} by this point. If you ate, log it now while the details are still fresh.`,
          `Based on ${learned.count} previous ${daypart} logs around this time window.`,
          { type: 'focus-meal', label: `Log ${daypart}` },
          0.88
        ));
      }
    }

    const currentTotals = dashboard.currentDayTotals || {};
    if (todayEntries.length >= 2 && calorieTarget > 0 && proteinTarget > 0) {
      const closeCalories = Math.abs(Number(currentTotals.calories || 0) - calorieTarget) <= calorieTarget * 0.12;
      const closeProtein = Math.abs(Number(currentTotals.protein || 0) - proteinTarget) <= Math.max(12, proteinTarget * 0.12);
      if (closeCalories && closeProtein) {
        suggestions.push(buildCoachSuggestion(
          context,
          'macros',
          'macro-target-hit',
          70,
          'Today is close to target',
          'Calories and protein are both inside a practical target band. Hold the line from here.',
          `Current total: ${Math.round(currentTotals.calories || 0)} cal and ${Math.round(currentTotals.protein || 0)}g protein.`,
          null,
          0.88
        ));
      }
    }

    return suggestions;
  }

  function buildWorkoutCoachSuggestions(context) {
    const suggestions = [];
    const entries = (context.workoutEntries || []).slice();
    const targets = context.dashboardData?.targets || {};
    const workoutTarget = targetNumber(targets, 'workouts');
    const today = context.today || getLocalIsoDay(context.now || new Date());
    const weekStart = (() => {
      const d = context.now instanceof Date ? new Date(context.now) : new Date(context.now || Date.now());
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return getLocalIsoDay(d);
    })();
    const recentThirty = entries.filter((entry) => getLocalIsoDay(entry.loggedAt) >= shiftIsoDay(today, -30));
    const daysThisWeek = new Set(recentThirty.filter((entry) => getLocalIsoDay(entry.loggedAt) >= weekStart).map((entry) => getLocalIsoDay(entry.loggedAt)));
    const lastWorkoutDay = recentThirty.length ? recentThirty.map((entry) => getLocalIsoDay(entry.loggedAt)).sort().pop() : null;
    const daysSinceLast = lastWorkoutDay ? Math.round((fromIsoDayLocal(today) - fromIsoDayLocal(lastWorkoutDay)) / 86400000) : 99;

    if (workoutTarget > 0 && recentThirty.length >= 4 && daysThisWeek.size <= Math.max(0, workoutTarget - 2) && daysSinceLast >= 2) {
      suggestions.push(buildCoachSuggestion(
        context,
        'workout',
        'workout-target-behind',
        92,
        'Workouts are behind pace',
        `You are at ${daysThisWeek.size} workout day${daysThisWeek.size === 1 ? '' : 's'} this week against a ${workoutTarget}/week target. Put one on the board today if recovery feels normal.`,
        `Last workout was ${daysSinceLast} day${daysSinceLast === 1 ? '' : 's'} ago; target is ${workoutTarget}/week.`,
        { type: 'focus-workout', label: 'Log workout' },
        0.88
      ));
    }

    const sorted = recentThirty.slice().sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
    const recentFive = sorted.slice(0, 5);
    const priorFive = sorted.slice(5, 10);
    if (recentFive.length >= 3 && priorFive.length >= 3) {
      const avg = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length;
      const recentDuration = avg(recentFive, 'durationHours');
      const priorDuration = avg(priorFive, 'durationHours');
      if (priorDuration > 0 && Math.abs(recentDuration - priorDuration) / priorDuration >= 0.25) {
        const direction = recentDuration > priorDuration ? 'longer' : 'shorter';
        suggestions.push(buildCoachSuggestion(
          context,
          'workout',
          `workout-duration-${direction}`,
          84,
          `Workouts are getting ${direction}`,
          `Recent workouts are averaging ${fmtNumber(recentDuration)} hr versus ${fmtNumber(priorDuration)} hr before. Adjust the next session deliberately, not by drift.`,
          `Compared ${recentFive.length} recent workouts with the prior ${priorFive.length}.`,
          null,
          0.86
        ));
      }
    }

    if (workoutTarget > 0 && daysThisWeek.size >= workoutTarget) {
      suggestions.push(buildCoachSuggestion(
        context,
        'workout',
        'workout-target-hit',
        74,
        'Workout target is hit',
        `You have ${daysThisWeek.size} workout days this week against a ${workoutTarget}/week target. Bank it and recover well.`,
        `Weekly target met with ${daysThisWeek.size} distinct workout days.`,
        null,
        0.9
      ));
    }

    return suggestions;
  }

  function buildWeightCoachSuggestions(context) {
    const suggestions = [];
    const entries = (context.weightChartEntries || context.weightEntries || [])
      .slice()
      .filter((entry) => Number(entry.weight || 0) > 0)
      .sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));
    const targetWeight = Number(context.weightTargetData?.targetWeight || context.weightTarget || 0);
    if (!entries.length || !Number.isFinite(targetWeight) || targetWeight <= 0) {
      return suggestions;
    }
    const recent = entries.filter((entry) => getLocalIsoDay(entry.loggedAt) >= shiftIsoDay(context.today || getLocalIsoDay(), -30));
    if (recent.length < 4) {
      return suggestions;
    }
    const first = recent[0];
    const latest = recent[recent.length - 1];
    const firstWeight = Number(first.weight || 0);
    const latestWeight = Number(latest.weight || 0);
    const delta = latestWeight - firstWeight;
    const distance = latestWeight - targetWeight;

    if (Math.abs(distance) <= 1 && recent.length >= 5) {
      suggestions.push(buildCoachSuggestion(
        context,
        'weight',
        'weight-goal-maintained',
        88,
        'Weight is at goal',
        'Recent weigh-ins are sitting inside the goal band. Keep the system steady instead of forcing a new move.',
        `Latest ${fmtNumber(latestWeight)} lb; target ${fmtNumber(targetWeight)} lb across ${recent.length} recent weigh-ins.`,
        null,
        0.9
      ));
    } else if ((targetWeight < firstWeight && delta >= -0.3) || (targetWeight > firstWeight && delta <= 0.3)) {
      const direction = targetWeight < firstWeight ? 'down' : 'up';
      suggestions.push(buildCoachSuggestion(
        context,
        'weight',
        'weight-off-track',
        90,
        'Weight trend is off pace',
        `The 30-day trend is not moving ${direction} toward the target yet. Tighten the repeatable inputs before changing the goal.`,
        `Latest ${fmtNumber(latestWeight)} lb, target ${fmtNumber(targetWeight)} lb; recent change ${fmtNumber(delta)} lb.`,
        { type: 'focus-weight', label: 'Log weight' },
        0.87
      ));
    }

    return suggestions;
  }

  function buildSleepCoachSuggestions(context) {
    const suggestions = [];
    const target = Number(context.sleepTargetHours || 8);
    const rows = (context.sleepChartRows || [])
      .slice()
      .filter((row) => Number(row.value || 0) > 0)
      .sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
    const recent = rows.slice(-7);
    if (target > 0 && recent.length >= 5) {
      const avg = recent.reduce((sum, row) => sum + Number(row.value || 0), 0) / recent.length;
      if (avg <= target - 0.75) {
        suggestions.push(buildCoachSuggestion(
          context,
          'sleep',
          'sleep-below-target',
          90,
          'Sleep is below target',
          `Recent sleep is averaging ${fmtNumber(avg)} hrs against a ${fmtNumber(target)} hr target. Protect tonight's start time first.`,
          `Based on ${recent.length} logged nights in the current sleep window.`,
          { type: 'focus-sleep', label: 'Log sleep' },
          0.88
        ));
      }
      const streak = rows.slice(-3);
      if (streak.length === 3 && streak.every((row) => Number(row.value || 0) >= target)) {
        suggestions.push(buildCoachSuggestion(
          context,
          'sleep',
          'sleep-target-streak',
          76,
          'Sleep target streak',
          `The last ${streak.length} logged nights met the target. Keep the same bedtime pattern if you can.`,
          `Three consecutive logged nights at or above ${fmtNumber(target)} hrs.`,
          null,
          0.9
        ));
      }
    }
    return suggestions;
  }

  function buildCoachCandidates(pageKey, context = {}) {
    if (pageKey === 'macros') return buildMacroCoachSuggestions(context);
    if (pageKey === 'workout') return buildWorkoutCoachSuggestions(context);
    if (pageKey === 'weight') return buildWeightCoachSuggestions(context);
    if (pageKey === 'sleep') return buildSleepCoachSuggestions(context);
    return [];
  }

  function isSuggestionDismissed(suggestion, dismissals, now = new Date()) {
    if (!suggestion) {
      return true;
    }
    if (dismissals?.pattern?.has?.(suggestion.patternKey)) {
      return true;
    }
    const todayUntil = dismissals?.today?.get?.(suggestion.todayKey);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    return Boolean(todayUntil && todayUntil > nowMs);
  }

  return {
    buildCoachCandidates,
    buildMacroCoachSuggestions,
    buildWorkoutCoachSuggestions,
    buildWeightCoachSuggestions,
    buildSleepCoachSuggestions,
    coachEndOfTodayIso,
    daypartForHour,
    getLocalIsoDay,
    isSuggestionDismissed,
    shiftIsoDay
  };
});
