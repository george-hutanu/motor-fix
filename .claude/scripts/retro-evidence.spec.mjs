import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { carryover, diffStat, featureCommits, gather, parseDeferred, render } from './retro-evidence.mjs';

// Tokens are assembled, never spelled out: the traceability matrix scans this
// file and a literal would be credited as coverage or reported as an orphan.
const T = (feature, n) => `${feature}${'-FR-'}${n}`;

function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-retro-'));
  for (const [rel, body] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return dir;
}

const git = (dir, args) =>
  execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });

/** A throwaway git repository with one feature and two commits touching it. */
function repoWithHistory() {
  const dir = fixture();
  git(dir, ['init', '-q', '-b', 'main']);
  // A commit before the feature, so the first feature commit has a parent —
  // the realistic case, and the one the range calculation is about.
  writeFileSync(join(dir, 'README.md'), 'before the feature\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'chore: start the repository']);
  mkdirSync(join(dir, 'specs/002-fixture'), { recursive: true });
  writeFileSync(join(dir, 'specs/002-fixture/spec.md'), `# Spec\n\n- **FR-001**: a thing\n`);
  writeFileSync(join(dir, 'other.txt'), 'unrelated\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'feat: add the fixture feature and its spec']);
  writeFileSync(join(dir, 'specs/002-fixture/tasks.md'), '- [X] T001 done\n- [ ] T002 still open\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'feat: add tasks with spaces in the subject']);
  writeFileSync(join(dir, 'other.txt'), 'changed, but not part of the feature\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'chore: touch an unrelated file']);
  return dir;
}

const feature = (dir) => ({ dir: join(dir, 'specs/002-fixture'), name: '002-fixture', num: '002', level: 2 });

describe('commits a feature spans', () => {
  it('lists only the commits that touched the feature, oldest first', () => {
    const dir = repoWithHistory();
    try {
      const commits = featureCommits(dir, join(dir, 'specs/002-fixture'));
      assert.equal(commits.length, 2, 'the unrelated commit must not be counted');
      assert.match(commits[0].subject, /add the fixture feature/);
      assert.match(commits[0].date, /^\d{4}-\d{2}-\d{2}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a whole commit subject, spaces and all', () => {
    // A space-delimited --format truncated every subject at its first word.
    const dir = repoWithHistory();
    try {
      const commits = featureCommits(dir, join(dir, 'specs/002-fixture'));
      assert.equal(commits[1].subject, 'feat: add tasks with spaces in the subject');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns nothing outside a git repository rather than throwing', () => {
    const dir = fixture({ 'specs/002-fixture/spec.md': '# Spec\n' });
    try {
      assert.deepEqual(featureCommits(dir, join(dir, 'specs/002-fixture')), []);
      assert.equal(diffStat(dir, null), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the diff a feature spans', () => {
  it('measures from the parent of the first feature commit to HEAD', () => {
    const dir = repoWithHistory();
    try {
      const commits = featureCommits(dir, join(dir, 'specs/002-fixture'));
      const stat = diffStat(dir, commits[0].hash);
      assert.ok(stat.insertions > 0);
      assert.ok(stat.paths.includes('specs/002-fixture/spec.md'), 'the range reaches back to the commit that began the feature');
      assert.ok(stat.paths.includes('specs/002-fixture/tasks.md'));
      assert.ok(stat.paths.includes('other.txt'), 'and forward to everything changed since, feature or not');
      assert.ok(!stat.paths.includes('README.md'), 'but not to what was already there before it began');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the commit itself when it has no parent', () => {
    const dir = fixture();
    git(dir, ['init', '-q', '-b', 'main']);
    try {
      mkdirSync(join(dir, 'specs/002-fixture'), { recursive: true });
      writeFileSync(join(dir, 'specs/002-fixture/spec.md'), '# Spec\n');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'feat: root commit']);
      const [first] = featureCommits(dir, join(dir, 'specs/002-fixture'));
      assert.match(diffStat(dir, first.hash).range, new RegExp(`^${first.hash}\\.\\.HEAD$`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('deferred findings', () => {
  it('reads the checkbox, the severity and the source of each line', () => {
    const items = parseDeferred(
      [
        '# Deferred findings',
        '',
        '- [ ] `src/store.js:41` — **high** — pre-existing: unvalidated JSON.parse (code-reviewer, 2026-09-13)',
        '- [X] `src/format.js:12` — **low** — closed already',
        'not a finding at all',
      ].join('\n'),
    );
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((i) => [i.open, i.severity, i.source]),
      [[true, 'high', 'src/store.js:41'], [false, 'low', 'src/format.js:12']],
    );
  });

  it('records a finding with no severity or source rather than dropping it', () => {
    const [item] = parseDeferred('- [ ] something is wrong somewhere\n');
    assert.equal(item.severity, 'unspecified');
    assert.equal(item.source, null);
    assert.equal(item.open, true);
  });
});

describe('carryover from earlier retrospectives', () => {
  it('collects open items from features that came before this one', () => {
    const dir = fixture({
      'specs/001-earlier/retrospective.md': '# Retro\n\n- [ ] tighten the store boundary\n- [X] already done\n',
      'specs/002-fixture/retrospective.md': '# Retro\n\n- [ ] this feature owns this one\n',
      'specs/003-later/retrospective.md': '# Retro\n\n- [ ] not yet reached\n',
    });
    try {
      const items = carryover(dir, '002-fixture');
      assert.deepEqual(items, [{ feature: '001-earlier', item: 'tighten the store boundary' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is empty when nothing has been retrospected yet', () => {
    const dir = fixture({ 'specs/002-fixture/spec.md': '# Spec\n' });
    try {
      assert.deepEqual(carryover(dir, '002-fixture'), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the gathered evidence', () => {
  const withEverything = () => {
    const dir = repoWithHistory();
    writeFileSync(
      join(dir, 'specs/002-fixture/spec.md'),
      ['# Spec', '', '- **FR-001**: a thing', '- **FR-002**: another', '',
        '## Spec Delta', '', '### Capability: `cli-tasks`', '', '- **Adds**: FR-001, FR-002', ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'specs/002-fixture/deferred.md'),
      '- [ ] `src/store.js:41` — **high** — pre-existing\n',
    );
    mkdirSync(join(dir, '.specify/capabilities'), { recursive: true });
    writeFileSync(
      join(dir, '.specify/capabilities/cli-tasks.md'),
      ['---', 'capability: cli-tasks', 'updated: 2026-01-01', 'features:', '---', '',
        '## Requirements', '', '## Retired', '', `- \`${T('002', '002')}\` — retired early`, ''].join('\n'),
    );
    return dir;
  };

  it('counts tasks, requirements, retirements and the delta', () => {
    const dir = withEverything();
    try {
      const e = gather(dir, feature(dir));
      assert.deepEqual(e.tasks, { open: 1, done: 1, openTitles: ['- [ ] T002 still open'] });
      assert.equal(e.requirements.declared, 2);
      assert.equal(e.requirements.retired, 1, 'a requirement this feature declared and a capability retired');
      assert.deepEqual(e.delta, [{ capability: 'cli-tasks', known: true, adds: 2, modifies: 0, removes: 0 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a delta naming a capability that does not exist', () => {
    const dir = withEverything();
    try {
      rmSync(join(dir, '.specify/capabilities/cli-tasks.md'));
      assert.equal(gather(dir, feature(dir)).delta[0].known, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists the artifacts the feature actually has', () => {
    const dir = withEverything();
    try {
      const e = gather(dir, feature(dir));
      assert.deepEqual(e.artifacts.sort(), ['deferred.md', 'spec.md', 'tasks.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders every section a retrospective has to answer', () => {
    const dir = withEverything();
    try {
      const text = render(gather(dir, feature(dir)));
      for (const heading of ['Artifacts', 'Tasks', 'Requirements', 'Commits', 'Diff', 'Spec Delta', 'Deferred', 'Carryover']) {
        assert.match(text, new RegExp(heading), `${heading} must appear in the report`);
      }
      assert.match(text, /Deferred {6}1 open of 1/);
      assert.match(text, /src\/store\.js:41/, 'a deferred finding keeps its source in the report');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says plainly when a feature declares no delta at all', () => {
    const dir = repoWithHistory();
    try {
      assert.match(render(gather(dir, feature(dir))), /none declared/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- the jev lane -----------------------------------------------------------
// Injected transport and an explicit key: the lane must be exercised without
// a network and without depending on whether this machine has credentials.
const jevReply = (answers) => async () => ({ ok: true, json: async () => ({ answers, usage: { input_tokens: 1, output_tokens: 1 } }) });
const withKey = async (fn) => {
  const saved = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'test-key';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
};

describe('suggestVerdict', () => {
  const evidence = { feature: '018-x', commits: [{ subject: 'feat: x' }], deferred: [{ open: true, text: 'a real bug' }] };

  it('reports the verdict, its confidence and whether the deferred items carry', async () => {
    const { suggestVerdict } = await import('./retro-evidence.mjs');
    const result = await withKey(() =>
      suggestVerdict(evidence, {
        repo: '/nonexistent',
        fetchImpl: jevReply({
          verdict: { choice: 'accepted-with-open-items', confidence: 0.87 },
          deferred_matter: { noul: 0.73 },
        }),
      }),
    );
    assert.equal(result.verdict, 'accepted-with-open-items');
    assert.equal(result.confidence, 0.87);
    assert.equal(result.deferredMatter, 0.73);
  });

  it('is unavailable rather than suggesting "accepted" by default', async () => {
    const { suggestVerdict } = await import('./retro-evidence.mjs');
    const result = await withKey(() =>
      suggestVerdict(evidence, { repo: '/nonexistent', fetchImpl: async () => ({ ok: false, status: 429 }) }),
    );
    assert.equal(result.unavailable, true);
    assert.equal(result.verdict, undefined);
  });
});
