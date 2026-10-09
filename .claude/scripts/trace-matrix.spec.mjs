import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

// Assembled at runtime: a literal NNN-FR-XXX here would be scanned as a token.
const T = (feature, n) => `${feature}${'-FR-'}${n}`;

// trace-matrix reads the repo its own file sits in, so each case copies the
// script and its imports into a throwaway repo beside a fixture spec.
function matrix(specBody, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-trace-'));
  try {
    for (const rel of ['trace-matrix.mjs', 'capabilities.mjs', 'lib/feature.mjs', 'lib/traces.mjs']) {
      const to = join(dir, '.claude', 'scripts', rel);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(root, '.claude', 'scripts', rel), to);
    }
    mkdirSync(join(dir, 'specs', '002-fixture'), { recursive: true });
    writeFileSync(join(dir, 'specs', '002-fixture', 'spec.md'), specBody);
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    const out = spawnSync(process.execPath, [join(dir, '.claude', 'scripts', 'trace-matrix.mjs'), '--json'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    return JSON.parse(out.stdout).features.find((f) => f.feature === '002-fixture');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('trace-matrix requirements', () => {
  it('reads only the feature\'s own FR ids, not the feature-qualified ids a Spec Delta names', () => {
    const f = matrix(
      [
        '- **FR-001**: does one thing.',
        '- **FR-002**: does another.',
        '',
        '## Spec Delta',
        '',
        `- **Modifies**: ${T('288', '013')} → FR-002, \`${T('082', '021')}\` → FR-001`,
        `- From ST-81: ${T('81', '003')} is reworded.`,
        '',
      ].join('\n'),
    );
    assert.deepEqual(
      f.requirements.map((r) => r.fr),
      ['FR-001', 'FR-002'],
    );
  });
});

describe('trace-matrix tokens', () => {
  const spec = ['- **FR-001**: one.', '- **FR-002**: two.', '- **FR-003**: three.', ''].join('\n');
  const tagged = (f) => f.requirements.filter((r) => r.tests.length).map((r) => r.fr);

  it('counts every id on a // @traces line in a test file, indented or not', () => {
    const f = matrix(spec, {
      'libs/a/src/a.spec.ts': `// @traces ${T('002', '001')} ${T('002', '002')}\nit('a', () => {});\n`,
      'apps/b/src/b.spec.ts': `describe('b', () => {\n  // @traces ${T('002', '003')}\n  it('b', () => {});\n});\n`,
    });
    assert.deepEqual(tagged(f), ['FR-001', 'FR-002', 'FR-003']);
  });

  it('does not count an id in a test title, a prose comment or after code', () => {
    const f = matrix(spec, {
      'libs/a/src/a.spec.ts': [
        `it('covers ${T('002', '001')}', () => {});`,
        `// see ${T('002', '002')} for why`,
        `it('c', () => {}); // @traces ${T('002', '003')}`,
        '',
      ].join('\n'),
    });
    assert.deepEqual(tagged(f), []);
  });

  it('does not count a line that carries anything but requirement ids', () => {
    const f = matrix(spec, {
      'libs/a/src/a.spec.ts': `// @traces ${T('002', '001')} 002-SC-001\nit('a', () => {});\n`,
    });
    assert.deepEqual(tagged(f), []);
  });

  it('ignores a // @traces line outside a test file', () => {
    const f = matrix(spec, { 'libs/a/src/a.ts': `// @traces ${T('002', '001')}\nexport const a = 1;\n` });
    assert.deepEqual(tagged(f), []);
  });
  it('reads a harness spec under .claude, and never a worktree copy inside it', () => {
    const f = matrix(spec, {
      '.claude/scripts/a.spec.mjs': `// @traces ${T('002', '001')}\nit('a', () => {});\n`,
      '.claude/worktrees/w/.claude/scripts/b.spec.mjs': `// @traces ${T('002', '002')}\nit('b', () => {});\n`,
    });
    const rows = Object.fromEntries(f.requirements.map((r) => [r.fr, r.tests]));
    assert.deepEqual(rows['FR-001'], ['.claude/scripts/a.spec.mjs']);
    assert.deepEqual(rows['FR-002'] ?? [], []);
  });
});
