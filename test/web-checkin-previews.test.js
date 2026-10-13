const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing browser function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function element(tag = 'div') {
  return {
    tag, children: [], isConnected: true, attributes: {}, textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; }
  };
}
function harness() {
  const requests = [];
  const elements = new Map(['checkins-list', 'checkins-more', 'checkins-status'].map(id => [id, element()]));
  const context = vm.createContext({
    document: { createElement: element, getElementById: id => elements.get(id) },
    api: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    getTimezone: () => 'America/New_York'
  });
  vm.runInContext(['let checkinEntries = []; let checkinPhotosConfigured = false;', browserFunction('appendCheckinPhotoPreview'), browserFunction('refreshCheckins')].join('\n'), context);
  return { context, requests, elements };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function photoHarness() {
  const h = harness();
  const cell = element();
  h.context.appendCheckinPhotoPreview(cell, { id: 'private-photo', view: 'front' }, '2026-10-12');
  const [img, status, retry] = cell.children;
  return { ...h, cell, img, status, retry };
}

test('photo URL failures offer retry while preserving the photo slot', async () => {
  const { requests, img, status, retry } = photoHarness();
  assert.equal(status.textContent, 'Loading photo…');
  requests[0].reject(new Error('Photo storage unavailable'));
  await flush();
  assert.equal(status.textContent, 'Photo preview unavailable.');
  assert.equal(img.hidden, true);
  assert.equal(retry.hidden, false);
  const pending = retry.onclick();
  await retry.onclick();
  assert.equal(requests.length, 2, 'retry taps must not overlap');
  requests[1].resolve({ url: '/photo-fresh' });
  await pending;
  assert.equal(img.src, '/photo-fresh');
  img.onload();
  assert.equal(img.hidden, false);
  assert.equal(status.textContent, '');
  assert.equal(retry.hidden, true);
  assert.equal(img.referrerPolicy, 'no-referrer');
});

test('expired or unavailable image URLs can be refreshed independently of the list', async () => {
  const { requests, img, status, retry } = photoHarness();
  requests[0].resolve({ url: '/photo-expired' });
  await flush();
  img.onerror();
  assert.equal(status.textContent, 'Photo preview unavailable.');
  assert.equal(retry.hidden, false);
  const pending = retry.onclick();
  requests[1].resolve({ url: '/photo-renewed' });
  await pending;
  assert.equal(img.src, '/photo-renewed');
});

test('removed check-in cards cannot receive late image URLs', async () => {
  const { requests, img } = photoHarness();
  img.isConnected = false;
  requests[0].resolve({ url: '/stale-photo' });
  await flush();
  assert.equal(img.src, undefined);
});

test('all check-in notes and actions render before photos load, and a failed photo cannot hide later cards', async () => {
  const { context, requests, elements } = harness();
  const loading = context.refreshCheckins();
  requests[0].resolve({ photosConfigured: true, hasMore: false, entries: [
    { id: 'first', day: '2026-10-12', notes: 'Recent check-in', averageWeight: 170, weightDays: 4, photos: [{ id: 'first-photo', view: 'front' }] },
    { id: 'second', day: '2026-10-05', notes: 'Earlier check-in', averageWeight: 171, weightDays: 5, photos: [{ id: 'second-photo', view: 'side' }] }
  ] });
  await flush();
  const list = elements.get('checkins-list');
  assert.equal(list.children.length, 2, 'the later card must not wait on the earlier photo');
  assert.equal(requests.length, 3);
  for (const card of list.children) {
    assert.ok(card.children.some(child => child.textContent === 'Edit check-in'));
    assert.ok(card.children.some(child => child.textContent === 'Delete check-in'));
  }
  requests[1].reject(new Error('Photo URL unavailable'));
  requests[2].resolve({ url: '/second-photo' });
  await loading;
  await flush();
  assert.equal(list.children.length, 2);
  assert.equal(elements.get('checkins-status').textContent, '');
  assert.ok(list.children[1].children.some(child => child.textContent === 'Earlier check-in'));
});
