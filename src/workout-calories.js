function normalizeWorkoutIntensity(intensity, fallback = 'medium') {
  const normalized = String(intensity || '').trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function isStrengthWorkout(text) {
  return /\b(?:lift|lifting|weightlifting|weight\s*training|strength|resistance|bodybuilding|barbell|dumbbell|kettlebell|bench|squat|deadlift|press|curl|pullup|pushup|chest|back|legs?|arms?|shoulders?|upper\s*body|lower\s*body|push\s*day|pull\s*day)\b/i.test(String(text || ''));
}

function isCardioWorkout(text) {
  return /\b(?:run|running|jog|jogging|cycle|cycling|bike|biking|spin|rowing?|swim|swimming|elliptical|stair|hike|hiking)\b/i.test(String(text || ''));
}

function hasExplicitActiveCalories(text) {
  const lower = String(text || '').toLowerCase();
  return /\b(?:active|move)\s*(?:calories|calorie|cal|cals|kcal)\b/.test(lower)
    || /\b(?:calories|calorie|cal|cals|kcal)\s*(?:active|move)\b/.test(lower);
}

function estimateWorkoutCalories(text, hours, intensity = 'medium') {
  const durationHours = Math.max(0, Number(hours) || 0);
  const normalizedIntensity = normalizeWorkoutIntensity(intensity);
  const context = String(text || '');
  const category = isStrengthWorkout(context)
    ? 'strength'
    : (isCardioWorkout(context) ? 'cardio' : 'general');

  const activeCaloriesPerHour = {
    strength: { low: 130, medium: 220, high: 380 },
    cardio: { low: 330, medium: 500, high: 650 },
    general: { low: 220, medium: 350, high: 500 }
  };

  return Math.round(durationHours * activeCaloriesPerHour[category][normalizedIntensity]);
}

function capConservativeWorkoutCalories({ sourceText = '', description = '', intensity, durationHours, caloriesBurned }) {
  const numericCalories = Number(caloriesBurned);
  const roundedCalories = Number.isFinite(numericCalories) ? Math.max(0, Math.round(numericCalories)) : 0;
  const context = `${sourceText} ${description}`.trim();
  if (hasExplicitActiveCalories(context)) {
    return roundedCalories;
  }

  const conservativeEstimate = estimateWorkoutCalories(context, durationHours, intensity);
  if (conservativeEstimate <= 0) {
    return roundedCalories;
  }
  return Math.min(roundedCalories, conservativeEstimate);
}

module.exports = {
  capConservativeWorkoutCalories,
  estimateWorkoutCalories,
  hasExplicitActiveCalories,
  isStrengthWorkout,
  normalizeWorkoutIntensity
};
