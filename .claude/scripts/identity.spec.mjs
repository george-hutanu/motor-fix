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
// No CLAUDE_CODE_REMOTE either, unless a case sets it: the local cases stay local in a cloud run.
const env = (extra = {}) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_CODE_REMOTE'));
  return { ...clean, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra };
};
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: env() });
const sh = (cwd, mode, extra) => spawnSync('sh', ['.husky/identity.sh', mode], { cwd, encoding: 'utf8', env: env(extra) });
const CLOUD = { CLAUDE_CODE_REMOTE: 'true' };
const credentialKeys = (cwd) => git(cwd, 'config', '--get-regexp', '^credential\\.').stdout.trim();

/** A main checkout with hooks in .husky/_ and one linked worktree, the way the desktop app lays them out. */
function checkouts({ worktreeHooks = true, worktreeConfig = true } = {}) {
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
  if (worktreeConfig) git(main, 'config', 'extensions.worktreeConfig', 'true');
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

  it('check tells a worktree with no hooks of its own yet to install them', () => {
    const repos = checkouts({ worktreeHooks: false });
    sh(repos.worktree, 'apply');
    pinToMain(repos);
    const out = sh(repos.worktree, 'check');
    assert.equal(out.status, 1);
    assert.match(out.stderr, /npm install/);
  });

  it('apply never unsets a hooks path shared by every checkout', () => {
    // A lone checkout: without the extension, git reads --worktree as the shared config.
    const { main, worktree } = checkouts({ worktreeConfig: false });
    git(main, 'worktree', 'remove', '--force', worktree);
    git(main, 'config', 'core.hooksPath', join(worktree, '.husky/_'));
    sh(main, 'apply');
    assert.equal(git(main, 'config', 'core.hooksPath').stdout.trim(), join(worktree, '.husky/_'));
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

// @traces 749-FR-001
describe('identity.sh in a cloud session (CLAUDE_CODE_REMOTE=true), where a proxy holds the GitHub credentials', () => {
  it('apply writes the author and no credential helper or username', () => {
    const { main } = checkouts();
    const out = sh(main, 'apply', CLOUD);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(git(main, 'config', 'user.name').stdout.trim(), 'george-hutanu');
    assert.equal(git(main, 'config', 'user.email').stdout.trim(), 'hutanugeorge40@gmail.com');
    assert.equal(credentialKeys(main), '');
  });

  it('check passes without credential pinning', () => {
    const { main } = checkouts();
    sh(main, 'apply', CLOUD);
    const out = sh(main, 'check', CLOUD);
    assert.equal(out.status, 0, out.stderr);
  });

  it('check still fails a wrong author or committer', () => {
    const { main } = checkouts();
    sh(main, 'apply', CLOUD);
    git(main, 'config', 'user.email', 'someone@work.example');
    const out = sh(main, 'check', CLOUD);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /commit author/);
    assert.match(out.stderr, /committer/);
    assert.doesNotMatch(out.stderr, /not pinned/);
  });

  it('check still fails hooks that run from another checkout', () => {
    const repos = checkouts();
    sh(repos.worktree, 'apply', CLOUD);
    pinToMain(repos);
    const out = sh(repos.worktree, 'check', CLOUD);
    assert.equal(out.status, 1);
    assert.ok(out.stderr.includes(join(repos.main, '.husky/_')), out.stderr);
  });

  it('outside the cloud, check still fails a checkout whose credentials are not pinned', () => {
    const { main } = checkouts();
    sh(main, 'apply', CLOUD);
    for (const remote of [undefined, '', 'false', '1']) {
      const out = sh(main, 'check', remote === undefined ? {} : { CLAUDE_CODE_REMOTE: remote });
      assert.equal(out.status, 1, `CLAUDE_CODE_REMOTE=${remote}`);
      assert.match(out.stderr, /not pinned to george-hutanu/);
    }
  });

  it('outside the cloud, apply still pins the credentials to george-hutanu', () => {
    const { main } = checkouts();
    sh(main, 'apply');
    assert.match(credentialKeys(main), /--user george-hutanu/);
  });
});
