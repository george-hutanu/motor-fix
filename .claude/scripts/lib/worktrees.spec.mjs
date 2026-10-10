import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as watch from '../watch.mjs';
import { ffMainCommand, lockPid, mainCheckoutState, parseWorktrees, processAlive } from './worktrees.mjs';

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

describe('the main checkout against origin/main', () => {
  const fake = (answers) => (_path, args) => answers[args[0]] ?? null;

  it('lists tracked edits and counts on main only', () => {
    assert.deepEqual(mainCheckoutState('/r', fake({ status: ' M AGENTS.md\nM  docs/a.md\n', 'rev-parse': 'main\n', 'rev-list': '0\t2\n' })), { dirty: ['AGENTS.md', 'docs/a.md'], ahead: 0, behind: 2 });
    assert.deepEqual(mainCheckoutState('/r', fake({ status: '', 'rev-parse': 'other\n', 'rev-list': '0\t2\n' })), { dirty: [], ahead: null, behind: null });
  });

  it('reads an unreadable status as unknown, never as clean', () => {
    assert.deepEqual(mainCheckoutState('/r', fake({ 'rev-parse': 'main\n', 'rev-list': '0\t2\n' })), { dirty: null, ahead: null, behind: null });
  });

  it('names the fast-forward command', () => {
    assert.equal(ffMainCommand('/r'), 'git -C /r merge --ff-only origin/main');
  });
});
