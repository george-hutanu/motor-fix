import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  baselineSize,
  breakFloor,
  proposedContent,
  verdict,
  isTestFile,
} from './config-protection.mjs';
import { traceTokens } from '../scripts/lib/traces.mjs';

// The ratchet guard. Each rule here corresponds to a line in CLAUDE.md that
// used to be prose only: the mutation floor only goes up, the trace baseline
// only shrinks, and an FR token is never deleted to quiet the trace gate.

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const HOOK = join(REPO, '.claude/hooks/config-protection.mjs');

/** The repo's first stryker config — root, or one workspace level down. */
// A floor of 0 cannot be lowered, so only a config with a positive floor
// proves the ratchet.
const strykerConfig = () => {
  const candidates = [join(REPO, 'stryker.config.json')];
  for (const group of ['apps', 'libs', 'packages']) {
    const dir = join(REPO, group);
    if (!existsSync(dir)) continue;
    for (const pkg of readdirSync(dir)) candidates.push(join(dir, pkg, 'stryker.config.json'));
  }
  return (
    candidates.find(
      (file) => existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).thresholds?.break > 0,
    ) ?? null
  );
};

const run = (payload, env = {}) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO, ...env },
  });

// Fixture tokens are assembled at runtime: a literal one in this file would
// read as a coverage claim to .claude/scripts/trace-matrix.mjs — this suite guards the
// gate, it does not cover a CLI requirement.
const fake = (feature, fr) => `${feature}-FR-${fr}`;

const judge = (over) =>
  verdict({ rel: '', current: null, next: null, profile: 'standard', allowHookEdit: false, ...over });

describe('config-protection — reading the proposed content', () => {
  it('takes a Write call at face value', () => {
    assert.equal(proposedContent('old', { content: 'new' }), 'new');
  });

  it('applies an Edit in memory', () => {
    assert.equal(proposedContent('a b c', { old_string: 'b', new_string: 'B' }), 'a B c');
    assert.equal(proposedContent('a a', { old_string: 'a', new_string: 'x', replace_all: true }), 'x x');
  });

  it('applies MultiEdit edits in order', () => {
    const next = proposedContent('1 2', {
      edits: [
        { old_string: '1', new_string: 'one' },
        { old_string: '2', new_string: 'two' },
      ],
    });
    assert.equal(next, 'one two');
  });

  it('gives up rather than guess', () => {
    assert.equal(proposedContent('abc', { old_string: 'zzz', new_string: 'x' }), null);
    assert.equal(proposedContent(null, { old_string: 'a', new_string: 'b' }), null);
    assert.equal(proposedContent('abc', {}), null);
  });
});

describe('config-protection — the mutation floor ratchet', () => {
  const cfg = (n) => JSON.stringify({ thresholds: { break: n, high: 100, low: 95 } });

  it('reads the floor from JSON and from a fragment', () => {
    assert.equal(breakFloor(cfg(95)), 95);
    assert.equal(breakFloor('  "break": 80,'), 80);
    assert.equal(breakFloor('no floor here'), null);
  });

  it('blocks lowering it', () => {
    const why = judge({ rel: 'apps/server/stryker.config.json', current: cfg(95), next: cfg(80) });
    assert.match(why, /ratchet/);
    assert.match(why, /95 to 80/);
  });

  it('allows raising or keeping it', () => {
    assert.equal(judge({ rel: 'apps/scanner/stryker.config.json', current: cfg(95), next: cfg(100) }), null);
    assert.equal(judge({ rel: 'apps/server/stryker.config.json', current: cfg(95), next: cfg(95) }), null);
  });
});

describe('config-protection — the traceability baseline', () => {
  const base = (g, a) => JSON.stringify({ grandfathered: g, artifact_legacy: a });

  it('counts every exemption', () => {
    assert.equal(baselineSize(base(['x'], ['y', 'z'])), 3);
    assert.equal(baselineSize('{'), null);
  });

  it('blocks growing it and allows shrinking it', () => {
    const why = judge({
      rel: '.specify/trace-baseline.json',
      current: base([], ['001-x']),
      next: base(['002-y'], ['001-x']),
    });
    assert.match(why, /grandfathering entry/);
    assert.equal(
      judge({ rel: '.specify/trace-baseline.json', current: base(['a'], []), next: base([], []) }),
      null,
    );
  });
});

describe('config-protection — the structure baseline', () => {
  const rel = 'scripts/structure-baseline.json';
  const base = (submodules, components) => JSON.stringify({ _comment: 'shrink only', submodules, components });

  it('counts the entries of both lists', () => {
    assert.equal(baselineSize(base(['a.ts'], ['b.ts', 'c.ts']), ['submodules', 'components']), 3);
  });

  it('blocks growing it', () => {
    const why = judge({ rel, current: base(['a.ts'], []), next: base(['a.ts'], ['b.ts']) });
    assert.match(why, /structure baseline/);
    assert.match(why, /1 → 2/);
  });

  it('allows shrinking or keeping it', () => {
    assert.equal(judge({ rel, current: base(['a.ts', 'b.ts'], []), next: base(['a.ts'], []) }), null);
    assert.equal(judge({ rel, current: base(['a.ts'], ['b.ts']), next: base(['a.ts'], ['c.ts']) }), null);
  });
});

describe('config-protection — requirement tokens', () => {
  it('finds every id on a // @traces line, and only there', () => {
    const text = `// @traces ${fake('001', '002')} ${fake('012', '134')}\n  // @traces ${fake('003', '004')}\n`;
    assert.deepEqual([...traceTokens(text)], [fake('001', '002'), fake('012', '134'), fake('003', '004')]);
    assert.equal(traceTokens('FR-002 alone').size, 0);
    assert.equal(traceTokens(`it('covers ${fake('001', '002')}', () => {});`).size, 0);
    assert.equal(traceTokens(`// see ${fake('001', '002')}`).size, 0);
  });

  it('lets an id leave a test title, which is not the traced form', () => {
    assert.equal(
      judge({
        rel: 'libs/utils/src/slug.spec.ts',
        current: `it('covers ${fake('001', '003')}', () => {})`,
        next: "it('covers it', () => {})",
      }),
      null,
    );
  });

  it('blocks deleting one from a test file', () => {
    const why = judge({
      rel: 'apps/scanner/src/plugins/regexp/rules.spec.ts',
      current: `// @traces ${fake('001', '003')}\nit('x', () => {})`,
      next: "it('x', () => {})",
    });
    assert.ok(why.includes(fake('001', '003')), why);
    assert.match(why, /trace-matrix\.mjs reads those \/\/ @traces lines/);
  });

  it('ignores test edits that keep their tokens', () => {
    assert.equal(
      judge({
        rel: 'libs/utils/src/slug.spec.ts',
        current: `// @traces ${fake('001', '003')}\nit('x', () => {})`,
        next: `// @traces ${fake('001', '003')}\nit('renamed', () => {})`,
      }),
      null,
    );
  });

  it('leaves files that are not tests alone', () => {
    assert.equal(judge({ rel: 'docs/notes.md', current: `[${fake('001', '003')}]`, next: 'gone' }), null);
  });
});

describe('config-protection — the strict harness freeze', () => {
  const edit = { rel: '.claude/hooks/bash-guard.mjs', current: 'a', next: 'b' };

  it('lets harness edits through under standard', () => {
    assert.equal(judge(edit), null);
  });

  it('blocks them under strict, and takes the explicit override', () => {
    assert.match(judge({ ...edit, profile: 'strict' }), /freezes the harness/);
    assert.equal(judge({ ...edit, profile: 'strict', allowHookEdit: true }), null);
  });
});

describe('config-protection — as a hook', () => {
  // Found rather than named: this harness is mirrored into repos that lay
  // their packages out differently, and a hardcoded workspace path makes the
  // ratchet look broken there when only the fixture moved. A repo with no
  // stryker config yet has no floor to guard.
  it.skipIf(!strykerConfig())('blocks a real floor drop with exit 2', () => {
    const cfgFile = strykerConfig();
    const current = JSON.parse(readFileSync(cfgFile, 'utf8'));
    const lowered = { ...current, thresholds: { ...current.thresholds, break: current.thresholds.break - 1 } };
    const out = run({ tool_input: { file_path: cfgFile, content: JSON.stringify(lowered) } });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /Config protection/);
  });

  it('passes an unrelated edit, and warns when a gate script changes', () => {
    const clean = run({ tool_input: { file_path: join(REPO, 'README.md'), content: '# hi' } });
    assert.equal(clean.status, 0);
    assert.equal(clean.stderr, '');

    const gate = run({ tool_input: { file_path: join(REPO, '.claude/hooks/bash-guard.mjs'), content: '// x' } });
    assert.equal(gate.status, 0);
    assert.match(gate.stderr, /re-bless the registry/);
  });

  it('ignores files outside the repo', () => {
    assert.equal(run({ tool_input: { file_path: '/tmp/elsewhere.json', content: '{}' } }).status, 0);
  });
});

// The two rules this port rewrote, because the repo they moved to is shaped
// differently: mutation is owned per workspace, and tests sit beside their
// source instead of under one tests/ directory.
describe('config-protection — what the port changed', () => {
  const cfg = (n) => JSON.stringify({ thresholds: { break: n } });

  it('guards every workspace that owns a mutation floor', () => {
    for (const rel of ['apps/server/stryker.config.json', 'apps/scanner/stryker.config.json']) {
      assert.match(judge({ rel, current: cfg(90), next: cfg(10) }), /ratchet/);
    }
  });

  it('does not mistake a file merely named like the config for it', () => {
    assert.equal(judge({ rel: 'docs/stryker.config.json.md', current: cfg(90), next: cfg(10) }), null);
  });

  it('recognises a colocated test wherever it sits, and nothing else', () => {
    for (const rel of [
      'apps/server/src/app.spec.ts',
      'apps/client/src/app/page.test.tsx',
      'libs/utils/src/slug.spec.ts',
      'e2e/scan.e2e.spec.ts',
      '.claude/hooks/config-protection.spec.mjs',
    ]) {
      assert.equal(isTestFile(rel), true, rel);
    }
    for (const rel of ['apps/server/src/app.ts', 'specs/011/spec.md', 'apps/server/src/spec.ts']) {
      assert.equal(isTestFile(rel), false, rel);
    }
  });

  it('blocks a token deleted from a colocated spec, not only from tests/', () => {
    const why = judge({
      rel: 'libs/regex-engine/src/compile.spec.ts',
      current: `// @traces ${fake('002', '004')}\nit('compiles', () => {})`,
      next: "it('compiles', () => {})",
    });
    assert.match(why, /trace-matrix\.mjs reads those \/\/ @traces lines/);
    assert.ok(why.includes(fake('002', '004')), why);
  });
});
