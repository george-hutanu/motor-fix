import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordDuration, shouldRunSpec } from './spec-durations.mjs';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const at = (days) => new Date(NOW - days * 864e5).toISOString();

// @traces 1355-FR-004
describe('shouldRunSpec: the post-edit hook runs only specs Jest finished in under 5 s', () => {
  it('runs a spec with no record', () => {
    assert.equal(shouldRunSpec('a.spec.ts', {}, NOW), true);
  });

  it('runs a spec under 5000 ms and skips one at 5000 ms or more', () => {
    assert.equal(shouldRunSpec('a.spec.ts', { 'a.spec.ts': { ms: 4999, at: at(1) } }, NOW), true);
    assert.equal(shouldRunSpec('a.spec.ts', { 'a.spec.ts': { ms: 5000, at: at(1) } }, NOW), false);
  });

  it('runs a slow spec again once its record is older than 7 days', () => {
    assert.equal(shouldRunSpec('a.spec.ts', { 'a.spec.ts': { ms: 9000, at: at(8) } }, NOW), true);
    assert.equal(shouldRunSpec('a.spec.ts', { 'a.spec.ts': { ms: 9000, at: at(6) } }, NOW), false);
  });
});

describe('recordDuration', () => {
  it('creates the cache folder and writes {ms, at}, keeping other records', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'durations-')), '.specify', '.cache', 'spec-durations.json');
    recordDuration(file, 'a.spec.ts', 1234, new Date(NOW));
    recordDuration(file, 'b.spec.ts', 7000, new Date(NOW));
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      'a.spec.ts': { ms: 1234, at: '2026-10-21T12:00:00.000Z' },
      'b.spec.ts': { ms: 7000, at: '2026-10-21T12:00:00.000Z' },
    });
  });
});
