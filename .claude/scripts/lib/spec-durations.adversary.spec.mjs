import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { recordDuration, shouldRunSpec, STORE } from './spec-durations.mjs';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const DAY = 864e5;
const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString();
const SPEC = 'apps/web/src/x.spec.ts';

// @traces 1355-FR-004
describe('shouldRunSpec: boundaries and corrupt records', () => {
  it('runs at 0 ms and at 4999 ms, skips at 5000 and 5001 ms', () => {
    assert.equal(shouldRunSpec(SPEC, { [SPEC]: { ms: 0, at: iso(1000) } }, NOW), true);
    assert.equal(shouldRunSpec(SPEC, { [SPEC]: { ms: 4999, at: iso(1000) } }, NOW), true);
    assert.equal(shouldRunSpec(SPEC, { [SPEC]: { ms: 5000, at: iso(1000) } }, NOW), false);
    assert.equal(shouldRunSpec(SPEC, { [SPEC]: { ms: 5001, at: iso(1000) } }, NOW), false);
  });

  it('keeps a slow record at exactly 7 days and drops it one millisecond later', () => {
    assert.equal(shouldRunSpec(SPEC, { [SPEC]: { ms: 9000, at: iso(7 * DAY) } }, NOW), false);
    assert.equal(shouldRunSpec(SPEC, { [SPEC]: { ms: 9000, at: iso(7 * DAY + 1) } }, NOW), true);
  });

  it('runs when the store is not an object', () => {
    for (const store of [undefined, null, [], 'x', 42, true]) {
      assert.equal(shouldRunSpec(SPEC, store, NOW), true, JSON.stringify(store));
    }
  });

  it('counts a record without a usable duration as absent', () => {
    for (const rec of [{ at: iso(1000) }, { ms: null, at: iso(1000) }, { ms: 'slow', at: iso(1000) }, { ms: NaN, at: iso(1000) }, {}, null, 12000, 'x', []]) {
      assert.equal(shouldRunSpec(SPEC, { [SPEC]: rec }, NOW), true, JSON.stringify(rec));
    }
  });

  it('counts a slow record without a usable timestamp as absent', () => {
    for (const at of [undefined, null, '', 'yesterday', 'not-a-date', {}]) {
      assert.equal(shouldRunSpec(SPEC, { [SPEC]: { ms: 12000, at } }, NOW), true, String(at));
    }
  });

  it('does not mistake an inherited property for a record', () => {
    for (const spec of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(shouldRunSpec(spec, {}, NOW), true, spec);
    }
  });

  it('treats paths with spaces and unicode as ordinary keys', () => {
    const spec = 'apps/web/src/café ünï/x y.spec.ts';
    assert.equal(shouldRunSpec(spec, { [spec]: { ms: 12000, at: iso(1000) } }, NOW), false);
    assert.equal(shouldRunSpec(spec, { 'other.spec.ts': { ms: 12000, at: iso(1000) } }, NOW), true);
  });

  it('judges each spec by its own record', () => {
    const store = { 'a.spec.ts': { ms: 12000, at: iso(1000) }, 'b.spec.ts': { ms: 100, at: iso(1000) } };
    assert.equal(shouldRunSpec('a.spec.ts', store, NOW), false);
    assert.equal(shouldRunSpec('b.spec.ts', store, NOW), true);
    assert.equal(shouldRunSpec('a.spec.ts', store, NOW), false);
  });
});

describe('recordDuration against a damaged store', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'durations-adv-'));
    file = join(dir, '.specify', '.cache', 'spec-durations.json');
    mkdirSync(dirname(file), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  for (const [label, content] of [
    ['garbage text', 'not json {{'],
    ['an empty file', ''],
    ['a truncated object', '{"a.spec.ts": {"ms": 12'],
    ['null', 'null'],
    ['an array', '[1,2]'],
    ['a string', '"x"'],
    ['a number', '42'],
  ]) {
    it(`replaces ${label} with a store holding the new record`, () => {
      writeFileSync(file, content);
      recordDuration(file, SPEC, 1234, new Date(NOW));
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { [SPEC]: { ms: 1234, at: iso(0) } });
    });
  }

  it('keeps one entry per spec when it records the same spec twice, the later wins', () => {
    recordDuration(file, SPEC, 9000, new Date(NOW));
    recordDuration(file, SPEC, 100, new Date(NOW + 1000));
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { [SPEC]: { ms: 100, at: new Date(NOW + 1000).toISOString() } });
  });

  it('writes a record shouldRunSpec reads back as fresh', () => {
    recordDuration(file, SPEC, 12000, new Date(NOW));
    const store = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(shouldRunSpec(SPEC, store, NOW + 6 * DAY), false);
    assert.equal(shouldRunSpec(SPEC, store, NOW + 8 * DAY), true);
  });

  it('names the store under .specify/.cache', () => {
    assert.equal(STORE, '.specify/.cache/spec-durations.json');
  });
});

describe('spec-durations CLI', () => {
  const cli = join(import.meta.dirname, 'spec-durations.mjs');
  let cwd;
  const sh = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  const store = () => join(cwd, STORE);
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'durations-cli-'));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('exits 0 (run) when no store file exists', () => {
    assert.equal(sh('should', SPEC).status, 0);
  });

  it('exits 0 (run) when the store file is corrupt', () => {
    mkdirSync(dirname(store()), { recursive: true });
    writeFileSync(store(), '\u0000\u0001 not json');
    assert.equal(sh('should', SPEC).status, 0);
  });

  for (const content of ['null', '[]', '"x"', '42', '{"a.spec.ts": null}']) {
    it(`exits 0 (run) when the store file holds ${content}`, () => {
      mkdirSync(dirname(store()), { recursive: true });
      writeFileSync(store(), content);
      assert.equal(sh('should', SPEC).status, 0);
    });

    it(`records into a store file that held ${content}`, () => {
      mkdirSync(dirname(store()), { recursive: true });
      writeFileSync(store(), content);
      assert.equal(sh('record', SPEC, '12000').status, 0);
      assert.equal(sh('should', SPEC).status, 1);
    });
  }

  it('exits 0 (run) when the store file is UTF-16 with a byte order mark', () => {
    mkdirSync(dirname(store()), { recursive: true });
    writeFileSync(store(), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify({ [SPEC]: { ms: 12000, at: new Date().toISOString() } }), 'utf16le')]));
    assert.equal(sh('should', SPEC).status, 0);
  });

  it('exits 1 (skip) right after recording 12000 ms, 0 after recording 4999 ms', () => {
    assert.equal(sh('record', SPEC, '12000').status, 0);
    assert.equal(sh('should', SPEC).status, 1);
    assert.equal(sh('record', SPEC, '4999').status, 0);
    assert.equal(sh('should', SPEC).status, 0);
  });

  it('exits 0 at 4999 and 1 at 5000 ms through the CLI', () => {
    sh('record', SPEC, '4999');
    assert.equal(sh('should', SPEC).status, 0);
    sh('record', SPEC, '5000');
    assert.equal(sh('should', SPEC).status, 1);
  });

  it('stores the duration as a number, not a string', () => {
    sh('record', SPEC, '12000');
    assert.strictEqual(JSON.parse(readFileSync(store(), 'utf8'))[SPEC].ms, 12000);
  });

  it('accepts a fractional duration', () => {
    assert.equal(sh('record', SPEC, '5000.5').status, 0);
    assert.equal(sh('should', SPEC).status, 1);
  });

  it('keeps earlier specs when it records another one', () => {
    sh('record', 'a.spec.ts', '12000');
    sh('record', 'b.spec.ts', '10');
    assert.equal(sh('should', 'a.spec.ts').status, 1);
    assert.equal(sh('should', 'b.spec.ts').status, 0);
  });

  it('exits 2 with usage for a missing argument or an unknown command', () => {
    assert.equal(sh().status, 2);
    assert.equal(sh('should').status, 2);
    assert.equal(sh('record', SPEC).status, 2);
    assert.equal(sh('forget', SPEC).status, 2);
  });

  it('writes no record for a duration that is not a number', () => {
    sh('record', SPEC, 'fast');
    sh('record', SPEC, '');
    let content = '{}';
    try {
      content = readFileSync(store(), 'utf8');
    } catch {}
    const rec = JSON.parse(content)[SPEC];
    assert.ok(rec === undefined || Number.isFinite(rec.ms), content);
    assert.equal(sh('should', SPEC).status, 0);
  });
});
