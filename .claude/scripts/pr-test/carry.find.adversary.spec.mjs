import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as carry from './carry.mjs';

const script = fileURLToPath(new URL('./carry.mjs', import.meta.url));

describe('carry.mjs --find, adversarial', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'carry-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (args, ghScript) => {
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\n${ghScript}\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  };

  // @traces 448-FR-008
  it('exits non-zero with a reason on stderr and nothing on stdout when gh fails', () => {
    const out = run(['21', '--find'], 'echo "HTTP 502 bad gateway" >&2; exit 1');
    assert.notEqual(out.status, 0);
    assert.equal(out.stdout, '');
    assert.match(out.stderr, /502/);
  });

  // @traces 448-FR-008
  it('exits non-zero and prints no JSON when gh prints output that is not JSON', () => {
    const out = run(['21', '--find'], 'echo "<html>"; exit 0');
    assert.notEqual(out.status, 0);
    assert.equal(out.stdout, '');
  });

  // @traces 448-FR-008
  it('exits 2 with a usage line when no PR number is given', () => {
    const out = run(['--find'], 'exit 0');
    assert.equal(out.status, 2);
    assert.match(out.stderr, /usage/);
  });

  // @traces 448-FR-008
  it('does not take a non-numeric PR argument for a PR', () => {
    const out = run(['abc', '--find'], 'exit 0');
    assert.equal(out.status, 2);
    assert.match(out.stderr, /usage/);
  });

  // @traces 448-FR-008
  it('only reads: gh is never asked to comment or post a status', () => {
    const log = join(dir, 'calls.log');
    run(['21', '--find'], `echo "$@" >> ${log}; exit 1`);
    assert.doesNotMatch(readFileSync(log, 'utf8'), /comment|POST|state=/);
  });
});

describe('the single carry reader, adversarial', () => {
  // @traces 448-FR-007
  it('no longer exports readCarryState', () => {
    assert.equal(carry.readCarryState, undefined);
  });

  // @traces 448-FR-007
  it('findCarry rejects when an async gh rejects', async () => {
    await assert.rejects(carry.findCarry({ pr: '21', gh: async () => { throw new Error('boom'); } }), /boom/);
  });

  // @traces 448-FR-007
  it('findCarry rejects when a synchronous gh throws', async () => {
    await assert.rejects(carry.findCarry({ pr: '21', gh: () => { throw new Error('sync boom'); } }), /sync boom/);
  });
});
