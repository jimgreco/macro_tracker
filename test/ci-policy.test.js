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

test('release workflows run only on main after verify and cannot bypass it', () => {
  for (const reusable of ['verify.yml', 'testflight.yml']) {
    const workflow = read(`.github/workflows/${reusable}`);
    const on = topLevelBlock(workflow, 'on');
    assert.match(on, /^\s{2}workflow_call:\s*$/m, `${reusable} must be reusable`);
    assert.doesNotMatch(on, /^\s{2}(push|pull_request|workflow_dispatch|schedule):/m, `${reusable} must only run through release.yml`);
  }
  assert.doesNotMatch(read('.github/workflows/testflight.yml'), /distribution/, 'audience comes from the release policy, not a workflow input');
  for (const retired of ['ci.yml', 'deploy.yml', 'publish.yml']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', '.github/workflows', retired)), false, `${retired} is replaced by release.yml`);
  }

  const release = read('.github/workflows/release.yml');
  const on = topLevelBlock(release, 'on');
  assert.match(on, /^\s{2}pull_request:\s*$/m);
  assert.match(on, /^\s{2}push:\s*\n\s{4}branches: \[main\]\s*$/m);
  assert.match(on, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(jobBlock(release, 'verify'), /uses: \.\/\.github\/workflows\/verify\.yml\s*$/m);
  for (const [jobName, uses] of [
    ['server', /uses: jimgreco\/release-tools\/\.github\/workflows\/server-release\.yml@[0-9a-f]{40}\s*$/m],
    ['ios', /uses: \.\/\.github\/workflows\/testflight\.yml\s*$/m]
  ]) {
    const block = jobBlock(release, jobName);
    assert.match(block, /^\s{4}needs: verify\s*$/m);
    assert.match(block, /github\.ref == 'refs\/heads\/main'/);
    // Pushes to main release automatically; pull requests never release.
    assert.match(block, /github\.event_name == 'push'/);
    assert.doesNotMatch(block, /pull_request/);
    assert.match(block, new RegExp(`inputs\\.${jobName}\\)`));
    assert.match(block, uses);
  }
  const server = jobBlock(release, 'server');
  const pinned = /server-release\.yml@([0-9a-f]{40})/.exec(server)[1];
  assert.match(server, new RegExp(`tools_ref: ${pinned}`));
  for (const secret of ['EC2_HOST', 'EC2_USER', 'EC2_SSH_KEY', 'EC2_SSH_KNOWN_HOSTS']) {
    assert.match(server, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`));
  }
  assert.match(read('.github/workflows/testflight.yml'), new RegExp(`ios/prepare@${pinned}`), 'server and iOS share one release-tools pin');
  assert.doesNotMatch(release, /app_store_build|distribution:|production-smoke/);
});

test('App Store submission is main-only, plans by default, and never uploads', () => {
  const workflow = read('.github/workflows/app-store-submit.yml');
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /submit:\n(?:\s+.*\n)*?\s+default: false/);
  assert.match(workflow, /if: inputs\.submit/);
  assert.ok(workflow.indexOf('asc-submit.mjs plan') < workflow.indexOf('asc-submit.mjs submit'));
  assert.doesNotMatch(workflow, /altool|xcodebuild|\$\{\{ inputs\.whats_new \}\}"/);
});

test('the stable verify / Required Checks context aggregates every required surface', () => {
  const verify = read('.github/workflows/verify.yml');
  const required = jobBlock(verify, 'required');
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

test('JavaScript CI audits production dependencies after install', () => {
  const javascript = jobBlock(read('.github/workflows/verify.yml'), 'javascript');
  assert.match(javascript, /^\s+run: npm audit --omit=dev\s*$/m);
  assert.ok(
    javascript.indexOf('npm ci') < javascript.indexOf('npm audit --omit=dev'),
    'audit must run against the installed lockfile'
  );
});

test('PostgreSQL CI fails if any mandatory database suite skips', () => {
  const postgres = jobBlock(read('.github/workflows/verify.yml'), 'postgres');
  assert.match(postgres, /npm run test:db:integration/);
  assert.match(postgres, /macro_tracker_fresh_test/);
  assert.match(postgres, /npm run test:db:upgrade/);
  assert.equal(
    (postgres.match(/grep -Eq '\^# skipped 0\$'/g) || []).length,
    3
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
