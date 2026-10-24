import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Wording the living platform capability must keep: rules a person applies,
// with no script behind them to test.

const platform = readFileSync(join(import.meta.dirname, '..', '..', '.specify', 'capabilities', 'platform.md'), 'utf8');

describe('the platform capability', () => {
  // @traces 493-FR-003
  it('names three routes for a surviving mutant: a test, a behaviour-preserving rewrite, a silenced line', () => {
    const fr = platform.match(/^### \S+ — Every surviving and uncovered mutant.*$/m)?.[0] ?? '';
    assert.match(fr, /killed by a test/);
    assert.match(fr, /behaviour-preserving rewrite/);
    assert.match(fr, /Stryker disable next-line/);
  });

  it('keeps every requirement heading apart from the line above it', () => {
    assert.doesNotMatch(platform, /[^\n]\n#{2,3} /);
  });
});
