import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TIMEOUT_MS, activeCount, mainLine, readWatch, reminder, runReminder } from './session-watch-reminder.mjs';

// A resumed or compacted session has lost its background watch wait, and a hook
// cannot start one. So the session-start reminder only says, once, that
// parallel work is running and the wait may need arming — and says nothing at
// all otherwise, in a worktree session, while a wait is armed, or when the
// watcher fails.

const HOOK = new URL('./session-watch-reminder.mjs', import.meta.url).pathname;
const row = (over = {}) => ({ main: false, verdict: 'ok', ...over });

describe('watch reminder — what counts as active', () => {
  it('counts held or stale work outside the main checkout', () => {
    const rows = [row({ main: true }), row(), row({ verdict: 'stale' }), row({ verdict: 'done' }), row({ verdict: 'blocked' })];
    assert.equal(activeCount({ rows }), 2);
  });

  it('reads a malformed report as no work', () => {
    assert.equal(activeCount(null), 0);
    assert.equal(activeCount({}), 0);
    assert.equal(activeCount({ rows: 'x' }), 0);
  });
});

describe('watch reminder — the line', () => {
  it('is silent below two active worktrees', () => {
    assert.equal(reminder(0), '');
    assert.equal(reminder(1), '');
  });

  it('names the count and the wait to arm from two on, and no cron', () => {
    assert.equal(reminder(3), '3 worktrees active: if no watch wait is armed, arm one (see speckit-watch, "Keeping it scheduled").');
    assert.doesNotMatch(reminder(3), /CronList|CronCreate|\* \* \*/);
  });
});

describe('watch reminder — where it speaks', () => {
  let scratch;
  let repo;
  let linked;
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });
  const busy = () => ({ rows: [row({ main: true }), row(), row({ verdict: 'stale' })] });

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'watch-reminder-')));
    repo = join(scratch, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    linked = join(scratch, 'wt-a');
    git(repo, 'worktree', 'add', '-q', '-b', 'a', linked);
    git(repo, 'worktree', 'add', '-q', '-b', 'b', join(scratch, 'wt-b'));
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('reminds the main checkout when two worktrees are active', () => {
    assert.match(runReminder({ repo, watch: busy, armed: () => null }), /^2 worktrees active: /);
  });

  it('stays silent while a live wait holds the record, without running the watcher', () => {
    let ran = false;
    assert.equal(runReminder({ repo, watch: () => ((ran = true), busy()), armed: () => 4242 }), '');
    assert.equal(ran, false);
  });

  it('reads the wait record in the repository by default', () => {
    const common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim();
    writeFileSync(join(common, 'speckit-watch-wait.pid'), `${process.pid}\n`);
    assert.match(runReminder({ repo, watch: busy }), /^2 worktrees active: /, 'this test runner is not a wait, so the record is stale');
  });

  it('stays silent in a session isolated in a worktree, without running the watcher', () => {
    let ran = false;
    const out = runReminder({ repo: linked, watch: () => ((ran = true), busy()) });
    assert.equal(out, '');
    assert.equal(ran, false);
  });

  it('skips the watcher when there are not enough worktrees to be parallel', () => {
    const lone = join(scratch, 'lone');
    mkdirSync(lone);
    git(lone, 'init', '-q');
    git(lone, 'commit', '-q', '--allow-empty', '-m', 'init');
    let ran = false;
    assert.equal(runReminder({ repo: lone, watch: () => ((ran = true), busy()) }), '');
    assert.equal(ran, false);
  });

  it('fails open when the watcher returns nothing', () => {
    assert.equal(runReminder({ repo, watch: () => null }), '');
  });

  it('fails open outside a git repository', () => {
    const plain = join(scratch, 'plain');
    mkdirSync(plain);
    assert.equal(runReminder({ repo: plain, watch: busy }), '');
  });
});

describe('watch reminder — the watcher call', () => {
  let repo;
  const fake = (body) => {
    mkdirSync(join(repo, '.claude/scripts'), { recursive: true });
    writeFileSync(join(repo, '.claude/scripts/watch.mjs'), body);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'watch-reminder-call-'));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('runs it read-only, as --json and never --fix', () => {
    fake('console.log(JSON.stringify({ argv: process.argv.slice(2) }));');
    assert.deepEqual(readWatch(repo, 5000), { argv: ['--json'] });
  });

  it("runs gh as george-hutanu: keeps the session's GH_TOKEN, never leaves it empty", () => {
    fake('console.log(JSON.stringify({ token: process.env.GH_TOKEN ?? null }));');
    assert.deepEqual(readWatch(repo, 5000, { GH_TOKEN: 'session-token' }), { token: 'session-token' });
    const resolved = readWatch(repo, 5000, { GH_TOKEN: '' }).token;
    assert.equal(typeof resolved, 'string');
    assert.notEqual(resolved, '');
  });

  it('waits by default well past a busy board (8-9 s measured with four worktrees)', () => {
    assert.ok(DEFAULT_TIMEOUT_MS >= 20_000);
  });

  it('gives up at the timeout', () => {
    fake('setTimeout(() => console.log("{}"), 5000);');
    const started = Date.now();
    assert.equal(readWatch(repo, 300), null);
    assert.ok(Date.now() - started < 3000);
  });

  it('reads a failing or garbled watcher as nothing', () => {
    fake('console.log("not json");');
    assert.equal(readWatch(repo, 5000), null);
    fake('process.exit(1);');
    assert.equal(readWatch(repo, 5000), null);
  });
});

describe('watch reminder — as a hook', () => {
  it('exits 0 and prints nothing in a directory with no repository', () => {
    const plain = mkdtempSync(join(tmpdir(), 'watch-reminder-hook-'));
    try {
      const run = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: plain } });
      assert.equal(run.status, 0);
      assert.equal(run.stdout, '');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

// A main checkout left behind origin/main, or holding an edit to a
// tracked file, serves stale gates to every session that starts in it. The
// reminder names it at session start, in the main checkout only.
describe('watch reminder — the main checkout', () => {
  let scratch;
  let repo;
  let linked;
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });
  const quiet = () => ({ rows: [] });

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'watch-reminder-main-')));
    repo = join(scratch, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), 'x\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    git(scratch, 'init', '-q', '--bare', 'origin.git');
    git(repo, 'remote', 'add', 'origin', join(scratch, 'origin.git'));
    git(repo, 'push', '-q', 'origin', 'main');
    linked = join(scratch, 'wt-a');
    git(repo, 'worktree', 'add', '-q', '-b', 'a', linked);
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  const advanceOrigin = () => {
    git(linked, 'commit', '-q', '--allow-empty', '-m', 'merged');
    git(linked, 'push', '-q', 'origin', 'HEAD:main');
  };
  const ff = () => `git -C ${repo} merge --ff-only origin/main`;

  // @traces 1035-FR-007
  it('says nothing when clean and level with origin/main', () => {
    assert.equal(mainLine(repo), '');
    assert.equal(runReminder({ repo, watch: quiet, armed: () => null }), '');
  });

  it('names a main checkout behind origin/main, with the fast-forward command', () => {
    advanceOrigin();
    assert.equal(mainLine(repo), `main checkout behind origin/main by 1 — ${ff()}`);
    assert.equal(runReminder({ repo, watch: quiet, armed: () => null }), `main checkout behind origin/main by 1 — ${ff()}`);
  });

  it('names the tracked files edited in it, leaving untracked ones out', () => {
    writeFileSync(join(repo, 'scratch.txt'), 'untracked\n');
    assert.equal(mainLine(repo), '');
    writeFileSync(join(repo, 'README.md'), 'edited\n');
    assert.equal(mainLine(repo), `main checkout dirty: README.md — ${ff()}`);
  });

  it('speaks even below the worktree count and while a wait is armed, and before the parallel-work line', () => {
    advanceOrigin();
    assert.match(runReminder({ repo, watch: quiet, armed: () => 4242 }), /^main checkout behind/);
    git(repo, 'worktree', 'add', '-q', '-b', 'b', join(scratch, 'wt-b'));
    const busy = () => ({ rows: [{ main: false, verdict: 'ok' }, { main: false, verdict: 'stale' }] });
    const lines = runReminder({ repo, watch: busy, armed: () => null }).split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^main checkout behind/);
    assert.match(lines[1], /^2 worktrees active: /);
  });

  it('says nothing about main in a worktree session', () => {
    advanceOrigin();
    writeFileSync(join(repo, 'README.md'), 'edited\n');
    assert.equal(runReminder({ repo: linked, watch: quiet }), '');
  });

  it('fails open with no origin/main and outside a repository', () => {
    const lone = join(scratch, 'lone');
    mkdirSync(lone);
    git(lone, 'init', '-q', '-b', 'main');
    git(lone, 'commit', '-q', '--allow-empty', '-m', 'init');
    assert.equal(mainLine(lone), '');
    const plain = join(scratch, 'plain');
    mkdirSync(plain);
    assert.equal(mainLine(plain), '');
  });
});
