import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prLinked } from './pr-lifecycle-gate.mjs';

const BRANCH = '1354-restart-stalled';
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
        '- 2026-10-20 · pr · ST-1354 · PR #464 https://github.com/george-hutanu/motor-fix/pull/464',
        '- 2026-10-21 09:15 · pr · ST-1354 · PR #465 https://github.com/george-hutanu/motor-fix/pull/465',
        '',
      ].join('\n'),
    );
    assert.equal(linked(464), true);
    assert.equal(linked(465), true);
    assert.equal(linked(466), false);
  });

  // @traces 1361-FR-011
  it('does not read #46 or #4650 as #465 in either form', () => {
    const linked = linkedBy('- 2026-10-21 09:15 · pr · ST-1354 · PR #4650\n- 2026-10-21 · pr · ST-1354 · PR #46\n');
    assert.equal(linked(465), false);
    assert.equal(linked(4650), true);
    assert.equal(linked(46), true);
  });

  // @traces 1361-FR-011
  it('does not count another event on the same PR as the link: a PR comment, labels, or a pending link', () => {
    const linked = linkedBy(
      [
        '- 2026-10-21 09:15 · pr-comment · PR #465 · Blocked: waits',
        '- 2026-10-21 09:16 · labels · PR #465 · QA',
        '- 2026-10-21 09:17 [TRACKER-SYNC PENDING: pr ST-1354 — network error] retry: ["pr","465"]',
        '',
      ].join('\n'),
    );
    assert.equal(linked(465), false);
  });

});
