// @traces 1376-FR-003 1376-FR-004
// The wait for a server the tester launched: it ends at once when the process
// has exited, ends at a bounded deadline otherwise, and carries the log's last lines.
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { freePorts, logTail, waitForServer, watchExit } from './services.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mf-wait-'));
const children = [];
afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

/** A node process running `code`, its output in `<name>.log`, as run.mjs launches an app. */
function launch(name, code) {
  const log = join(dir, `${name}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', fd, fd] });
  closeSync(fd);
  children.push(child);
  return { log, exited: watchExit(child) };
}

const nobody = async () => `http://127.0.0.1:${(await freePorts(1))[0]}/health/live`;

describe('waiting for a launched server', () => {
  it('ends at once when the server exits before it answers, naming the code, with the last log lines', async () => {
    const { log, exited } = launch('api', 'for (let i = 1; i <= 30; i++) console.log("line " + i); console.error("Error: APP_ENV must be one of development, test, staging, production"); process.exit(1)');
    const started = Date.now();
    const h = await waitForServer(await nobody(), { name: 'api', exited, log, timeoutMs: 60000, intervalMs: 100 });
    assert.ok(Date.now() - started < 5000, `waited ${Date.now() - started} ms for a server that had exited`);
    assert.equal(h.ok, false);
    assert.match(h.error, /api exited \(code 1\) before it answered/);
    assert.equal(h.server, 'api');
    assert.match(h.tail, /APP_ENV must be one of/);
    assert.match(h.tail, /line 30/);
    assert.doesNotMatch(h.tail, /^line 1$/m, 'only the last lines, not the whole log');
    assert.ok(h.tail.split('\n').length <= 20);
  });

  it('names the signal of a server killed by one', async () => {
    const { log, exited } = launch('web', 'process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 5000)');
    const h = await waitForServer(await nobody(), { name: 'web', exited, log, timeoutMs: 60000, intervalMs: 100 });
    assert.equal(h.ok, false);
    assert.match(h.error, /web exited \(signal SIGTERM\) before it answered/);
  });

  it('names the server that exited when it is not the one being waited for', async () => {
    const worker = launch('worker', 'console.log("worker boom"); process.exit(2)');
    const h = await waitForServer(await nobody(), { name: 'api', exited: () => (worker.exited() ? { ...worker.exited(), name: 'worker', log: worker.log } : null), log: join(dir, 'api-none.log'), timeoutMs: 60000, intervalMs: 100 });
    assert.equal(h.ok, false);
    assert.match(h.error, /worker exited \(code 2\)/);
    assert.equal(h.server, 'worker');
    assert.match(h.tail, /worker boom/);
  });

  it('ends at its deadline on a server that runs but never answers, with the last log lines', async () => {
    const { log, exited } = launch('slow', 'console.log("still booting"); setTimeout(() => {}, 30000)');
    const started = Date.now();
    const h = await waitForServer(await nobody(), { name: 'slow', exited, log, timeoutMs: 700, intervalMs: 100 });
    assert.ok(Date.now() - started < 4000);
    assert.equal(h.ok, false);
    assert.match(h.error, /slow: .* did not answer 2xx within 700 ms/);
    assert.match(h.tail, /still booting/);
  });

  it('succeeds once the server answers 2xx', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const h = await waitForServer(`http://127.0.0.1:${server.address().port}/`, { name: 'web', exited: () => null, log: join(dir, 'none.log'), timeoutMs: 5000, intervalMs: 50 });
    await new Promise((resolve) => server.close(resolve));
    assert.equal(h.ok, true);
    assert.equal(h.status, 200);
  });
});

describe('the last lines of a log', () => {
  it('says the log is empty when there is no file or nothing in it', () => {
    assert.equal(logTail(join(dir, 'missing.log')), '(the log is empty)');
    writeFileSync(join(dir, 'empty.log'), '\n');
    assert.equal(logTail(join(dir, 'empty.log')), '(the log is empty)');
  });

  it('keeps the last n lines', () => {
    writeFileSync(join(dir, 'five.log'), 'a\nb\nc\nd\ne\n');
    assert.equal(logTail(join(dir, 'five.log'), 2), 'd\ne');
  });
});
