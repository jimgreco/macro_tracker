const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('iOS Safari viewport baseline is present', () => {
  const html = read('public/index.html');

  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1\.0"\s*\/>/i);
});

test('iOS Safari menu flow has touch-accessible page controls', () => {
  const html = read('public/index.html');
  const css = read('public/styles.css');

  assert.equal(html.includes('class="main-nav"'), true);
  assert.equal(html.includes('class="nav-tab is-active" data-page="today"'), true);
  assert.equal(html.includes('class="nav-tab" data-page="macros"'), true);
  assert.equal(html.includes('class="nav-tab" data-page="workout"'), true);
  assert.equal(html.includes('class="nav-tab" data-page="health"'), true);
  assert.equal(html.includes('class="nav-tab" data-page="insights"'), true);
  assert.equal(html.includes('class="health-subnav-btn" role="tab"'), true);

  // Keep menu controls finger-friendly on mobile Safari.
  assert.equal(css.includes('@media (max-width: 760px)'), true);
  assert.equal(css.includes('.main-nav'), true);
  assert.equal(css.includes('.nav-tab'), true);
  assert.equal(css.includes('.health-subnav-btn'), true);
});

test('iOS Safari pages remain togglable via hidden attribute', () => {
  const html = read('public/index.html');
  const css = read('public/styles.css');
  const script = read('public/script.js');

  assert.equal(html.includes('id="today-page" class="app-page is-active"'), true);
  assert.equal(html.includes('id="workout-page" class="app-page" hidden'), true);
  assert.equal(html.includes('id="health-page" class="app-page" hidden'), true);
  assert.equal(html.includes('id="weight-page" class="health-pane"'), true);
  assert.equal(html.includes('id="sleep-page" class="health-pane'), true);
  assert.equal(css.includes('.app-page[hidden]'), true);
  assert.equal(css.includes('.health-pane[hidden]'), true);
  assert.equal(script.includes('function renderActivePage(pageKey'), true);
  assert.equal(script.includes('section.hidden = !active;'), true);
});
