import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { checkHooks } from './doctor.mjs';

// The ready label is retired (2026-10-16): no rule or script under the
// harness names it again. The pattern is built from parts so this file does
// not match itself.

const root = join(import.meta.dirname, '..', '..');
const pattern = ['ready', ' to ', 'work', '\\|', 'notion', '-ready'].join('');

describe('the retired debt and ready routes', () => {
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

  // @traces 1324-FR-011
  it('leaves every registered gate script as it was reviewed, so doctor needs no re-bless', () => {
    const results = checkHooks(root);
    const fingerprints = results.find((r) => r.name === 'hooks/fingerprints');
    assert.ok(fingerprints, JSON.stringify(results));
    assert.equal(fingerprints.status, 'ok', JSON.stringify(fingerprints));
  });
});
