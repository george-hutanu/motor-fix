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
function matrix(specBody) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-trace-'));
  try {
    for (const rel of ['trace-matrix.mjs', 'capabilities.mjs', 'lib/feature.mjs']) {
      const to = join(dir, '.claude', 'scripts', rel);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(root, '.claude', 'scripts', rel), to);
    }
    mkdirSync(join(dir, 'specs', '002-fixture'), { recursive: true });
    writeFileSync(join(dir, 'specs', '002-fixture', 'spec.md'), specBody);
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
