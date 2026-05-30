const MACRO_FIELDS = ['calories', 'protein', 'carbs', 'fat'];

function roundNumber(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function positiveNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeUnit(value, fallback = 'serving') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function commonWholeQuantity(items) {
  if (!Array.isArray(items) || items.length < 2) {
    return null;
  }

  const quantities = items.map((item) => Number(item.quantity));
  if (quantities.some((quantity) => !Number.isFinite(quantity) || quantity <= 1)) {
    return null;
  }

  const wholeQuantity = Math.round(quantities[0]);
  if (wholeQuantity <= 1 || Math.abs(quantities[0] - wholeQuantity) > 0.001) {
    return null;
  }

  return quantities.every((quantity) => Math.abs(quantity - wholeQuantity) <= 0.001)
    ? wholeQuantity
    : null;
}

function normalizeMealParse(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems.map((rawItem) => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const normalized = {
      ...item,
      itemName: normalizeUnit(item.itemName, 'Item'),
      quantity: roundNumber(positiveNumber(item.quantity, 1), 3),
      unit: normalizeUnit(item.unit)
    };
    for (const field of MACRO_FIELDS) {
      normalized[field] = roundNumber(Math.max(0, Number(item[field]) || 0), 2);
    }
    return normalized;
  });

  const explicitMealQuantity = positiveNumber(source.mealQuantity, 0);
  const repeatedQuantity = commonWholeQuantity(items);
  let mealQuantity = explicitMealQuantity || 1;

  if ((!explicitMealQuantity || Math.abs(mealQuantity - 1) <= 0.001) && repeatedQuantity) {
    mealQuantity = repeatedQuantity;
  }

  const shouldConvertItemsToMealUnit =
    mealQuantity > 1 &&
    repeatedQuantity &&
    Math.abs(repeatedQuantity - mealQuantity) <= 0.001;
  const divisor = shouldConvertItemsToMealUnit ? mealQuantity : 1;

  return {
    ...source,
    mealQuantity: roundNumber(mealQuantity, 3),
    mealUnit: normalizeUnit(source.mealUnit),
    items: items.map((item) => {
      if (divisor === 1) {
        return item;
      }
      const normalized = {
        ...item,
        quantity: roundNumber(item.quantity / divisor, 3)
      };
      for (const field of MACRO_FIELDS) {
        normalized[field] = roundNumber(item[field] / divisor, 2);
      }
      return normalized;
    })
  };
}

function scaleMealUnitRows(rows, mealQuantity) {
  const scale = positiveNumber(mealQuantity, 1);
  if (scale === 1) {
    return rows;
  }

  return rows.map((row) => {
    const scaled = {
      ...row,
      quantity: roundNumber(Number(row.quantity || 0) * scale, 3)
    };
    for (const field of MACRO_FIELDS) {
      scaled[field] = roundNumber(Number(row[field] || 0) * scale, 2);
    }
    return scaled;
  });
}

module.exports = {
  normalizeMealParse,
  scaleMealUnitRows
};
