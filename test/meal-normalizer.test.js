const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMealParse, scaleMealUnitRows } = require('../src/meal-normalizer');

test('normalizes repeated multi-item meal quantities onto the meal', () => {
  const parsed = normalizeMealParse({
    consumedAt: '2026-05-30T12:00:00.000Z',
    mealName: 'Pancakes with Syrup',
    items: [
      {
        itemName: 'Pancake',
        quantity: 2,
        unit: 'pancake',
        calories: 180,
        protein: 6,
        carbs: 32,
        fat: 4,
        confidence: 'medium'
      },
      {
        itemName: 'Syrup',
        quantity: 2,
        unit: 'serving',
        calories: 100,
        protein: 0,
        carbs: 26,
        fat: 0,
        confidence: 'medium'
      }
    ],
    notes: ''
  });

  assert.equal(parsed.mealQuantity, 2);
  assert.equal(parsed.mealUnit, 'serving');
  assert.equal(parsed.items[0].quantity, 1);
  assert.equal(parsed.items[1].quantity, 1);
  assert.equal(parsed.items[0].calories, 90);
  assert.equal(parsed.items[1].carbs, 13);
});

test('keeps single-food counts on the item', () => {
  const parsed = normalizeMealParse({
    consumedAt: '2026-05-30T12:00:00.000Z',
    mealName: 'Pancakes',
    items: [
      {
        itemName: 'Pancake',
        quantity: 2,
        unit: 'pancake',
        calories: 180,
        protein: 6,
        carbs: 32,
        fat: 4,
        confidence: 'medium'
      }
    ],
    notes: ''
  });

  assert.equal(parsed.mealQuantity, 1);
  assert.equal(parsed.items[0].quantity, 2);
  assert.equal(parsed.items[0].calories, 180);
});

test('moves explicit single-food meal quantity onto the item', () => {
  const parsed = normalizeMealParse({
    consumedAt: '2026-05-30T12:00:00.000Z',
    mealName: 'Child Waffles',
    mealQuantity: 2,
    mealUnit: 'serving',
    items: [
      {
        itemName: 'Child Waffle',
        quantity: 1,
        unit: 'waffle',
        calories: 90,
        protein: 3,
        carbs: 14,
        fat: 3,
        confidence: 'medium'
      }
    ],
    notes: ''
  });

  assert.equal(parsed.mealQuantity, 1);
  assert.equal(parsed.items[0].quantity, 2);
  assert.equal(parsed.items[0].calories, 180);
  assert.equal(parsed.items[0].carbs, 28);
});

test('uses input text to repair single-food parsed quantities', () => {
  const parsed = normalizeMealParse({
    consumedAt: '2026-05-30T12:00:00.000Z',
    mealName: 'Child Waffles',
    mealQuantity: 1,
    mealUnit: 'serving',
    items: [
      {
        itemName: 'Child Waffle',
        quantity: 1,
        unit: 'waffle',
        calories: 90,
        protein: 3,
        carbs: 14,
        fat: 3,
        confidence: 'medium'
      }
    ],
    notes: ''
  }, { text: '2 child waffles' });

  assert.equal(parsed.mealQuantity, 1);
  assert.equal(parsed.items[0].quantity, 2);
  assert.equal(parsed.items[0].calories, 180);
  assert.equal(parsed.items[0].carbs, 28);
});

test('uses fractional input text for single-food parsed quantities', () => {
  const parsed = normalizeMealParse({
    consumedAt: '2026-05-30T12:00:00.000Z',
    mealName: 'Protein Shake',
    mealQuantity: 1,
    mealUnit: 'serving',
    items: [
      {
        itemName: 'Protein Shake',
        quantity: 1,
        unit: 'bottle',
        calories: 240,
        protein: 30,
        carbs: 12,
        fat: 4,
        confidence: 'medium'
      }
    ],
    notes: ''
  }, { text: '1/2 bottle protein shake' });

  assert.equal(parsed.mealQuantity, 1);
  assert.equal(parsed.items[0].quantity, 0.5);
  assert.equal(parsed.items[0].calories, 120);
  assert.equal(parsed.items[0].protein, 15);
});

test('scales meal-unit rows back to consumed totals before persistence', () => {
  const rows = scaleMealUnitRows([
    { itemName: 'Pancake', quantity: 1, calories: 90, protein: 3, carbs: 16, fat: 2 },
    { itemName: 'Syrup', quantity: 1, calories: 50, protein: 0, carbs: 13, fat: 0 }
  ], 2);

  assert.deepEqual(rows.map((row) => row.quantity), [2, 2]);
  assert.deepEqual(rows.map((row) => row.calories), [180, 100]);
  assert.deepEqual(rows.map((row) => row.carbs), [32, 26]);
});
