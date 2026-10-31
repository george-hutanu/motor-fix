import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { realGh } from './post.mjs';

// carry.mjs reads the compare through realGh: a reply over execFileSync's
// default 1 MB maxBuffer (1.2 MB on #651) failed, and the empty stderr hid why.
describe('realGh', () => {
  it('reads a reply over 1 MB', () => {
    const size = 3 * 1024 * 1024;
    const r = realGh(['-e', `process.stdout.write('x'.repeat(${size}))`], { file: process.execPath });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.length, size);
  });

  it('surfaces the error when the command wrote nothing to stderr', () => {
    const r = realGh(['-e', 'setTimeout(() => {}, 5000)'], { file: process.execPath, timeout: 100 });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /ETIMEDOUT|timed out/i);
  });

  it('keeps the command own stderr and exit code', () => {
    const r = realGh(['-e', 'process.stderr.write("boom"); process.exit(3)'], { file: process.execPath });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /boom/);
  });
});
