import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const identity = readFileSync(fileURLToPath(new URL('../../.husky/identity.sh', import.meta.url)), 'utf8');
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// No GIT_* from a surrounding hook, and no global config reaching the scratch repos.
const env = () => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return { ...clean, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
};
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: env() });
const sh = (cwd, mode) => spawnSync('sh', ['.husky/identity.sh', mode], { cwd, encoding: 'utf8', env: env() });

/** A main checkout with hooks in .husky/_ and one linked worktree, the way the desktop app lays them out. */
function checkouts({ worktreeHooks = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'identity-')));
  dirs.push(root);
  const main = join(root, 'main');
  const worktree = join(root, 'wt');
  mkdirSync(join(main, '.husky/_'), { recursive: true });
  writeFileSync(join(main, '.husky/identity.sh'), identity);
  writeFileSync(join(main, '.husky/_/h'), '');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '.husky/identity.sh');
  git(main, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qm', 'init');
  git(main, 'config', 'core.hooksPath', '.husky/_');
  git(main, 'config', 'extensions.worktreeConfig', 'true');
  git(main, 'worktree', 'add', '-q', worktree);
  if (worktreeHooks) {
    mkdirSync(join(worktree, '.husky/_'), { recursive: true });
    writeFileSync(join(worktree, '.husky/_/h'), '');
  }
  return { main, worktree };
}
const pinToMain = ({ main, worktree }) => git(worktree, 'config', '--worktree', 'core.hooksPath', join(main, '.husky/_'));

describe('identity.sh and the hooks a worktree runs', () => {
  it('apply points a worktree pinned to the main checkout back at its own hooks', () => {
    const repos = checkouts();
    pinToMain(repos);
    const out = sh(repos.worktree, 'apply');
    assert.equal(out.status, 0, out.stderr);
    assert.equal(git(repos.worktree, 'config', 'core.hooksPath').stdout.trim(), '.husky/_');
    assert.match(out.stdout, /hooks/);
  });

  it('check fails a worktree whose hooks run from another checkout, naming it and the fix', () => {
    const repos = checkouts();
    sh(repos.worktree, 'apply');
    pinToMain(repos);
    const out = sh(repos.worktree, 'check');
    assert.equal(out.status, 1);
    assert.ok(out.stderr.includes(join(repos.main, '.husky/_')), out.stderr);
    assert.match(out.stderr, /identity\.sh apply/);
  });

  it('check passes the main checkout and a worktree on their own hooks', () => {
    const repos = checkouts();
    pinToMain(repos);
    for (const dir of [repos.main, repos.worktree]) sh(dir, 'apply');
    for (const dir of [repos.main, repos.worktree]) {
      const out = sh(dir, 'check');
      assert.equal(out.status, 0, out.stderr);
    }
  });

  it('apply leaves the pin while the worktree has no hooks of its own yet', () => {
    const repos = checkouts({ worktreeHooks: false });
    pinToMain(repos);
    assert.equal(sh(repos.worktree, 'apply').status, 0);
    assert.equal(git(repos.worktree, 'config', 'core.hooksPath').stdout.trim(), join(repos.main, '.husky/_'));
  });
});
