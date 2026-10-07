import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commit, ensure, status, TRUNK } from './specs-repo.mjs';

// Real git against a local bare "motor-fix-specs", so clone, adopt, rebase and
// push are the ones the laptop runs. 815-FR-001..003.
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];

let tmp;
let remote;
let root;

function seedRemote() {
  remote = join(tmp, 'motor-fix-specs.git');
  git(tmp, 'init', '-q', '--bare', '-b', TRUNK, remote);
  const seed = join(tmp, 'seed');
  git(tmp, 'clone', '-q', remote, seed);
  mkdirSync(join(seed, '100-old'), { recursive: true });
  writeFileSync(join(seed, '100-old', 'spec.md'), '# old\n');
  writeFileSync(join(seed, '.gitignore'), '**/handoff.md\n');
  git(seed, 'add', '-A');
  git(seed, ...ID, 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', 'origin', `HEAD:${TRUNK}`);
  return seed;
}

function checkout(name = 'wt') {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'george-hutanu');
  git(dir, 'config', 'user.email', 'hutanugeorge40@gmail.com');
  return dir;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specs-repo-'));
  seedRemote();
  root = checkout();
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// @traces 815-FR-002
describe('ensure (815-FR-002)', () => {
  it('clones trunk into a missing specs/ and carries the checkout identity into it', () => {
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.action, 'cloned');
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# old\n');
    assert.equal(git(join(root, 'specs'), 'rev-parse', '--abbrev-ref', 'HEAD'), TRUNK);
    assert.equal(git(join(root, 'specs'), 'config', '--local', 'user.email'), 'hutanugeorge40@gmail.com');
  });

  it('adopts a specs/ that holds files but no repository, keeping every local file and change', () => {
    mkdirSync(join(root, 'specs', '100-old'), { recursive: true });
    mkdirSync(join(root, 'specs', '200-new'), { recursive: true });
    writeFileSync(join(root, 'specs', '100-old', 'spec.md'), '# old, edited here\n');
    writeFileSync(join(root, 'specs', '200-new', 'spec.md'), '# in flight\n');
    const r = ensure({ root, url: remote });
    assert.equal(r.action, 'adopted', JSON.stringify(r));
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# old, edited here\n');
    assert.equal(readFileSync(join(root, 'specs', '200-new', 'spec.md'), 'utf8'), '# in flight\n');
    assert.ok(existsSync(join(root, 'specs', '.gitignore')), 'a file missing locally is restored from trunk');
    const dirty = git(join(root, 'specs'), 'status', '--porcelain');
    assert.match(dirty, /M 100-old\/spec\.md/);
    assert.match(dirty, /\?\? 200-new\//);
    assert.ok(!existsSync(join(root, '.specs-adopt')), 'no temp clone is left behind');
  });

  it('fast-forwards an existing clone to the newer trunk', () => {
    ensure({ root, url: remote });
    const other = checkout('other');
    ensure({ root: other, url: remote });
    writeFileSync(join(other, 'specs', 'new.md'), 'x\n');
    assert.equal(commit({ root: other, message: 'docs(specs): ST-1 x' }).pushed, true);
    const r = ensure({ root, url: remote });
    assert.equal(r.action, 'updated', JSON.stringify(r));
    assert.ok(existsSync(join(root, 'specs', 'new.md')));
  });

  it('borrows the main checkout clone objects, then stands alone', () => {
    ensure({ root, url: remote });
    git(root, ...ID, 'commit', '-q', '--allow-empty', '-m', 'init');
    const wt = join(tmp, 'linked');
    git(root, 'worktree', 'add', '-q', wt);
    const r = ensure({ root: wt, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(realpathSync(r.reference), realpathSync(join(root, 'specs')));
    assert.equal(existsSync(join(wt, 'specs', '.git', 'objects', 'info', 'alternates')), false, '--dissociate leaves no alternates');
  });

  it('soft: an unreachable remote is reported, never thrown, and exits ok', () => {
    const r = ensure({ root, url: join(tmp, 'nowhere.git'), soft: true });
    assert.equal(r.ok, true);
    assert.equal(r.action, 'skipped');
    assert.match(r.warning, /clone/);
  });

  it('without soft, an unreachable remote fails with the reason', () => {
    const r = ensure({ root, url: join(tmp, 'nowhere.git') });
    assert.equal(r.ok, false);
    assert.match(r.error, /clone/);
  });
});

// @traces 815-FR-003
describe('commit (815-FR-003)', () => {
  beforeEach(() => ensure({ root, url: remote }));

  it('commits the named paths only and pushes them to trunk', () => {
    mkdirSync(join(root, 'specs', '300-a'));
    writeFileSync(join(root, 'specs', '300-a', 'notion-sync.md'), 'line\n');
    writeFileSync(join(root, 'specs', 'stray.md'), 'not mine\n');
    const r = commit({ root, message: 'chore(specs): ST-300 qa', paths: ['300-a'] });
    assert.deepEqual([r.ok, r.committed, r.pushed], [true, true, true], JSON.stringify(r));
    assert.equal(git(remote, 'log', '-1', '--format=%s', TRUNK), 'chore(specs): ST-300 qa');
    assert.equal(git(remote, 'log', '-1', '--format=%ae', TRUNK), 'hutanugeorge40@gmail.com');
    assert.match(git(join(root, 'specs'), 'status', '--porcelain'), /\?\? stray\.md/);
  });

  it('rebases on a trunk another session pushed meanwhile, then pushes', () => {
    const other = checkout('other');
    ensure({ root: other, url: remote });
    mkdirSync(join(other, 'specs', '400-b'));
    writeFileSync(join(other, 'specs', '400-b', 'spec.md'), 'b\n');
    commit({ root: other, message: 'docs(specs): ST-400 b' });
    mkdirSync(join(root, 'specs', '300-a'));
    writeFileSync(join(root, 'specs', '300-a', 'spec.md'), 'a\n');
    const r = commit({ root, message: 'docs(specs): ST-300 a' });
    assert.equal(r.pushed, true, JSON.stringify(r));
    const subjects = git(remote, 'log', '--format=%s', TRUNK).split('\n');
    assert.deepEqual(subjects.slice(0, 2), ['docs(specs): ST-300 a', 'docs(specs): ST-400 b']);
  });

  it('with nothing to commit and nothing unpushed, does nothing', () => {
    const r = commit({ root, message: 'docs(specs): ST-1 none' });
    assert.deepEqual([r.ok, r.committed, r.pushed], [true, false, false]);
  });

  it('pushes an earlier commit left unpushed even when nothing new is staged', () => {
    writeFileSync(join(root, 'specs', 'x.md'), 'x\n');
    git(join(root, 'specs'), 'add', 'x.md');
    git(join(root, 'specs'), 'commit', '-q', '-m', 'docs(specs): ST-1 x');
    const r = commit({ root, message: 'docs(specs): ST-1 again' });
    assert.deepEqual([r.committed, r.pushed], [false, true]);
  });

  it('refuses when specs/ is not a clone, naming ensure', () => {
    rmSync(join(root, 'specs'), { recursive: true, force: true });
    const r = commit({ root, message: 'docs(specs): ST-1 x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /specs-repo\.mjs ensure/);
  });
});

describe('status', () => {
  it('reports a missing clone, then the branch and what is unpushed', () => {
    assert.equal(status({ root }).present, false);
    ensure({ root, url: remote });
    writeFileSync(join(root, 'specs', 'x.md'), 'x\n');
    git(join(root, 'specs'), 'add', 'x.md');
    git(join(root, 'specs'), 'commit', '-q', '-m', 'docs(specs): ST-1 x');
    const s = status({ root });
    assert.deepEqual([s.present, s.branch, s.ahead], [true, TRUNK, 1]);
  });
});
