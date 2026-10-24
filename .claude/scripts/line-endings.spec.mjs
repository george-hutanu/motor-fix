import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// A checkout on any platform writes LF: the frontmatter readers, Biome and the
// harness's fixtures all assume it.
const root = join(import.meta.dirname, '..', '..');

describe('line endings', () => {
  // @traces 471-FR-001
  it('has a root .gitattributes that normalises every text file to LF', () => {
    const lines = readFileSync(join(root, '.gitattributes'), 'utf8').split('\n').map((l) => l.trim());
    assert.ok(lines.includes('* text=auto eol=lf'), lines.join('\n'));
  });

  // @traces 471-FR-001
  it('makes git check out a script and a skill with eol=lf', () => {
    const run = spawnSync('git', ['check-attr', 'text', 'eol', '--', '.claude/scripts/doctor.mjs', '.claude/skills/speckit-auto/SKILL.md'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    for (const file of ['.claude/scripts/doctor.mjs', '.claude/skills/speckit-auto/SKILL.md']) {
      assert.match(run.stdout, new RegExp(`${file.replace(/\./g, '\\.')}: text: auto`));
      assert.match(run.stdout, new RegExp(`${file.replace(/\./g, '\\.')}: eol: lf`));
    }
  });
});
