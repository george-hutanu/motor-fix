import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const hook = join(import.meta.dirname, 'bash-guard.mjs');
const run = (command) => spawnSync('node', [hook], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' });

// @traces 815-FR-007
describe('bash guard and the specs repository', () => {
  it('allows pushing the specs clone to its trunk', () => {
    assert.equal(run('git -C specs push -q origin HEAD:trunk').status, 0);
  });

  it('still blocks a push to main beside it', () => {
    const r = run('git -C specs push -q origin HEAD:trunk && git push origin HEAD:main');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /pushing to main/);
  });
});
