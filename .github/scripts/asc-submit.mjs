#!/usr/bin/env node
// Submit an existing, processed App Store-eligible build for App Store review.
// `plan` is GET-only and prints what `submit` would change. `submit` only
// creates/edits the marketing version, its What's New text, its build, and
// one review submission; it never touches TestFlight groups, testers, pricing,
// or signing resources.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { policy, token } from './asc-readonly.mjs';

const origin = 'https://api.appstoreconnect.apple.com';
const check = (ok, message) => { if (!ok) throw new Error(message); };
// Apple accepts new metadata and a new build only in these version states.
export const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'];
const activeReviewStates = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'];

export function apiClient(fetcher = fetch, auth = token) {
  async function request(method, path, body) {
    const url = new URL(path, `${origin}/v1/`);
    check(url.origin === origin && url.pathname.startsWith('/v1/') && !url.username && !url.password && !url.hash, 'Untrusted Apple URL.');
    const headers = { Authorization: `Bearer ${auth()}`, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await fetcher(url.href, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers, body: body && JSON.stringify(body) }); }
    catch { throw new Error(`Apple ${method} failed at ${url.pathname}.`); }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).errors?.map(e => e.detail || e.title).join('; ') || ''; } catch {}
      throw new Error(`Apple ${method} rejected (${response.status}) at ${url.pathname}${detail ? ': ' + detail : ''}`);
    }
    return response.status === 204 ? null : response.json();
  }
  return { get: path => request('GET', path), send: request };
}

export function validateWhatsNew(text) {
  check(typeof text === 'string' && text.trim().length > 0 && text.length <= 4000, "What's New text must be 1-4000 characters.");
  return text.trim();
}

export async function inspect(client, build, p = policy) {
  check(/^[1-9][0-9]*$/.test(String(build)), 'A positive build number is required.');
  const apps = (await client.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(p.bundleId)}`)).data;
  check(apps.length === 1 && apps[0].attributes?.bundleId === p.bundleId, 'Exactly one existing Macros App Store record is required.');
  const appId = apps[0].id;
  const builds = (await client.get(`/v1/builds?filter[app]=${appId}&filter[version]=${build}&filter[preReleaseVersion.version]=${encodeURIComponent(p.marketingVersion)}&filter[preReleaseVersion.platform]=IOS`)).data;
  check(builds.length === 1, `Build ${build} for ${p.marketingVersion} was not found.`);
  const b = builds[0].attributes;
  check(b.processingState === 'VALID' && b.expired === false, `Build ${build} is not processed and valid.`);
  check(b.buildAudienceType === 'APP_STORE_ELIGIBLE', `Build ${build} is ${b.buildAudienceType}; only App Store-eligible builds can be submitted.`);
  const versions = (await client.get(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=200`)).data;
  const version = versions.find(v => v.attributes.versionString === p.marketingVersion) || null;
  if (version) check(editableStates.includes(version.attributes.appStoreState), `Version ${p.marketingVersion} is ${version.attributes.appStoreState} and cannot be changed.`);
  const otherOpen = versions.filter(v => v !== version && editableStates.includes(v.attributes.appStoreState));
  check(!otherOpen.length, `Another editable version exists: ${otherOpen.map(v => v.attributes.versionString).join(', ')}.`);
  const live = versions.find(v => v.attributes.appStoreState === 'READY_FOR_SALE') || null;
  const localizations = version ? (await client.get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`)).data : [];
  const submissions = (await client.get(`/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&limit=200`)).data;
  const active = submissions.filter(s => activeReviewStates.includes(s.attributes.state));
  check(!active.length, `A review submission is already ${active.map(s => s.attributes.state).join(', ')}.`);
  return {
    appId, buildId: builds[0].id, build: String(build), marketingVersion: p.marketingVersion,
    version: version && { id: version.id, state: version.attributes.appStoreState, releaseType: version.attributes.releaseType },
    live: live && { versionString: live.attributes.versionString },
    localizations: localizations.map(l => ({ id: l.id, locale: l.attributes.locale, whatsNew: l.attributes.whatsNew })),
    draftSubmission: submissions.find(s => s.attributes.state === 'READY_FOR_REVIEW')?.id || null,
  };
}

export async function submit(client, build, whatsNew, p = policy) {
  const text = validateWhatsNew(whatsNew);
  const state = await inspect(client, build, p);
  let versionId = state.version?.id;
  if (!versionId) {
    versionId = (await client.send('POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString: p.marketingVersion },
      relationships: { app: { data: { type: 'apps', id: state.appId } } } } })).data.id;
  }
  // A new version inherits the live version's localizations from Apple.
  const localizations = (await client.get(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`)).data;
  check(localizations.length > 0, 'The version has no localizations to update.');
  for (const l of localizations) {
    await client.send('PATCH', `/v1/appStoreVersionLocalizations/${l.id}`, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: text } } });
  }
  await client.send('PATCH', `/v1/appStoreVersions/${versionId}/relationships/build`, { data: { type: 'builds', id: state.buildId } });
  let submissionId = state.draftSubmission;
  if (!submissionId) {
    submissionId = (await client.send('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions',
      attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: state.appId } } } } })).data.id;
  }
  const items = (await client.get(`/v1/reviewSubmissions/${submissionId}/items?limit=200`)).data;
  const included = items.some(i => i.relationships?.appStoreVersion?.data?.id === versionId);
  if (!included) {
    await client.send('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } } } });
  }
  const result = (await client.send('PATCH', `/v1/reviewSubmissions/${submissionId}`, { data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } } })).data;
  return { appId: state.appId, versionId, marketingVersion: p.marketingVersion, build: state.build, submissionId, state: result.attributes.state, locales: localizations.map(l => l.attributes.locale) };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`); check(i >= 0 && process.argv[i + 1], `Missing --${name}.`); return process.argv[i + 1];
}
async function main() {
  const client = apiClient(), mode = process.argv[2];
  if (mode === 'plan') {
    console.log(JSON.stringify(await inspect(client, arg('build')), null, 2));
  } else if (mode === 'submit') {
    console.log(JSON.stringify(await submit(client, arg('build'), readFileSync(arg('whats-new-file'), 'utf8')), null, 2));
  } else throw new Error('Expected plan or submit.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
