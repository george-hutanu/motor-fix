import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// The ready label is retired (2026-10-16): no rule or script under the
// harness names it again. The pattern is built from parts so this file does
// not match itself.

const root = join(import.meta.dirname, '..', '..');
const pattern = ['ready', ' to ', 'work', '\\|', 'notion', '-ready'].join('');

describe('the retired ready label', () => {
  // @traces 1324-FR-010
  it('is named nowhere in AGENTS.md or .claude', () => {
    let out = '';
    try {
      out = execFileSync('grep', ['-rnil', pattern, 'AGENTS.md', '.claude', '--exclude-dir=worktrees', '--exclude-dir=node_modules'], { cwd: root, encoding: 'utf8' });
    } catch (error) {
      if (error.status !== 1) throw error;
    }
    assert.equal(out.trim(), '');
  });
});
