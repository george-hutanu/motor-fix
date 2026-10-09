import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLONE, commit, ensure, migrateTrunk, status, TRUNK } from './specs-repo.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'specs-repo.mjs');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];

let tmp;
let remote;
let root;
let actions;

function seedRemote() {
  remote = join(tmp, 'motor-fix-specs.git');
  git(tmp, 'init', '-q', '--bare', '-b', TRUNK, remote);
  const seed = join(tmp, 'seed');
  git(tmp, 'clone', '-q', remote, seed);
  mkdirSync(join(seed, '100-old'), { recursive: true });
  writeFileSync(join(seed, '100-old', 'spec.md'), '# old\n');
  writeFileSync(join(seed, '.gitignore'), '**/handoff.md\n');
  writeFileSync(join(seed, 'README.md'), 'readme\n');
  git(seed, 'add', '-A');
  git(seed, ...ID, 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', 'origin', `HEAD:${TRUNK}`);
}
function checkout(name = 'wt') {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'george-hutanu');
  git(dir, 'config', 'user.email', 'hutanugeorge40@gmail.com');
  return dir;
}
function pushSeed(edit, message = 'more') {
  const seed = join(tmp, 'seed');
  git(seed, 'pull', '-q', 'origin', TRUNK);
  edit(seed);
  git(seed, 'add', '-A');
  git(seed, ...ID, 'commit', '-q', '-m', message);
  git(seed, 'push', '-q', 'origin', `HEAD:${TRUNK}`);
}
const remoteHead = () => git(remote, 'rev-parse', TRUNK);
const clone = () => join(root, CLONE);
const cli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, SPECS_REPO_URL: remote } });

beforeEach(() => {
  actions = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'specs-sync-')));
  seedRemote();
  root = checkout();
  process.env.SPECS_REPO_URL = remote;
});
afterEach(() => {
  delete process.env.SPECS_REPO_URL;
  if (actions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = actions;
  rmSync(tmp, { recursive: true, force: true });
});

describe('the lock file', () => {
  // @traces 1018-FR-003
  it('takes over a lock left by a dead run once it is old', () => {
    writeFileSync(join(root, '.motor-fix-specs.lock'), '999999');
    const old = new Date(Date.now() - 11 * 60_000);
    utimesSync(join(root, '.motor-fix-specs.lock'), old, old);
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.action, 'cloned');
    assert.equal(existsSync(join(root, '.motor-fix-specs.lock')), false);
  });

  // @traces 1018-FR-003
  it('removes its lock after a successful run and after a refused migrate-trunk', () => {
    ensure({ root, url: remote });
    assert.equal(existsSync(join(root, '.motor-fix-specs.lock')), false);
    writeFileSync(join(clone(), 'stray.txt'), 'x');
    const r = migrateTrunk({ root, dryRun: true });
    assert.equal(r.ok, false);
    assert.equal(existsSync(join(root, '.motor-fix-specs.lock')), false);
  });

});

describe('ensure beside folders that are not its own', () => {
  // @traces 1018-FR-004
  it('refuses a real specs folder with files beside an existing clone, naming both, and touches neither', () => {
    ensure({ root, url: remote });
    rmSync(join(root, 'specs'));
    mkdirSync(join(root, 'specs', '900-mine'), { recursive: true });
    writeFileSync(join(root, 'specs', '900-mine', 'spec.md'), 'mine\n');
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, false);
    assert.match(r.error, /specs/);
    assert.ok(r.error.includes(clone()) || r.error.includes(CLONE), r.error);
    assert.equal(readFileSync(join(root, 'specs', '900-mine', 'spec.md'), 'utf8'), 'mine\n');
    assert.equal(lstatSync(join(root, 'specs')).isSymbolicLink(), false);
  });

  // @traces 1018-FR-004
  it('refuses a specs link into another directory that exists, and leaves it pointing there', () => {
    ensure({ root, url: remote });
    mkdirSync(join(tmp, 'elsewhere'));
    rmSync(join(root, 'specs'));
    symlinkSync(join(tmp, 'elsewhere'), join(root, 'specs'));
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, false);
    assert.equal(readlinkSync(join(root, 'specs')), join(tmp, 'elsewhere'));
  });

  // @traces 1018-FR-004
  it('adopts a plain specs folder that holds a dotfile only, and keeps the file', () => {
    mkdirSync(join(root, 'specs'));
    writeFileSync(join(root, 'specs', '.keep'), 'k');
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(lstatSync(join(root, 'specs')).isSymbolicLink());
  });

  // @traces 1018-FR-003
  it('leaves the old-layout clone linked and unchanged when the rebase conflicts', () => {
    const specs = join(root, 'specs');
    git(root, 'clone', '-q', '-b', TRUNK, remote, specs);
    git(specs, 'config', 'user.name', 'george-hutanu');
    git(specs, 'config', 'user.email', 'hutanugeorge40@gmail.com');
    writeFileSync(join(specs, '100-old', 'spec.md'), '# local edit\n');
    git(specs, 'add', '-A');
    git(specs, 'commit', '-q', '-m', 'local');
    const localHead = git(specs, 'rev-parse', 'HEAD');
    pushSeed((seed) => {
      mkdirSync(join(seed, 'specs'));
      git(seed, 'mv', '100-old', 'specs/100-old');
      writeFileSync(join(seed, 'specs', '100-old', 'spec.md'), '# remote edit\n');
    }, 'move');
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.step, 'rebase');
    assert.equal(git(clone(), 'rev-parse', 'HEAD'), localHead);
    assert.equal(existsSync(join(clone(), '.git', 'rebase-merge')), false);
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# local edit\n');
  });
});

describe('migrate-trunk refusals', () => {
  beforeEach(() => ensure({ root, url: remote }));

  // @traces 1018-FR-006
  it('names a root folder called docs as unexpected, in a dry run and a real run', () => {
    pushSeed((seed) => {
      mkdirSync(join(seed, 'docs'));
      writeFileSync(join(seed, 'docs', 'old.md'), 'x');
    });
    ensure({ root, url: remote });
    for (const opt of [{ dryRun: true }, { yes: true }]) {
      const r = migrateTrunk({ root, ...opt });
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.match(r.error, /docs/);
    }
  });

  // @traces 1018-FR-006
  it('refuses when the clone is behind origin and changes nothing', () => {
    pushSeed((seed) => writeFileSync(join(seed, '100-old', 'more.md'), 'm'));
    const before = remoteHead();
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, false);
    assert.equal(remoteHead(), before);
    assert.equal(existsSync(join(clone(), 'specs')), false);
  });

  // @traces 1018-FR-006
  it('refuses when the clone has an unpushed commit and leaves the remote alone', () => {
    writeFileSync(join(clone(), '100-old', 'local.md'), 'l');
    git(clone(), 'add', '-A');
    git(clone(), ...ID, 'commit', '-q', '-m', 'local');
    const before = remoteHead();
    for (const opt of [{ dryRun: true }, { yes: true }]) assert.equal(migrateTrunk({ root, ...opt }).ok, false);
    assert.equal(remoteHead(), before);
  });

  // @traces 1018-FR-006
  it('refuses when the clone is on another branch', () => {
    git(clone(), 'switch', '-q', '-c', 'side');
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, false);
    assert.equal(git(clone(), 'rev-parse', '--abbrev-ref', 'HEAD'), 'side');
  });

  // @traces 1018-FR-006
  it('with a failed push leaves the remote, the branch, the tree and the link as they were, and runs again once fixed', () => {
    const hook = join(remote, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho rejected >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const before = remoteHead();
    const link = readlinkSync(join(root, 'specs'));
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.step, 'push');
    assert.equal(remoteHead(), before);
    assert.equal(git(clone(), 'rev-parse', '--abbrev-ref', 'HEAD'), TRUNK);
    assert.equal(git(clone(), 'branch', '--list', 'migrate-trunk-*'), '');
    assert.equal(git(clone(), 'status', '--porcelain'), '');
    assert.equal(git(clone(), 'rev-list', '--count', `origin/${TRUNK}..HEAD`), '0');
    assert.equal(readlinkSync(join(root, 'specs')), link);
    assert.equal(existsSync(join(clone(), 'specs')), false);
    rmSync(hook);
    const again = migrateTrunk({ root, yes: true });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(again.moved, 1);
  });

  // @traces 1018-FR-006
  it('keeps an existing root README, appends the layout section and keeps one commit', () => {
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    const text = readFileSync(join(clone(), 'README.md'), 'utf8');
    assert.ok(text.startsWith('readme\n'), text);
    assert.match(text, /## Layout/);
    assert.equal(git(clone(), 'rev-list', '--count', `HEAD~1..HEAD`), '1');
    assert.match(git(clone(), 'log', '-1', '--format=%s'), /^chore\(specs\): move the feature folders under specs\/ and add docs\/$/);
  });

  // @traces 1018-FR-006
  it('answers usage (64) when neither flag is given', () => {
    assert.equal(cli(['migrate-trunk', '--root', root]).status, 64);
  });

  // @traces 1018-FR-006
  it('moves nothing when trunk holds no feature folders and says so', () => {
    pushSeed((seed) => {
      git(seed, 'rm', '-rq', '100-old');
    });
    ensure({ root, url: remote });
    const r = migrateTrunk({ root, dryRun: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.move, []);
  });
});

describe('commit when the remote moves under it', () => {
  beforeEach(() => ensure({ root, url: remote }));

  // @traces 1018-FR-003
  it('rebases on a concurrent push to another file and pushes on the second try', () => {
    writeFileSync(join(clone(), '100-old', 'mine.md'), 'mine');
    pushSeed((seed) => writeFileSync(join(seed, '100-old', 'theirs.md'), 'theirs'));
    git(clone(), 'fetch', '-q');
    const r = commit({ root, message: 'docs: mine', paths: ['100-old/mine.md'] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.pushed, true);
    assert.equal(git(remote, 'ls-tree', '--name-only', `${TRUNK}:100-old`).includes('theirs.md'), true);
    assert.equal(git(remote, 'ls-tree', '--name-only', `${TRUNK}:100-old`).includes('mine.md'), true);
  });

  // @traces 1018-FR-003
  it('aborts a conflicting rebase, keeps the commit local and leaves no rebase in progress', () => {
    writeFileSync(join(clone(), '100-old', 'spec.md'), '# mine\n');
    pushSeed((seed) => writeFileSync(join(seed, '100-old', 'spec.md'), '# theirs\n'));
    const before = remoteHead();
    const r = commit({ root, message: 'docs: mine', paths: ['100-old/spec.md'] });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.error, /rebase/);
    assert.equal(remoteHead(), before);
    assert.equal(existsSync(join(clone(), '.git', 'rebase-merge')), false);
    assert.equal(git(clone(), 'status', '--porcelain').includes('UU'), false);
  });

  // @traces 1018-FR-003
  it('commits nothing and pushes nothing when the paths have no change', () => {
    const before = remoteHead();
    const r = commit({ root, message: 'docs: none', paths: ['100-old/spec.md'] });
    assert.deepEqual({ ok: r.ok, committed: r.committed, pushed: r.pushed }, { ok: true, committed: false, pushed: false });
    assert.equal(remoteHead(), before);
  });

  // @traces 1018-FR-003
  it('does not sweep an unrelated dirty file into a commit limited to a path', () => {
    writeFileSync(join(clone(), '100-old', 'mine.md'), 'mine');
    writeFileSync(join(clone(), '100-old', 'other.md'), 'other');
    commit({ root, message: 'docs: mine', paths: ['100-old/mine.md'] });
    assert.equal(git(remote, 'ls-tree', '--name-only', `${TRUNK}:100-old`).includes('other.md'), false);
    assert.equal(existsSync(join(clone(), '100-old', 'other.md')), true);
  });

  // @traces 1018-FR-003
  it('refuses to commit on a branch other than trunk and pushes nothing', () => {
    git(clone(), 'switch', '-q', '-c', 'side');
    writeFileSync(join(clone(), '100-old', 'mine.md'), 'mine');
    const before = remoteHead();
    const r = commit({ root, message: 'docs: mine' });
    assert.equal(r.ok, false);
    assert.equal(remoteHead(), before);
  });

  // @traces 1018-FR-003
  it('migrates first and then commits when trunk moved since the last fetch, without losing the new file', () => {
    pushSeed((seed) => {
      mkdirSync(join(seed, 'specs'));
      git(seed, 'mv', '100-old', 'specs/100-old');
      mkdirSync(join(seed, 'docs'));
      writeFileSync(join(seed, 'docs', 'README.md'), 'd');
    }, 'move');
    writeFileSync(join(clone(), '100-old', 'mine.md'), 'mine');
    const r = commit({ root, message: 'docs: mine', paths: ['100-old/mine.md'] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(git(remote, 'ls-tree', '--name-only', `${TRUNK}:specs/100-old`).includes('mine.md'), true);
    assert.equal(readlinkSync(join(root, 'specs')), `${CLONE}/specs`);
  });

  // @traces 1018-FR-003
  it('status reports pending after a fetch of a moved trunk and writes nothing', () => {
    pushSeed((seed) => {
      mkdirSync(join(seed, 'specs'));
      git(seed, 'mv', '100-old', 'specs/100-old');
    }, 'move');
    git(clone(), 'fetch', '-q');
    const head = git(clone(), 'rev-parse', 'HEAD');
    const s = status({ root });
    assert.equal(s.layout, 'pending');
    assert.equal(git(clone(), 'rev-parse', 'HEAD'), head);
    assert.equal(readlinkSync(join(root, 'specs')), CLONE);
  });
});
