import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { removeWorktree } from './worktree-remove.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'worktree-remove.mjs');
const NOW = new Date(2026, 9, 8, 14, 5, 9);
const BRANCH = 'feat-adv';
const MERGED = JSON.stringify([{ number: 7, state: 'MERGED' }]);
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'adv',
  GIT_AUTHOR_EMAIL: 'adv@example.test',
  GIT_COMMITTER_NAME: 'adv',
  GIT_COMMITTER_EMAIL: 'adv@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

let base;
let main;
let wt;
const saved = {};

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const gitOk = (cwd, ...args) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).status === 0;

beforeEach(() => {
  for (const [k, v] of Object.entries(GIT_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  base = realpathSync(mkdtempSync(join(tmpdir(), 'wt-adv-')));
  const origin = join(base, 'origin.git');
  main = join(base, 'motor-fix');
  mkdirSync(origin);
  git(origin, 'init', '--bare', '-b', 'main');
  mkdirSync(main);
  git(main, 'init', '-b', 'main');
  writeFileSync(join(main, '.gitignore'), '/specs/\nnode_modules/\n.worktrees/\n/.work/\n');
  writeFileSync(join(main, 'a.txt'), 'one\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-m', 'init');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '-u', 'origin', 'main');
  wt = join(main, '.worktrees', BRANCH);
  git(main, 'worktree', 'add', '-b', BRANCH, wt);
  git(wt, 'push', '-u', 'origin', BRANCH);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(base, { recursive: true, force: true });
});

function fake({ gh = { code: 0, stdout: MERGED }, node = { code: 0, stdout: '{"project":"p","stopped":true}\n' }, override } = {}) {
  const calls = [];
  const run = (file, args, opts = {}) => {
    const cmd = [file, ...args].join(' ');
    calls.push({ file, args, cmd, cwd: opts.cwd });
    if (override) {
      const o = override(cmd, file, args, opts);
      if (o) return { code: 0, stdout: '', stderr: '', ...o };
    }
    if (file === 'git') {
      const r = spawnSync('git', args, { cwd: opts.cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    }
    if (file === 'gh') return { stderr: '', ...gh };
    if (file === 'node') return { stderr: '', ...node };
    return { code: 127, stdout: '', stderr: `unexpected ${file}` };
  };
  return { run, calls, cmds: () => calls.map((c) => c.cmd) };
}

const MUTATING = [/worktree remove/, /branch -D/, /worktree prune/, /test-services\.ts/, /docker volume rm/, / add /];
const mutating = (cmds) => cmds.filter((c) => MUTATING.some((re) => re.test(c)));

function options(f, extra = {}) {
  const commits = [];
  return {
    commits,
    options: {
      run: f.run,
      cwd: base,
      now: NOW,
      commitSpecs: (o) => (commits.push(o), { ok: true, committed: false, pushed: false }),
      alive: () => false,
      ...extra,
    },
  };
}

const backfillRoot = () => join(main, '.work', 'worktree-backfill');
const patches = (suffix) => {
  const root = backfillRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .filter((n) => String(n).endsWith(suffix))
    .map((n) => join(root, String(n)));
};
const branchExists = () => gitOk(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`);

function assertUntouched(f, o) {
  assert.deepEqual(mutating(f.cmds()), [], f.cmds().join('\n'));
  assert.deepEqual(o.commits, []);
  assert.equal(existsSync(join(main, '.work')), false);
  assert.equal(existsSync(wt), true);
  assert.equal(branchExists(), true);
}

describe('paths that lead to the main checkout are refused', () => {
  const attempt = (target, extra) => {
    const f = fake();
    const o = options(f, extra);
    const result = removeWorktree(target, o);
    return { f, o, result };
  };
  const refusedMain = (target, extra) => {
    const { f, o, result } = attempt(target, extra);
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.match(result.reason, /^main checkout$/);
    assertUntouched(f, { commits: o.commits });
    assert.equal(existsSync(join(main, '.git')), true);
  };

  it('refuses the main path with a trailing slash', () => {
    refusedMain(`${main}/`);
  });

  it('refuses the main path spelled with dot segments', () => {
    refusedMain(join(main, '.worktrees', '..', '.'));
  });

  it('refuses a symlink that points at the main checkout', () => {
    const link = join(base, 'link-to-main');
    symlinkSync(main, link);
    refusedMain(link);
  });

  it('refuses a symlink to the main checkout planted among the worktrees', () => {
    const link = join(main, '.worktrees', 'innocent');
    symlinkSync(main, link);
    refusedMain(link);
  });

  it('refuses a relative path to the main checkout', () => {
    refusedMain(relative(process.cwd(), main), { cwd: process.cwd() });
  });

  it('refuses the main checkout even when admitting every exception', () => {
    refusedMain(main, { admitNoPr: true, admitLiveLock: true });
  });

  it('refuses a plain subfolder of the main checkout as not a worktree', () => {
    mkdirSync(join(main, 'apps'));
    const { f, o, result } = attempt(join(main, 'apps'));
    assert.equal(result.removed, false);
    assert.equal(result.reason, 'not a worktree');
    assertUntouched(f, { commits: o.commits });
  });

  it('refuses the folder that holds the worktrees', () => {
    const { f, o, result } = attempt(join(main, '.worktrees'));
    assert.equal(result.removed, false);
    assert.equal(result.reason, 'not a worktree');
    assertUntouched(f, { commits: o.commits });
  });

  it('refuses an empty path', () => {
    const { f, o, result } = attempt('');
    assert.equal(result.removed, false);
    assertUntouched(f, { commits: o.commits });
  });
});

describe('running from inside the worktree is refused however it is spelled', () => {
  const refusedInside = (target, cwd) => {
    const f = fake();
    const o = options(f, { cwd });
    const result = removeWorktree(target, o.options);
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.match(result.reason, /^run from inside the worktree$/);
    assertUntouched(f, o);
  };

  it('refuses when the cwd reaches the worktree through a symlink', () => {
    const link = join(base, 'wt-link');
    symlinkSync(wt, link);
    refusedInside(wt, link);
  });

  it('refuses when the path is a symlink to the worktree and the cwd is the real folder', () => {
    const link = join(base, 'wt-link');
    symlinkSync(wt, link);
    refusedInside(link, wt);
  });

  it('refuses when the path has a trailing slash and the cwd is a nested folder', () => {
    mkdirSync(join(wt, 'deep', 'er'), { recursive: true });
    refusedInside(`${wt}/`, join(wt, 'deep', 'er'));
  });

  it('refuses when the path is relative to a cwd inside the worktree', () => {
    refusedInside(relative(process.cwd(), wt), wt);
  });

  it('refuses when the cwd spells the worktree with dot segments', () => {
    refusedInside(wt, join(wt, 'deep', '..', '.'));
  });

  it('does not treat a sibling folder sharing the name prefix as inside', () => {
    const sibling = `${wt}-two`;
    mkdirSync(sibling);
    const f = fake();
    const o = options(f, { cwd: sibling });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
  });
});

describe('locks', () => {
  it('refuses a bare hand lock even when a live session lock is admitted', () => {
    git(main, 'worktree', 'lock', wt);
    const f = fake();
    const o = options(f, { admitLiveLock: true, admitNoPr: true, alive: () => true });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^locked/);
    assertUntouched(f, o);
  });

  it('refuses a hand lock that has a reason', () => {
    git(main, 'worktree', 'lock', '--reason', 'on a usb stick, do not touch', wt);
    const f = fake();
    const o = options(f, { admitLiveLock: true });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^locked: on a usb stick/);
    assertUntouched(f, o);
  });

  it('refuses a live session lock by default and names the pid', () => {
    git(main, 'worktree', 'lock', '--reason', 'claude agent agent-a1 (pid 424242 start Sun Oct  4 08:07:18 2026)', wt);
    const f = fake();
    const o = options(f, { alive: (pid) => Number(pid) === 424242 });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.equal(result.reason, 'locked by a live session (pid 424242)');
    assertUntouched(f, o);
  });

  it('removes past a live session lock only when it is admitted', () => {
    git(main, 'worktree', 'lock', '--reason', 'claude agent agent-a1 (pid 424242 start Sun Oct  4 08:07:18 2026)', wt);
    const f = fake();
    const o = options(f, { alive: () => true, admitLiveLock: true });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(wt), false);
  });

  it('removes a worktree whose lock names a process that has ended', () => {
    git(main, 'worktree', 'lock', '--reason', 'claude agent agent-a1 (pid 424242 start Sun Oct  4 08:07:18 2026)', wt);
    const f = fake();
    const o = options(f, { alive: () => false });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(wt), false);
  });
});

describe('unpushed commits', () => {
  it('refuses a head with one commit on no remote', () => {
    writeFileSync(join(wt, 'new.txt'), 'x\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-m', 'local only');
    const f = fake();
    const o = options(f, { admitNoPr: true });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^unpushed commits: 1$/);
    assertUntouched(f, o);
  });

  it('refuses a head many commits ahead of the pushed branch and counts them', () => {
    for (let i = 0; i < 12; i += 1) {
      writeFileSync(join(wt, `n${i}.txt`), `${i}\n`);
      git(wt, 'add', '-A');
      git(wt, 'commit', '-m', `c${i}`);
    }
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^unpushed commits: 12$/);
    assertUntouched(f, o);
  });

  it('refuses a detached head sitting on a commit no remote has', () => {
    writeFileSync(join(wt, 'new.txt'), 'x\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-m', 'local only');
    git(wt, 'checkout', '--detach');
    const f = fake();
    const o = options(f, { admitNoPr: true });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /unpushed commits/);
    assertUntouched(f, o);
  });

  it('refuses when the unpushed count cannot be read', () => {
    const f = fake({ override: (cmd) => (cmd.includes('rev-list') ? { code: 128, stderr: 'fatal: bad object' } : null) });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^unpushed commits: unknown/);
    assertUntouched(f, o);
  });

  it('refuses when the unpushed count prints something that is not a number', () => {
    const f = fake({ override: (cmd) => (cmd.includes('rev-list') ? { stdout: 'banana\n' } : null) });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assertUntouched(f, o);
  });

  it('refuses when the unpushed count prints nothing', () => {
    const f = fake({ override: (cmd) => (cmd.includes('rev-list') ? { stdout: '' } : null) });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assertUntouched(f, o);
  });
});

describe('pull request state', () => {
  const refusedWith = (gh, reason, extra) => {
    const f = fake({ gh });
    const o = options(f, extra);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.match(result.reason, reason);
    assertUntouched(f, o);
  };

  it('refuses an open PR', () => {
    refusedWith({ code: 0, stdout: JSON.stringify([{ number: 9, state: 'OPEN' }]) }, /^PR #9 open$/, { admitNoPr: true });
  });

  it('refuses an open PR listed after a merged one', () => {
    refusedWith(
      { code: 0, stdout: JSON.stringify([{ number: 3, state: 'MERGED' }, { number: 9, state: 'OPEN' }]) },
      /^PR #9 open$/,
    );
  });

  it('refuses an open PR listed before a closed one', () => {
    refusedWith(
      { code: 0, stdout: JSON.stringify([{ number: 9, state: 'OPEN' }, { number: 3, state: 'CLOSED' }]) },
      /^PR #9 open$/,
    );
  });

  it('refuses when gh fails', () => {
    refusedWith({ code: 1, stdout: '', stderr: 'HTTP 502' }, /^PR state unreadable$/, { admitNoPr: true });
  });

  it('refuses when gh fails but still printed a merged PR', () => {
    refusedWith({ code: 1, stdout: MERGED, stderr: 'rate limited' }, /^PR state unreadable$/, { admitNoPr: true });
  });

  it('refuses when gh prints nothing', () => {
    refusedWith({ code: 0, stdout: '' }, /^PR state unreadable$/, { admitNoPr: true });
  });

  it('refuses when gh prints text that is not JSON', () => {
    refusedWith({ code: 0, stdout: 'Welcome to gh!' }, /^PR state unreadable$/, { admitNoPr: true });
  });

  it('refuses when gh prints JSON null', () => {
    refusedWith({ code: 0, stdout: 'null' }, /^PR state unreadable$/, { admitNoPr: true });
  });

  it('refuses when gh prints a JSON object instead of a list', () => {
    refusedWith({ code: 0, stdout: '{"number":7,"state":"MERGED"}' }, /^PR state unreadable$/, { admitNoPr: true });
  });

  it('refuses when the newest PR has no state', () => {
    refusedWith({ code: 0, stdout: JSON.stringify([{ number: 7 }]) }, /unreadable/, { admitNoPr: true });
  });

  it('refuses when the newest PR has an unknown state', () => {
    refusedWith({ code: 0, stdout: JSON.stringify([{ number: 7, state: 'DRAFTING' }]) }, /unreadable/, { admitNoPr: true });
  });

  it('refuses a worktree with no PR when the no-PR option is off', () => {
    refusedWith({ code: 0, stdout: '[]' }, /^no PR$/);
  });

  it('refuses a no-PR worktree when the option is a truthy non-boolean string "false"', () => {
    refusedWith({ code: 0, stdout: '[]' }, /^no PR$/, { admitNoPr: undefined });
  });

  it('admits a worktree with no PR when the option is on', () => {
    const f = fake({ gh: { code: 0, stdout: '[]' } });
    const o = options(f, { admitNoPr: true });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(wt), false);
    assert.equal(branchExists(), false);
  });

  it('removes a worktree whose newest PR is closed after an older merged one', () => {
    const f = fake({ gh: { code: 0, stdout: JSON.stringify([{ number: 8, state: 'CLOSED' }, { number: 4, state: 'MERGED' }]) } });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
  });

  it('looks the PR up for the branch from the main checkout', () => {
    const f = fake();
    const o = options(f);
    removeWorktree(wt, o.options);
    const gh = f.calls.find((c) => c.file === 'gh');
    assert.ok(gh, 'gh was asked');
    assert.ok(gh.args.includes(BRANCH), gh.cmd);
    assert.equal(realpathSync(gh.cwd), main);
  });
});

describe('detached head', () => {
  beforeEach(() => {
    git(wt, 'checkout', '--detach');
  });

  it('is refused as no PR without the option and nothing is touched', () => {
    const f = fake({ gh: { code: 0, stdout: '[]' } });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /no PR/);
    assertUntouched(f, o);
  });

  it('is removed with the option, skips the branch delete and leaves other branches alone', () => {
    const f = fake({ gh: { code: 0, stdout: '[]' } });
    const o = options(f, { admitNoPr: true });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(wt), false);
    assert.equal(f.cmds().some((c) => /branch -D/.test(c)), false, f.cmds().join('\n'));
    assert.equal(branchExists(), true);
    assert.equal(gitOk(main, 'rev-parse', '--verify', '--quiet', 'refs/heads/main'), true);
  });

  it('asks gh for no PR of an empty branch name', () => {
    const f = fake({ gh: { code: 0, stdout: MERGED } });
    const o = options(f, { admitNoPr: true });
    removeWorktree(wt, o.options);
    const gh = f.calls.find((c) => c.file === 'gh');
    if (gh) {
      const head = gh.args[gh.args.indexOf('--head') + 1];
      assert.notEqual(head, '');
      assert.notEqual(head, 'HEAD');
    }
  });
});

describe('uncommitted work is kept', () => {
  const dirty = () => {
    writeFileSync(join(wt, 'a.txt'), 'one\nedited\n');
    writeFileSync(join(wt, 'untracked.txt'), 'brand new\n');
    writeFileSync(join(wt, 'naïve file ✓.txt'), 'unicode name\n');
    writeFileSync(join(wt, 'blob.bin'), Buffer.from([0, 1, 2, 255, 254, 0, 9]));
    mkdirSync(join(wt, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(wt, 'node_modules', 'pkg', 'index.js'), 'ignored content\n');
    writeFileSync(join(wt, 'staged.txt'), 'staged only\n');
    git(wt, 'add', 'staged.txt');
  };

  it('saves tracked, staged, untracked, unicode-named and binary changes in one patch that applies on the head', () => {
    dirty();
    const head = git(wt, 'rev-parse', 'HEAD');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    const found = patches('.product.patch');
    assert.equal(found.length, 1, found.join(','));
    const text = readFileSync(found[0], 'utf8');
    assert.match(text, /edited/);
    assert.match(text, /brand new/);
    assert.match(text, /staged only/);
    assert.match(text, /unicode name/);
    assert.doesNotMatch(text, /ignored content/);
    const fresh = join(base, 'fresh');
    git(base, 'clone', '--quiet', join(base, 'origin.git'), fresh);
    git(fresh, 'checkout', '--quiet', head);
    git(fresh, 'apply', '--index', found[0]);
    assert.equal(readFileSync(join(fresh, 'untracked.txt'), 'utf8'), 'brand new\n');
    assert.equal(readFileSync(join(fresh, 'naïve file ✓.txt'), 'utf8'), 'unicode name\n');
    assert.deepEqual([...readFileSync(join(fresh, 'blob.bin'))], [0, 1, 2, 255, 254, 0, 9]);
    assert.equal(readFileSync(join(fresh, 'a.txt'), 'utf8'), 'one\nedited\n');
  });

  it('saves a deleted tracked file as a deletion', () => {
    rmSync(join(wt, 'a.txt'));
    const head = git(wt, 'rev-parse', 'HEAD');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    const found = patches('.product.patch');
    assert.equal(found.length, 1);
    const fresh = join(base, 'fresh');
    git(base, 'clone', '--quiet', join(base, 'origin.git'), fresh);
    git(fresh, 'checkout', '--quiet', head);
    git(fresh, 'apply', found[0]);
    assert.equal(existsSync(join(fresh, 'a.txt')), false);
  });

  it('writes no product patch for a clean tree', () => {
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.deepEqual(patches('.product.patch'), []);
  });

  it('writes no product patch for a tree whose only difference is ignored files', () => {
    mkdirSync(join(wt, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(wt, 'node_modules', 'pkg', 'index.js'), 'ignored content\n');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.deepEqual(patches('.product.patch'), []);
  });

  it('puts the patch under the main checkout, not under the worktree being deleted', () => {
    dirty();
    const f = fake();
    const o = options(f);
    removeWorktree(wt, o.options);
    const found = patches('.product.patch');
    assert.equal(found.length, 1);
    assert.ok(found[0].startsWith(join(main, '.work', 'worktree-backfill', '2026-10-08')), found[0]);
    assert.match(found[0], /feat-adv-140509\.product\.patch$/);
  });

  it('never overwrites a patch already sitting at the same name', () => {
    dirty();
    const dir = join(backfillRoot(), '2026-10-08');
    mkdirSync(dir, { recursive: true });
    const existing = join(dir, `${BRANCH}-140509.product.patch`);
    writeFileSync(existing, 'earlier backup\n');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(readFileSync(existing, 'utf8'), 'earlier backup\n');
    if (result.removed) {
      assert.equal(existsSync(wt), false);
      const all = patches('.product.patch');
      assert.equal(all.length, 2, all.join(','));
    } else {
      assert.equal(existsSync(wt), true);
    }
  });

  it('refuses without touching the worktree, branch or stack when the patch cannot be written', () => {
    dirty();
    writeFileSync(join(main, '.work'), 'a file where a folder is needed\n');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.match(result.reason, /^backup failed/);
    assert.deepEqual(mutating(f.cmds()).filter((c) => !/ add /.test(c)), [], f.cmds().join('\n'));
    assert.equal(existsSync(wt), true);
    assert.equal(branchExists(), true);
    assert.equal(readFileSync(join(wt, 'untracked.txt'), 'utf8'), 'brand new\n');
    assert.equal(readFileSync(join(wt, 'a.txt'), 'utf8'), 'one\nedited\n');
  });

  it('leaves the tree dirty exactly as it was when the removal is refused after the backup step', () => {
    dirty();
    writeFileSync(join(main, '.work'), 'blocker\n');
    const before = git(wt, 'status', '--porcelain=v1');
    const f = fake();
    const o = options(f);
    removeWorktree(wt, o.options);
    const after = git(wt, 'status', '--porcelain=v1');
    assert.deepEqual(after.split('\n').map((l) => l.slice(3)).sort(), before.split('\n').map((l) => l.slice(3)).sort());
  });

  it('copes with a worktree path holding spaces and unicode', () => {
    const odd = join(main, '.worktrees', 'spacé dir');
    git(main, 'worktree', 'add', '-b', 'odd-branch', odd);
    git(odd, 'push', '-u', 'origin', 'odd-branch');
    writeFileSync(join(odd, 'x y.txt'), 'content\n');
    const f = fake({ gh: { code: 0, stdout: MERGED } });
    const o = options(f);
    const result = removeWorktree(odd, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(odd), false);
    assert.equal(gitOk(main, 'rev-parse', '--verify', '--quiet', 'refs/heads/odd-branch'), false);
    const found = patches('.product.patch');
    assert.equal(found.length, 1);
    assert.match(readFileSync(found[0], 'utf8'), /content/);
  });
});

describe('the specs clone', () => {
  let specsOrigin;
  const setupSpecs = (branch = 'trunk') => {
    specsOrigin = join(base, 'specs-origin.git');
    mkdirSync(specsOrigin);
    git(specsOrigin, 'init', '--bare', '-b', 'trunk');
    const seed = join(base, 'specs-seed');
    mkdirSync(seed);
    git(seed, 'init', '-b', 'trunk');
    writeFileSync(join(seed, 'README.md'), 'specs\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-m', 'seed');
    git(seed, 'remote', 'add', 'origin', specsOrigin);
    git(seed, 'push', '-u', 'origin', 'trunk');
    git(wt, 'status');
    git(join(wt), 'clone', '--quiet', specsOrigin, 'specs');
    if (branch !== 'trunk') git(join(wt, 'specs'), 'checkout', '-b', branch);
  };

  it('saves uncommitted specs notes as a patch when the push fails, then removes', () => {
    setupSpecs();
    writeFileSync(join(wt, 'specs', 'note.md'), 'precious untracked note\n');
    writeFileSync(join(wt, 'specs', 'README.md'), 'specs\nprecious edit\n');
    const f = fake();
    const o = options(f);
    o.options.commitSpecs = () => ({ ok: false, error: 'push rejected' });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    const found = patches('.specs.patch');
    assert.equal(found.length, 1, found.join(','));
    const text = readFileSync(found[0], 'utf8');
    assert.match(text, /precious untracked note/);
    assert.match(text, /precious edit/);
  });

  it('saves a patch rather than losing the notes when the push throws', () => {
    setupSpecs();
    writeFileSync(join(wt, 'specs', 'note.md'), 'precious untracked note\n');
    const f = fake();
    const o = options(f);
    o.options.commitSpecs = () => {
      throw new Error('network down');
    };
    let result;
    try {
      result = removeWorktree(wt, o.options);
    } catch (err) {
      assert.equal(existsSync(wt), true, `threw ${err.message} after destroying the worktree`);
      return;
    }
    if (result.removed) {
      const found = patches('.specs.patch');
      assert.equal(found.length, 1, 'removed with no specs patch');
      assert.match(readFileSync(found[0], 'utf8'), /precious untracked note/);
    } else {
      assert.equal(existsSync(wt), true);
    }
  });

  it('refuses and keeps everything when both the push and the specs patch fail', () => {
    setupSpecs();
    writeFileSync(join(wt, 'specs', 'note.md'), 'precious untracked note\n');
    writeFileSync(join(main, '.work'), 'blocker\n');
    const f = fake();
    const o = options(f);
    o.options.commitSpecs = () => ({ ok: false, error: 'push rejected' });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.match(result.reason, /^backup failed/);
    assert.deepEqual(mutating(f.cmds()).filter((c) => !/ add /.test(c)), [], f.cmds().join('\n'));
    assert.equal(existsSync(join(wt, 'specs', 'note.md')), true);
    assert.equal(existsSync(wt), true);
    assert.equal(branchExists(), true);
  });

  it('saves committed work on a branch other than trunk as a patch and does not push it', () => {
    setupSpecs('side');
    writeFileSync(join(wt, 'specs', 'side.md'), 'committed on side branch\n');
    git(join(wt, 'specs'), 'add', '-A');
    git(join(wt, 'specs'), 'commit', '-m', 'side work');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.deepEqual(o.commits, []);
    const found = patches('.specs.patch');
    assert.equal(found.length, 1);
    assert.match(readFileSync(found[0], 'utf8'), /committed on side branch/);
  });

  it('hands uncommitted notes on trunk to the push with the backfill message', () => {
    setupSpecs();
    writeFileSync(join(wt, 'specs', 'note.md'), 'note\n');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(o.commits.length, 1);
    assert.match(JSON.stringify(o.commits[0]), /chore\(specs\): backfill feat-adv before removal/);
  });

  it('does not ask for a push when the specs clone has nothing to back up', () => {
    setupSpecs();
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.deepEqual(patches('.specs.patch'), []);
  });

  it('removes a worktree with no specs folder and writes no specs patch', () => {
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.deepEqual(o.commits, []);
    assert.deepEqual(patches('.specs.patch'), []);
  });

  it('removes a worktree whose specs folder is a plain folder, not a clone, without losing it silently', () => {
    mkdirSync(join(wt, 'specs'), { recursive: true });
    writeFileSync(join(wt, 'specs', 'loose.md'), 'loose note\n');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.match(result.backup.specs, /^copy /);
    assert.equal(readFileSync(join(result.backup.specs.slice(5), 'loose.md'), 'utf8'), 'loose note\n');
  });
});

describe('the removal sequence', () => {
  it('backs up, takes the stack down, then removes the worktree, deletes the branch and prunes, in that order', () => {
    writeFileSync(join(wt, 'dirty.txt'), 'x\n');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    const cmds = f.cmds();
    const at = (re) => cmds.findIndex((c) => re.test(c));
    const down = at(/test-services\.ts down/);
    const rm = at(/worktree remove --force --force/);
    const del = at(new RegExp(`branch -D ${BRANCH}$`));
    const prune = at(/worktree prune/);
    assert.ok(down >= 0 && rm > down && del > rm && prune > del, cmds.join('\n'));
    assert.match(cmds[down], /--volumes/);
    assert.equal(f.calls[down].cwd, wt);
    assert.equal(patches('.product.patch').length, 1);
  });

  it('never deletes a branch name it was not given by the worktree', () => {
    const f = fake();
    const o = options(f);
    removeWorktree(wt, o.options);
    const deletes = f.cmds().filter((c) => /branch -[dD]/.test(c));
    assert.deepEqual(deletes.map((c) => c.split(' ').pop()), [BRANCH]);
  });

  it('removes a worktree whose branch name contains a slash', () => {
    const slash = join(main, '.worktrees', 'feat-slash');
    git(main, 'worktree', 'add', '-b', 'feature/with/slash', slash);
    git(slash, 'push', '-u', 'origin', 'feature/with/slash');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(slash, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(gitOk(main, 'rev-parse', '--verify', '--quiet', 'refs/heads/feature/with/slash'), false);
    const gh = f.calls.find((c) => c.file === 'gh');
    assert.ok(gh.args.includes('feature/with/slash'), gh.cmd);
  });

  it('keeps the backup and reports the failure when the worktree remove fails, without deleting the branch', () => {
    writeFileSync(join(wt, 'dirty.txt'), 'x\n');
    const f = fake({ override: (cmd) => (/worktree remove/.test(cmd) ? { code: 1, stderr: 'fatal: cannot remove' } : null) });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.equal(typeof result.reason, 'string');
    assert.equal(branchExists(), true);
    assert.equal(f.cmds().some((c) => /branch -D|worktree prune/.test(c)), false, f.cmds().join('\n'));
    assert.equal(patches('.product.patch').length, 1);
    assert.equal(f.cmds().filter((c) => /worktree remove/.test(c)).length, 1, 'retried');
  });

  it('stops before the prune and reports it when the branch delete fails', () => {
    const f = fake({ override: (cmd) => (/branch -D/.test(cmd) ? { code: 1, stderr: 'error: cannot delete' } : null) });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.equal(f.cmds().some((c) => /worktree prune/.test(c)), false);
    assert.equal(f.cmds().filter((c) => /branch -D/.test(c)).length, 1, 'retried');
  });

  it('removes anyway and reports the failure when the stack will not go down', () => {
    const ok = fake();
    const o1 = options(ok);
    const good = removeWorktree(wt, o1.options);
    assert.equal(good.removed, true);

    git(main, 'worktree', 'add', '-b', 'second', join(main, '.worktrees', 'second'));
    git(join(main, '.worktrees', 'second'), 'push', '-u', 'origin', 'second');
    const bad = fake({ node: { code: 1, stdout: '', stderr: 'docker: command not found' } });
    const o2 = options(bad);
    const result = removeWorktree(join(main, '.worktrees', 'second'), o2.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(join(main, '.worktrees', 'second')), false);
    assert.notDeepEqual(result.test_stack, good.test_stack);
    assert.match(JSON.stringify(result.test_stack), /docker|fail|error|1/i);
  });

  it('removes anyway when the stack command prints garbage', () => {
    const f = fake({ node: { code: 0, stdout: 'not json at all' } });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(wt), false);
  });

  it('removes anyway when the stack command could not even start', () => {
    const f = fake({ node: { code: null, stdout: '', stderr: 'spawn node ENOENT' } });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(existsSync(wt), false);
  });

  it('says the worktree is gone and removes nothing on the second call', () => {
    const f = fake();
    const o = options(f);
    assert.equal(removeWorktree(wt, o.options).removed, true);
    const again = fake();
    const o2 = options(again);
    const result = removeWorktree(wt, o2.options);
    assert.equal(result.removed, false);
    assert.equal(result.reason, 'not a worktree');
    assert.deepEqual(mutating(again.cmds()), []);
    assert.equal(gitOk(main, 'rev-parse', '--git-dir'), true);
  });

  it('returns the path it was given in the result', () => {
    const f = fake({ gh: { code: 0, stdout: '[]' } });
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(typeof result.path, 'string');
    assert.equal(realpathSync(dirname(result.path)), realpathSync(dirname(wt)));
  });

  it('removing one worktree leaves a sibling worktree and its branch alone', () => {
    const sib = join(main, '.worktrees', 'sibling');
    git(main, 'worktree', 'add', '-b', 'sibling-branch', sib);
    git(sib, 'push', '-u', 'origin', 'sibling-branch');
    writeFileSync(join(sib, 'keep.txt'), 'keep\n');
    const f = fake();
    const o = options(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(readFileSync(join(sib, 'keep.txt'), 'utf8'), 'keep\n');
    assert.equal(gitOk(main, 'rev-parse', '--verify', '--quiet', 'refs/heads/sibling-branch'), true);
  });
});

describe('the command line', () => {
  let stubs;
  let ghLog;
  let ghOut;

  beforeEach(() => {
    stubs = join(base, 'stubs');
    ghLog = join(base, 'gh.log');
    ghOut = join(base, 'gh.out');
    mkdirSync(stubs);
    writeFileSync(join(stubs, 'gh'), `#!/bin/sh\necho "$@" >> "${ghLog}"\ncat "${ghOut}" 2>/dev/null\n[ -f "${ghOut}" ] || exit 1\n`);
    writeFileSync(join(stubs, 'docker'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(stubs, 'gh'), 0o755);
    chmodSync(join(stubs, 'docker'), 0o755);
  });

  const cli = (args, cwd) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, ...GIT_ENV, PATH: `${stubs}:${process.env.PATH}` },
    });
  const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').trim() : '');
  const oneJson = (r) => {
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `stdout was: ${r.stdout} | stderr: ${r.stderr}`);
    return JSON.parse(lines[0]);
  };

  it('refuses the main checkout, prints one JSON line, exits 1 and asks gh nothing', () => {
    const r = cli([main], base);
    assert.equal(r.status, 1, r.stderr);
    const json = oneJson(r);
    assert.equal(json.removed, false);
    assert.equal(json.reason, 'main checkout');
    assert.equal(ghCalls(), '');
    assert.equal(existsSync(join(main, '.git')), true);
  });

  it('refuses the main checkout reached through a symlink and a trailing slash', () => {
    const link = join(base, 'ln');
    symlinkSync(main, link);
    const r = cli([`${link}/`], base);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(oneJson(r).reason, 'main checkout');
    assert.equal(existsSync(join(main, '.git')), true);
  });

  it('refuses the main checkout named by a relative path from another folder', () => {
    const r = cli([relative(base, main)], base);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(oneJson(r).reason, 'main checkout');
  });

  it('refuses the worktree it is run from and keeps it', () => {
    const r = cli([wt], wt);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(oneJson(r).reason, 'run from inside the worktree');
    assert.equal(existsSync(wt), true);
    assert.equal(ghCalls(), '');
  });

  it('refuses the worktree named as dot-dot from inside its subfolder', () => {
    mkdirSync(join(wt, 'sub'));
    const r = cli(['..'], join(wt, 'sub'));
    assert.equal(r.status, 1, r.stderr);
    assert.equal(existsSync(wt), true);
    assert.equal(oneJson(r).removed, false);
  });

  it('refuses a worktree with no PR because the command never admits it', () => {
    writeFileSync(ghOut, '[]');
    const r = cli([wt], main);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(oneJson(r).reason, 'no PR');
    assert.equal(existsSync(wt), true);
    assert.equal(branchExists(), true);
  });

  it('refuses a worktree with an open PR', () => {
    writeFileSync(ghOut, JSON.stringify([{ number: 12, state: 'OPEN' }]));
    const r = cli([wt], main);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(oneJson(r).reason, 'PR #12 open');
    assert.equal(existsSync(wt), true);
  });

  it('refuses when gh is unavailable', () => {
    const r = cli([wt], main);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(oneJson(r).reason, 'PR state unreadable');
    assert.equal(existsSync(wt), true);
  });

  it('refuses a hand-locked worktree', () => {
    writeFileSync(ghOut, MERGED);
    git(main, 'worktree', 'lock', '--reason', 'hands off', wt);
    const r = cli([wt], main);
    assert.equal(r.status, 1, r.stderr);
    assert.match(oneJson(r).reason, /^locked/);
    assert.equal(existsSync(wt), true);
  });

  it('refuses a worktree with a commit on no remote', () => {
    writeFileSync(ghOut, MERGED);
    writeFileSync(join(wt, 'n.txt'), 'n\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-m', 'local');
    const r = cli([wt], main);
    assert.equal(r.status, 1, r.stderr);
    assert.match(oneJson(r).reason, /^unpushed commits: 1$/);
    assert.equal(existsSync(wt), true);
  });

  it('exits 1 with JSON for a path that does not exist', () => {
    const r = cli([join(base, 'nope')], main);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(oneJson(r).reason, 'not a worktree');
  });

  it('exits 2 with its usage, not a stack trace, when given no path', () => {
    const r = cli([], main);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^usage: node \.claude\/scripts\/worktree-remove\.mjs <path>/);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(join(main, '.git')), true);
  });

  it('removes a merged worktree held by a live session, exits 0 and prints one JSON line', () => {
    writeFileSync(ghOut, MERGED);
    git(main, 'worktree', 'lock', '--reason', `claude agent agent-a1 (pid ${process.pid} start Sun Oct  4 08:07:18 2026)`, wt);
    writeFileSync(join(wt, 'dirty.txt'), 'dirty\n');
    const r = cli([wt], main);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const json = oneJson(r);
    assert.equal(json.removed, true);
    assert.equal(existsSync(wt), false);
    assert.equal(branchExists(), false);
    assert.equal(patches('.product.patch').length, 1);
  });
});
