import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WATCH = join(dirname(fileURLToPath(import.meta.url)), 'watch.mjs');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' }).trim();

function repoWithWorktrees(names, { commitDate } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-claim-')));
  roots.push(root);
  const repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  const paths = names.map((name, i) => {
    const path = join(root, name);
    git(repo, 'worktree', 'add', '-q', path, '-b', `90${i}-${name}`);
    if (commitDate) {
      execFileSync('git', ['-C', path, '-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '-m', 'old'], {
        env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate },
      });
    }
    return path;
  });
  return { root, repo, paths };
}

const claimFile = (path) => join(path, '.specify', '.cache', 'watch-claim.json');

const claimOnce = (cwd, path, fix) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [WATCH, 'claim', path, fix], { cwd, env: { ...process.env, CLAUDE_CODE_REMOTE: '' }, stdio: 'ignore' });
    child.on('close', (code) => resolve(code));
  });

describe('claim under contention and hostile input', () => {
  // @traces 1361-FR-002
  it('lets exactly one of many simultaneous claims on one worktree win, round after round', async () => {
    const { repo, paths } = repoWithWorktrees(['r1', 'r2', 'r3', 'r4']);
    for (const path of paths) {
      const codes = await Promise.all(Array.from({ length: 12 }, () => claimOnce(repo, path, 'resume')));
      assert.equal(codes.filter((c) => c === 0).length, 1, `${path}: exit codes ${codes.join(',')}`);
      assert.equal(JSON.parse(readFileSync(claimFile(path), 'utf8')).fix, 'resume');
    }
  });

  // @traces 1361-FR-002
  it('replaces a claim file that is not JSON instead of refusing every dispatch for ever', () => {
    const { repo, paths } = repoWithWorktrees(['w']);
    mkdirSync(dirname(claimFile(paths[0])), { recursive: true });
    writeFileSync(claimFile(paths[0]), '{"fix": "resu');
    const r = spawnSync(process.execPath, [WATCH, 'claim', paths[0], 'tail'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(claimFile(paths[0]), 'utf8')).fix, 'tail');
  });

  // @traces 1361-FR-002
  it('refuses without a fix, with a fix it does not know, and for a worktree that does not exist, writing nothing', () => {
    const { repo, root, paths } = repoWithWorktrees(['w']);
    const run = (...args) => spawnSync(process.execPath, [WATCH, 'claim', ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' } });
    for (const args of [[paths[0]], [paths[0], 'rm -rf'], [paths[0], ''], [join(root, 'not-there'), 'resume'], []]) {
      const r = run(...args);
      assert.equal(r.status, 1, `${JSON.stringify(args)}: ${r.stderr}`);
    }
    assert.equal(existsSync(claimFile(paths[0])), false);
    assert.equal(existsSync(join(root, 'not-there')), false);
  });

});

describe('--dispatch in a cloud session', () => {
  // @traces 1361-FR-003
  it('starts no agent, writes no claim and no log for a long-idle worktree, whatever the stale thresholds say', () => {
    const { repo, root, paths } = repoWithWorktrees(['w'], { commitDate: new Date(Date.now() - 3 * 3600_000).toISOString() });
    const bin = join(root, 'bin');
    mkdirSync(bin);
    for (const name of ['claude', 'gh']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "$0 $@" >> "${join(root, 'tools.log')}"\nexit 1\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const r = spawnSync(process.execPath, [WATCH, '--dispatch', '--stale', 'planning=1,tests=1,development=1,qa=1,review=1'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, r.stderr);
    const claude = existsSync(join(root, 'tools.log')) ? readFileSync(join(root, 'tools.log'), 'utf8').split('\n').filter((l) => l.includes('/claude ')) : [];
    assert.deepEqual(claude, []);
    assert.equal(existsSync(claimFile(paths[0])), false);
    assert.equal(existsSync(join(repo, '.work')), false);
  });
});
