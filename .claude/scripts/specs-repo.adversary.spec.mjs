import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLONE, cloneDir, commit, ensure, featuresDir, layout, migrateTrunk, status, TRUNK, trunkMoved } from './specs-repo.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'specs-repo.mjs');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];

vi.setConfig({ testTimeout: 30000 });

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
  writeFileSync(join(seed, '100-old', 'résumé ü & co.md'), 'unicode\n');
  writeFileSync(join(seed, '.gitignore'), '**/handoff.md\n**/pr-review/**/*.png\n');
  mkdirSync(join(seed, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  writeFileSync(join(seed, '.github', 'ISSUE_TEMPLATE', 'story.yml'), 'name: story\n');
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
const moveTrunk = (edit) =>
  pushSeed((seed) => {
    mkdirSync(join(seed, 'specs'), { recursive: true });
    git(seed, 'mv', '100-old', 'specs/100-old');
    mkdirSync(join(seed, 'docs'), { recursive: true });
    writeFileSync(join(seed, 'docs', 'README.md'), 'docs\n');
    if (edit) edit(seed);
  }, 'chore(specs): move');

function oldClone(dir = root) {
  const specs = join(dir, 'specs');
  git(dir, 'clone', '-q', '-b', TRUNK, remote, specs);
  git(specs, 'config', 'user.name', 'george-hutanu');
  git(specs, 'config', 'user.email', 'hutanugeorge40@gmail.com');
  return specs;
}

const link = (dir = root) => readlinkSync(join(dir, 'specs'));
const clone = (dir = root) => join(dir, CLONE);
const cli = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, SPECS_REPO_URL: remote, ...env } });
const lastJson = (out) => JSON.parse(out.trim().split('\n').pop());

beforeEach(() => {
  actions = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'specs-adv-')));
  seedRemote();
  root = checkout();
});
afterEach(() => {
  if (actions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = actions;
  rmSync(tmp, { recursive: true, force: true });
});

describe('ensure when the remote or the folders are wrong', () => {
  it('leaves no clone folder and no dangling link behind after a clone that failed', () => {
    const r = ensure({ root, url: join(tmp, 'no-such-remote.git') });
    assert.equal(r.ok, false);
    assert.equal(existsSync(clone()), false);
    assert.throws(() => lstatSync(join(root, 'specs')), /ENOENT/);
    assert.equal(layout(root), 'none');
  });

  it('refuses a dangling foreign symlink beside an existing clone, naming both paths and leaving it as it was', () => {
    ensure({ root, url: remote });
    rmSync(join(root, 'specs'));
    symlinkSync('../nowhere/at/all', join(root, 'specs'));
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes(join(root, 'specs')) && r.error.includes(clone()), r.error);
    assert.equal(link(), '../nowhere/at/all');
  });

  it('turns the refusal into a skipped warning with --soft and still changes nothing', () => {
    ensure({ root, url: remote });
    rmSync(join(root, 'specs'));
    mkdirSync(join(root, 'specs', 'mine'), { recursive: true });
    const r = ensure({ root, url: remote, soft: true });
    assert.equal(r.ok, true);
    assert.equal(r.action, 'skipped');
    assert.ok(existsSync(join(root, 'specs', 'mine')));
  });

  it('a second ensure on a fresh clone is an update with nothing migrated', () => {
    const first = ensure({ root, url: remote });
    assert.equal(first.action, 'cloned');
    const again = ensure({ root, url: remote });
    assert.equal(again.ok, true);
    assert.equal(again.action, 'updated');
    assert.deepEqual(again.migrated, []);
    assert.equal(link(), '.motor-fix-specs');
  });

  it('repairs a link that points at the moved location while the clone is still in the old layout', () => {
    ensure({ root, url: remote });
    rmSync(join(root, 'specs'));
    symlinkSync('.motor-fix-specs/specs', join(root, 'specs'));
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# old\n');
  });

  it('rewrites an absolute link into the clone as a relative one', () => {
    ensure({ root, url: remote });
    rmSync(join(root, 'specs'));
    symlinkSync(clone(), join(root, 'specs'));
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(isAbsolute(link()), false, link());
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# old\n');
  });

  it('answers status on a checkout with no clone without creating one', () => {
    const s = status({ root });
    assert.equal(s.present, false);
    assert.equal(existsSync(clone()), false);
    assert.equal(existsSync(join(root, 'specs')), false);
  });

  it('reads an empty clone folder as layout none', () => {
    mkdirSync(clone());
    assert.equal(layout(root), 'none');
  });
});

describe('what counts as a moved trunk', () => {
  const fetched = () => {
    ensure({ root, url: remote });
    git(clone(), 'fetch', '-q', 'origin');
    return clone();
  };

  it('is not moved by a plain file called specs at the root', () => {
    pushSeed((seed) => writeFileSync(join(seed, 'specs'), 'not a folder\n'));
    assert.equal(trunkMoved(fetched()), false);
  });

  it('is not moved by a specs folder nested inside a feature folder', () => {
    pushSeed((seed) => {
      mkdirSync(join(seed, '100-old', 'specs'));
      writeFileSync(join(seed, '100-old', 'specs', 'x.md'), 'x\n');
    });
    assert.equal(trunkMoved(fetched()), false);
    assert.equal(ensure({ root: checkout('other'), url: remote }).layout, 'old');
  });

  it('is not moved by a root folder whose name only starts with specs', () => {
    pushSeed((seed) => {
      mkdirSync(join(seed, 'specs-archive'));
      writeFileSync(join(seed, 'specs-archive', 'x.md'), 'x\n');
    });
    assert.equal(trunkMoved(fetched()), false);
  });

  it('is moved once a specs folder holds anything at the root', () => {
    moveTrunk();
    assert.equal(trunkMoved(fetched()), true);
  });
});

describe('migrating an existing clone with awkward files', () => {
  it('keeps a feature folder that holds only untracked files', () => {
    const specs = oldClone();
    mkdirSync(join(specs, '300-draft'));
    writeFileSync(join(specs, '300-draft', 'notes.md'), 'draft\n');
    moveTrunk();
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(join(root, 'specs', '300-draft', 'notes.md'), 'utf8'), 'draft\n');
    assert.equal(existsSync(join(clone(), '300-draft')), false);
  });

  it('carries an edit to a file named with spaces and non-ASCII letters to its new path', () => {
    const specs = oldClone();
    writeFileSync(join(specs, '100-old', 'résumé ü & co.md'), 'edited\n');
    writeFileSync(join(specs, '100-old', 'new ünï file.md'), 'untracked\n');
    moveTrunk();
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'résumé ü & co.md'), 'utf8'), 'edited\n');
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'new ünï file.md'), 'utf8'), 'untracked\n');
  });

  it('brings an unpushed commit that added a new file to an existing feature folder onto the moved trunk', () => {
    const specs = oldClone();
    writeFileSync(join(specs, '100-old', 'plan.md'), 'plan\n');
    git(specs, 'add', '-A');
    git(specs, 'commit', '-q', '-m', 'docs(specs): plan');
    moveTrunk();
    const r = ensure({ root, url: remote });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'plan.md'), 'utf8'), 'plan\n');
    assert.equal(git(clone(), 'rev-list', '--count', `origin/${TRUNK}..HEAD`), '1');
  });

  it('removes its lock after a failed migration and fails the same way when run again', () => {
    const specs = oldClone();
    writeFileSync(join(specs, '100-old', 'spec.md'), '# mine\n');
    git(specs, 'commit', '-q', '-am', 'docs(specs): mine');
    moveTrunk((seed) => writeFileSync(join(seed, 'specs', '100-old', 'spec.md'), '# theirs\n'));
    const first = ensure({ root, url: remote });
    const second = ensure({ root, url: remote });
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(second.step, first.step);
    assert.equal(existsSync(join(root, '.motor-fix-specs.lock')), false);
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), '# mine\n');
  });

  it('serialises four concurrent runs: all succeed and exactly one migrates', async () => {
    const specs = oldClone();
    writeFileSync(join(specs, '100-old', 'spec.md'), 'plan\n');
    git(specs, 'commit', '-q', '-am', 'docs(specs): plan');
    moveTrunk();
    const one = () =>
      new Promise((done) => {
        const child = spawn(process.execPath, [SCRIPT, 'ensure', '--root', root], { env: { ...process.env, SPECS_REPO_URL: remote } });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('close', (code) => done({ code, out: lastJson(out) }));
      });
    const results = await Promise.all([one(), one(), one(), one()]);
    assert.deepEqual(results.map((r) => r.code), [0, 0, 0, 0], JSON.stringify(results));
    const migrating = results.filter((r) => r.out.migrated.length > 0);
    assert.equal(migrating.length, 1, JSON.stringify(results.map((r) => r.out.migrated)));
    assert.equal(link(), '.motor-fix-specs/specs');
    assert.equal(git(clone(), 'rev-list', '--count', `origin/${TRUNK}..HEAD`), '1');
    assert.equal(readFileSync(join(root, 'specs', '100-old', 'spec.md'), 'utf8'), 'plan\n');
  }, 60000);
});

describe('commit with hostile input', () => {
  beforeEach(() => ensure({ root, url: remote }));

  it('refuses a path that climbs out of the clone and commits nothing', () => {
    writeFileSync(join(root, 'escape.txt'), 'outside\n');
    const before = git(clone(), 'rev-parse', 'HEAD');
    const r = commit({ root, message: 'docs(specs): x', paths: ['../escape.txt'] });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(git(clone(), 'rev-parse', 'HEAD'), before);
    assert.equal(git(remote, 'rev-parse', TRUNK), before);
  });

  it('refuses an absolute path outside the clone', () => {
    writeFileSync(join(tmp, 'abs.txt'), 'outside\n');
    const before = git(clone(), 'rev-parse', 'HEAD');
    const r = commit({ root, message: 'docs(specs): x', paths: [join(tmp, 'abs.txt')] });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(git(clone(), 'rev-parse', 'HEAD'), before);
  });

  it('refuses a docs/ path that climbs into the git directory', () => {
    const before = git(clone(), 'rev-parse', 'HEAD');
    const r = commit({ root, message: 'docs(specs): x', paths: ['docs/../.git/config'] });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(git(clone(), 'rev-parse', 'HEAD'), before);
  });

  it('treats a message and a file name full of shell characters as plain text', () => {
    const pwned = 'PWNED_MARK';
    const marks = [join(clone(), pwned), join(root, pwned), join(tmp, pwned), join(process.cwd(), pwned)];
    const name = `a b $(touch ${pwned}) \`touch ${pwned}\`.md`;
    mkdirSync(join(clone(), '100-old'), { recursive: true });
    writeFileSync(join(clone(), '100-old', name), 'x\n');
    const message = `docs(specs): "quoted"; touch ${pwned} #`;
    const r = commit({ root, message, paths: [`100-old/${name}`] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(marks.filter((m) => existsSync(m)), []);
    assert.equal(git(clone(), 'log', '-1', '--format=%s'), message);
    assert.equal(git(remote, 'log', '-1', '--format=%s', TRUNK), message);
  });

  it('takes a message that starts with a dash as a message, not an option', () => {
    writeFileSync(join(clone(), '100-old', 'dash.md'), 'x\n');
    const r = commit({ root, message: '--amend docs', paths: ['100-old/dash.md'] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(git(clone(), 'log', '-1', '--format=%s'), '--amend docs');
    assert.equal(git(clone(), 'rev-list', '--count', 'HEAD'), '2');
  });
});

describe('command line usage', () => {
  it('answers 64 to no command, an unknown command and commit without a message', () => {
    assert.equal(cli(['--root', root]).status, 64);
    assert.equal(cli(['frobnicate', '--root', root]).status, 64);
    ensure({ root, url: remote });
    assert.equal(cli(['commit', '--root', root]).status, 64);
  });

  it('prints one JSON line last for a failure and exits 1', () => {
    const r = cli(['ensure', '--root', root], { SPECS_REPO_URL: join(tmp, 'gone.git') });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(lastJson(r.stdout).ok, false);
  });

  it('migrate-trunk on a checkout without a clone fails with a reason instead of throwing', () => {
    const r = migrateTrunk({ root, dryRun: true });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  });
});

describe('migrate-trunk', () => {
  beforeEach(() => {
    ensure({ root, url: remote });
  });

  it('refuses a hidden stray entry and names it', () => {
    pushSeed((seed) => writeFileSync(join(seed, '.env'), 'SECRET=1\n'));
    ensure({ root, url: remote });
    for (const mode of [{ dryRun: true }, { yes: true }]) {
      const r = migrateTrunk({ root, ...mode });
      assert.equal(r.ok, false);
      assert.match(r.error, /\.env/);
    }
  });

  it('refuses a root file whose name only resembles a feature folder', () => {
    pushSeed((seed) => writeFileSync(join(seed, 'notes-100.md'), 'x\n'));
    ensure({ root, url: remote });
    const r = migrateTrunk({ root, dryRun: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /notes-100\.md/);
  });

  it('a dry run leaves the remote, the branches, the working tree and the link as they were', () => {
    const before = [git(remote, 'rev-parse', TRUNK), git(clone(), 'branch', '--list'), git(clone(), 'status', '--porcelain'), link()];
    const r = migrateTrunk({ root, dryRun: true });
    assert.equal(r.ok, true);
    assert.deepEqual([git(remote, 'rev-parse', TRUNK), git(clone(), 'branch', '--list'), git(clone(), 'status', '--porcelain'), link()], before);
    assert.equal(existsSync(join(clone(), 'docs')), false);
  });

  it('a dry run twice answers the same', () => {
    assert.deepEqual(migrateTrunk({ root, dryRun: true }), migrateTrunk({ root, dryRun: true }));
  });

  it('keeps the history of a file with non-ASCII letters and spaces in its name', () => {
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    const fresh = join(tmp, 'fresh');
    git(tmp, 'clone', '-q', remote, fresh);
    const log = git(fresh, '-c', 'core.quotepath=off', 'log', '--follow', '--format=%s', '--', 'specs/100-old/résumé ü & co.md');
    assert.match(log, /seed/);
  });

  it('leaves the ignore rules working under the new paths', () => {
    migrateTrunk({ root, yes: true });
    const fresh = join(tmp, 'fresh');
    git(tmp, 'clone', '-q', remote, fresh);
    mkdirSync(join(fresh, 'specs', '100-old', 'pr-review', 'run-1'), { recursive: true });
    writeFileSync(join(fresh, 'specs', '100-old', 'handoff.md'), 'x\n');
    writeFileSync(join(fresh, 'specs', '100-old', 'pr-review', 'run-1', 'shot.png'), 'png');
    assert.equal(git(fresh, 'status', '--porcelain'), '');
  });

  it('keeps the issue forms and the root README, and holds only specs/ besides them', () => {
    migrateTrunk({ root, yes: true });
    assert.deepEqual(git(remote, 'ls-tree', '--name-only', TRUNK).split('\n'), ['.github', '.gitignore', 'README.md', 'specs']);
    assert.equal(git(remote, 'show', `${TRUNK}:.github/ISSUE_TEMPLATE/story.yml`), 'name: story');
  });

  it('refuses a second real run after the first with the reason named, changing nothing', () => {
    migrateTrunk({ root, yes: true });
    const before = git(remote, 'rev-parse', TRUNK);
    const again = migrateTrunk({ root, yes: true });
    assert.equal(again.ok, false);
    assert.match(again.error, /already moved|layout|moved/);
    assert.equal(git(remote, 'rev-parse', TRUNK), before);
  });

  it('a clone whose feature folders hold a file named like a kept root entry still moves them whole', () => {
    pushSeed((seed) => writeFileSync(join(seed, '100-old', 'README.md'), 'inner readme\n'));
    ensure({ root, url: remote });
    const r = migrateTrunk({ root, yes: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(git(remote, 'show', `${TRUNK}:specs/100-old/README.md`), 'inner readme');
    assert.equal(git(remote, 'show', `${TRUNK}:README.md`) !== 'inner readme', true);
  });

  it('features folder is the clone root before the move and its specs folder after', () => {
    assert.equal(featuresDir(root), cloneDir(root));
    migrateTrunk({ root, yes: true });
    assert.equal(featuresDir(root), join(cloneDir(root), 'specs'));
  });
});
