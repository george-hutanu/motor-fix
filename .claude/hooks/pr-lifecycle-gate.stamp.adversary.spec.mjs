import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prLinked } from './pr-lifecycle-gate.mjs';

const BRANCH = '900-restart-stalled';
const dirs = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function linkedBy(log) {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-stamp-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'specs', BRANCH), { recursive: true });
  if (log !== null) writeFileSync(join(dir, 'specs', BRANCH, 'tracker-sync.md'), log);
  return (number) => prLinked(dir, BRANCH, number);
}

describe('the PR link check against stamped and date-only tracker log lines', () => {
  // @traces 1361-FR-011
  it('sees a link written with the minute stamp, and one written date-only, in the same log', () => {
    const linked = linkedBy(
      [
        '# Tracker sync',
        '- 2026-10-20 · pr · ST-900 · PR #901 https://github.com/george-hutanu/motor-fix/pull/901',
        '- 2026-10-21 09:15 · pr · ST-900 · PR #900 https://github.com/george-hutanu/motor-fix/pull/900',
        '',
      ].join('\n'),
    );
    assert.equal(linked(901), true);
    assert.equal(linked(900), true);
    assert.equal(linked(902), false);
  });

  // @traces 1361-FR-011
  it('does not read #90 or #9000 as #900 in either form', () => {
    const linked = linkedBy('- 2026-10-21 09:15 · pr · ST-900 · PR #9000\n- 2026-10-21 · pr · ST-900 · PR #90\n');
    assert.equal(linked(900), false);
    assert.equal(linked(9000), true);
    assert.equal(linked(90), true);
  });

  // @traces 1361-FR-011
  it('does not count another event on the same PR as the link: a PR comment, labels, or a pending link', () => {
    const linked = linkedBy(
      [
        '- 2026-10-21 09:15 · pr-comment · PR #900 · Blocked: waits',
        '- 2026-10-21 09:16 · labels · PR #900 · QA',
        '- 2026-10-21 09:17 [TRACKER-SYNC PENDING: pr ST-900 — network error] retry: ["pr","900"]',
        '',
      ].join('\n'),
    );
    assert.equal(linked(900), false);
  });

});
