import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorktree, removeWorktree } from './worktree.mjs';

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An origin with main and a PR head ref, and a caller's clone of it. */
function repos() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'prtest-wt-')));
  dirs.push(root);
  const work = join(root, 'work');
  git(root, 'init', '-q', '-b', 'main', work);
  writeFileSync(join(work, 'a.txt'), 'main\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'main');
  git(work, 'checkout', '-qb', 'feature');
  writeFileSync(join(work, 'a.txt'), 'feature\n');
  git(work, 'commit', '-qam', 'feature');
  const head = git(work, 'rev-parse', 'HEAD');
  const origin = join(root, 'origin.git');
  git(root, 'clone', '-q', '--bare', work, origin);
  git(origin, 'update-ref', 'refs/pull/21/head', head);
  const caller = join(root, 'caller');
  git(root, 'clone', '-q', origin, caller);
  return { caller, head, root };
}

describe('the tester worktree', () => {
  it('checks the PR head out, detached, outside the caller\'s tree', () => {
    const { caller, head, root } = repos();
    const wt = createWorktree({ repo: caller, pr: 21, root: join(root, 'runs') });
    assert.equal(wt.sha, head);
    assert.equal(git(wt.dir, 'rev-parse', 'HEAD'), head);
    assert.ok(!wt.dir.startsWith(`${caller}/`), 'the worktree is inside the caller');
    assert.equal(git(caller, 'status', '--porcelain'), '');
    removeWorktree({ repo: caller, dir: wt.dir });
  });

  it('refuses a head that is not the commit it was asked to test', () => {
    const { caller, root } = repos();
    assert.throws(() => createWorktree({ repo: caller, pr: 21, sha: 'deadbeef', root: join(root, 'runs') }), /head/i);
  });

  it('removes the worktree and its registration', () => {
    const { caller, root } = repos();
    const wt = createWorktree({ repo: caller, pr: 21, root: join(root, 'runs') });
    removeWorktree({ repo: caller, dir: wt.dir });
    assert.equal(existsSync(wt.dir), false);
    assert.doesNotMatch(git(caller, 'worktree', 'list'), new RegExp(wt.dir));
  });

  it('leaves no ref behind in the caller\'s repository', () => {
    const { caller, root } = repos();
    const before = git(caller, 'for-each-ref', '--format=%(refname)');
    const wt = createWorktree({ repo: caller, pr: 21, root: join(root, 'runs') });
    removeWorktree({ repo: caller, dir: wt.dir });
    assert.equal(git(caller, 'for-each-ref', '--format=%(refname)'), before);
  });

  it('is safe to remove twice', () => {
    const { caller, root } = repos();
    const wt = createWorktree({ repo: caller, pr: 21, root: join(root, 'runs') });
    removeWorktree({ repo: caller, dir: wt.dir });
    assert.doesNotThrow(() => removeWorktree({ repo: caller, dir: wt.dir }));
  });
});
