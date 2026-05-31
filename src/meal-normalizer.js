const MACRO_FIELDS = ['calories', 'protein', 'carbs', 'fat'];
const QUANTITY_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5
};
const QUANTITY_PATTERN = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)';

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

function parseQuantityText(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(QUANTITY_WORDS, normalized)) {
    return QUANTITY_WORDS[normalized];
  }

  const mixedFraction = normalized.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    return denominator > 0 ? whole + (numerator / denominator) : null;
  }

  const fraction = normalized.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator > 0 ? numerator / denominator : null;
  }

  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function extractSingleItemQuantityFromText(text) {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  if (!normalized) {
    return null;
  }

  const prefixes = [
    normalized,
    normalized.replace(/^(?:please\s+)?(?:log|add|track)\s+(?:my\s+)?/, ''),
    normalized.replace(/^(?:i\s+)?(?:ate|had|logged|added|tracked|consumed)\s+/, ''),
    normalized.replace(/^for\s+(?:breakfast|lunch|dinner|snack)[,:\s]+/, '')
  ];
  const leadingPattern = new RegExp(`^(${QUANTITY_PATTERN})(?!\\s*(?:am|pm)\\b)\\b`, 'i');
  for (const candidate of prefixes) {
    const match = candidate.match(leadingPattern);
    if (match) {
      return parseQuantityText(match[1]);
    }
  }

  const verbPattern = new RegExp(`\\b(?:ate|had|log|logged|add|added|track|tracked|consumed)\\s+(${QUANTITY_PATTERN})(?!\\s*(?:am|pm)\\b)\\b`, 'i');
  const verbMatch = normalized.match(verbPattern);
  return verbMatch ? parseQuantityText(verbMatch[1]) : null;
}

function scaleItem(item, scale) {
  const scaled = {
    ...item,
    quantity: roundNumber(Number(item.quantity || 0) * scale, 3)
  };
  for (const field of MACRO_FIELDS) {
    scaled[field] = roundNumber(Number(item[field] || 0) * scale, 2);
  }
  return scaled;
}

function normalizeSingleItemQuantity(items, mealQuantity, textQuantity) {
  if (!Array.isArray(items) || items.length !== 1) {
    return { items, mealQuantity };
  }

  const item = items[0];
  const currentQuantity = positiveNumber(item.quantity, 1);
  const hasExplicitMealQuantity = mealQuantity > 0 && Math.abs(mealQuantity - 1) > 0.001;
  if (hasExplicitMealQuantity) {
    if (Math.abs(currentQuantity - mealQuantity) <= 0.001) {
      return { items, mealQuantity: 1 };
    }
    return { items: [scaleItem(item, mealQuantity)], mealQuantity: 1 };
  }

  if (textQuantity && Math.abs(textQuantity - 1) > 0.001 && Math.abs(currentQuantity - 1) <= 0.001) {
    return { items: [scaleItem(item, textQuantity)], mealQuantity: 1 };
  }

  return { items, mealQuantity: 1 };
}

function normalizeMealParse(parsed, options = {}) {
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
  let normalizedItems = items;

  if ((!explicitMealQuantity || Math.abs(mealQuantity - 1) <= 0.001) && repeatedQuantity) {
    mealQuantity = repeatedQuantity;
  }

  const shouldConvertItemsToMealUnit =
    mealQuantity > 1 &&
    repeatedQuantity &&
    Math.abs(repeatedQuantity - mealQuantity) <= 0.001;
  const divisor = shouldConvertItemsToMealUnit ? mealQuantity : 1;
  if (divisor !== 1) {
    normalizedItems = normalizedItems.map((item) => {
      const normalized = {
        ...item,
        quantity: roundNumber(item.quantity / divisor, 3)
      };
      for (const field of MACRO_FIELDS) {
        normalized[field] = roundNumber(item[field] / divisor, 2);
      }
      return normalized;
    });
  } else {
    const singleItemResult = normalizeSingleItemQuantity(
      normalizedItems,
      mealQuantity,
      extractSingleItemQuantityFromText(options.text)
    );
    normalizedItems = singleItemResult.items;
    mealQuantity = singleItemResult.mealQuantity;
  }

  return {
    ...source,
    mealQuantity: roundNumber(mealQuantity, 3),
    mealUnit: normalizeUnit(source.mealUnit),
    items: normalizedItems
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
