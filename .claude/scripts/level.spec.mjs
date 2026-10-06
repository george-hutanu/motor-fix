import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { LEVELS, DEFAULT_LEVEL, PENDING_TTL_MINUTES, activeFeature, featureLevel, levelApplies, pendingLevel, pointTo } from './lib/feature.mjs';
import { classifyLevel, levelTarget, main, pointFeature, resolveLevel, setLevel } from './level.mjs';
import { checkFeatureState } from './doctor.mjs';

const root = join(import.meta.dirname, '..', '..');

function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-level-'));
  mkdirSync(join(dir, '.specify'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return dir;
}

const capture = (fn) => {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    return { status: fn(), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
};

// featureLevel reads process.env directly, the way every other harness setting
// is resolved, so a case that exercises the environment has to set it.
const withEnv = (value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SPECKIT_FEATURE_LEVEL');
  const previous = process.env.SPECKIT_FEATURE_LEVEL;
  if (value === undefined) delete process.env.SPECKIT_FEATURE_LEVEL;
  else process.env.SPECKIT_FEATURE_LEVEL = value;
  try {
    return fn();
  } finally {
    if (had) process.env.SPECKIT_FEATURE_LEVEL = previous;
    else delete process.env.SPECKIT_FEATURE_LEVEL;
  }
};

describe('the level vocabulary', () => {
  it('names four levels, each with the artifacts it owes', () => {
    assert.deepEqual(Object.keys(LEVELS), ['0', '1', '2', '3']);
    assert.deepEqual(LEVELS[0].artifacts, [], 'a trivial change owes no artifact');
    assert.deepEqual(LEVELS[1].artifacts, ['spec.md', 'tasks.md']);
    assert.ok(LEVELS[2].artifacts.includes('plan.md'));
  });

  it('defaults to the full chain, so an unrouted change loses no process', () => {
    assert.equal(DEFAULT_LEVEL, 2);
    const dir = fixture();
    try {
      withEnv(undefined, () => assert.equal(featureLevel(dir), 2));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolving a level', () => {
  it('takes the environment over the file, and the file over the default', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/002-sized', level: 1, level_for: 'specs/002-sized' }) });
    try {
      withEnv(undefined, () => assert.deepEqual(resolveLevel(dir), { level: 1, source: '.specify/feature.json' }));
      withEnv('3', () => assert.deepEqual(resolveLevel(dir), { level: 3, source: 'SPECKIT_FEATURE_LEVEL' }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a value outside the vocabulary rather than inventing a level', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ level: 9 }) });
    try {
      withEnv(undefined, () => assert.equal(resolveLevel(dir).source, 'default'));
      withEnv('banana', () => assert.equal(resolveLevel(dir).level, DEFAULT_LEVEL));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives a malformed feature file', () => {
    const dir = fixture({ '.specify/feature.json': '{ broken' });
    try {
      withEnv(undefined, () => assert.equal(resolveLevel(dir).level, DEFAULT_LEVEL));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('setting a level', () => {
  it('writes the level without disturbing the active feature pointer', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/002-x' }) });
    try {
      assert.deepEqual(setLevel(dir, 1), { level: 1, level_for: 'next' });
      const state = JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8'));
      assert.equal(state.level, 1);
      assert.equal(state.feature_directory, 'specs/002-x', 'choosing a level must not un-choose the feature');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a level outside the vocabulary and writes nothing', () => {
    const dir = fixture();
    try {
      assert.match(setLevel(dir, '7').error, /must be one of/);
      assert.match(setLevel(dir, '1.5').error, /must be one of/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replaces a malformed file rather than refusing to work', () => {
    const dir = fixture({ '.specify/feature.json': 'not json at all' });
    try {
      assert.deepEqual(setLevel(dir, 0), { level: 0, level_for: 'next' });
      assert.equal(JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8')).level, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the level command', () => {
  it('reports the level, its source and what it owes', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/002-sized', level: 1, level_for: 'specs/002-sized' }) });
    try {
      const result = withEnv(undefined, () => capture(() => main([], dir, {})));
      assert.match(result.out, /level 1 \(one-session\)/);
      assert.match(result.out, /owes: spec\.md, tasks\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers as JSON for a script', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/002-sized', level: 0, level_for: 'specs/002-sized' }) });
    try {
      const result = withEnv(undefined, () => capture(() => main(['--json'], dir, {})));
      const parsed = JSON.parse(result.out);
      assert.equal(parsed.level, 0);
      assert.deepEqual(parsed.artifacts, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets a level and rejects an unknown command', () => {
    const dir = fixture();
    try {
      assert.equal(capture(() => main(['set', '3'], dir, {})).status, 0);
      assert.equal(JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8')).level, 3);
      const bad = capture(() => main(['promote'], dir, {}));
      assert.equal(bad.status, 1);
      assert.match(bad.err, /unknown command/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('what a level does and does not change', () => {
  const lint = (dir, feature) =>
    spawnSync(process.execPath, [join(dir, '.claude', 'scripts', 'artifact-lint.mjs'), feature], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SPECKIT_FEATURE_LEVEL: '' },
    });

  const repoWithFeature = (level) => {
    const dir = fixture({
      '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/002-sized', level, level_for: 'specs/002-sized' }),
      'specs/002-sized/spec.md': '# Spec\n\n- **FR-001**: a thing\n',
      'specs/002-sized/tasks.md': '- [ ] T001 do the thing (FR-001)\n',
    });
    cpSync(join(root, '.claude', 'scripts'), join(dir, '.claude', 'scripts'), { recursive: true });
    return dir;
  };

  it('stops demanding a plan at the levels that owe none', () => {
    for (const level of [0, 1]) {
      const dir = repoWithFeature(level);
      try {
        assert.doesNotMatch(lint(dir, 'specs/002-sized').stdout, /plan-missing/, `level ${level} owes no plan`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('still demands a plan at the levels that owe one', () => {
    for (const level of [2, 3]) {
      const dir = repoWithFeature(level);
      try {
        assert.match(lint(dir, 'specs/002-sized').stdout, /plan-missing/, `level ${level} owes a plan`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('never softens a finding about an artifact the level does owe', () => {
    // FR-002 has no task at every level: routing by size decides how much
    // planning a change carries, not whether its requirements are covered.
    const dir = repoWithFeature(0);
    try {
      writeFileSync(join(dir, 'specs/002-sized/spec.md'), '# Spec\n\n- **FR-001**: a thing\n- **FR-002**: another\n');
      assert.match(lint(dir, 'specs/002-sized').stdout, /fr-untasked/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('doctor reads a level-only feature file', () => {
  it('does not report a missing pointer when the file only chooses a level', () => {
    // `node scripts/level.mjs set` writes the level alone; reading that as a
    // broken pointer made choosing a level fail the harness check.
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ level: 1 }) });
    try {
      const names = checkFeatureState(dir).map((c) => c.name);
      assert.ok(!names.includes('feature/pointer'), 'a level choice is not a pointer');
      assert.ok(names.includes('feature/level'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reports a pointer that names a directory with no spec', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/404-gone' }) });
    try {
      const pointer = checkFeatureState(dir).find((c) => c.name === 'feature/pointer');
      assert.equal(pointer.status, 'fail');
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

describe('suggestLevel', () => {
  it('returns the chosen level with its confidence, and writes nothing', async () => {
    const { suggestLevel } = await import('./level.mjs');
    const dir = fixture();
    const result = await withKey(() =>
      suggestLevel('fix a typo', { repo: dir, fetchImpl: jevReply({ level: { choice: '0', confidence: 0.97 } }) }),
    );
    assert.deepEqual(result, { level: 0, confidence: 0.97, unavailable: false });
    assert.equal(featureLevel(dir), DEFAULT_LEVEL);
  });

  it('offers every level as an option, so nothing is unreachable', async () => {
    const { suggestLevel } = await import('./level.mjs');
    let sent;
    await withKey(() =>
      suggestLevel('work', {
        repo: fixture(),
        fetchImpl: async (_url, init) => {
          sent = JSON.parse(init.body);
          return { ok: true, json: async () => ({ answers: { level: { choice: '2', confidence: 0.8 } } }) };
        },
      }),
    );
    assert.deepEqual(Object.keys(sent.questions.level.criteria), Object.keys(LEVELS));
  });

  it('is unavailable rather than silently defaulting to a level', async () => {
    const { suggestLevel } = await import('./level.mjs');
    const result = await withKey(() =>
      suggestLevel('work', { repo: fixture(), fetchImpl: async () => ({ ok: false, status: 500 }) }),
    );
    assert.equal(result.unavailable, true);
    assert.equal(result.level, undefined);
  });
});

describe('a level reaches only the feature it was sized for', () => {
  const state = (dir) => JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8'));
  const minutes = (n) => n * 60_000;
  const T = Date.parse('2026-10-05T12:00:00.000Z');
  const at = (ms) => new Date(ms).toISOString();
  const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

  it('sizes the next feature from main or a fresh worktree, and the current one on its own branch', () => {
    const pointer = { feature_directory: 'specs/002-x' };
    assert.equal(levelTarget('.', pointer, { branch: 'main' }), 'next');
    assert.equal(levelTarget('.', pointer, { branch: '002-x' }), 'specs/002-x');
    assert.equal(levelTarget('.', {}, { branch: '002-x' }), 'next');
    assert.equal(levelTarget('.', pointer, { for: 'current', branch: 'main' }), 'specs/002-x');
    assert.equal(levelTarget('.', pointer, { for: 'next', branch: '002-x' }), 'next');
  });

  it('survives /speckit-specify pointing feature.json at the new feature', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/001-old' }) });
    try {
      withEnv(undefined, () => {
        setLevel(dir, 1, { for: 'next' });
        pointFeature(dir, 'specs/002-new');
        assert.deepEqual(state(dir), { feature_directory: 'specs/002-new', level: 1, level_for: 'specs/002-new' });
        assert.equal(featureLevel(dir), 1);
        assert.equal(featureLevel(dir, 'specs/002-new'), 1);
      });
    } finally {
      cleanup(dir);
    }
  });

  it('never applies a level sized for the next feature to the one feature.json still points at', () => {
    // QA lap 1: on main, the pointer is whatever was specified last. A level
    // chosen there for new work read back as that old feature's level.
    const dir = fixture({
      '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/001-old' }),
      'specs/001-old/spec.md': '# Spec\n\n- **FR-001**: a thing\n',
    });
    try {
      withEnv(undefined, () => {
        assert.deepEqual(setLevel(dir, 0, { for: 'next' }), { level: 0, level_for: 'next' });
        assert.equal(featureLevel(dir), DEFAULT_LEVEL);
        assert.equal(featureLevel(dir, 'specs/001-old'), DEFAULT_LEVEL);
        assert.equal(activeFeature(dir).level, DEFAULT_LEVEL);
        assert.equal(resolveLevel(dir, {}).level, DEFAULT_LEVEL);
      });
    } finally {
      cleanup(dir);
    }
  });

  it('never gives a feature resolved from the environment or the branch another feature\'s level', () => {
    // QA lap 1: feature.json points at 001-old (level 0) while the gates
    // resolve 003-new some other way. The level follows the pointer's feature,
    // not whichever feature is active.
    const dir = fixture({
      '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/001-old', level: 0, level_for: 'specs/001-old' }),
      'specs/001-old/spec.md': '# Spec\n\n- **FR-001**: a thing\n',
      'specs/003-new/spec.md': '# Spec\n\n- **FR-001**: a thing\n',
      'specs/003-new/tasks.md': '- [ ] T001 do the thing (FR-001)\n',
    });
    const saved = process.env.SPECIFY_FEATURE_DIRECTORY;
    try {
      withEnv(undefined, () => {
        assert.equal(featureLevel(dir, 'specs/001-old'), 0, 'the old feature keeps its own level');
        assert.equal(featureLevel(dir, join(dir, 'specs/001-old')), 0, 'an absolute path names the same feature');
        assert.equal(featureLevel(dir, 'specs/003-new'), DEFAULT_LEVEL);
        process.env.SPECIFY_FEATURE_DIRECTORY = 'specs/003-new';
        const active = activeFeature(dir);
        assert.equal(active.name, '003-new');
        assert.equal(active.level, DEFAULT_LEVEL);
        assert.match(resolveLevel(dir, {}).source, /sized for specs\/001-old/);
      });
      cpSync(join(root, '.claude', 'scripts'), join(dir, '.claude', 'scripts'), { recursive: true });
      const lint = spawnSync(process.execPath, [join(dir, '.claude', 'scripts', 'artifact-lint.mjs'), 'specs/003-new'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SPECKIT_FEATURE_LEVEL: '', SPECIFY_FEATURE_DIRECTORY: '' },
      });
      assert.match(lint.stdout, /plan-missing/, 'another feature\'s level 0 must not excuse this one\'s plan');
    } finally {
      if (saved === undefined) delete process.env.SPECIFY_FEATURE_DIRECTORY;
      else process.env.SPECIFY_FEATURE_DIRECTORY = saved;
      cleanup(dir);
    }
  });

  it('lets a level sized for the next feature expire, and uses it once', () => {
    // QA lap 1: a level 1 chosen on main and never used was carried onto
    // whatever was specified next, however much later.
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/001-old' }) });
    try {
      withEnv(undefined, () => {
        setLevel(dir, 1, { for: 'next', now: T });
        assert.equal(state(dir).level_at, at(T));
        assert.deepEqual(pendingLevel(state(dir), T + minutes(1)), { level: 1, minutesLeft: PENDING_TTL_MINUTES - 1 });
        assert.equal(pendingLevel(state(dir), T + minutes(PENDING_TTL_MINUTES) + 1), null);
        assert.equal(pendingLevel(state(dir), T - minutes(5)), null, 'a level from the future is not trusted');

        pointFeature(dir, 'specs/002-late', { now: T + minutes(PENDING_TTL_MINUTES + 1) });
        assert.deepEqual(state(dir), { feature_directory: 'specs/002-late' });

        setLevel(dir, 1, { for: 'next', now: T });
        pointFeature(dir, 'specs/003-on-time', { now: T + minutes(2) });
        assert.deepEqual(state(dir), { feature_directory: 'specs/003-on-time', level: 1, level_for: 'specs/003-on-time' });
        pointFeature(dir, 'specs/004-after', { now: T + minutes(3) });
        assert.deepEqual(state(dir), { feature_directory: 'specs/004-after' }, 'the level was used up by 003');
      });
    } finally {
      cleanup(dir);
    }
  });

  it('never carries "trivial" onto a feature: a level 0 change creates none', () => {
    const dir = fixture();
    try {
      withEnv(undefined, () => {
        setLevel(dir, 0, { for: 'next', now: T });
        pointFeature(dir, 'specs/002-big', { now: T + minutes(1) });
        assert.deepEqual(state(dir), { feature_directory: 'specs/002-big' });
        assert.equal(featureLevel(dir), DEFAULT_LEVEL);
      });
    } finally {
      cleanup(dir);
    }
  });

  it('keeps a pending level for the new feature when the pointer is only re-written or moved to a committed one', () => {
    const git = (dir, ...args) =>
      spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: dir,
        encoding: 'utf8',
      });
    const dir = fixture({ 'specs/001-old/spec.md': '# Spec\n', 'specs/005-committed/spec.md': '# Spec\n' });
    try {
      if (git(dir, 'init', '-q').status !== 0) return;
      git(dir, 'add', 'specs');
      assert.equal(git(dir, 'commit', '-q', '-m', 'specs').status, 0);
      withEnv(undefined, () => {
        pointFeature(dir, 'specs/001-old');
        setLevel(dir, 1, { for: 'next', now: T });
        const pending = state(dir);

        pointFeature(dir, 'specs/001-old', { now: T + minutes(1) });
        assert.deepEqual(state(dir), pending, 'pointing at the same feature changes nothing');

        pointFeature(dir, 'specs/005-committed', { now: T + minutes(1) });
        assert.deepEqual(state(dir), { ...pending, feature_directory: 'specs/005-committed' }, 'a feature HEAD already holds is not the next one');
        assert.equal(featureLevel(dir, 'specs/005-committed'), DEFAULT_LEVEL);

        mkdirSync(join(dir, 'specs/006-new'), { recursive: true });
        writeFileSync(join(dir, 'specs/006-new/spec.md'), '# Spec\n');
        pointFeature(dir, 'specs/006-new', { now: T + minutes(2) });
        assert.deepEqual(state(dir), { feature_directory: 'specs/006-new', level: 1, level_for: 'specs/006-new' });
      });
    } finally {
      cleanup(dir);
    }
  });

  it('never lets an old feature\'s small level shrink the next one', () => {
    const dir = fixture({
      '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/001-old', level: 0, level_for: 'specs/001-old' }),
    });
    try {
      withEnv(undefined, () => {
        assert.equal(featureLevel(dir), 0, 'the old feature keeps its own level');
        pointFeature(dir, 'specs/002-new');
        assert.deepEqual(state(dir), { feature_directory: 'specs/002-new' });
        assert.equal(featureLevel(dir), DEFAULT_LEVEL);
      });
    } finally {
      cleanup(dir);
    }
  });

  it('ignores a level sized for another feature, and says why', () => {
    const dir = fixture({
      '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/002-new', level: 0, level_for: 'specs/001-old' }),
    });
    try {
      withEnv(undefined, () => {
        assert.equal(featureLevel(dir), DEFAULT_LEVEL);
        assert.match(resolveLevel(dir, {}).source, /sized for specs\/001-old/);
      });
    } finally {
      cleanup(dir);
    }
  });

  it('reads a level written before level_for existed as the pointed feature\'s, and nobody else\'s', () => {
    assert.equal(levelApplies({ feature_directory: 'specs/1-a', level: 1 }), true);
    assert.equal(levelApplies({ feature_directory: 'specs/1-a', level: 1 }, 'specs/2-b'), false);
    assert.equal(levelApplies({ level: 1 }), false, 'a level with no feature belongs to none');
    assert.equal(levelApplies({ feature_directory: 'specs/1-a', level: 1, level_for: 'specs/1-a' }), true);
    assert.equal(levelApplies({ feature_directory: 'specs/1-a', level: 1, level_for: 'specs/0-z' }), false);
    assert.equal(levelApplies({ feature_directory: 'specs/1-a', level: 1, level_for: 'next' }), false);
    assert.equal(levelApplies({ feature_directory: 'specs/1-a' }), false);
  });

  it('stores the feature as a path inside the repository, whichever way it was named', () => {
    const dir = fixture();
    try {
      withEnv(undefined, () => {
        setLevel(dir, 1, { for: 'next' });
        pointFeature(dir, `${join(dir, 'specs/002-new')}/`);
        assert.deepEqual(state(dir), { feature_directory: 'specs/002-new', level: 1, level_for: 'specs/002-new' });
      });
    } finally {
      cleanup(dir);
    }
  });

  it('sizes the feature the gates resolve when asked for the current one', () => {
    // feature.json may point elsewhere (or nowhere) while the environment
    // names the feature in hand; "--current" means that one.
    const dir = fixture({
      '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/001-old' }),
      'specs/001-old/spec.md': '# Spec\n',
      'specs/003-new/spec.md': '# Spec\n',
    });
    const saved = process.env.SPECIFY_FEATURE_DIRECTORY;
    try {
      process.env.SPECIFY_FEATURE_DIRECTORY = 'specs/003-new';
      withEnv(undefined, () => {
        assert.deepEqual(setLevel(dir, 1, { for: 'current', branch: 'main' }), { level: 1, level_for: 'specs/003-new' });
        assert.equal(featureLevel(dir, 'specs/003-new'), 1);
        assert.equal(featureLevel(dir, 'specs/001-old'), DEFAULT_LEVEL);
        assert.equal(state(dir).feature_directory, 'specs/001-old', 'sizing never moves the pointer');
      });
    } finally {
      if (saved === undefined) delete process.env.SPECIFY_FEATURE_DIRECTORY;
      else process.env.SPECIFY_FEATURE_DIRECTORY = saved;
      cleanup(dir);
    }
  });

  it('says what is waiting for the next feature, and when a waiting level was dropped', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/001-old' }) });
    try {
      withEnv(undefined, () => {
        setLevel(dir, 1, { for: 'next' });
        const shown = capture(() => main([], dir, {}));
        assert.match(shown.out, /level 2 \(feature\)/);
        assert.match(shown.out, /pending: level 1 \(one-session\) for the next feature/);
        assert.equal(JSON.parse(capture(() => main(['--json'], dir, {})).out).pending.level, 1);

        writeFileSync(
          join(dir, '.specify/feature.json'),
          JSON.stringify({ feature_directory: 'specs/001-old', level: 1, level_for: 'next', level_at: at(Date.now() - minutes(PENDING_TTL_MINUTES + 5)) }),
        );
        const pointed = capture(() => main(['point', 'specs/002-new'], dir, {}));
        assert.match(pointed.out, /level 2 \(default\)/);
        assert.match(pointed.out, /expired/);
      });
    } finally {
      cleanup(dir);
    }
  });

  it('keeps the pointer and the level in step in the Python helper too', () => {
    const probe = spawnSync('python3', ['--version']);
    if (probe.status !== 0) return;
    const run = (before, value) => {
      const dir = fixture({ '.specify/feature.json': JSON.stringify(before) });
      try {
        const py = spawnSync(
          'python3',
          ['-c', 'import sys; from pathlib import Path; from common import persist_feature_json; persist_feature_json(Path(sys.argv[1]), sys.argv[2].replace("@", sys.argv[1]))', dir, value],
          { cwd: join(root, '.specify/scripts/python'), encoding: 'utf8' },
        );
        assert.equal(py.status, 0, py.stderr);
        return state(dir);
      } finally {
        cleanup(dir);
      }
    };
    const fresh = at(Date.now() - minutes(1));
    const stale = at(Date.now() - minutes(PENDING_TTL_MINUTES + 5));
    const cases = [
      [{ feature_directory: 'specs/001-old', level: 1, level_for: 'next', level_at: fresh }, 'specs/002-new'],
      [{ feature_directory: 'specs/001-old', level: 1, level_for: 'next', level_at: stale }, 'specs/002-new'],
      [{ feature_directory: 'specs/001-old', level: 1, level_for: 'next' }, 'specs/002-new'],
      [{ feature_directory: 'specs/001-old', level: 0, level_for: 'next', level_at: fresh }, 'specs/002-new'],
      [{ level: 3, level_for: 'next', level_at: fresh }, 'specs/002-new'],
      [{ feature_directory: 'specs/001-old', level: 0, level_for: 'specs/001-old' }, 'specs/002-new'],
      [{ feature_directory: 'specs/001-old', level: 1 }, 'specs/002-new'],
      [{ feature_directory: 'specs/002-new', level: 1, level_for: 'next', level_at: fresh }, 'specs/002-new'],
      [{ feature_directory: 'specs/002-new', level: 1, level_for: 'specs/002-new' }, 'specs/002-new'],
      [{ feature_directory: 'specs/001-old', level: 1, level_for: 'next', level_at: fresh }, '@/specs/002-new'],
    ];
    for (const [before, value] of cases) {
      assert.deepEqual(run(before, value), pointTo(before, 'specs/002-new'), JSON.stringify(before));
    }
    assert.deepEqual(pointTo(cases[0][0], 'specs/002-new'), { feature_directory: 'specs/002-new', level: 1, level_for: 'specs/002-new' });
    assert.deepEqual(pointTo(cases[1][0], 'specs/002-new'), { feature_directory: 'specs/002-new' });
    assert.deepEqual(pointTo(cases[7][0], 'specs/002-new'), cases[7][0]);
  });
});

describe('classifyLevel', () => {
  it('calls the obvious cases without a model', () => {
    assert.deepEqual(
      ['fix a typo in the footer', 'rename the helper in the garage card', 'bump the readme badge'].map((d) => classifyLevel(d).level),
      [0, 0, 0],
    );
    assert.equal(classifyLevel('build the reviews epic').level, 3);
    assert.equal(classifyLevel('add a --json flag to the rule check').level, 2);
  });

  it('lets a risky word outrank a trivial one, so it only ever pushes a level up', () => {
    assert.equal(classifyLevel('rename the column in the bookings table').level, 2);
    assert.equal(classifyLevel('fix a typo in the sign-in email').level, 2);
    assert.equal(classifyLevel('update the docs for the payments endpoint').level, 2);
  });

  it('is unsure rather than guessing, and never claims level 1', () => {
    assert.equal(classifyLevel('add a filter chip to the garage list').unsure, true);
    assert.equal(
      classifyLevel('rename things across the garage list, the detail page, the map pin, the card and the summary tile').unsure,
      true,
    );
    for (const d of ['make the garage card nicer', 'show the opening hours', 'fix a typo']) {
      assert.notEqual(classifyLevel(d).level, 1);
    }
  });

  it('never calls new behaviour trivial because it shares a word with a trivial change', () => {
    // Level 0 runs no phase at all, so a wrong 0 is the costly mistake: a
    // word like "comments", "copy" or "rename" is trivial only as an edit to
    // text or to a name nothing outside the code reads.
    for (const d of [
      'add a comments section to the garage page',
      'copy the garage records to the archive',
      'rename the garage slug in the shareable URLs',
      'show comments under a review',
      'let drivers copy a garage link',
      'rename the booking status field',
      'add docs upload for mechanics',
      'remove the unused garages',
      'rename garage to workshop',
      'rename the Garage model',
      'check the docs a garage sends before listing it',
      'fix the date formatting on the booking card',
      'bump angular to the next major',
      'fix a typo and change the booking flow',
      'fix the typos everywhere',
    ]) {
      assert.notEqual(classifyLevel(d).level, 0, d);
    }
    for (const d of ['fix a typo in the footer', 'remove dead code from the garage card', 'reword the code comment in the helper', 'tweak the button copy']) {
      assert.equal(classifyLevel(d).level, 0, d);
    }
  });
});
