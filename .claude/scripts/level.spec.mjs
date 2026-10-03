import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { LEVELS, DEFAULT_LEVEL, featureLevel } from './lib/feature.mjs';
import { main, resolveLevel, setLevel } from './level.mjs';
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
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ level: 1 }) });
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
      assert.deepEqual(setLevel(dir, 1), { level: 1 });
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
      assert.deepEqual(setLevel(dir, 0), { level: 0 });
      assert.equal(JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8')).level, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the level command', () => {
  it('reports the level, its source and what it owes', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ level: 1 }) });
    try {
      const result = withEnv(undefined, () => capture(() => main([], dir, {})));
      assert.match(result.out, /level 1 \(one-session\)/);
      assert.match(result.out, /owes: spec\.md, tasks\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers as JSON for a script', () => {
    const dir = fixture({ '.specify/feature.json': JSON.stringify({ level: 0 }) });
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
      '.specify/feature.json': JSON.stringify({ level }),
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
