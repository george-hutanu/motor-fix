import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { waitForCi } from './ci-wait.mjs';

function world({ checks = [], run = [], mergeable = ['MERGEABLE'] } = {}) {
  const calls = [];
  let t = 0;
  const next = (list) => (list.length > 1 ? list.shift() : list[0]);
  const bad = (answer) => {
    if (answer === 'error') return { code: 1, stdout: '', stderr: 'HTTP 502' };
    if (answer === 'garbled') return { code: 0, stdout: '<html>', stderr: '' };
    if (answer === 'empty') return { code: 0, stdout: '', stderr: '' };
    return null;
  };
  const gh = async (args) => {
    calls.push(args.join(' '));
    const list = args[0] === 'pr' && args[1] === 'checks' ? checks : args[0] === 'pr' ? mergeable : run;
    const answer = next(list);
    const failure = bad(answer);
    if (failure) return failure;
    if (args[1] === 'view' && args[0] === 'pr') return { code: 0, stdout: JSON.stringify({ mergeable: answer }), stderr: '' };
    return { code: 0, stdout: JSON.stringify(answer), stderr: '' };
  };
  return { calls, gh, sleep: async (ms) => { t += ms; }, now: () => t };
}

const green = [{ name: 'CI OK', bucket: 'pass' }];
const pending = [{ name: 'CI OK', bucket: 'pending' }];
const done = { status: 'completed', conclusion: 'success' };
const reads = (w, prefix) => w.calls.filter((c) => c.startsWith(prefix)).length;
const wait = (w, extra = {}) => waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now, ...extra });

describe('the unreadable-answer limit at its edges', () => {
  // @traces 317-FR-005
  it('with one try allowed, the first unreadable checks read ends the wait with exit 2', async () => {
    const w = world({ checks: ['error', green] });
    const out = await wait(w, { ghTries: 1 });
    assert.equal(out.code, 2);
    assert.match(out.lines[0], /HTTP 502/);
    assert.equal(reads(w, 'pr checks'), 1);
  });

  // @traces 317-FR-005
  it('two unreadable reads in a row stay under the default of three, the third ends it', async () => {
    const two = world({ checks: ['error', 'error', green] });
    assert.deepEqual(await wait(two), { code: 0, lines: [] });
    const three = world({ checks: ['error', 'error', 'error', green] });
    assert.equal((await wait(three)).code, 2);
    assert.equal(reads(three, 'pr checks'), 3);
  });

  // @traces 317-FR-005
  it('empty output counts as unreadable, not as green', async () => {
    const w = world({ checks: ['empty'] });
    assert.equal((await wait(w)).code, 2);
    assert.equal(reads(w, 'pr checks'), 3);
  });

  // @traces 317-FR-005
  it('an error and a parse failure mixed count together toward the limit', async () => {
    const w = world({ checks: ['error', 'garbled', 'error', green] });
    const out = await wait(w);
    assert.equal(out.code, 2);
    assert.equal(reads(w, 'pr checks'), 3);
  });

  // @traces 317-FR-005
  it('waits between the retries instead of re-reading at once', async () => {
    const w = world({ checks: ['error'] });
    await wait(w);
    assert.equal(w.now(), 120_000);
  });

  // @traces 317-FR-005
  it('a success after the wait is already done is not affected by earlier errors', async () => {
    const w = world({ checks: ['error', [{ name: 'Checks', bucket: 'fail' }]] });
    assert.deepEqual(await wait(w), { code: 0, lines: ['Checks: fail'] });
  });
});

describe('every read the wait makes has the retry', () => {
  // @traces 317-FR-005
  it('a mergeable read that never answers ends with exit 2 after three reads', async () => {
    const w = world({ checks: [green], mergeable: ['error'] });
    const out = await wait(w);
    assert.equal(out.code, 2);
    assert.match(out.lines[0], /HTTP 502/);
    assert.equal(reads(w, 'pr view'), 3);
  });

  // @traces 317-FR-005
  it('a conflict read after one mergeable failure still ends the wait with exit 3', async () => {
    const w = world({ checks: [pending], mergeable: ['error', 'CONFLICTING'] });
    assert.deepEqual(await wait(w), { code: 3, lines: ['conflict: merge origin/main'] });
  });

  // @traces 317-FR-005
  it('the QA run wait restarts its count after a readable in-progress answer', async () => {
    const w = world({ run: ['error', 'error', { status: 'in_progress', conclusion: '' }, 'error', 'error', done] });
    assert.deepEqual(await wait(w, { run: '123' }), { code: 0, lines: ['QA run: success'] });
  });

  // @traces 317-FR-005
  it('the QA run wait takes the number of tries it is given', async () => {
    const w = world({ run: ['garbled'] });
    assert.equal((await wait(w, { run: '123', ghTries: 4 })).code, 2);
    assert.equal(reads(w, 'run view'), 4);
  });

  // @traces 317-FR-005
  // The count is by poll (spec FR-005): three polls in a row each with a different read broken end the wait,
  // and a poll whose every read answered between them starts it over.
  it('three polls in a row, each with a different read unreadable, end the wait with exit 2', async () => {
    const w = world({ mergeable: ['error', 'MERGEABLE'], run: ['error', { status: 'in_progress', conclusion: '' }, 'error', done] });
    const out = await wait(w, { run: '123' });
    assert.equal(out.code, 2, JSON.stringify(out));
  });

  it('a whole poll between unreadable ones starts the count over in the QA run wait', async () => {
    const pending = { status: 'in_progress', conclusion: '' };
    const w = world({ mergeable: ['error', 'MERGEABLE', 'MERGEABLE', 'error', 'MERGEABLE'], run: ['error', pending, pending, pending, 'error', done] });
    assert.deepEqual(await wait(w, { run: '123' }), { code: 0, lines: ['QA run: success'] });
  });

  // @traces 317-FR-005
  it('an unreadable read does not outlast the overall wait limit', async () => {
    const w = world({ checks: ['error'] });
    const out = await wait(w, { ghTries: 100, waitMs: 60_000, pollMs: 15_000 });
    assert.equal(out.code === 1 || out.code === 2, true, JSON.stringify(out));
    assert.ok(w.now() <= 60_000 + 15_000, String(w.now()));
  });
});

describe('the command line', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // @traces 317-FR-005
  it('SPECKIT_CI_GH_TRIES=1 ends at the first gh failure with exit 2 and no sleep', () => {
    dir = mkdtempSync(join(tmpdir(), 'ci-wait-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\necho 'HTTP 502' >&2\nexit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const script = join(import.meta.dirname, 'ci-wait.mjs');
    const r = spawnSync(process.execPath, [script, '21'], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SPECKIT_CI_GH_TRIES: '1' },
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /HTTP 502/);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  });
});
