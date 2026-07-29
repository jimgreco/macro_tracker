const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function topLevelBlock(source, key) {
  const startMatch = new RegExp(`^${key}:\\s*$`, 'm').exec(source);
  assert.ok(startMatch, `missing top-level ${key} block`);
  const start = startMatch.index + startMatch[0].length;
  const remainder = source.slice(start);
  const endMatch = /^\S.*$/m.exec(remainder);
  return endMatch ? remainder.slice(0, endMatch.index) : remainder;
}

function jobBlock(source, jobName) {
  const jobs = topLevelBlock(source, 'jobs');
  const startMatch = new RegExp(`^  ${jobName}:\\s*$`, 'm').exec(jobs);
  assert.ok(startMatch, `missing ${jobName} job`);
  const start = startMatch.index + startMatch[0].length;
  const remainder = jobs.slice(start);
  const endMatch = /^  [a-zA-Z0-9_-]+:\s*$/m.exec(remainder);
  return endMatch ? remainder.slice(0, endMatch.index) : remainder;
}

test('release workflows are reusable only and cannot bypass required CI', () => {
  for (const workflow of [
    '.github/workflows/deploy.yml',
    '.github/workflows/testflight.yml'
  ]) {
    const triggers = topLevelBlock(read(workflow), 'on');
    assert.match(triggers, /^\s{2}workflow_call:\s*$/m, `${workflow} must expose workflow_call`);
    assert.doesNotMatch(triggers, /^\s+push:/m, `${workflow} must not deploy directly on push`);
    assert.doesNotMatch(
      triggers,
      /^\s+workflow_dispatch:/m,
      `${workflow} must not expose a gate-bypassing dispatch`
    );
  }

  const orchestrator = read('.github/workflows/ci.yml');
  for (const [jobName, workflow] of [
    ['deploy', 'deploy.yml'],
    ['testflight', 'testflight.yml']
  ]) {
    const block = jobBlock(orchestrator, jobName);
    assert.match(block, /^\s{4}needs: required\s*$/m);
    assert.match(block, /if: needs\.required\.result == 'success'/);
    assert.match(block, new RegExp(`uses: \\.\\/\\.github\\/workflows\\/${workflow}`));
  }
});

test('the stable Required Checks context aggregates every required surface', () => {
  const orchestrator = read('.github/workflows/ci.yml');
  const required = jobBlock(orchestrator, 'required');
  assert.match(required, /^\s{4}name: Required Checks\s*$/m);
  assert.match(required, /^\s{4}if: always\(\)\s*$/m);

  for (const dependency of ['javascript', 'postgres', 'docker', 'browser', 'ios']) {
    assert.match(
      required,
      new RegExp(`^\\s{6}- ${dependency}\\s*$`, 'm'),
      `Required Checks must depend on ${dependency}`
    );
  }
});

test('PostgreSQL CI fails if either mandatory database suite skips', () => {
  const postgres = jobBlock(read('.github/workflows/ci.yml'), 'postgres');
  assert.match(postgres, /npm run test:db:integration/);
  assert.match(postgres, /npm run test:db:upgrade/);
  assert.equal(
    (postgres.match(/grep -Eq '\^# skipped 0\$'/g) || []).length,
    2
  );
});

test('branch-protection automation verifies the latest check and complete policy', () => {
  const configure = read('scripts/configure-required-checks.sh');
  const verify = read('scripts/verify-required-checks.sh');

  for (const script of [configure, verify]) {
    assert.match(
      script,
      /sort_by\(\[\(\.started_at \/\/ \.created_at \/\/ ""\), \(\.id \/\/ 0\)\]\)/
    );
    assert.match(script, /\|\s+last\s+\|/);
    assert.match(script, /completed\\tsuccess/);
  }

  for (const policy of [
    '"strict": true',
    '"contexts": ["${required_context}"]',
    '"enforce_admins": true',
    '"required_pull_request_reviews": null',
    '"restrictions": null',
    '"required_linear_history": true',
    '"allow_force_pushes": false',
    '"allow_deletions": false',
    '"required_conversation_resolution": true',
    '"lock_branch": false',
    '"allow_fork_syncing": false'
  ]) {
    assert.ok(configure.includes(policy), `configuration is missing ${policy}`);
  }

  for (const responseField of [
    'statusChecks.strict === true',
    'contexts.has(requiredContext)',
    'protection.enforce_admins?.enabled === true',
    'protection.required_linear_history?.enabled === true',
    'protection.allow_force_pushes?.enabled !== true',
    'protection.allow_deletions?.enabled !== true',
    'protection.required_conversation_resolution?.enabled === true',
    'protection.required_pull_request_reviews == null',
    'protection.restrictions == null',
    'protection.lock_branch?.enabled !== true',
    'protection.allow_fork_syncing?.enabled !== true'
  ]) {
    assert.ok(verify.includes(responseField), `verification is missing ${responseField}`);
  }
});
