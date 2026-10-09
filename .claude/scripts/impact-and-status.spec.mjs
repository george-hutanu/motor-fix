import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { impactOf, main as impactMain, render as renderImpact } from './impact.mjs';
import { DEFAULT_STALE_DAYS, featureStatus, gatherStatus, render as renderStatus } from './status.mjs';

// Assembled, never spelled out — the traceability matrix scans this file.
const T = (feature, n) => `${feature}${'-FR-'}${n}`;

function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-impact-'));
  for (const [rel, body] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return dir;
}

const capability = (slug, { requirements = [], retired = [], features = [] } = {}) =>
  ['---', `capability: ${slug}`, 'updated: 2026-01-01', 'features:', ...features.map((f) => `  - ${f}`), '---', '',
    '## Requirements', '', ...requirements.flatMap(([t, text]) => [`### ${t} — ${text}`, '']),
    '## Retired', '', ...retired.map(([t, why]) => `- \`${t}\` — ${why}`), ''].join('\n');

const feature = (dir) => ({ dir: join(dir, 'specs/002-fixture'), name: '002-fixture', num: '002' });

describe('what rests on a requirement', () => {
  const build = (extra = {}) =>
    fixture({
      'specs/002-fixture/spec.md': '# Spec\n\n- **FR-001**: sorts the list\n- **FR-002**: emits JSON\n',
      'specs/002-fixture/tasks.md': `- [X] T001 implement sorting (FR-001)\n- [ ] T002 emit the field (FR-002)\n`,
      // Colocated, TypeScript, and the token in a comment — this repo's
      // convention, and the one `lib/tests.mjs` encodes.
      'libs/utils/src/sorting.spec.ts': `// @traces ${T('002', '001')}\nit('sorts', () => {});\n`,
      ...extra,
    });

  it('finds the spec line, the tasks and the tests that name it', () => {
    const dir = build();
    try {
      const i = impactOf(dir, feature(dir), 'FR-001');
      assert.match(i.specLine, /sorts the list/);
      assert.deepEqual(i.tasks, [{ done: true, line: '- [X] T001 implement sorting (FR-001)' }]);
      assert.deepEqual(i.tests, ['libs/utils/src/sorting.spec.ts'], 'colocated tests are reported by path, not bare name');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a requirement nothing tests, because changing it breaks nothing visibly', () => {
    const dir = build();
    try {
      const i = impactOf(dir, feature(dir), 'FR-002');
      assert.deepEqual(i.tests, []);
      assert.equal(i.tasks.length, 1);
      assert.equal(i.tasks[0].done, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the capability holding it, and who superseded it', () => {
    const dir = build({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', {
        requirements: [[T('002', '001'), 'sorts the list']],
        retired: [[T('002', '002'), 'superseded by a later feature']],
      }),
    });
    try {
      assert.equal(impactOf(dir, feature(dir), 'FR-001').capability.slug, 'cli-tasks');
      const retired = impactOf(dir, feature(dir), 'FR-002');
      assert.equal(retired.capability, null);
      assert.deepEqual(retired.supersededBy.map((s) => s.slug), ['cli-tasks']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a harness spec under .claude that names it, and skips a worktree copy', () => {
    const dir = build({
      '.claude/scripts/emit.spec.mjs': `// @traces ${T('002', '002')}\nit('emits', () => {});\n`,
      '.claude/worktrees/w/.claude/scripts/emit.spec.mjs': `// @traces ${T('002', '002')}\nit('emits', () => {});\n`,
    });
    try {
      assert.deepEqual(impactOf(dir, feature(dir), 'FR-002').tests, ['.claude/scripts/emit.spec.mjs']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says so when the id is not declared at all', () => {
    const dir = build();
    try {
      assert.equal(impactOf(dir, feature(dir), 'FR-099').specLine, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls out every untested requirement in one closing line', () => {
    const dir = build();
    try {
      const text = renderImpact(feature(dir), [impactOf(dir, feature(dir), 'FR-001'), impactOf(dir, feature(dir), 'FR-002')]);
      assert.match(text, /1 requirement\(s\) have no test: FR-002/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('where a feature stands', () => {
  const context = (over = {}) => ({
    covered: new Set(),
    retired: new Set(),
    capabilities: new Map(),
    staleDays: DEFAULT_STALE_DAYS,
    exempt: new Set(),
    ...over,
  });

  const withTasks = (tasks, extra = {}) =>
    fixture({
      'specs/002-fixture/spec.md': '# Spec\n\n- **FR-001**: a thing\n',
      'specs/002-fixture/tasks.md': tasks,
      ...extra,
    });

  it('is in-flight while any task is open', () => {
    const dir = withTasks('- [X] T001 done\n- [ ] T002 open\n');
    try {
      const s = featureStatus(dir, '002-fixture', context());
      assert.equal(s.state, 'in-flight');
      assert.deepEqual(s.tasks, { open: 1, done: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('awaits a retrospective once every task is checked', () => {
    const dir = withTasks('- [X] T001 done\n');
    try {
      const s = featureStatus(dir, '002-fixture', context());
      assert.equal(s.state, 'awaiting-retro');
      assert.equal(s.next, 'run /speckit-retro');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('awaits archiving once a verdict exists but the delta has not merged', () => {
    const dir = withTasks('- [X] T001 done\n', {
      'specs/002-fixture/retrospective.md': '---\nverdict: accepted\n---\n',
    });
    try {
      writeFileSync(
        join(dir, 'specs/002-fixture/spec.md'),
        '# Spec\n\n- **FR-001**: a thing\n\n## Spec Delta\n\n### Capability: `cli-tasks`\n\n- **Adds**: FR-001\n',
      );
      const caps = new Map([['cli-tasks', { slug: 'cli-tasks', features: [], requirements: new Map(), retired: new Map() }]]);
      const s = featureStatus(dir, '002-fixture', context({ capabilities: caps }));
      assert.equal(s.state, 'awaiting-archive');
      assert.equal(s.verdict, 'accepted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is archived once the capability records the feature', () => {
    const dir = withTasks('- [X] T001 done\n', {
      'specs/002-fixture/retrospective.md': '---\nverdict: accepted\n---\n',
    });
    try {
      writeFileSync(
        join(dir, 'specs/002-fixture/spec.md'),
        '# Spec\n\n- **FR-001**: a thing\n\n## Spec Delta\n\n### Capability: `cli-tasks`\n\n- **Adds**: FR-001\n',
      );
      const caps = new Map([['cli-tasks', { slug: 'cli-tasks', features: ['002-fixture'], requirements: new Map(), retired: new Map() }]]);
      const s = featureStatus(dir, '002-fixture', context({ capabilities: caps, covered: new Set([T('002', '001')]) }));
      assert.equal(s.state, 'archived');
      assert.equal(s.next, 'nothing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a finished feature whose requirements have no test', () => {
    const dir = withTasks('- [X] T001 done\n');
    try {
      const s = featureStatus(dir, '002-fixture', context());
      assert.ok(s.flags.some((f) => /no test/.test(f)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not count a retired requirement as untested', () => {
    const dir = withTasks('- [X] T001 done\n');
    try {
      const s = featureStatus(dir, '002-fixture', context({ retired: new Set([T('002', '001')]) }));
      assert.equal(s.requirements.untested, 0);
      assert.equal(s.requirements.retired, 1);
      assert.ok(!s.flags.some((f) => /no test/.test(f)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags open deferred findings and a rejected verdict', () => {
    const dir = withTasks('- [X] T001 done\n', {
      'specs/002-fixture/deferred.md': '- [ ] `src/a.js:1` — **high** — pre-existing\n- [X] `src/b.js:2` — **low** — closed\n',
      'specs/002-fixture/retrospective.md': '---\nverdict: rejected\n---\n',
    });
    try {
      const s = featureStatus(dir, '002-fixture', context());
      assert.equal(s.deferredOpen, 1);
      assert.ok(s.flags.some((f) => /deferred finding/.test(f)));
      assert.ok(s.flags.some((f) => /rejected/.test(f)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says nothing about a grandfathered feature that the matrix already skips', () => {
    // The baseline exempts features that predate the token convention. Saying
    // the same untrue thing about them forever turns the list into noise.
    const dir = withTasks('- [X] T001 done\n');
    try {
      const s = featureStatus(dir, '002-fixture', context({ exempt: new Set(['002-fixture']) }));
      assert.equal(s.grandfathered, true);
      assert.deepEqual(s.flags, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a spec with requirements and no delta, because archiving it would merge nothing', () => {
    const dir = withTasks('- [ ] T001 open\n');
    try {
      assert.ok(featureStatus(dir, '002-fixture', context()).flags.some((f) => /no Spec Delta/.test(f)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a feature with no tasks file as owing tasks', () => {
    const dir = fixture({ 'specs/002-fixture/spec.md': '# Spec\n\n- **FR-001**: a thing\n' });
    try {
      const s = featureStatus(dir, '002-fixture', context());
      assert.equal(s.state, 'no-tasks');
      assert.equal(s.next, 'run /speckit-tasks');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never reports a time estimate, only evidence', () => {
    const dir = withTasks('- [ ] T001 open\n');
    try {
      const text = renderStatus(gatherStatus(dir));
      assert.doesNotMatch(text, /\b(hours?|days? remaining|ETA|estimate|velocity|points?)\b/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('staleness', () => {
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

  it('flags an in-flight feature whose last commit is older than the window', () => {
    const dir = fixture({
      'specs/002-fixture/spec.md': '# Spec\n\n- **FR-001**: a thing\n',
      'specs/002-fixture/tasks.md': '- [ ] T001 open\n',
    });
    try {
      git(dir, ['init', '-q', '-b', 'main']);
      git(dir, ['add', '-A']);
      const old = '2020-01-01T00:00:00Z';
      execFileSync('git', ['commit', '-q', '-m', 'feat: an old commit'], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
          GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old,
        },
      });
      const stale = gatherStatus(dir).features[0];
      assert.ok(stale.ageDays > 365);
      assert.ok(stale.flags.some((f) => /stale/.test(f)));
      const patient = gatherStatus(dir, { staleDays: 100000 }).features[0];
      assert.ok(!patient.flags.some((f) => /stale/.test(f)), 'a wider window must stop flagging it');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not flag staleness outside a git repository', () => {
    const dir = fixture({
      'specs/002-fixture/spec.md': '# Spec\n\n- **FR-001**: a thing\n',
      'specs/002-fixture/tasks.md': '- [ ] T001 open\n',
    });
    try {
      const s = gatherStatus(dir).features[0];
      assert.equal(s.lastCommit, null);
      assert.ok(!s.flags.some((f) => /stale/.test(f)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ST-1026: an old clone at specs/ past trunk's move holds the feature folders at specs/specs.
describe('the moved specs layout', () => {
  it('lists the features under specs/specs', () => {
    const dir = fixture({ 'specs/specs/002-fixture/spec.md': '# Spec\n', 'specs/specs/002-fixture/tasks.md': '- [ ] T001 open\n', 'specs/docs/x.md': '# Doc\n' });
    try {
      const features = gatherStatus(dir).features;
      assert.deepEqual(features.map((f) => f.state), ['in-flight']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a feature named specs/<feature> from specs/specs/<feature>', () => {
    const dir = fixture({ 'specs/specs/002-fixture/spec.md': '# Spec\n\n- **FR-001**: does a thing\n' });
    const errors = [];
    const error = console.error;
    const log = console.log;
    console.error = (m) => errors.push(m);
    console.log = () => {};
    try {
      assert.equal(impactMain(['specs/002-fixture', 'FR-001'], dir), 0, errors.join('\n'));
    } finally {
      console.error = error;
      console.log = log;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
