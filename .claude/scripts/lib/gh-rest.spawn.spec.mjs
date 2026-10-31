import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { spawnRun } from './gh-rest.mjs';

// A compare reply over spawnSync's default 1 MB maxBuffer (1.2 MB on #651)
// failed with ENOBUFS, and the error was dropped: carry.mjs exited 2 with an
// empty message.
describe('spawnRun', () => {
  it('reads a reply over 1 MB', () => {
    const size = 3 * 1024 * 1024;
    const r = spawnRun()(process.execPath, ['-e', `process.stdout.write('x'.repeat(${size}))`]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.length, size);
  });

  it('surfaces a spawn error even when the command wrote nothing to stderr', () => {
    const r = spawnRun({ timeout: 100 })(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /ETIMEDOUT|timed out/i);
  });

  it('keeps the command own stderr and exit code', () => {
    const r = spawnRun()(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(3)']);
    assert.equal(r.code, 3);
    assert.equal(r.stderr, 'boom');
  });
});
