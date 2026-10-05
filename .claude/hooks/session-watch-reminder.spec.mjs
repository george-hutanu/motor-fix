import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TIMEOUT_MS, activeCount, readWatch, reminder, runReminder } from './session-watch-reminder.mjs';

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
