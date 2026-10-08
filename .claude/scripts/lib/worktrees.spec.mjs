import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as watch from '../watch.mjs';
import { lockPid, parseWorktrees, processAlive } from './worktrees.mjs';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('lib/worktrees', () => {
  it('holds the worktree helpers that watch, worktree-remove and lifecycle share', () => {
    const [main, wt] = parseWorktrees(['worktree /r', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/main', '', 'worktree /r/w', 'HEAD ' + 'b'.repeat(40), 'branch refs/heads/x', 'locked claude agent a (pid 42 start x)', ''].join('\n'));
    assert.equal(main.main, true);
    assert.equal(wt.branch, 'x');
    assert.equal(lockPid(wt.lock), 42);
    assert.equal(processAlive(process.pid), true);
  });

  it('watch.mjs re-exports the same functions', () => {
    assert.equal(watch.parseWorktrees, parseWorktrees);
    assert.equal(watch.lockPid, lockPid);
    assert.equal(watch.processAlive, processAlive);
  });

  it('worktree-remove.mjs and lifecycle.mjs do not import watch.mjs (no import cycle)', () => {
    for (const name of ['worktree-remove.mjs', 'lifecycle.mjs']) {
      assert.doesNotMatch(source(name), /from "\.\/watch\.mjs"/, name);
    }
  });
});
