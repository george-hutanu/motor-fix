// @traces 1376-FR-001 1376-FR-003 1376-FR-004
// Hostile inputs for the local boot: the environment builder, the log tail and the bounded wait.
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTcp } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { freePorts, logTail, waitForHttp, waitForServer, watchExit, bootEnv } from './services.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mf-bootadv-'));
const children = [];
const servers = [];
afterAll(() => {
  for (const c of children) c.kill('SIGKILL');
  for (const s of servers) s.close();
  rmSync(dir, { recursive: true, force: true });
});

function launch(name, code) {
  const log = join(dir, `${name}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', fd, fd] });
  closeSync(fd);
  children.push(child);
  return { log, exited: watchExit(child), child };
}
const nobody = async () => `http://127.0.0.1:${(await freePorts(1))[0]}/health/live`;
const listen = (server) => new Promise((resolve) => { servers.push(server); server.listen(0, '127.0.0.1', resolve); });

const ports = { postgres: 5501, redis: 5502, storage: 5503 };

describe('the boot environment under hostile callers', () => {
  it('sets APP_ENV to test when the caller holds an empty or odd-cased APP_ENV', () => {
    for (const bad of ['', ' ', 'PRODUCTION', 'test ', 'production\n']) {
      assert.equal(bootEnv({ ports, base: { APP_ENV: bad } }).APP_ENV, 'test', JSON.stringify(bad));
    }
  });

  it('does not mutate the caller environment or the ports', () => {
    const base = { PATH: '/bin', APP_ENV: 'production' };
    const p = { ...ports };
    bootEnv({ ports: p, base });
    assert.deepEqual(base, { PATH: '/bin', APP_ENV: 'production' });
    assert.deepEqual(p, ports);
  });

  it('returns the same environment on a second call', () => {
    const a = bootEnv({ ports, base: { PATH: '/bin' } });
    assert.deepEqual(bootEnv({ ports, base: { PATH: '/bin' } }), a);
  });


  it('never leaves an empty value for a variable it supplies even when the caller blanks every name', () => {
    const base = { APP_ENV: '', AUTH_TOKEN_SECRET: '', DATABASE_URL: '', REDIS_URL: '', STORAGE_ACCESS_KEY_ID: '', STORAGE_SECRET_ACCESS_KEY: '' };
    const env = bootEnv({ ports, base });
    for (const name of Object.keys(base)) assert.notEqual(env[name], '', name);
  });

  it('lets the tester win over caller values written in lower case or with unicode names', () => {
    const env = bootEnv({ ports, base: { 'APP_ENV': 'production', 'ÄPP_ENV': 'x' } });
    assert.equal(env.APP_ENV, 'test');
  });

  it('points database and cache at the run ports for any port value, not the shared defaults', () => {
    const env = bootEnv({ ports: { postgres: 65535, redis: 1, storage: 9 }, base: {} });
    assert.match(env.DATABASE_URL, /:65535\//);
    assert.match(env.REDIS_URL, /:1(\/|$)/);
  });
});

describe('the last lines of a hostile log', () => {
  it('returns exactly the last line for n = 1 with and without a trailing newline', () => {
    writeFileSync(join(dir, 'a.log'), 'x\ny\nz');
    assert.equal(logTail(join(dir, 'a.log'), 1), 'z');
    writeFileSync(join(dir, 'b.log'), 'x\ny\nz\n');
    assert.equal(logTail(join(dir, 'b.log'), 1), 'z');
  });

  it('returns at most n lines when n is more than the file holds', () => {
    writeFileSync(join(dir, 'c.log'), 'only\n');
    assert.equal(logTail(join(dir, 'c.log'), 50), 'only');
  });

  it('does not return the whole log for n = 0', () => {
    writeFileSync(join(dir, 'd.log'), 'a\nb\n');
    assert.notEqual(logTail(join(dir, 'd.log'), 0), 'a\nb');
  });

  it('reads a tens-of-MB log quickly and keeps only the last lines', () => {
    const line = 'x'.repeat(99) + '\n';
    writeFileSync(join(dir, 'big.log'), line.repeat(500000) + 'LAST\n');
    const started = Date.now();
    const tail = logTail(join(dir, 'big.log'), 3);
    assert.ok(Date.now() - started < 3000);
    assert.equal(tail.split('\n').length, 3);
    assert.match(tail, /LAST$/);
  });

  it('handles a log that is one huge line without returning megabytes', () => {
    writeFileSync(join(dir, 'one.log'), 'y'.repeat(20 * 1024 * 1024));
    assert.ok(logTail(join(dir, 'one.log'), 20).length < 1024 * 1024);
  });

  it('strips carriage returns of a Windows-style log', () => {
    writeFileSync(join(dir, 'crlf.log'), 'a\r\nb\r\n');
    assert.equal(logTail(join(dir, 'crlf.log'), 2), 'a\nb');
  });

  it('returns a UTF-8 multibyte line intact', () => {
    writeFileSync(join(dir, 'u.log'), 'eroare: șuruburi încărcate\n');
    assert.equal(logTail(join(dir, 'u.log'), 1), 'eroare: șuruburi încărcate');
  });

  it('does not throw on a UTF-16 log with a BOM and returns a string', () => {
    writeFileSync(join(dir, 'u16.log'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('boom\n', 'utf16le')]));
    assert.equal(typeof logTail(join(dir, 'u16.log'), 5), 'string');
  });

  it('does not throw on a binary blob and returns a string', () => {
    writeFileSync(join(dir, 'bin.log'), Buffer.from([0, 255, 254, 0, 1, 2, 10, 200, 201]));
    assert.equal(typeof logTail(join(dir, 'bin.log'), 5), 'string');
  });

  it('says the log is empty when the path is a directory instead of throwing', () => {
    mkdirSync(join(dir, 'adir'));
    assert.equal(logTail(join(dir, 'adir')), '(the log is empty)');
  });

  it('says the log is empty for a zero-byte file and for whitespace only', () => {
    writeFileSync(join(dir, 'zero.log'), '');
    assert.equal(logTail(join(dir, 'zero.log')), '(the log is empty)');
    writeFileSync(join(dir, 'ws.log'), '  \n\t\n\n');
    assert.equal(logTail(join(dir, 'ws.log')), '(the log is empty)');
  });
});

describe('the bounded wait under hostile servers', () => {
  it('reports code 0 when a server exits cleanly before answering', async () => {
    const { log, exited } = launch('clean', 'console.log("bye")');
    const h = await waitForServer(await nobody(), { name: 'api', exited, log, timeoutMs: 60000, intervalMs: 50 });
    assert.equal(h.ok, false);
    assert.match(h.error, /api exited \(code 0\) before it answered/);
    assert.match(h.tail, /bye/);
  });

  it('does not throw when the log of an exited server was never created', async () => {
    const { exited } = launch('nolog', 'process.exit(3)');
    const h = await waitForServer(await nobody(), { name: 'api', exited, log: join(dir, 'never.log'), timeoutMs: 60000, intervalMs: 50 });
    assert.match(h.error, /code 3/);
    assert.equal(h.tail, '(the log is empty)');
  });

  it('ends a server that exits in the middle of the wait without waiting out the timeout', async () => {
    const { log, exited } = launch('late', 'console.log("warming"); setTimeout(() => { console.log("crash"); process.exit(9) }, 400)');
    const started = Date.now();
    const h = await waitForServer(await nobody(), { name: 'api', exited, log, timeoutMs: 60000, intervalMs: 50 });
    assert.ok(Date.now() - started < 4000);
    assert.match(h.error, /code 9/);
    assert.match(h.tail, /crash/);
  });

  it('keeps waiting while a server answers 503 and succeeds when it turns 200', async () => {
    let n = 0;
    const s = createServer((_q, r) => { r.statusCode = ++n < 3 ? 503 : 200; r.end(); });
    await listen(s);
    const h = await waitForServer(`http://127.0.0.1:${s.address().port}/`, { name: 'web', exited: () => null, log: join(dir, 'n.log'), timeoutMs: 5000, intervalMs: 50 });
    assert.deepEqual([h.ok, h.status], [true, 200]);
  });

  it('fails at the deadline on a server that only ever answers 500, with the log tail', async () => {
    const s = createServer((_q, r) => { r.statusCode = 500; r.end(); });
    await listen(s);
    writeFileSync(join(dir, 'five.log'), 'stack trace\n');
    const h = await waitForServer(`http://127.0.0.1:${s.address().port}/`, { name: 'web', exited: () => null, log: join(dir, 'five.log'), timeoutMs: 500, intervalMs: 50 });
    assert.equal(h.ok, false);
    assert.match(h.error, /did not answer 2xx within 500 ms/);
    assert.match(h.tail, /stack trace/);
  });

  it('is bounded by its deadline when the server accepts the connection and never replies', async () => {
    const s = createTcp(() => {});
    await listen(s);
    const started = Date.now();
    const h = await waitForServer(`http://127.0.0.1:${s.address().port}/`, { name: 'api', exited: () => null, log: join(dir, 'hang.log'), timeoutMs: 600, intervalMs: 50 });
    assert.ok(Date.now() - started < 4500, `waited ${Date.now() - started} ms on a 600 ms deadline`);
    assert.equal(h.ok, false);
  });

  it('keeps only the requested number of lines in the tail', async () => {
    const { log, exited } = launch('many', 'for (let i = 1; i <= 100; i++) console.log("row " + i); process.exit(1)');
    const h = await waitForServer(await nobody(), { name: 'api', exited, log, timeoutMs: 60000, intervalMs: 50, lines: 3 });
    assert.equal(h.tail, 'row 98\nrow 99\nrow 100');
  });

  it('answers the same on a second wait for the same exited server', async () => {
    const { log, exited } = launch('twice', 'console.log("once"); process.exit(4)');
    const url = await nobody();
    const a = await waitForServer(url, { name: 'api', exited, log, timeoutMs: 60000, intervalMs: 50 });
    const b = await waitForServer(url, { name: 'api', exited, log, timeoutMs: 60000, intervalMs: 50 });
    assert.deepEqual(b, a);
  });

  it('fails at once on an exited server even with a timeout of zero or a tiny interval', async () => {
    const { log, exited } = launch('zero', 'process.exit(5)');
    const h = await waitForServer(await nobody(), { name: 'api', exited, log, timeoutMs: 1, intervalMs: 1 });
    assert.equal(h.ok, false);
    assert.match(h.error, /api/);
  });

  it('prefers the exit over an answer that never came: an unreachable URL string fails, not throws', async () => {
    const h = await waitForServer('not a url', { name: 'api', exited: () => null, log: join(dir, 'x.log'), timeoutMs: 300, intervalMs: 50 });
    assert.equal(h.ok, false);
    assert.equal(typeof h.error, 'string');
  });

  it('waitForHttp ends at once for an exited process rather than at its timeout', async () => {
    const { exited } = launch('http', 'process.exit(6)');
    const started = Date.now();
    await waitForHttp(await nobody(), { timeoutMs: 60000, intervalMs: 50, exited }).catch(() => {});
    assert.ok(Date.now() - started < 4000);
  });
});
