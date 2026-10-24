// @traces 1376-FR-003
// run.mjs's side of a server that exits at boot: the wait's error and the log's
// last lines become one blocking finding, so the lap fails with the cause in it.
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bootFailure } from './run.mjs';
import { freePorts, waitForServer, watchExit } from './services.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mf-bootfail-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('bootFailure', () => {
  it('turns an app that exits before answering into a blocker carrying its log', async () => {
    const log = join(dir, 'api.out.log');
    const fd = openSync(log, 'w');
    const child = spawn(process.execPath, ['-e', 'console.log("boot step one"); console.error("Error: DATABASE_URL is missing"); process.exit(7)'], { stdio: ['ignore', fd, fd] });
    closeSync(fd);
    const exited = watchExit(child);
    const [port] = await freePorts(1);
    const started = Date.now();
    const h = await waitForServer(`http://127.0.0.1:${port}/health`, { name: 'api', exited: () => (exited() ? { ...exited(), name: 'api', log } : null), log, timeoutMs: 60000, intervalMs: 100 });
    assert.ok(Date.now() - started < 5000, 'the wait ended at the exit, not at the timeout');
    assert.equal(h.ok, false);

    const finding = bootFailure(h, log);
    assert.equal(finding.severity, 'blocker');
    assert.equal(finding.title, 'api did not come up');
    const [detail] = finding.steps;
    assert.match(detail, /7/, 'names the exit code');
    assert.match(detail, /DATABASE_URL is missing/, 'carries the last lines of the log');
    assert.match(detail, new RegExp(`last lines of ${log.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('names the object store the same way when it is the one that failed', () => {
    const finding = bootFailure({ ok: false, server: 'storage', error: 'storage: exited with code 1', tail: 'bind: address already in use' }, '/x/storage.out.log', 'The object store');
    assert.equal(finding.severity, 'blocker');
    assert.equal(finding.title, 'The object store did not come up');
    assert.match(finding.steps[0], /address already in use/);
  });
});
