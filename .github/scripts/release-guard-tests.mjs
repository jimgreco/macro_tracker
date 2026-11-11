// Repo-specific release checks. The TestFlight engine's own guard tests run in
// jimgreco/release-tools CI; these cover only the App Store submit tooling and
// the macros-specific marketing-version alignment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { policy as basePolicy } from './asc-readonly.mjs';
import { inspect, submit, validateWhatsNew } from './asc-submit.mjs';

test('every Xcode target configuration matches the pinned marketing version', () => {
  const project = readFileSync(new URL('../../ios/DailyMacros/DailyMacros.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const versions = [...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map(match => match[1]);
  assert.equal(versions.length, 6, 'Check Debug and Release for the app and both test targets.');
  assert.match(basePolicy.marketingVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.deepEqual([...new Set(versions)], [basePolicy.marketingVersion]);
});

function submitFixture(overrides = {}) {
  const calls = [], app = 'app1', p = basePolicy;
  const versions = overrides.versions ?? [{ id: 'live', attributes: { versionString: '1.2.0', appStoreState: 'READY_FOR_SALE' } }];
  const routes = {
    [`/v1/apps?filter[bundleId]=${p.bundleId}`]: { data: [{ id: app, attributes: { bundleId: p.bundleId } }] },
    [`/v1/builds?filter[app]=${app}&filter[version]=316&filter[preReleaseVersion.version]=${p.marketingVersion}&filter[preReleaseVersion.platform]=IOS`]:
      { data: [{ id: 'b316', attributes: { processingState: 'VALID', expired: false, buildAudienceType: overrides.audience ?? 'APP_STORE_ELIGIBLE' } }] },
    [`/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&limit=200`]: { data: versions },
    [`/v1/reviewSubmissions?filter[app]=${app}&filter[platform]=IOS&limit=200`]: { data: overrides.submissions ?? [] },
    '/v1/appStoreVersions/new/appStoreVersionLocalizations?limit=200': { data: [{ id: 'loc', attributes: { locale: 'en-US' } }] },
    '/v1/reviewSubmissions/sub/items?limit=200': { data: [] },
  };
  const client = {
    get: async path => { const r = routes[path]; assert.ok(r, 'unexpected GET ' + path); calls.push(['GET', path]); return r; },
    send: async (method, path, body) => {
      calls.push([method, path, body]);
      if (path === '/v1/appStoreVersions') return { data: { id: 'new' } };
      if (path === '/v1/reviewSubmissions') return { data: { id: 'sub' } };
      if (path === '/v1/reviewSubmissions/sub') return { data: { attributes: { state: 'WAITING_FOR_REVIEW' } } };
      return { data: {} };
    },
  };
  return { client, calls };
}

test('App Store plan is GET-only and refuses internal-only builds or busy review', async () => {
  const f = submitFixture();
  const plan = await inspect(f.client, '316');
  assert.equal(plan.version, null);
  assert.equal(plan.live.versionString, '1.2.0');
  assert.ok(f.calls.every(([method]) => method === 'GET'));
  await assert.rejects(() => inspect(submitFixture({ audience: 'INTERNAL_ONLY' }).client, '316'), /App Store-eligible/);
  await assert.rejects(() => inspect(submitFixture({ submissions: [{ attributes: { state: 'WAITING_FOR_REVIEW' } }] }).client, '316'), /already/);
  await assert.rejects(() => inspect(submitFixture({ versions: [{ id: 'v', attributes: { versionString: basePolicy.marketingVersion, appStoreState: 'WAITING_FOR_REVIEW' } }] }).client, '316'), /cannot be changed/);
  await assert.rejects(() => inspect(submitFixture({ versions: [{ id: 'v', attributes: { versionString: '9.9.9', appStoreState: 'PREPARE_FOR_SUBMISSION' } }] }).client, '316'), /Another editable/);
});

test('App Store submit creates the version, sets notes and build, then submits once', async () => {
  const f = submitFixture();
  const result = await submit(f.client, '316', ' Fits your day suggestions. ');
  assert.equal(result.state, 'WAITING_FOR_REVIEW');
  const writes = f.calls.filter(([method]) => method !== 'GET').map(([method, path]) => `${method} ${path}`);
  assert.deepEqual(writes, [
    'POST /v1/appStoreVersions',
    'PATCH /v1/appStoreVersionLocalizations/loc',
    'PATCH /v1/appStoreVersions/new/relationships/build',
    'POST /v1/reviewSubmissions',
    'POST /v1/reviewSubmissionItems',
    'PATCH /v1/reviewSubmissions/sub',
  ]);
  assert.equal(f.calls.find(([, path]) => path === '/v1/appStoreVersionLocalizations/loc')[2].data.attributes.whatsNew, 'Fits your day suggestions.');
  assert.throws(() => validateWhatsNew('   '));
});
