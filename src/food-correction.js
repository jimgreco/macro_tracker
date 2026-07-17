const CORRECTION_ELIGIBLE_SOURCES = new Set(['ai_text', 'ai_photo', 'barcode']);
const MACRO_FIELDS = ['calories', 'protein', 'carbs', 'fat'];
const UNIT_ALIASES = new Map([
  ['servings', 'serving'],
  ['portion', 'serving'],
  ['portions', 'serving'],
  ['ounce', 'oz'],
  ['ounces', 'oz'],
  ['lbs', 'lb'],
  ['pound', 'lb'],
  ['pounds', 'lb'],
  ['gram', 'g'],
  ['grams', 'g'],
  ['kilogram', 'kg'],
  ['kilograms', 'kg'],
  ['milliliter', 'ml'],
  ['milliliters', 'ml'],
  ['liter', 'l'],
  ['liters', 'l'],
  ['tablespoon', 'tbsp'],
  ['tablespoons', 'tbsp'],
  ['teaspoon', 'tsp'],
  ['teaspoons', 'tsp']
]);

function roundNumber(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeUnitKey(value) {
  const normalized = String(value || 'serving')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');

  if (UNIT_ALIASES.has(normalized)) {
    return UNIT_ALIASES.get(normalized);
  }
  if (normalized.length > 3 && normalized.endsWith('ies')) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.length > 3 && normalized.endsWith('s') && !normalized.endsWith('ss')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function canApplyFoodCorrection(item) {
  return CORRECTION_ELIGIBLE_SOURCES.has(String(item?.source || '').trim().toLowerCase());
}

function correctionUnitsAreCompatible(itemUnit, correctionUnit) {
  const requestedUnit = normalizeUnitKey(itemUnit);
  const rememberedUnit = normalizeUnitKey(correctionUnit);
  return requestedUnit === rememberedUnit || requestedUnit === 'serving';
}

function applyFoodCorrectionToItem(item, correction, correctionKey) {
  if (!correction || !canApplyFoodCorrection(item)) {
    return item;
  }

  const requestedQuantity = Number(item.quantity);
  const rememberedQuantity = Number(correction.quantity);
  if (
    !Number.isFinite(requestedQuantity) || requestedQuantity <= 0 ||
    !Number.isFinite(rememberedQuantity) || rememberedQuantity <= 0 ||
    !correctionUnitsAreCompatible(item.unit, correction.unit)
  ) {
    return item;
  }

  const scale = requestedQuantity / rememberedQuantity;
  const corrected = {
    ...item,
    itemName: correction.item_name || item.itemName,
    quantity: requestedQuantity,
    unit: correction.unit || item.unit || 'serving',
    source: 'food_correction',
    sourceDetail: 'Remembered correction',
    confidence: 1,
    needsReview: false,
    correctionKey: correctionKey || correction.correction_key
  };
  for (const field of MACRO_FIELDS) {
    corrected[field] = roundNumber(Number(correction[field] || 0) * scale, 2);
  }
  return corrected;
}

module.exports = {
  applyFoodCorrectionToItem,
  canApplyFoodCorrection,
  correctionUnitsAreCompatible,
  normalizeUnitKey
};
