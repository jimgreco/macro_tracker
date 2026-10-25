function fiberValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(number) || number < 0 || number > 5000) {
    throw new Error('fiber must be a finite number between 0 and 5000 grams, or null.');
  }
  return number;
}
function scaleFiber(value, factor) {
  const fiber = fiberValue(value);
  return fiber == null ? null : Math.round(fiber * factor * 100) / 100;
}
function fiberSummary(items) {
  const known = items.filter(item => item.fiber != null);
  const knownFiber = Math.round(known.reduce((sum, item) => sum + fiberValue(item.fiber), 0) * 100) / 100;
  return { fiber: items.length && known.length === items.length ? knownFiber : null,
    fiberKnownGrams: knownFiber, fiberKnownCount: known.length, fiberItemCount: items.length };
}
module.exports = { fiberValue, scaleFiber, fiberSummary };
