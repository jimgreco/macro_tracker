const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('mobile bottom navigation markup is removed', () => {
  const html = read('public/index.html');

  assert.equal(html.includes('class="mobile-nav"'), false);
  assert.equal(html.includes('class="mobile-nav-btn"'), false);
  assert.equal(html.includes('data-nav-target='), false);
});

test('mobile bottom navigation script wiring is removed', () => {
  const script = read('public/script.js');

  assert.equal(script.includes('mobileNavButtons'), false);
  assert.equal(script.includes('setActiveMobileNav('), false);
  assert.equal(script.includes('scrollToSection('), false);
});

test('mobile bottom navigation styles are removed', () => {
  const styles = read('public/styles.css');

  assert.equal(styles.includes('.mobile-nav'), false);
  assert.equal(styles.includes('.mobile-nav-btn'), false);
});


test('brand menu includes macro, weight, and workout pages', () => {
  const html = read('public/index.html');

  assert.equal(html.includes('data-page="macros"'), true);
  assert.equal(html.includes('data-page="weight"'), true);
  assert.equal(html.includes('data-page="workout"'), true);
  assert.equal(html.includes('id="weight-page"'), true);
  assert.equal(html.includes('id="workout-page"'), true);
});

test('weight page has log, entries, and snapshot sections', () => {
  const html = read('public/index.html');

  assert.equal(html.includes('id="weight-log-section"'), true);
  assert.equal(html.includes('id="weight-entries-section"'), true);
  assert.equal(html.includes('id="weight-snapshot-section"'), true);
});

test('weight page includes target weight + date controls', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(html.includes('id="edit-weight-target-link"'), true);
  assert.equal(script.includes('showWeightTargetModal'), true);
  assert.equal(script.includes("/api/weight-target"), true);
  assert.equal(server.includes("apiRouter.get('/weight-target'"), true);
  assert.equal(server.includes("apiRouter.put('/weight-target'"), true);
});

test('analysis goal selector is removed from weekly analysis form', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');

  assert.equal(html.includes('id="analysis-goal"'), false);
  assert.equal(script.includes('analysisGoalEl'), false);
});

test('analysis report no longer includes recovery context section', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(html.includes('id="analysis-recovery-list"'), false);
  assert.equal(script.includes('analysisRecoveryListEl'), false);
  assert.equal(server.includes('recoveryContext'), false);
});

test('weight entries support edit and delete actions', () => {
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(script.includes('data-weight-action="edit"'), true);
  assert.equal(script.includes('showWeightEditModal'), true);
  assert.equal(script.includes('deleteWeightEntryApi'), true);
  assert.equal(server.includes("apiRouter.put('/weights/:id'"), true);
  assert.equal(server.includes("apiRouter.delete('/weights/:id'"), true);
  assert.equal(server.includes("apiRouter.post('/weights/:id/delete'"), true);
  assert.equal(server.includes("apiRouter.post('/weights/delete'"), true);
});


test('workout parser uses server endpoint with local fallback', () => {
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(script.includes("/api/parse-workout"), true);
  assert.equal(script.includes('Used fallback workout parsing'), true);
  assert.equal(server.includes("apiRouter.post('/parse-workout'"), true);
});


test('workout target input lives on workout page and not analysis form', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');

  assert.equal(html.includes('id="edit-workout-target-link"'), true);
  assert.equal(script.includes('showWorkoutTargetModal'), true);
  assert.equal(html.includes('id="analysis-planned-workouts"'), false);
  assert.equal(script.includes('/api/macro-targets/workouts'), true);
  assert.equal(script.includes('plannedWorkoutsPerWeek: Number(analysisPlannedWorkoutsEl?.value || 5)'), false);
});
