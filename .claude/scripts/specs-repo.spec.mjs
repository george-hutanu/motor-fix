import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLONE, cloneDir, commit, docsDir, ensure, featuresDir, layout, migrateTrunk, status, TRUNK, trunkMoved } from './specs-repo.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'specs-repo.mjs');

// Real git against a local bare "motor-fix-specs", so clone, adopt, rebase and
// push are the ones the laptop runs.
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
  writeFileSync(join(seed, '100-old', 'plan.md'), 'plan\n');
  writeFileSync(join(seed, '.gitignore'), '**/handoff.md\n**/pr-review/**/*.png\n');
  mkdirSync(join(seed, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  writeFileSync(join(seed, '.github', 'ISSUE_TEMPLATE', 'story.yml'), 'name: story\n');
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

// CI sets GITHUB_ACTIONS=true, which makes ensure --soft skip on purpose.
let actions;
beforeEach(() => {
  actions = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  tmp = mkdtempSync(join(tmpdir(), 'specs-repo-'));
  seedRemote();
  root = checkout();
});
afterEach(() => {
  if (actions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = actions;
  rmSync(tmp, { recursive: true, force: true });
});

// @traces 815-FR-002
describe('ensure', () => {
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

  it('soft in GitHub Actions does nothing, leaving specs/ to a workflow checkout', () => {
    process.env.GITHUB_ACTIONS = 'true';
    const r = ensure({ root, url: remote, soft: true });
    assert.deepEqual([r.ok, r.action], [true, 'skipped']);
    assert.equal(existsSync(join(root, 'specs')), false);
  });

  it('without soft, an unreachable remote fails with the reason', () => {
    const r = ensure({ root, url: join(tmp, 'nowhere.git') });
    assert.equal(r.ok, false);
    assert.match(r.error, /clone/);
  });
});

// @traces 815-FR-003
describe('commit', () => {
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
    rmSync(cloneDir(root), { recursive: true, force: true });
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

// The trunk move as migrate-trunk makes it: every feature folder under specs/, a docs/ beside it.
function moveTrunk(edit) {
  const seed = join(tmp, 'seed');
  git(seed, 'pull', '-q', 'origin', TRUNK);
  mkdirSync(join(seed, 'specs'), { recursive: true });
  git(seed, 'mv', '100-old', 'specs/100-old');
  mkdirSync(join(seed, 'docs'), { recursive: true });
  writeFileSync(join(seed, 'docs', 'README.md'), 'docs\n');
  if (edit) edit(seed);
  git(seed, 'add', '-A');
  git(seed, ...ID, 'commit', '-q', '-m', 'chore(specs): move');
  git(seed, 'push', '-q', 'origin', `HEAD:${TRUNK}`);
}

// A clone where ensure used to put it, before this change: a real folder at specs/.
function oldClone(dir = root) {
  const specs = join(dir, 'specs');
  git(dir, 'clone', '-q', '-b', TRUNK, remote, specs);
  git(specs, 'config', 'user.name', 'george-hutanu');
  git(specs, 'config', 'user.email', 'hutanugeorge40@gmail.com');
  return specs;
}

const link = (dir = root) => readlinkSync(join(dir, 'specs'));
const clone = (dir = root) => join(dir, CLONE);
const head = (dir) => git(dir, 'rev-parse', TRUNK);

// @traces 1018-FR-002
// @traces 1018-FR-005
// @traces 1018-FR-017
describe('clone location and layout', () => {
  it('names the clone, its docs folder and nothing before a clone exists', () => {
    assert.equal(CLONE, '.motor-fix-specs');
    assert.equal(cloneDir(root), join(root, '.motor-fix-specs'));
    assert.equal(docsDir(root), join(root, '.motor-fix-specs', 'docs'));
    assert.equal(layout(root), 'none');
  });

  it('on the old trunk, clones into .motor-fix-specs and links specs to the clone root, relatively', () => {
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.action, r.layout], ['cloned', 'old']);
    assert.ok(existsSync(join(clone(), '.git')));
    assert.ok(lstatSync(join(root, 'specs')).isSymbolicLink());
    assert.equal(link(), '.motor-fix-specs');
    assert.equal(featuresDir(root), clone());
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# old\n');
    assert.equal(trunkMoved(clone()), false);
  });

  it('on the moved trunk, links specs to .motor-fix-specs/specs so feature paths do not move', () => {
    moveTrunk();
    const r = ensure({ root, url: remote });
    assert.deepEqual([r.ok, r.layout], [true, 'moved'], JSON.stringify(r));
    assert.equal(link(), '.motor-fix-specs/specs');
    assert.equal(featuresDir(root), join(clone(), 'specs'));
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# old\n');
  });

  it('links by the clone own checked-out layout, not by what origin/trunk has become', () => {
    ensure({ root, url: remote });
    moveTrunk();
    git(clone(), 'fetch', '-q', 'origin');
    assert.equal(trunkMoved(clone()), true);
    assert.equal(layout(root), 'old');
    assert.equal(featuresDir(root), clone());
    assert.equal(link(), '.motor-fix-specs');
  });

  it('reaches the issue forms through the clone location in both layouts', () => {
    ensure({ root, url: remote });
    assert.ok(existsSync(join(cloneDir(root), '.github', 'ISSUE_TEMPLATE', 'story.yml')));
    moveTrunk();
    assert.equal(ensure({ root, url: remote }).ok, true);
    assert.equal(layout(root), 'moved');
    assert.ok(existsSync(join(cloneDir(root), '.github', 'ISSUE_TEMPLATE', 'story.yml')));
  });
});

// @traces 1018-FR-003
// @traces 1018-FR-004
describe('ensure migrates an existing clone in place', () => {
  it('renames a clone at specs/ and links it at the root while trunk has not moved; nothing is rebased', () => {
    const specs = oldClone();
    writeFileSync(join(specs, '100-old', 'spec.md'), '# old, edited\n');
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.migrated, ['link']);
    assert.equal(r.layout, 'old');
    assert.equal(link(), '.motor-fix-specs');
    assert.ok(existsSync(join(clone(), '.git')));
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# old, edited\n');
  });

  it('brings a dirty clone with an unpushed commit onto the moved trunk without losing anything, then a second run changes nothing', () => {
    const specs = oldClone();
    writeFileSync(join(specs, '100-old', 'plan.md'), 'plan, committed here\n');
    mkdirSync(join(specs, '300-mine'));
    writeFileSync(join(specs, '300-mine', 'spec.md'), '# mine\n');
    git(specs, 'add', '-A');
    git(specs, 'commit', '-q', '-m', 'docs(specs): ST-300 mine');
    writeFileSync(join(specs, '100-old', 'spec.md'), '# old, edited\n');
    writeFileSync(join(specs, '100-old', 'handoff.md'), 'note\n');
    moveTrunk();

    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.migrated, ['link', 'rebase', 'sweep', 'move', 'repoint']);
    assert.equal(r.layout, 'moved');
    assert.equal(link(), '.motor-fix-specs/specs');
    const feature = join(root, 'specs', '100-old');
    assert.equal(readFileSync(join(feature, 'spec.md'), 'utf8'), '# old, edited\n');
    assert.equal(readFileSync(join(feature, 'plan.md'), 'utf8'), 'plan, committed here\n');
    assert.equal(readFileSync(join(feature, 'handoff.md'), 'utf8'), 'note\n');
    assert.equal(readFileSync(join(root, 'specs', '300-mine', 'spec.md'), 'utf8'), '# mine\n');
    assert.equal(existsSync(join(clone(), '100-old')), false, 'nothing is left at the old root path');
    assert.equal(existsSync(join(clone(), '300-mine')), false);
    assert.equal(git(clone(), 'status', '--porcelain'), 'M specs/100-old/spec.md', 'the edit is still uncommitted, and nothing else is');
    assert.equal(git(clone(), 'rev-list', '--count', `origin/${TRUNK}..HEAD`), '2');
    assert.equal(git(clone(), 'stash', 'list'), '');

    const again = ensure({ root, url: remote });
    assert.deepEqual([again.ok, again.migrated], [true, []], JSON.stringify(again));
    assert.equal(link(), '.motor-fix-specs/specs');
  });

  it('aborts a rebase that conflicts, leaving the old layout linked at its root and every file where it was', () => {
    const specs = oldClone();
    writeFileSync(join(specs, '100-old', 'spec.md'), '# mine\n');
    git(specs, 'commit', '-q', '-am', 'docs(specs): ST-100 mine');
    writeFileSync(join(specs, '100-old', 'plan.md'), 'plan, edited\n');
    moveTrunk((seed) => writeFileSync(join(seed, 'specs', '100-old', 'spec.md'), '# theirs\n'));

    const r = ensure({ root, url: remote });
    assert.equal(r.ok, false);
    assert.equal(r.step, 'rebase');
    assert.match(r.error, /rebase/);
    assert.equal(existsSync(join(clone(), '.git', 'rebase-merge')), false, 'no rebase is left in progress');
    assert.equal(link(), '.motor-fix-specs');
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# mine\n');
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'plan.md'), 'utf8'), 'plan, edited\n');
    assert.equal(git(clone(), 'stash', 'list'), '');
  });

  it('adopts a plain specs/ folder into the new location and links it', () => {
    mkdirSync(join(root, 'specs', '200-new'), { recursive: true });
    writeFileSync(join(root, 'specs', '200-new', 'spec.md'), '# in flight\n');
    const r = ensure({ root, url: remote });
    assert.equal(r.action, 'adopted', JSON.stringify(r));
    assert.ok(existsSync(join(clone(), '.git')));
    assert.equal(link(), '.motor-fix-specs');
    assert.equal(readFileSync(join(root, 'specs', '200-new', 'spec.md'), 'utf8'), '# in flight\n');
  });

  it('refuses, naming both paths, a real specs folder beside an existing clone', () => {
    ensure({ root, url: remote });
    rmSync(join(root, 'specs'));
    mkdirSync(join(root, 'specs', 'x'), { recursive: true });
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes(join(root, 'specs')) && r.error.includes(clone()), r.error);
    assert.ok(existsSync(join(root, 'specs', 'x')), 'the folder is left alone');
  });

  it('refuses, naming both paths, a specs symlink that points somewhere else', () => {
    ensure({ root, url: remote });
    rmSync(join(root, 'specs'));
    mkdirSync(join(tmp, 'elsewhere'));
    symlinkSync(join(tmp, 'elsewhere'), join(root, 'specs'));
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes(join(root, 'specs')) && r.error.includes(clone()), r.error);
    assert.equal(link(), join(tmp, 'elsewhere'));
  });

  it('serialises two runs in one checkout on a lock: one migrates, the other finds nothing to do', async () => {
    oldClone();
    const run = () =>
      new Promise((done) => {
        const child = spawn(process.execPath, [SCRIPT, 'ensure', '--root', root], { env: { ...process.env, SPECS_REPO_URL: remote } });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('close', (code) => done({ code, out: JSON.parse(out.trim().split('\n').pop()) }));
      });
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.map((r) => r.code), [0, 0], JSON.stringify(results));
    assert.deepEqual(results.map((r) => r.out.migrated.join(',')).sort(), ['', 'link']);
    assert.equal(existsSync(join(root, '.motor-fix-specs.lock')), false);
  }, 30000);

  it('keeps a clone on another branch as it is, with a warning, and does not throw', () => {
    ensure({ root, url: remote });
    git(clone(), 'switch', '-q', '-c', 'other');
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.action, 'kept');
    assert.match(r.warning, /on other, not trunk/);
  });

  it('gives up on a lock it cannot read once the wait is over, never spinning', () => {
    ensure({ root, url: remote });
    mkdirSync(join(root, '.motor-fix-specs.lock'));
    const started = Date.now();
    const r = ensure({ root, url: remote, lockWaitMs: 300 });
    assert.equal(r.ok, false);
    assert.equal(r.step, 'lock');
    assert.ok(Date.now() - started < 5000);
    rmSync(join(root, '.motor-fix-specs.lock'), { recursive: true });
  });

  it('takes over at once a fresh lock whose owner has died', () => {
    ensure({ root, url: remote });
    const lock = join(root, '.motor-fix-specs.lock');
    const dead = spawnSync(process.execPath, ['-e', 'process.pid']).pid;
    writeFileSync(lock, String(dead));
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(existsSync(lock), false);
  });

  it('status writes nothing and reports a clone left behind a moved trunk as pending', () => {
    ensure({ root, url: remote });
    moveTrunk();
    git(clone(), 'fetch', '-q', 'origin');
    const before = git(clone(), 'rev-parse', 'HEAD');
    const s = status({ root });
    assert.deepEqual([s.ok, s.present, s.layout, s.clone], [true, true, 'pending', clone()]);
    assert.equal(git(clone(), 'rev-parse', 'HEAD'), before);
    assert.equal(link(), '.motor-fix-specs');
  });

  it('commit migrates first once trunk has moved, and resolves a docs/ path against the clone root', () => {
    ensure({ root, url: remote });
    moveTrunk();
    mkdirSync(join(clone(), 'docs'), { recursive: true });
    writeFileSync(join(clone(), 'docs', 'plan.md'), 'plan\n');
    const r = commit({ root, message: 'docs(specs): EP-1 execution plan', paths: ['docs/plan.md'] });
    assert.deepEqual([r.ok, r.committed, r.pushed], [true, true, true], JSON.stringify(r));
    assert.equal(link(), '.motor-fix-specs/specs');
    assert.equal(git(remote, 'show', `${TRUNK}:docs/plan.md`), 'plan');

    writeFileSync(join(root, 'specs', '100-old', 'x.md'), 'x\n');
    const f = commit({ root, message: 'docs(specs): ST-100 x', paths: ['100-old'] });
    assert.deepEqual([f.ok, f.pushed], [true, true], JSON.stringify(f));
    assert.equal(git(remote, 'show', `${TRUNK}:specs/100-old/x.md`), 'x');
  });

  // @traces FR-025
  it('commit carries the Diataxis root entries, and refuses anything else at the root', () => {
    ensure({ root, url: remote });
    moveTrunk();
    ensure({ root });
    const files = ['README.md', 'llms.txt', 'AGENTS.md', '.gitignore', 'scripts/docs-lint.mjs', '.github/workflows/docs-lint.yml', 'tracker/README.md', 'docs/reference/a.md'];
    for (const f of files) {
      mkdirSync(dirname(join(clone(), f)), { recursive: true });
      writeFileSync(join(clone(), f), `${f}\n`);
    }
    const r = commit({ root, message: 'docs: organise by Diataxis', paths: files });
    assert.deepEqual([r.ok, r.committed, r.pushed], [true, true, true], JSON.stringify(r));
    for (const f of files) assert.equal(git(remote, 'show', `${TRUNK}:${f}`), f);
    for (const bad of ['.git/config', 'other/x', '../x', 'docs/../.git/config', 'scripts/../.git/config']) {
      const b = commit({ root, message: 'docs: x', paths: [bad] });
      assert.equal(b.ok, false, bad);
    }
  });
});

// @traces 1018-FR-001
// @traces 1018-FR-006
describe('migrate-trunk', () => {
  beforeEach(() => {
    const seed = join(tmp, 'seed');
    mkdirSync(join(seed, '101-more'));
    writeFileSync(join(seed, '101-more', 'spec.md'), '# more\n');
    git(seed, 'add', '-A');
    git(seed, ...ID, 'commit', '-q', '-m', 'docs(specs): more');
    git(seed, 'push', '-q', 'origin', `HEAD:${TRUNK}`);
    ensure({ root, url: remote });
  });

  const cli = (...args) => {
    try {
      execFileSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return 0;
    } catch (e) {
      return e.status;
    }
  };

  it('needs --dry-run or --yes', () => {
    assert.equal(cli('migrate-trunk'), 64);
  });

  it('--dry-run lists every folder it would move and the files it would add, and pushes nothing', () => {
    const before = head(remote);
    const r = migrateTrunk({ root, dryRun: true });
    assert.deepEqual(r, { ok: true, dryRun: true, move: ['100-old', '101-more'], add: ['README.md', 'docs/README.md'] });
    assert.equal(head(remote), before);
    assert.equal(layout(root), 'old');
  });

  it('refuses a root entry that is neither a feature folder nor kept, naming it, in both modes', () => {
    const seed = join(tmp, 'seed');
    writeFileSync(join(seed, 'notes.txt'), 'x\n');
    git(seed, 'add', '-A');
    git(seed, ...ID, 'commit', '-q', '-m', 'stray');
    git(seed, 'push', '-q', 'origin', `HEAD:${TRUNK}`);
    ensure({ root, url: remote });
    const before = head(remote);
    for (const mode of [{ dryRun: true }, { yes: true }]) {
      const r = migrateTrunk({ root, ...mode });
      assert.equal(r.ok, false);
      assert.match(r.error, /notes\.txt/);
    }
    assert.equal(head(remote), before);
  });

  it('refuses a real specs folder where the link goes, before it pushes anything', () => {
    rmSync(join(root, 'specs'));
    mkdirSync(join(root, 'specs'));
    const before = head(remote);
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /real folder/);
    assert.equal(head(remote), before);
  });

  it('keeps an existing README, adding the layout section only once', () => {
    const seed = join(tmp, 'seed');
    git(seed, 'pull', '-q', 'origin', TRUNK);
    writeFileSync(join(seed, 'README.md'), '# Mine\n\nOwner notes.\n');
    git(seed, 'add', '-A');
    git(seed, ...ID, 'commit', '-q', '-m', 'readme');
    git(seed, 'push', '-q', 'origin', `HEAD:${TRUNK}`);
    ensure({ root, url: remote });
    assert.equal(migrateTrunk({ root, yes: true }).ok, true);
    const text = readFileSync(join(clone(), 'README.md'), 'utf8');
    assert.match(text, /^# Mine\n\nOwner notes\.\n\n## Layout\n/);
    assert.equal(text.match(/specs\/<NNN-slug>\//g).length, 1);
  });

  it('refuses a dirty clone, an unpushed clone and a trunk that has already moved, before any change', () => {
    writeFileSync(join(clone(), '100-old', 'spec.md'), 'dirty\n');
    assert.match(migrateTrunk({ root, yes: true }).error, /dirty/);
    git(clone(), 'commit', '-q', '-am', 'local');
    assert.match(migrateTrunk({ root, yes: true }).error, /unpushed/);
    const other = checkout('other');
    ensure({ root: other, url: remote });
    assert.equal(migrateTrunk({ root: other, yes: true }).ok, true);
    const third = checkout('third');
    ensure({ root: third, url: remote });
    assert.match(migrateTrunk({ root: third, dryRun: true }).error, /already moved/);
  });

  it('--yes moves every folder with git mv, adds the two files, pushes, keeps history and repoints the link', () => {
    writeFileSync(join(clone(), '100-old', 'handoff.md'), 'note\n');
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.moved, r.pushed], [2, true]);
    assert.match(r.next, /docs-lint\.mjs --write/);
    assert.doesNotMatch(r.next, /notion-export/);
    assert.deepEqual(git(remote, 'ls-tree', '--name-only', TRUNK).split('\n'), ['.github', '.gitignore', 'README.md', 'docs', 'specs']);
    assert.deepEqual(git(remote, 'ls-tree', '--name-only', `${TRUNK}:specs`).split('\n'), ['100-old', '101-more']);
    assert.doesNotMatch(git(remote, 'show', `${TRUNK}:docs/README.md`), /notion-export/);
    const fresh = join(tmp, 'fresh');
    git(tmp, 'clone', '-q', remote, fresh);
    assert.match(git(fresh, 'log', '--follow', '--format=%s', '--', 'specs/100-old/spec.md'), /seed/);
    assert.equal(link(), '.motor-fix-specs/specs');
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'handoff.md'), 'utf8'), 'note\n');
    assert.doesNotMatch(git(clone(), 'branch', '--list'), /migrate/);
    assert.equal(git(clone(), 'rev-parse', '--abbrev-ref', 'HEAD'), TRUNK);
  });

  it('a refused push leaves the remote, the clone and its branches as they were, and can be run again', () => {
    const hook = join(remote, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    const before = head(remote);
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, false);
    assert.equal(r.step, 'push');
    assert.equal(head(remote), before);
    assert.equal(git(clone(), 'rev-parse', '--abbrev-ref', 'HEAD'), TRUNK);
    assert.doesNotMatch(git(clone(), 'branch', '--list'), /migrate/);
    assert.equal(git(clone(), 'status', '--porcelain'), '');
    assert.ok(existsSync(join(clone(), '100-old', 'spec.md')));
    assert.equal(link(), '.motor-fix-specs');
    rmSync(hook);
    assert.equal(migrateTrunk({ root, yes: true }).ok, true);
  });
});
