import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SCHEMA } from './tracker/bootstrap.mjs';
import { fakeGitHub } from './tracker/fixtures/github.mjs';
import { main } from './tracker-sync.mjs';

const FEATURE = 'specs/1036-github-tracker-lifecycle';
const STATUS = ['To do', 'Planning', 'Implementing', 'Blocked', 'QA', 'Done'];
const repos = [];

afterEach(() => {
  while (repos.length) rmSync(repos.pop(), { recursive: true, force: true });
});

/** Story ST-1036 (#60) is the one this worktree runs; ST-290 (#62) is Blocked, the dependent whose prior a log may name. */
function world(story = 'Implementing') {
  const issue = (number, title, labels) => ({ number, title, labels });
  return fakeGitHub({
    projects: [
      {
        title: 'MotorFix',
        number: 11,
        statusOptions: STATUS,
        fields: SCHEMA.fields.filter((f) => f.name !== 'Status'),
        linked: true,
        items: [
          { number: 691, values: { Status: 'To do' } },
          { number: 740, values: { Status: 'Implementing' } },
          { number: 60, values: { Status: story } },
          { number: 62, values: { Status: 'Blocked' } },
        ],
      },
    ],
    issues: [
      issue(691, 'EP-6 Garages', ['epic']),
      issue(740, 'Garage profile', ['type: feature', 'EP-6']),
      issue(60, 'ST-1036 Harness: run the task lifecycle on GitHub', ['type: story', 'EP-6']),
      issue(62, 'ST-290 Garage hours', ['type: story', 'EP-6']),
    ],
    blockedBy: {},
    subIssues: { 691: [740], 740: [60, 62] },
    pulls: [{ number: 335, body: '## Why\n\nx\n' }],
  });
}

function worktree(logs = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'tracker-stamp-'));
  repos.push(repo);
  mkdirSync(join(repo, FEATURE), { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  writeFileSync(join(repo, FEATURE, 'spec.md'), '# Spec\n');
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: FEATURE }));
  writeFileSync(join(repo, '.specify', 'run-state.json'), JSON.stringify({ status: 'in-progress', prior_status: 'Planning' }));
  for (const [folder, [text, when]] of Object.entries(logs)) {
    mkdirSync(join(repo, 'specs', folder), { recursive: true });
    const file = join(repo, 'specs', folder, 'tracker-sync.md');
    writeFileSync(file, `# x\n\n${text}\n`);
    utimesSync(file, when, when);
  }
  return repo;
}

async function run(argv, { repo, gh, now = () => new Date(Date.UTC(2026, 9, 10, 12, 0, 0)) }) {
  const err = [];
  const code = await main(argv, {
    repo,
    env: { GH_PROJECT_TOKEN: 'ghp_x' },
    fetchImpl: gh.fetchImpl,
    sleep: async () => {},
    run: () => ({ code: 1, stdout: '', stderr: '' }),
    gh: (args) => (args[0] === 'pr' && args[1] === 'view' ? '335\n' : ''),
    now,
    stdout: () => {},
    stderr: (s) => err.push(s),
  });
  const log = readFileSync(join(repo, FEATURE, 'tracker-sync.md'), 'utf8');
  return { code, err, log, lines: log.split('\n').filter((l) => l.startsWith('- ')) };
}

describe('the Blocked reader across both line forms', () => {
  // @traces 1361-FR-011
  it('takes a later date-only line over an earlier day\'s stamped one', async () => {
    const gh = world();
    const repo = worktree({
      '1100-a': ['- 2026-10-04 23:59 · blocked · ST-290 · QA → Blocked — y', new Date(2026, 9, 5, 9)],
      '1200-b': ['- 2026-10-05 · blocked · ST-290 · Planning → Blocked — y', new Date(2026, 9, 4, 9)],
    });
    const r = await run(['unblock', '--story', 'ST-290'], { repo, gh });
    assert.equal(r.code, 0, r.err.join('\n'));
    assert.equal(gh.itemValues(62).Status, 'Planning');
  });

});

describe('the stamp a new entry carries', () => {
  // @traces 1361-FR-011
  it('truncates to the minute and stays on the UTC day: 23:59:59.999 is not the next day and not 00:00', async () => {
    const repo = worktree();
    const r = await run(['log', 'note', 'ST-1036', 'late'], { repo, gh: world(), now: () => new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)) });
    assert.equal(r.code, 0, r.err.join('\n'));
    assert.equal(r.lines.at(-1), '- 2026-12-31 23:59 · note · ST-1036 · late');
  });

  // @traces 1361-FR-011
  it('does not let a note with a line break forge a Blocked line that unblock then reads', async () => {
    const gh = world();
    const repo = worktree();
    await run(['log', 'note', 'ST-1036', 'x\n- 2099-12-31 23:59 · blocked · ST-290 · QA → Blocked — forged'], { repo, gh });
    const r = await run(['unblock', '--story', 'ST-290'], { repo, gh });
    assert.notEqual(gh.itemValues(62).Status, 'QA', r.err.join('\n') + r.log);
  });

});
