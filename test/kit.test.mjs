// The maintenance kit: Dependabot config, CI, the weekly upkeep job, hygiene files and the
// small dossier. The private source of this repo must not spend its capped Actions minutes,
// so every job is gated on the public repository's name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const WORKFLOWS = existsSync(WORKFLOW_DIR) ? readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
const GATE = "if: github.repository == 'kd-011/party-games'";

// Job ids in a workflow that do not carry the gate as a job-level `if:`.
function ungatedJobs(yaml) {
  const body = yaml.split(/^jobs:\s*$/m)[1];
  if (body === undefined) return ['(no jobs block)'];
  const jobs = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  if (!jobs.length) return ['(no jobs)'];
  return jobs.filter((m, i) => {
    const block = body.slice(m.index, jobs[i + 1]?.index ?? body.length);
    return !block.split('\n').some((l) => l === `    ${GATE}`);
  }).map((m) => m[1]);
}

test('the workflows exist: CI and the weekly upkeep', () => {
  assert.deepEqual(WORKFLOWS.sort(), ['ci.yml', 'upkeep.yml']);
});

test('every job in every workflow is gated on the public repository, so none runs in the private source', () => {
  for (const f of WORKFLOWS) assert.deepEqual(ungatedJobs(read(`.github/workflows/${f}`)), [], f);
});

test('weaken the gate check: a missing, loosened or step-level gate is caught, so the test above really guards', () => {
  const job = (id, line) => `  ${id}:\n${line}    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  const yaml = (...jobs) => `name: x\n\njobs:\n${jobs.join('\n')}`;
  const good = `    ${GATE}\n`;
  assert.deepEqual(ungatedJobs(yaml(job('a', good), job('b', good))), []);
  assert.deepEqual(ungatedJobs(yaml(job('a', good), job('b', ''))), ['b'], 'one job without it');
  assert.deepEqual(ungatedJobs(yaml(job('a', "    if: github.repository != 'someone/fork'\n"))), ['a'], 'a different condition');
  assert.deepEqual(ungatedJobs(yaml(job('a', `    ${GATE} || true\n`))), ['a'], 'a condition that always holds');
  assert.deepEqual(ungatedJobs(yaml(`  a:\n    runs-on: ubuntu-latest\n    steps:\n      - ${GATE}\n        run: echo hi\n`)), ['a'], 'on a step, the runner still starts and spends minutes');
  // the check itself goes red on the real files once one gate line is removed
  for (const f of WORKFLOWS) {
    const y = read(`.github/workflows/${f}`);
    assert.notDeepEqual(ungatedJobs(y.replace(`    ${GATE}\n`, '')), [], `${f} with one gate removed`);
  }
});

test('an exported repo has no auto-merge workflow and no ruleset: nothing merges on the public repo', () => {
  assert.ok(!existsSync(join(ROOT, '.github/workflows/dependabot-automerge.yml')));
  assert.ok(!existsSync(join(ROOT, '.github/rulesets')));
  assert.ok(!existsSync(join(ROOT, '.github/scripts/automerge-eligible.mjs')));
});

test('dependabot: weekly npm and github-actions, grouped minor and patch, a 7 day cooldown', () => {
  const y = read('.github/dependabot.yml');
  assert.match(y, /package-ecosystem: npm/);
  assert.match(y, /package-ecosystem: github-actions/);
  assert.equal((y.match(/interval: weekly/g) ?? []).length, 2);
  assert.doesNotMatch(y, /interval: (daily|monthly)/);
  assert.equal((y.match(/cooldown:\s*\n\s+default-days: 7/g) ?? []).length, 2);
  assert.equal((y.match(/patterns:\s*\n\s+- "\*"\s*\n\s+update-types:\s*\n\s+- minor\s*\n\s+- patch/g) ?? []).length, 2);
});

test('no workflow uses pull_request_target or expands attacker-controlled text', () => {
  const UNTRUSTED = /\$\{\{\s*github\.(head_ref|event\.(pull_request\.(title|body|head\.(ref|label))|issue\.(title|body)|comment\.body|review\.body))/;
  for (const f of WORKFLOWS) {
    const y = read(`.github/workflows/${f}`);
    assert.doesNotMatch(y, UNTRUSTED, f);
    assert.doesNotMatch(y, /pull_request_target/, f);
  }
});

test('third-party actions are pinned by full SHA and permissions are least privilege', () => {
  for (const f of WORKFLOWS) {
    const y = read(`.github/workflows/${f}`);
    for (const m of y.matchAll(/uses:\s*([^\s#]+)/g)) {
      if (m[1].startsWith('actions/') || m[1].startsWith('./')) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]}`);
    }
    assert.match(y, /^permissions:\s*\n\s+contents: read/m, `${f} defaults to read only`);
    assert.doesNotMatch(y, /write-all/, f);
  }
});

test('ci: runs the tests and the scan on push, pull request and a weekly schedule, and the README carries its badge', () => {
  const y = read('.github/workflows/ci.yml');
  assert.match(y, /^ {2}push:/m);
  assert.match(y, /^ {2}pull_request:/m);
  assert.match(y, /schedule:\s*\n\s+- cron: "[^"]+ \* \* \d"/);
  assert.match(y, /npm ci/);
  assert.match(y, /npm test/);
  assert.match(y, /node scripts\/secret-scan\.mjs \. --tracked/);
  assert.match(read('README.md'), /kd-011\/party-games\/actions\/workflows\/ci\.yml\/badge\.svg/);
});

test('upkeep: weekly link check and drift, retries, a pinned install, one issue each', () => {
  const y = read('.github/workflows/upkeep.yml');
  assert.match(y, /schedule:\s*\n\s+- cron: "[^"]+ \* \* \d"/);
  assert.match(y, /lycheeverse\/lychee-action@[0-9a-f]{40}/);
  assert.match(y, /--max-retries/);
  assert.match(y, /npm install -g github:kd-011\/dossier-scribe#v\d+\.\d+\.\d+\b/);
  assert.doesNotMatch(y, /dossier-scribe#(main|master)\b/);
  assert.match(y, /sync-issue\.sh link-rot/);
  assert.match(y, /sync-issue\.sh dossier-drift/);
  assert.ok(existsSync(join(ROOT, '.github/scripts/sync-issue.sh')));
});

test('hygiene files exist, and the security contact is private reporting, never an email', () => {
  for (const f of ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  for (const f of ['SECURITY.md', 'CODE_OF_CONDUCT.md']) {
    assert.match(read(f), /kd-011\/party-games\/security\/advisories\/new/, f);
    assert.doesNotMatch(read(f), /[\w.+-]+@[\w-]+\.[\w.]+/, `no email address in ${f}`);
  }
  assert.match(read('SECURITY.md'), /private vulnerability reporting/i);
});

test('the README says plainly that the drinking tiers are for adults', () => {
  assert.match(read('README.md'), /18\+/);
});

test('the social preview is a 1280x640 PNG on the export allowlist', () => {
  const b = readFileSync(join(ROOT, '.github/social-preview.png'));
  assert.equal(b.subarray(1, 4).toString(), 'PNG');
  assert.equal(b.readUInt32BE(16), 1280);
  assert.equal(b.readUInt32BE(20), 640);
  assert.ok(read('scripts/export-allowlist.txt').split('\n').includes('.github/social-preview.png'));
});

test('the dossier has 5 to 15 cited claims, each one pinned in the lock', () => {
  const doc = read('dossiers/games.md');
  const claims = doc.split('\n').filter((l) => /^- .*<!-- src: .+ -->$/.test(l));
  assert.ok(claims.length >= 5 && claims.length <= 15, `claims: ${claims.length}`);
  const lock = JSON.parse(read('dossiers/.dossier-lock.json'));
  assert.equal(Object.keys(lock.docs.games.claims).length, claims.length);
  assert.deepEqual(JSON.parse(read('dossier-scribe.json')).collectors, ['package'], 'names only: git and filetypes print counts that go stale on every commit');
});

// sync-issue.sh against a stub `gh`: the stub reports one open issue (or none) and records its calls.
function runSync({ existing, existingBody = '', args }) {
  const dir = mkdtempSync(join(tmpdir(), 'games-sync-issue-'));
  try {
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
case "$1 $2" in
  "label create") exit 0 ;;
  "issue list") echo '${JSON.stringify(existing ? [{ number: 7, title: 'T' }] : [])}' ;;
  "issue view") printf '%s' '${existingBody}' ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(dir, 'body.md'), 'problem text\n');
    const r = spawnSync('sh', [join(ROOT, '.github/scripts/sync-issue.sh'), 'lbl', 'T', ...args.map((a) => (a === 'BODY' ? join(dir, 'body.md') : a))], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(log, 'utf8').split('\n').filter((l) => /^issue (create|edit|close)/.test(l)).map((c) => c.split(' ').slice(0, 2).join(' '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('sync-issue: opens one issue for a problem, never duplicates, closes when clean', { skip: spawnSync('jq', ['--version']).status !== 0 && 'jq not installed' }, () => {
  assert.deepEqual(runSync({ existing: false, args: ['BODY'] }), ['issue create']);
  assert.deepEqual(runSync({ existing: true, existingBody: 'old', args: ['BODY'] }), ['issue edit']);
  assert.deepEqual(runSync({ existing: true, existingBody: 'problem text', args: ['BODY'] }), [], 'an unchanged body is left alone');
  assert.deepEqual(runSync({ existing: true, args: [] }), ['issue close']);
  assert.deepEqual(runSync({ existing: false, args: [] }), [], 'a clean run with no issue does nothing');
});
