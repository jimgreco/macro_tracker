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

test('weight page is weekly-only and split into three sections', () => {
  const html = read('public/index.html');
  const script = read('public/script.js');

  assert.equal(html.includes('id="weight-log-section"'), true);
  assert.equal(html.includes('id="weight-entries-section"'), true);
  assert.equal(html.includes('id="weight-snapshot-section"'), true);
  assert.equal(html.includes('data-weight-scope="month"'), false);
  assert.equal(html.includes('data-weight-scope="year"'), false);
  assert.equal(script.includes('weightScope'), false);
  assert.equal(script.includes('/api/weights?scope=week'), true);
});

test('weight entries support inline edit and delete actions', () => {
  const script = read('public/script.js');
  const server = read('src/server.js');

  assert.equal(script.includes('data-weight-action="edit"'), true);
  assert.equal(script.includes('data-weight-action="save"'), true);
  assert.equal(script.includes('data-weight-action="delete"'), true);
  assert.equal(script.includes('/api/weights/${entryId}'), true);
  assert.equal(server.includes("app.put('/api/weights/:id'"), true);
  assert.equal(server.includes("app.delete('/api/weights/:id'"), true);
});
