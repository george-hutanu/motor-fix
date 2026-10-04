import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorktree, depsToClone, removeWorktree } from './worktree.mjs';

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

/** A checkout with a lockfile and, if asked, its own installed dependencies. */
function checkout(root, name, { lock = 'lock-a', deps = true } = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package-lock.json'), lock);
  if (deps) {
    mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), '');
  }
  return dir;
}

describe('the dependencies the tester copies instead of installing', () => {
  const scratch = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'prtest-deps-')));
    dirs.push(root);
    return root;
  };

  it('copies the caller\'s own node_modules when the lockfiles match', () => {
    const repoRoot = checkout(scratch(), 'caller');
    assert.equal(depsToClone({ repoRoot, lock: 'lock-a' }), join(repoRoot, 'node_modules'));
  });

  it('copies the directory a symlinked node_modules points at, not the link', () => {
    const root = scratch();
    const owner = checkout(root, 'owner');
    const repoRoot = checkout(root, 'caller', { deps: false });
    symlinkSync('../owner/node_modules', join(repoRoot, 'node_modules'));
    assert.equal(depsToClone({ repoRoot, lock: 'lock-a' }), join(owner, 'node_modules'));
  });

  it('installs when the linked dependencies were installed from another lockfile', () => {
    const root = scratch();
    checkout(root, 'owner', { lock: 'lock-old' });
    const repoRoot = checkout(root, 'caller', { deps: false });
    symlinkSync('../owner/node_modules', join(repoRoot, 'node_modules'));
    assert.equal(depsToClone({ repoRoot, lock: 'lock-a' }), null);
  });

  it('installs when the link points at nothing', () => {
    const repoRoot = checkout(scratch(), 'caller', { deps: false });
    symlinkSync('../gone/node_modules', join(repoRoot, 'node_modules'));
    assert.equal(depsToClone({ repoRoot, lock: 'lock-a' }), null);
  });

  it('installs when the caller has no dependencies or a different lockfile', () => {
    const root = scratch();
    assert.equal(depsToClone({ repoRoot: checkout(root, 'bare', { deps: false }), lock: 'lock-a' }), null);
    assert.equal(depsToClone({ repoRoot: checkout(root, 'caller'), lock: 'lock-b' }), null);
  });
});
