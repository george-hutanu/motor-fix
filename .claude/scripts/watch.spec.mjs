import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_THRESHOLDS,
  QA_CAP,
  applyFixes,
  collect,
  dispatchPlan,
  dueFixes,
  fixOf,
  holderOf,
  isClaudeCommand,
  lockPid,
  main,
  parseStale,
  parseWorktrees,
  phaseOf,
  qaCapFrom,
  scratchRun,
  summarizePr,
  writeClaim,
} from './watch.mjs';
import { waitHolder } from './lib/watch-wait.mjs';

const MIN = 60_000;
const NOW = Date.parse('2026-10-04T12:00:00Z');

const porcelain = [
  'worktree /repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo/.claude/worktrees/agent-a1',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/901-fixture-urls',
  'locked claude agent agent-a1 (pid 2214 start Sun Oct  4 08:07:18 2026)',
  '',
  'worktree /tmp/x/mf-prtest-12-e57edba-73771',
  'HEAD e57edba000000000000000000000000000000000',
  'detached',
  '',
  'worktree /repo/.claude/worktrees/gone',
  'HEAD 3333333333333333333333333333333333333333',
  'branch refs/heads/chore-gone',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n');

const check = (conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name: 'ci', status, conclusion });
const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });

const pr = (over = {}) => ({
  number: 21,
  headRefName: '901-fixture-urls',
  state: 'OPEN',
  isDraft: false,
  headRefOid: 'abc',
  statusCheckRollup: [check('SUCCESS')],
  ...over,
});

const row = (over = {}) => ({
  main: false,
  phase: 'development',
  holder: 'none',
  activity: { at: NOW - 60 * MIN, source: 'commit' },
  pr: null,
  clean: true,
  head: 'abc',
  ...over,
});

describe('worktree records', () => {
  it('reads path, branch, lock and the main worktree from porcelain output', () => {
    const [first, second] = parseWorktrees(porcelain);
    assert.equal(first.main, true);
    assert.equal(first.branch, 'main');
    assert.equal(second.main, false);
    assert.equal(second.path, '/repo/.claude/worktrees/agent-a1');
    assert.equal(second.branch, '901-fixture-urls');
    assert.match(second.lock, /pid 2214/);
  });

  it('marks a record whose directory is gone as prunable', () => {
    const gone = parseWorktrees(porcelain).find((w) => w.path.endsWith('/gone'));
    assert.equal(gone.prunable, true);
  });

  it('reads the PR and the pid of a PR-tester scratch worktree, and nothing else', () => {
    assert.deepEqual(scratchRun('/tmp/x/mf-prtest-12-e57edba-73771'), { pr: 12, pid: 73771 });
    assert.equal(scratchRun('/repo/.claude/worktrees/agent-a1'), null);
  });

  it('reads the pid from a claude lock reason', () => {
    assert.equal(lockPid('claude agent agent-a1 (pid 2214 start Sun Oct  4 08:07:18 2026)'), 2214);
    assert.equal(lockPid('claude session agent-watchdog (pid 86141 start Sun Oct  4 10:15:05 2026)'), 86141);
    assert.equal(lockPid('kept by hand'), null);
    assert.equal(lockPid(null), null);
  });
});

describe('which process is Claude Code', () => {
  it('matches the native binary and the npm entry point, not a process that only mentions .claude', () => {
    assert.ok(isClaudeCommand('/Users/x/Library/Application Support/Claude/claude-code/2.1.286/f2/claude.app/Contents/MacOS/claude\n'));
    assert.ok(isClaudeCommand('claude --resume'));
    assert.ok(isClaudeCommand('node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'));
    assert.ok(!isClaudeCommand('node -e "x" /Users/me/.claude/settings.json'));
    assert.ok(!isClaudeCommand('node .claude/scripts/watch.mjs'));
  });
});

describe('holder', () => {
  const lock = 'claude agent agent-a1 (pid 2214 start Sun Oct  4 08:07:18 2026)';
  const base = { main: false, lock: null, alive: () => false, qaLive: false, claim: null, threshold: 30, now: NOW };

  it('is owner for the main worktree', () => {
    assert.equal(holderOf({ ...base, main: true }), 'owner');
  });

  it('is live when the lock names a running claude process, dead when it does not', () => {
    assert.equal(holderOf({ ...base, lock, alive: (pid) => pid === 2214 }), 'live');
    assert.equal(holderOf({ ...base, lock }), 'dead');
  });

  it('reads a subagent lock as live only while its worktree moves within the threshold', () => {
    const agentLock = 'claude agent agent-a1 (pid 2214 start Sun Oct  4 08:07:18 2026)';
    const sessionLock = 'claude session agent-watchdog (pid 2214 start Sun Oct  4 10:15:05 2026)';
    const alive = (pid) => pid === 2214;
    assert.equal(holderOf({ ...base, lock: agentLock, alive, activityAt: NOW - 10 * MIN }), 'live');
    assert.equal(holderOf({ ...base, lock: agentLock, alive, activityAt: NOW - 31 * MIN }), 'none');
    assert.equal(holderOf({ ...base, lock: sessionLock, alive, activityAt: NOW - 600 * MIN }), 'live');
  });

  it('is live for a lock set by hand, with no pid, and while a PR-tester run tests its PR', () => {
    assert.equal(holderOf({ ...base, lock: 'kept while I look at it' }), 'live');
    assert.equal(holderOf({ ...base, lock, qaLive: true }), 'live');
  });

  it('is none without a lock', () => {
    assert.equal(holderOf(base), 'none');
  });

  it('counts a claim as live only while it is younger than the threshold', () => {
    assert.equal(holderOf({ ...base, claim: { fix: 'resume', at: new Date(NOW - 10 * MIN).toISOString() } }), 'live');
    assert.equal(holderOf({ ...base, claim: { fix: 'resume', at: new Date(NOW - 31 * MIN).toISOString() } }), 'none');
  });
});

describe('PR summary', () => {
  it('names draft, ready, merged and closed', () => {
    assert.equal(summarizePr(pr({ isDraft: true })).state, 'draft');
    assert.equal(summarizePr(pr()).state, 'ready');
    assert.equal(summarizePr(pr({ state: 'MERGED' })).state, 'merged');
    assert.equal(summarizePr(pr({ state: 'CLOSED' })).state, 'closed');
  });

  it('separates agent-review from the other checks', () => {
    const s = summarizePr(pr({ statusCheckRollup: [check('SUCCESS'), review('SUCCESS')] }));
    assert.equal(s.checks, 'pass');
    assert.equal(s.agentReview, 'success');
  });

  it('reads a failed, a pending and an absent check', () => {
    assert.equal(summarizePr(pr({ statusCheckRollup: [check('SUCCESS'), check('FAILURE')] })).checks, 'fail');
    assert.equal(summarizePr(pr({ statusCheckRollup: [check(null, 'IN_PROGRESS')] })).checks, 'pending');
    assert.equal(summarizePr(pr({ statusCheckRollup: [check('SKIPPED'), check('NEUTRAL')] })).checks, 'pass');
    assert.equal(summarizePr(pr({ statusCheckRollup: [] })).checks, 'none');
    assert.equal(summarizePr(pr({ statusCheckRollup: [review('FAILURE')] })).agentReview, 'failure');
    assert.equal(summarizePr(pr()).agentReview, null);
  });
});

describe('phase', () => {
  const none = { pr: null, runState: { status: 'draft', phase: null }, artifacts: null, qaLive: false };

  it('is done for a merged or closed PR, whatever run-state says', () => {
    assert.equal(phaseOf({ ...none, pr: summarizePr(pr({ state: 'MERGED' })), runState: { status: 'in-progress', phase: 'implement' } }), 'done');
    assert.equal(phaseOf({ ...none, pr: summarizePr(pr({ state: 'CLOSED' })) }), 'done');
  });

  it('is blocked or done from run-state status', () => {
    assert.equal(phaseOf({ ...none, runState: { status: 'blocked', phase: 'harden' } }), 'blocked');
    assert.equal(phaseOf({ ...none, runState: { status: 'done', phase: 'archive' } }), 'done');
  });

  it('lets an open ready PR outrank run-state done, but not blocked', () => {
    const ready = summarizePr(pr());
    assert.equal(phaseOf({ ...none, pr: ready, runState: { status: 'done', phase: 'retro' } }), 'qa');
    assert.equal(phaseOf({ ...none, pr: ready, runState: { status: 'blocked', phase: 'pr-test' } }), 'blocked');
  });

  it('is merging or qa for a ready PR: marking it ready puts it in QA, there is no in review stage', () => {
    const ready = (rollupEntries) => summarizePr(pr({ statusCheckRollup: rollupEntries }));
    assert.equal(phaseOf({ ...none, pr: ready([check('SUCCESS'), review('SUCCESS')]) }), 'merging');
    assert.equal(phaseOf({ ...none, pr: ready([check('SUCCESS'), review('FAILURE')]) }), 'qa');
    assert.equal(phaseOf({ ...none, pr: ready([check('SUCCESS')]) }), 'qa');
    assert.equal(phaseOf({ ...none, pr: ready([check(null, 'IN_PROGRESS')]) }), 'qa');
  });

  it('maps a run-state phase to its stage', () => {
    const at = (phase) => phaseOf({ ...none, runState: { status: 'in-progress', phase } });
    assert.equal(at('clarify'), 'planning');
    assert.equal(at('tests'), 'tests');
    assert.equal(at('harden'), 'development');
    assert.equal(at('hand-off'), 'review');
    assert.equal(at('pr-test'), 'qa');
  });

  it('falls back to the artifacts, then to development', () => {
    const art = (over) => phaseOf({ ...none, artifacts: { spec: true, plan: true, tasks: true, open: 0, done: 0, ...over } });
    assert.equal(art({ tasks: false }), 'planning');
    assert.equal(art({ open: 3, done: 1 }), 'development');
    assert.equal(art({ open: 0, done: 4 }), 'review');
    assert.equal(phaseOf(none), 'development');
  });
});

describe('stale and the fix', () => {
  const opts = { now: NOW, thresholds: DEFAULT_THRESHOLDS };

  it('is stale when no live agent holds it and it has been quiet past its threshold', () => {
    const r = fixOf(row(), opts);
    assert.equal(r.verdict, 'stale');
    assert.equal(r.fix, 'resume');
  });

  it('is never stale while a live agent holds it, however long it has been quiet', () => {
    const r = fixOf(row({ holder: 'live', activity: { at: NOW - 600 * MIN, source: 'commit' } }), opts);
    assert.equal(r.verdict, 'ok');
    assert.equal(r.fix, null);
  });

  it('is ok while quieter than its threshold, and the main worktree is never stale', () => {
    assert.equal(fixOf(row({ activity: { at: NOW - 40 * MIN, source: 'file' } }), opts).verdict, 'ok');
    assert.equal(fixOf(row({ main: true, holder: 'owner', activity: { at: 0, source: 'commit' } }), opts).verdict, 'ok');
  });

  it('takes an overridden threshold for one phase and the defaults for the rest', () => {
    const thresholds = parseStale(['qa=10'], DEFAULT_THRESHOLDS);
    assert.equal(thresholds.qa, 10);
    assert.equal(thresholds.development, 45);
    const qa = row({ phase: 'qa', activity: { at: NOW - 15 * MIN, source: 'commit' }, pr: summarizePr(pr()) });
    assert.equal(fixOf(qa, { ...opts, thresholds }).verdict, 'stale');
    assert.throws(() => parseStale(['qa=soon'], DEFAULT_THRESHOLDS));
    assert.throws(() => parseStale(['lunch=10'], DEFAULT_THRESHOLDS));
  });

  it('picks the first fix that applies: merge, fix-ci, rerun-qa, resume', () => {
    const quiet = { activity: { at: NOW - 120 * MIN, source: 'commit' } };
    const ready = (entries) => summarizePr(pr({ statusCheckRollup: entries }));
    assert.equal(fixOf(row({ ...quiet, phase: 'merging', pr: ready([check('SUCCESS'), review('SUCCESS')]) }), opts).fix, 'merge');
    assert.equal(fixOf(row({ ...quiet, pr: summarizePr(pr({ isDraft: true, statusCheckRollup: [check('FAILURE')] })) }), opts).fix, 'fix-ci');
    assert.equal(fixOf(row({ ...quiet, phase: 'qa', pr: ready([check('SUCCESS')]) }), opts).fix, 'rerun-qa');
    // QA runs beside CI: a ready PR with no verdict gets the tester while CI still runs.
    assert.equal(fixOf(row({ ...quiet, phase: 'qa', pr: ready([check(null, 'IN_PROGRESS')]) }), opts).fix, 'rerun-qa');
    assert.equal(fixOf(row({ ...quiet, phase: 'qa', pr: ready([check('SUCCESS'), review('FAILURE')]) }), opts).fix, 'resume');
    assert.equal(fixOf(row({ ...quiet, pr: summarizePr(pr({ isDraft: true })) }), opts).fix, 'resume');
  });

  it('hands a quiet ready PR with a hand-off note to a tail agent, after merge', () => {
    const quiet = { activity: { at: NOW - 120 * MIN, source: 'commit' }, phase: 'qa', handoff: true };
    const ready = (entries) => summarizePr(pr({ statusCheckRollup: entries }));
    assert.equal(fixOf(row({ ...quiet, phase: 'merging', pr: ready([check('SUCCESS'), review('SUCCESS')]) }), opts).fix, 'merge');
    assert.equal(fixOf(row({ ...quiet, pr: ready([check('SUCCESS')]) }), opts).fix, 'tail');
    assert.equal(fixOf(row({ ...quiet, pr: ready([check(null, 'IN_PROGRESS')]) }), opts).fix, 'tail');
    assert.equal(fixOf(row({ ...quiet, pr: ready([check('FAILURE')]) }), opts).fix, 'tail');
    assert.equal(fixOf(row({ ...quiet, pr: ready([check('SUCCESS'), review('FAILURE')]) }), opts).fix, 'tail');
    // A draft is still the story agent's: no hand-off has happened yet.
    assert.equal(fixOf(row({ ...quiet, phase: 'development', pr: summarizePr(pr({ isDraft: true })) }), opts).fix, 'resume');
    // A held or recent PR is left alone.
    assert.equal(fixOf(row({ ...quiet, holder: 'live', pr: ready([check('SUCCESS')]) }), opts).fix, null);
    assert.equal(fixOf(row({ ...quiet, activity: { at: NOW - 5 * MIN, source: 'commit' }, pr: ready([check('SUCCESS')]) }), opts).fix, null);
  });

  it('resumes instead of merging when the worktree holds work the PR head does not', () => {
    const quiet = { activity: { at: NOW - 120 * MIN, source: 'commit' } };
    const green = summarizePr(pr({ headRefOid: 'abc', statusCheckRollup: [check('SUCCESS'), review('SUCCESS')] }));
    assert.equal(fixOf(row({ ...quiet, phase: 'merging', pr: green }), opts).fix, 'merge');
    assert.equal(fixOf(row({ ...quiet, phase: 'merging', pr: green, head: 'def' }), opts).fix, 'resume');
    assert.equal(fixOf(row({ ...quiet, phase: 'merging', pr: green, clean: false }), opts).fix, 'resume');
  });

  it('proposes no PR fix when the PR state is unknown', () => {
    const r = fixOf(row({ phase: 'review', pr: 'unknown', activity: { at: NOW - 120 * MIN, source: 'commit' } }), opts);
    assert.equal(r.fix, 'resume');
  });

  it('removes a merged worktree only when it is clean, not held and at the merged head', () => {
    const merged = summarizePr(pr({ state: 'MERGED', headRefOid: 'abc' }));
    const done = { phase: 'done', pr: merged };
    assert.equal(fixOf(row(done), opts).fix, 'remove-worktree');
    assert.equal(fixOf(row(done), opts).verdict, 'done');
    const dirty = fixOf(row({ ...done, clean: false }), opts);
    assert.equal(dirty.fix, null);
    assert.match(dirty.reason, /uncommitted/);
    assert.equal(fixOf(row({ ...done, holder: 'live' }), opts).fix, null);
    assert.equal(fixOf(row({ ...done, head: 'def' }), opts).fix, null);
    assert.equal(fixOf(row({ ...done, main: true, holder: 'owner' }), opts).fix, null);
  });

  it('shows a worktree git cannot read as blocked, with no fix', () => {
    const r = fixOf(row({ gitFailed: true, activity: { at: 0, source: 'commit' } }), opts);
    assert.equal(r.verdict, 'blocked');
    assert.equal(r.fix, null);
  });

  it('never fixes a blocked worktree', () => {
    const r = fixOf(row({ phase: 'blocked', activity: { at: 0, source: 'commit' } }), opts);
    assert.equal(r.verdict, 'blocked');
    assert.equal(r.fix, null);
  });
});

describe('dispatch plan', () => {
  const stale = (path, fix, minutesQuiet) => ({ path, verdict: 'stale', fix, activity: { at: NOW - minutesQuiet * MIN }, claim: null });

  it('dispatches no QA run while the cap is live', () => {
    const plan = dispatchPlan([stale('a', 'rerun-qa', 50), stale('b', 'rerun-qa', 60)], { qaLive: 4, qaCap: 4, now: NOW });
    assert.deepEqual(plan, []);
  });

  it('fills the free QA places, oldest first', () => {
    const rows = [stale('a', 'rerun-qa', 50), stale('b', 'rerun-qa', 90), stale('c', 'rerun-qa', 70)];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 2, qaCap: 4, now: NOW }).map((p) => p.path), ['b', 'c']);
    assert.deepEqual(dispatchPlan(rows, { qaLive: QA_CAP - 2, now: NOW }).map((p) => p.path), ['b', 'c']);
    assert.deepEqual(dispatchPlan(rows, { qaLive: QA_CAP, now: NOW }), []);
  });

  it('runs at most 2 other agent fixes at once, counting live claims', () => {
    const rows = [stale('a', 'resume', 50), stale('b', 'fix-ci', 60), stale('c', 'merge', 70)];
    assert.equal(dispatchPlan(rows, { qaLive: 0, now: NOW }).length, 2);
    const claimed = { path: 'z', verdict: 'ok', fix: null, claim: { fix: 'resume', at: new Date(NOW - MIN).toISOString(), live: true } };
    assert.equal(dispatchPlan([...rows, claimed], { qaLive: 0, now: NOW }).length, 1);
  });

  it('counts a QA claim once when the QA run it started is already live', () => {
    const claimed = (path, qaLive) => ({ path, verdict: 'ok', fix: null, qaLive, claim: { fix: 'rerun-qa', at: new Date(NOW - MIN).toISOString(), live: true } });
    const rows = [claimed('x', true), claimed('y', true), stale('a', 'rerun-qa', 90), stale('b', 'rerun-qa', 80)];
    assert.equal(dispatchPlan(rows, { qaLive: 2, qaCap: 4, now: NOW }).length, 2);
  });

  it('does not count QA re-runs against the 2 other agent fixes', () => {
    const rows = [stale('a', 'rerun-qa', 90), stale('b', 'resume', 80), stale('c', 'fix-ci', 70), stale('d', 'merge', 60)];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, now: NOW }).map((p) => p.path), ['a', 'b', 'c']);
  });

  it('counts a tail against the QA cap, like a QA re-run', () => {
    const rows = [stale('a', 'tail', 90), stale('b', 'rerun-qa', 80), stale('c', 'resume', 70), stale('d', 'fix-ci', 60)];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, now: NOW }).map((p) => p.path), ['a', 'b', 'c', 'd']);
    assert.deepEqual(dispatchPlan(rows, { qaLive: 1, qaCap: 2, now: NOW }).map((p) => p.path), ['a', 'c', 'd']);
    const claimed = { path: 'z', verdict: 'ok', fix: null, qaLive: false, claim: { fix: 'tail', at: new Date(NOW - MIN).toISOString(), live: true } };
    assert.deepEqual(dispatchPlan([...rows, claimed], { qaLive: 0, qaCap: 2, now: NOW }).map((p) => p.path), ['a', 'c', 'd']);
  });

  it('dispatches nothing when the PR state is unknown', () => {
    assert.deepEqual(dispatchPlan([stale('a', 'resume', 90)], { qaLive: 0, now: NOW, prsKnown: false }), []);
  });

  it('never dispatches remove-worktree or a row that is not stale', () => {
    const rows = [{ ...stale('a', 'remove-worktree', 50), verdict: 'done' }, { ...stale('b', null, 5), verdict: 'ok' }];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, now: NOW }), []);
  });
});

// ---- against real git repositories ------------------------------------------------

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-')));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  mkdirSync(join(repo, '.specify'));
  writeFileSync(join(repo, '.specify', '.gitignore'), 'feature.json\n');
  writeFileSync(join(repo, '.gitignore'), '.specify/**/.cache/\n.specify/run-state.json\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  const add = (name, branch) => {
    const path = join(root, name);
    git(repo, 'worktree', 'add', '-q', '-b', branch, path);
    return path;
  };
  return { root, repo, add };
}

const quietCommit = (path, minutesAgo) => {
  const date = new Date(NOW - minutesAgo * MIN).toISOString();
  writeFileSync(join(path, `f${minutesAgo}.txt`), 'x\n');
  git(path, 'add', '.');
  execFileSync('git', ['commit', '-q', '-m', 'w'], { cwd: path, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
};

const env = (over = {}) => ({ now: NOW, gh: () => [], alive: () => false, pidAlive: () => false, ...over });

describe('collect', () => {
  it('lists every worktree with its fields and counts a live PR-tester run instead of listing it', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-fixture-urls');
      quietCommit(a, 120);
      const scratch = join(f.root, 'mf-prtest-12-abcdef1-4242');
      git(f.repo, 'worktree', 'add', '-q', '--detach', scratch);
      const head = git(a, 'rev-parse', 'HEAD');
      const report = collect(f.repo, env({
        gh: () => [pr({ headRefOid: head, isDraft: true })],
        pidAlive: (pid) => pid === 4242,
      }));
      assert.equal(report.rows.length, 2);
      const r = report.rows.find((x) => x.path === a);
      assert.equal(r.branch, '901-fixture-urls');
      assert.equal(r.holder, 'none');
      assert.equal(r.pr.number, 21);
      assert.equal(r.pr.state, 'draft');
      assert.equal(r.activity.source, 'commit');
      assert.equal(r.verdict, 'stale');
      assert.deepEqual(report.qaRuns, [{ pr: 12, pid: 4242 }]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('takes the newest of commit, changed file and run-state as the last activity', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '905-x');
      quietCommit(a, 300);
      writeFileSync(join(a, 'wip.txt'), 'x\n');
      const t = (NOW - 100 * MIN) / 1000;
      utimesSync(join(a, 'wip.txt'), t, t);
      let r = collect(f.repo, env()).rows.find((x) => x.path === a);
      assert.equal(r.activity.source, 'file');
      assert.equal(r.activity.at, NOW - 100 * MIN);
      assert.equal(r.clean, false);
      writeFileSync(join(a, '.specify', 'run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'implement', updated: new Date(NOW - 5 * MIN).toISOString() }));
      r = collect(f.repo, env()).rows.find((x) => x.path === a);
      assert.equal(r.activity.source, 'run-state');
      assert.equal(r.phase, 'development');
      assert.equal(r.verdict, 'ok');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reads the feature and its phase from the worktree pointer and artifacts', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', 'chore-x');
      mkdirSync(join(a, 'specs', '900-fixture'), { recursive: true });
      writeFileSync(join(a, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/900-fixture' }));
      writeFileSync(join(a, 'specs', '900-fixture', 'spec.md'), '# s\n');
      const r = collect(f.repo, env()).rows.find((x) => x.path === a);
      assert.equal(r.feature, 'specs/900-fixture');
      assert.equal(r.phase, 'planning');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('marks a worktree whose feature folder holds a hand-off note', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-fixture-urls');
      const b = f.add('agent-b', 'chore-y');
      mkdirSync(join(a, 'specs', '901-fixture-urls'), { recursive: true });
      writeFileSync(join(a, 'specs', '901-fixture-urls', 'handoff.md'), '# hand-off\n');
      const rows = collect(f.repo, env()).rows;
      assert.equal(rows.find((x) => x.path === a).handoff, true);
      assert.equal(rows.find((x) => x.path === b).handoff, false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('still lists every row when gh fails, with the PR state unknown', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-fixture-urls');
      quietCommit(a, 120);
      const report = collect(f.repo, env({ gh: () => { throw new Error('gh: not logged in'); } }));
      const r = report.rows.find((x) => x.path === a);
      assert.equal(r.pr, 'unknown');
      assert.equal(r.verdict, 'stale');
      assert.deepEqual(report.plan, []);
      assert.equal(report.rows.length, 2);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe('--fix and claim', () => {
  it('accepts a tail claim', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      assert.equal(main(['claim', a, 'tail'], { now: NOW }), 0);
      assert.equal(JSON.parse(readFileSync(join(a, '.specify', '.cache', 'watch-claim.json'), 'utf8')).fix, 'tail');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('unlocks a dead lock, removes a merged clean worktree, prunes a deleted one, and leaves the rest alone', () => {
    const f = fixture();
    try {
      const dead = f.add('agent-dead', '901-a');
      quietCommit(dead, 120);
      git(f.repo, 'worktree', 'lock', '--reason', 'claude agent agent-dead (pid 999999 start Sun Oct  4 08:07:18 2026)', dead);
      const merged = f.add('agent-merged', '902-b');
      const dirty = f.add('agent-dirty', '903-c');
      writeFileSync(join(dirty, 'wip.txt'), 'x\n');
      const gone = f.add('agent-gone', '904-d');
      rmSync(gone, { recursive: true, force: true });
      const heads = { '902-b': git(merged, 'rev-parse', 'HEAD'), '903-c': git(dirty, 'rev-parse', 'HEAD') };
      const report = collect(f.repo, env({
        gh: () => [
          pr({ number: 22, headRefName: '902-b', state: 'MERGED', headRefOid: heads['902-b'] }),
          pr({ number: 23, headRefName: '903-c', state: 'MERGED', headRefOid: heads['903-c'] }),
        ],
      }));
      const actions = applyFixes(f.repo, report);
      assert.equal(actions.filter((a) => a.ok).length, 3, JSON.stringify(actions));
      const list = git(f.repo, 'worktree', 'list', '--porcelain');
      assert.ok(!list.includes('locked'), 'the dead lock is released');
      assert.ok(!existsSync(merged), 'the merged clean worktree is removed');
      assert.ok(!list.includes('agent-gone'), 'the deleted worktree is pruned');
      assert.ok(existsSync(join(dirty, 'wip.txt')), 'the dirty worktree is kept');
      assert.ok(existsSync(join(f.repo, 'README.md')), 'the main worktree is kept');
      const branches = git(f.repo, 'branch', '--format=%(refname:short)').split('\n');
      for (const b of ['901-a', '902-b', '903-c', '904-d']) assert.ok(branches.includes(b), `branch ${b} kept`);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('releases and prunes a deleted worktree whose agent lock is dead, but keeps one whose agent is alive', () => {
    const f = fixture();
    try {
      const dead = f.add('agent-dead-gone', '907-dead-gone');
      const held = f.add('agent-held-gone', '908-held-gone');
      git(f.repo, 'worktree', 'lock', '--reason', 'claude agent x (pid 999999 start Sun Oct  4 08:07:18 2026)', dead);
      git(f.repo, 'worktree', 'lock', '--reason', 'claude agent y (pid 4242 start Sun Oct  4 08:07:18 2026)', held);
      rmSync(dead, { recursive: true, force: true });
      rmSync(held, { recursive: true, force: true });
      const report = collect(f.repo, env({ alive: (pid) => pid === 4242 }));
      assert.deepEqual(report.prunable, [dead]);
      applyFixes(f.repo, report);
      const list = git(f.repo, 'worktree', 'list', '--porcelain');
      assert.ok(!list.includes('agent-dead-gone'), 'the dead agent\'s deleted worktree is pruned');
      assert.ok(list.includes('agent-held-gone'), 'the live agent\'s record is kept');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('removes a merged clean worktree whose subagent went quiet, though the session that started it still runs', () => {
    const f = fixture();
    try {
      const done = f.add('agent-done', '909-done');
      quietCommit(done, 120);
      git(f.repo, 'worktree', 'lock', '--reason', 'claude agent agent-done (pid 4242 start Sun Oct  4 08:07:18 2026)', done);
      const sha = git(done, 'rev-parse', 'HEAD');
      const report = collect(f.repo, env({ alive: (pid) => pid === 4242, gh: () => [pr({ number: 9, headRefName: '909-done', state: 'MERGED', headRefOid: sha })] }));
      const r = report.rows.find((x) => x.path === done);
      assert.equal(r.holder, 'none');
      assert.equal(r.fix, 'remove-worktree');
      const actions = applyFixes(f.repo, report);
      assert.ok(actions.every((a) => a.ok), JSON.stringify(actions));
      assert.ok(!existsSync(done));
      assert.ok(git(f.repo, 'branch', '--format=%(refname:short)').split('\n').includes('909-done'));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('never unlocks a lock whose agent is alive, or a lock set by hand', () => {
    const f = fixture();
    try {
      const held = f.add('agent-held', '905-held');
      const byHand = f.add('agent-by-hand', '906-by-hand');
      quietCommit(held, 120);
      quietCommit(byHand, 120);
      git(f.repo, 'worktree', 'lock', '--reason', 'claude agent agent-held (pid 4242 start Sun Oct  4 08:07:18 2026)', held);
      git(f.repo, 'worktree', 'lock', '--reason', 'kept while I look at it', byHand);
      const report = collect(f.repo, env({ alive: (pid) => pid === 4242 }));
      assert.deepEqual(applyFixes(f.repo, report), []);
      const locked = git(f.repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('locked'));
      assert.equal(locked.length, 2);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('does nothing and writes nothing on a pass with nothing to fix', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      const before = statSync(join(f.repo, '.git')).mtimeMs;
      const actions = applyFixes(f.repo, collect(f.repo, env()));
      assert.deepEqual(actions, []);
      assert.ok(!existsSync(join(a, '.specify', '.cache', 'watch-claim.json')));
      assert.equal(statSync(join(f.repo, '.git')).mtimeMs, before);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('writes a claim git ignores, which makes the holder live until it ages out', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      quietCommit(a, 120);
      writeClaim(a, 'resume', NOW - 5 * MIN);
      const claim = JSON.parse(readFileSync(join(a, '.specify', '.cache', 'watch-claim.json'), 'utf8'));
      assert.equal(claim.fix, 'resume');
      assert.equal(git(a, 'status', '--porcelain'), '');
      let r = collect(f.repo, env()).rows.find((x) => x.path === a);
      assert.equal(r.holder, 'live');
      assert.equal(r.verdict, 'ok');
      r = collect(f.repo, env({ now: NOW + 60 * MIN })).rows.find((x) => x.path === a);
      assert.equal(r.verdict, 'stale');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe('the command, started from a path with a space or through a symlink', () => {
  it('still runs', () => {
    const f = fixture();
    try {
      const dir = join(f.root, 'with space', '.claude', 'scripts');
      mkdirSync(dir, { recursive: true });
      for (const name of ['watch.mjs', 'run-state.mjs']) writeFileSync(join(dir, name), readFileSync(join(import.meta.dirname, name)));
      mkdirSync(join(f.root, 'with space', '.claude', 'scripts', 'lib'), { recursive: true });
      for (const name of ['feature.mjs', 'watch-wait.mjs']) writeFileSync(join(dir, 'lib', name), readFileSync(join(import.meta.dirname, 'lib', name)));
      mkdirSync(join(dir, 'pr-test'));
      for (const name of ['carry.mjs', 'post.mjs', 'findings.mjs', 'qa-run.mjs']) writeFileSync(join(dir, 'pr-test', name), readFileSync(join(import.meta.dirname, 'pr-test', name)));
      mkdirSync(join(f.root, 'with space', 'scripts'));
      writeFileSync(join(f.root, 'with space', 'scripts', 'docs-only.ts'), readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'docs-only.ts')));
      symlinkSync(join(f.root, 'with space'), join(f.root, 'linked'));
      for (const script of [join(dir, 'watch.mjs'), join(f.root, 'linked', '.claude', 'scripts', 'watch.mjs')]) {
        const out = execFileSync('node', [script, '--json'], { cwd: f.repo, encoding: 'utf8', env: { ...process.env, GH_TOKEN: '' } });
        assert.ok(JSON.parse(out).rows.length >= 1, script);
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe('the command', () => {
  const capture = (fn) => {
    const out = [];
    const log = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      return { status: fn(), out: out.join('\n') };
    } finally {
      console.log = log;
    }
  };

  it('prints rows, QA runs and the dispatch plan as JSON', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      quietCommit(a, 120);
      const { status, out } = capture(() => main(['--json'], { cwd: f.repo, ...env() }));
      assert.equal(status, 0);
      const parsed = JSON.parse(out);
      assert.equal(parsed.rows.length, 2);
      assert.deepEqual(parsed.qaRuns, []);
      assert.equal(parsed.plan[0].path, a);
      assert.equal(parsed.plan[0].fix, 'resume');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('prints a board line per worktree, and refuses an unknown flag', () => {
    const f = fixture();
    try {
      f.add('agent-a', '901-a');
      const { status, out } = capture(() => main([], { cwd: f.repo, ...env() }));
      assert.equal(status, 0);
      assert.match(out, /901-a/);
      assert.ok(out.includes(join(f.root, 'agent-a')), 'the full path');
      assert.match(out, /\d+m commit/);
      assert.equal(capture(() => main(['--frobnicate'], { cwd: f.repo, ...env() })).status, 1);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe('the QA cap', () => {
  it('reads SPECKIT_QA_CAP, so the cap is configuration and not code', () => {
    assert.equal(qaCapFrom({ SPECKIT_QA_CAP: '6' }), 6);
    assert.equal(qaCapFrom({ SPECKIT_QA_CAP: '1' }), 1);
  });

  it('falls back to the default when the value is unset or not a positive whole number', () => {
    for (const v of [undefined, '', '0', '-3', '2.5', 'many', ' 4x']) assert.equal(qaCapFrom({ SPECKIT_QA_CAP: v }), QA_CAP, String(v));
    assert.equal(qaCapFrom({}), QA_CAP);
  });

  it('dispatches up to the cap it is given', () => {
    const stale = (path, minutesQuiet) => ({ path, verdict: 'stale', fix: 'rerun-qa', activity: { at: NOW - minutesQuiet * MIN }, claim: null });
    const rows = [stale('a', 50), stale('b', 90), stale('c', 70)];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, qaCap: 1, now: NOW }).map((p) => p.path), ['b']);
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, qaCap: 2, now: NOW }).map((p) => p.path), ['b', 'c']);
  });

  it('prints the cap it was given in the header and the JSON', () => {
    const f = fixture();
    const out = [];
    const log = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      assert.equal(main([], { cwd: f.repo, ...env(), qaCap: 3 }), 0);
      assert.equal(main(['--json'], { cwd: f.repo, ...env(), qaCap: 3 }), 0);
    } finally {
      console.log = log;
      rmSync(f.root, { recursive: true, force: true });
    }
    assert.match(out[0], /QA runs 0\/3 /);
    assert.equal(JSON.parse(out.at(-1)).qaCap, 3);
  });
});

describe('a ready PR whose head is docs-only since its last verdict', () => {
  const quiet = { phase: 'qa', activity: { at: NOW - 120 * MIN, source: 'commit' } };
  const ready = summarizePr(pr({ statusCheckRollup: [check('SUCCESS')] }));
  const opts = { now: NOW, thresholds: DEFAULT_THRESHOLDS };
  const FROM = 'f'.repeat(40);

  it('carries the verdict instead of re-running QA', () => {
    const r = fixOf(row({ ...quiet, pr: ready, carry: { from: FROM, head: 'abc' } }), opts);
    assert.equal(r.fix, 'carry-review');
    assert.equal(r.verdict, 'stale');
    assert.match(r.reason, /docs-only since fffffff/);
    assert.equal(fixOf(row({ ...quiet, pr: ready, carry: { from: FROM, head: 'abc', reason: 'apps/x changed' } }), opts).fix, 'rerun-qa');
  });

  it('never dispatches an agent for a carry: --fix applies it', () => {
    const r = { path: 'a', verdict: 'stale', fix: 'carry-review', activity: { at: NOW - 90 * MIN }, claim: null };
    assert.deepEqual(dispatchPlan([r], { qaLive: 0, now: NOW }), []);
  });

  it('looks for a carry only on a row that would re-run QA, and posts it on --fix', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-fixture-urls');
      const b = f.add('agent-b', '902-draft');
      quietCommit(a, 120);
      quietCommit(b, 120);
      const head = git(a, 'rev-parse', 'HEAD');
      const asked = [];
      const report = collect(f.repo, env({
        gh: () => [pr({ headRefOid: head }), pr({ number: 22, headRefName: '902-draft', isDraft: true })],
        carry: (n) => (asked.push(n), { from: FROM, head }),
      }));
      assert.deepEqual(asked, [21]);
      const row = report.rows.find((x) => x.path === a);
      assert.equal(row.fix, 'carry-review');
      assert.ok(!report.plan.some((p) => p.path === a), 'a carry is not dispatched to an agent');
      const posted = [];
      const actions = applyFixes(f.repo, report, { postCarry: (c) => (posted.push(c), {}) });
      assert.deepEqual(posted, [{ pr: 21, from: FROM, head }]);
      assert.ok(actions.some((x) => x.ok && /carry #21/.test(x.what)), JSON.stringify(actions));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('re-runs QA when the carry lookup fails or finds none', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-fixture-urls');
      quietCommit(a, 120);
      const head = git(a, 'rev-parse', 'HEAD');
      const gh = () => [pr({ headRefOid: head })];
      const thrown = collect(f.repo, env({ gh, carry: () => { throw new Error('gh down'); } }));
      assert.equal(thrown.rows.find((x) => x.path === a).fix, 'rerun-qa');
      const none = collect(f.repo, env({ gh, carry: () => ({ reason: 'no earlier commit has an agent-review success' }) }));
      assert.equal(none.rows.find((x) => x.path === a).fix, 'rerun-qa');
      assert.equal(collect(f.repo, env({ gh })).rows.find((x) => x.path === a).fix, 'rerun-qa');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports a carry that could not be posted as a failed action', () => {
    const r = { path: '/x', fix: 'carry-review', holder: 'none', pr: { number: 21 }, carry: { from: FROM, head: 'abc' } };
    const actions = applyFixes('/nonexistent', { rows: [r], prunable: [], orphanLocks: [] }, { postCarry: () => { throw new Error('HTTP 403'); } });
    assert.deepEqual(actions, [{ what: 'carry #21 from fffffff', ok: false, error: 'HTTP 403' }]);
  });
});

describe('a handed-off ready PR waits for CI and its QA run with no agent alive', () => {
  const opts = { now: NOW, thresholds: DEFAULT_THRESHOLDS };
  const HEAD = 'd'.repeat(40);
  const ready = (entries) => summarizePr(pr({ headRefOid: HEAD, statusCheckRollup: entries }));
  const handed = (over = {}) =>
    row({ phase: 'qa', head: HEAD, handoff: true, qaRun: { id: '77', head: HEAD, lap: 1 }, activity: { at: NOW - 5 * MIN, source: 'commit' }, ...over });

  it('waits, with no fix, while CI is pending, even long past the quiet threshold', () => {
    for (const at of [NOW - 5 * MIN, NOW - 300 * MIN]) {
      const r = fixOf(handed({ activity: { at, source: 'commit' }, pr: ready([check(null, 'IN_PROGRESS')]), qaRunState: { status: 'completed', conclusion: 'success' } }), opts);
      assert.equal(r.verdict, 'waiting');
      assert.equal(r.fix, null);
      assert.match(r.reason, /CI/);
    }
  });

  it('waits while the QA run is queued or in progress, even long past the quiet threshold', () => {
    for (const state of [{ status: 'queued' }, { status: 'in_progress' }]) {
      const r = fixOf(handed({ activity: { at: NOW - 300 * MIN, source: 'commit' }, pr: ready([check('SUCCESS')]), qaRunState: state }), opts);
      assert.equal(r.verdict, 'waiting', JSON.stringify(state));
      assert.equal(r.fix, null);
      assert.match(r.reason, /QA run 77/);
    }
  });

  it('waits on a run that cannot be read only until the quiet threshold, then falls back to the tail', () => {
    for (const state of [null, undefined]) {
      const recent = fixOf(handed({ pr: ready([check('SUCCESS')]), qaRunState: state }), opts);
      assert.equal(recent.verdict, 'waiting', JSON.stringify(state));
      assert.match(recent.reason, /QA run 77 \(state unreadable\)/);
      const quiet = fixOf(handed({ activity: { at: NOW - 300 * MIN, source: 'commit' }, pr: ready([check('SUCCESS')]), qaRunState: state }), opts);
      assert.equal(quiet.fix, 'tail', JSON.stringify(state));
    }
  });

  it('offers the merge, not the tail, once the head already has agent-review success', () => {
    const passed = summarizePr(pr({ headRefOid: HEAD, statusCheckRollup: [check('SUCCESS'), review('SUCCESS')] }));
    assert.equal(passed.agentReview, 'success');
    const r = fixOf(handed({ activity: { at: NOW - 300 * MIN, source: 'commit' }, clean: true, pr: passed, qaRunState: { status: 'completed' } }), opts);
    assert.equal(r.fix, 'merge');
  });

  it('offers the tail at once when CI has finished, passing or failing, and the run has completed', () => {
    for (const ci of [check('SUCCESS'), check('FAILURE')]) {
      const r = fixOf(handed({ pr: ready([ci]), qaRunState: { status: 'completed', conclusion: 'failure' } }), opts);
      assert.equal(r.verdict, 'stale');
      assert.equal(r.fix, 'tail');
    }
  });

  it('leaves a held worktree alone even when both have finished', () => {
    const r = fixOf(handed({ holder: 'live', pr: ready([check('SUCCESS')]), qaRunState: { status: 'completed' } }), opts);
    assert.equal(r.fix, null);
  });

  it('waits on a PR with no checks only until the quiet threshold, then falls back to the tail', () => {
    const none = summarizePr(pr({ headRefOid: HEAD, statusCheckRollup: [] }));
    assert.equal(fixOf(handed({ pr: none, qaRunState: { status: 'completed' } }), opts).verdict, 'waiting');
    assert.equal(fixOf(handed({ activity: { at: NOW - 120 * MIN, source: 'commit' }, pr: none, qaRunState: { status: 'completed' } }), opts).fix, 'tail');
  });

  it('keeps today\'s rule with no run recorded, or a run about an older head', () => {
    for (const qaRun of [null, { id: '77', head: 'e'.repeat(40), lap: 1 }]) {
      const recent = fixOf(handed({ qaRun, pr: ready([check(null, 'IN_PROGRESS')]) }), opts);
      assert.equal(recent.verdict, 'ok');
      const quiet = fixOf(handed({ qaRun, activity: { at: NOW - 120 * MIN, source: 'commit' }, pr: ready([check(null, 'IN_PROGRESS')]) }), opts);
      assert.equal(quiet.fix, 'tail');
    }
  });

  it('dispatches nothing for a waiting row', () => {
    const waiting = { ...handed(), verdict: 'waiting', fix: null };
    assert.deepEqual(dispatchPlan([waiting], { qaLive: 0 }), []);
  });

  it('reads the run line from the note and asks for the run only for a ready PR at the recorded head', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-fixture-urls');
      quietCommit(a, 5);
      const head = git(a, 'rev-parse', 'HEAD');
      mkdirSync(join(a, 'specs', '901-fixture-urls'), { recursive: true });
      writeFileSync(join(a, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/901-fixture-urls' }));
      writeFileSync(join(a, 'specs', '901-fixture-urls', 'handoff.md'), `# hand-off\n- QA run: 77 · head ${head} · lap 1 · https://x/runs/77\n`);
      const asked = [];
      const runOf = (id) => {
        asked.push(id);
        return { status: 'in_progress', conclusion: '' };
      };
      let r = collect(f.repo, env({ gh: () => [pr({ headRefOid: head, statusCheckRollup: [check('SUCCESS')] })], runOf })).rows.find((x) => x.path === a);
      assert.deepEqual(r.qaRun, { id: '77', head, lap: 1 });
      assert.deepEqual(asked, ['77']);
      assert.equal(r.verdict, 'waiting');
      r = collect(f.repo, env({ gh: () => [pr({ headRefOid: head, statusCheckRollup: [check('SUCCESS')] })], runOf: () => ({ status: 'completed', conclusion: 'success' }) })).rows.find((x) => x.path === a);
      assert.equal(r.fix, 'tail');
      asked.length = 0;
      collect(f.repo, env({ gh: () => [pr({ headRefOid: 'f'.repeat(40) })], runOf }));
      collect(f.repo, env({ gh: () => [pr({ headRefOid: head, isDraft: true })], runOf }));
      assert.deepEqual(asked, []);
      r = collect(f.repo, env({ gh: () => [pr({ headRefOid: head })], runOf: () => { throw new Error('gh: 404'); } })).rows.find((x) => x.path === a);
      assert.equal(r.verdict, 'waiting');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('counts waiting rows in the board header', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-fixture-urls');
      quietCommit(a, 5);
      const head = git(a, 'rev-parse', 'HEAD');
      mkdirSync(join(a, 'specs', '901-fixture-urls'), { recursive: true });
      writeFileSync(join(a, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/901-fixture-urls' }));
      writeFileSync(join(a, 'specs', '901-fixture-urls', 'handoff.md'), `- QA run: 77 · head ${head} · lap 1 · u\n`);
      const lines = [];
      const log = console.log;
      console.log = (s) => lines.push(s);
      try {
        main([], { cwd: f.repo, now: NOW, gh: () => [pr({ headRefOid: head })], alive: () => false, pidAlive: () => false, runOf: () => ({ status: 'queued' }) });
      } finally {
        console.log = log;
      }
      assert.match(lines.join('\n'), /waiting 1/);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

// The gate answers the one question a scheduled pass asks first, with no model:
// would this pass do anything? Its verdict is the full pass's, never looser.
const captured = () => {
  const out = [];
  const err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.join(' ')));
  return { out, err };
};

const deadLock = (f, path) => git(f.repo, 'worktree', 'lock', '--reason', 'claude agent x (pid 999999 start Sun Oct  4 08:07:18 2026)', path);

describe('--gate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exits 0 and prints nothing when a pass would do nothing', () => {
    const f = fixture();
    try {
      f.add('agent-a', '901-a');
      const io = captured();
      assert.equal(main(['--gate'], { cwd: f.repo, ...env() }), 0);
      assert.deepEqual(io.out, []);
      assert.deepEqual(io.err, []);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('fires with the agent fix a stale worktree needs', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      quietCommit(a, 120);
      const io = captured();
      assert.equal(main(['--gate'], { cwd: f.repo, ...env() }), 2);
      assert.equal(io.out.length, 1);
      assert.match(io.out[0], /^resume /);
      assert.ok(io.out[0].includes(a));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('fires on a dead holder, and leaves its lock in place', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      deadLock(f, a);
      const io = captured();
      assert.equal(main(['--gate'], { cwd: f.repo, ...env() }), 2);
      assert.ok(io.out.some((l) => l.startsWith('unlock ') && l.includes(a)), io.out.join('\n'));
      assert.ok(git(f.repo, 'worktree', 'list', '--porcelain').includes('locked'));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('fires on a finished clean worktree to remove, and keeps it', () => {
    const f = fixture();
    try {
      const done = f.add('agent-done', '902-b');
      const sha = git(done, 'rev-parse', 'HEAD');
      const io = captured();
      const code = main(['--gate'], { cwd: f.repo, ...env({ gh: () => [pr({ number: 22, headRefName: '902-b', state: 'MERGED', headRefOid: sha })] }) });
      assert.equal(code, 2);
      assert.ok(io.out.some((l) => l.startsWith('remove-worktree ') && l.includes(done)), io.out.join('\n'));
      assert.ok(existsSync(done));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('fires on a deleted worktree to prune and its orphan lock', () => {
    const f = fixture();
    try {
      const gone = f.add('agent-gone', '904-d');
      deadLock(f, gone);
      rmSync(gone, { recursive: true, force: true });
      const io = captured();
      assert.equal(main(['--gate'], { cwd: f.repo, ...env() }), 2);
      assert.ok(io.out.some((l) => l.startsWith('unlock ') && l.includes(gone)), io.out.join('\n'));
      assert.ok(io.out.some((l) => l.startsWith('prune ') && l.includes(gone)), io.out.join('\n'));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('stays silent for an item a live agent has already claimed', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      quietCommit(a, 120);
      writeClaim(a, 'resume', NOW - 5 * MIN);
      const io = captured();
      assert.equal(main(['--gate'], { cwd: f.repo, ...env() }), 0);
      assert.deepEqual(io.out, []);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('fires exactly when the full pass would dispatch or apply something', () => {
    const states = {
      idle: () => {},
      stale: (f) => quietCommit(f.add('agent-a', '901-a'), 120),
      claimed: (f) => {
        const a = f.add('agent-a', '901-a');
        quietCommit(a, 120);
        writeClaim(a, 'resume', NOW - 5 * MIN);
      },
      dead: (f) => deadLock(f, f.add('agent-a', '901-a')),
      dirtyDone: (f) => writeFileSync(join(f.add('agent-a', '901-a'), 'wip.txt'), 'x\n'),
      gone: (f) => rmSync(f.add('agent-gone', '904-d'), { recursive: true, force: true }),
    };
    for (const [name, arrange] of Object.entries(states)) {
      const f = fixture();
      try {
        arrange(f);
        const merged = (branch) => ({ number: 30, headRefName: branch, state: 'MERGED', headRefOid: 'zzz' });
        const deps = { cwd: f.repo, ...env({ gh: () => (name === 'dirtyDone' ? [pr(merged('901-a'))] : []) }) };
        const io = captured();
        const gate = main(['--gate'], deps);
        io.out.length = 0;
        assert.equal(main(['--fix', '--json'], deps), 0);
        const full = JSON.parse(io.out.join('\n'));
        vi.restoreAllMocks();
        assert.equal(gate === 2, full.plan.length > 0 || full.actions.length > 0, name);
        assert.ok(gate === 0 || gate === 2, name);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    }
  });

  it('is an error outside a repository and with --fix, --json or --wait', () => {
    const f = fixture();
    try {
      captured();
      const plain = join(f.root, 'plain');
      mkdirSync(plain);
      assert.equal(main(['--gate'], { cwd: plain, ...env() }), 1);
      for (const other of ['--fix', '--json', '--wait']) assert.equal(main(['--gate', other], { cwd: f.repo, ...env() }), 1, other);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe('dueFixes', () => {
  it('lists every action the no-agent fixer would take, in its order', () => {
    const report = {
      rows: [
        row({ path: '/w/dead', holder: 'dead' }),
        row({ path: '/w/done', fix: 'remove-worktree', clean: true }),
        row({ path: '/w/dirty', fix: 'remove-worktree', clean: false }),
        row({ path: '/w/main', main: true, fix: 'remove-worktree', clean: true }),
        row({ path: '/w/carry', fix: 'carry-review', pr: { number: 5 }, carry: { from: 'abcdef1234', head: 'def' } }),
        row({ path: '/w/nocarry', fix: 'carry-review', pr: { number: 6 }, carry: null }),
      ],
      orphanLocks: ['/w/orphan'],
      prunable: ['/w/orphan', '/w/gone'],
      plan: [],
    };
    assert.deepEqual(
      dueFixes(report).map((d) => `${d.fix} ${d.path}`),
      ['unlock /w/dead', 'remove-worktree /w/done', 'carry-review /w/carry', 'unlock /w/orphan', 'prune /w/orphan, /w/gone'],
    );
  });

  it('is empty for an empty board', () => {
    assert.deepEqual(dueFixes({ rows: [], orphanLocks: [], prunable: [], plan: [] }), []);
  });
});

// The wait is the schedule: it polls the gate outside the model and returns only
// when the gate fires, an error happens, or its time is up.
const commonDir = (f) => git(f.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir');
const record = (f) => join(commonDir(f), 'speckit-watch-wait.pid');
const waitCommand = 'node /repo/.claude/scripts/watch.mjs --wait';

describe('--wait', () => {
  afterEach(() => vi.restoreAllMocks());

  it('polls while an interval fits in its limit, then says to re-arm', () => {
    const f = fixture();
    try {
      f.add('agent-a', '901-a');
      const io = captured();
      const sleeps = [];
      const code = main(['--wait', '--every', '15', '--for', '110'], { cwd: f.repo, ...env({ sleep: (ms) => sleeps.push(ms) }) });
      assert.equal(code, 0);
      assert.deepEqual(sleeps, Array(7).fill(15 * MIN));
      assert.deepEqual(io.out, ['watch: idle for 105 min; re-arm the wait']);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('waits 15 minutes for 110 by default', () => {
    const f = fixture();
    try {
      captured();
      const sleeps = [];
      assert.equal(main(['--wait'], { cwd: f.repo, ...env({ sleep: (ms) => sleeps.push(ms) }) }), 0);
      assert.deepEqual(sleeps, Array(7).fill(15 * MIN));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('never sleeps past its limit', () => {
    const f = fixture();
    try {
      captured();
      const sleeps = [];
      assert.equal(main(['--wait', '--every', '15', '--for', '20'], { cwd: f.repo, ...env({ sleep: (ms) => sleeps.push(ms) }) }), 0);
      assert.deepEqual(sleeps, [15 * MIN]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('ends with the gate lines as soon as a poll fires', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      const io = captured();
      let sleeps = 0;
      const sleep = () => {
        sleeps++;
        if (sleeps === 2) deadLock(f, a);
      };
      assert.equal(main(['--wait'], { cwd: f.repo, ...env({ sleep }) }), 2);
      assert.equal(sleeps, 2);
      assert.ok(io.out.some((l) => l.startsWith('unlock ') && l.includes(a)), io.out.join('\n'));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('holds the record while it waits and removes it however it ends', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      captured();
      const seen = [];
      const sleep = () => {
        seen.push(readFileSync(record(f), 'utf8').trim());
        deadLock(f, a);
      };
      assert.equal(main(['--wait'], { cwd: f.repo, ...env({ sleep }) }), 2);
      assert.deepEqual(seen, [String(process.pid)]);
      assert.ok(!existsSync(record(f)));
      git(f.repo, 'worktree', 'unlock', a);
      assert.equal(main(['--wait', '--every', '1', '--for', '1'], { cwd: f.repo, ...env({ sleep: () => {} }) }), 0);
      assert.ok(!existsSync(record(f)));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('ends with the error as soon as a poll fails, and removes its record', () => {
    const f = fixture();
    try {
      const a = f.add('agent-a', '901-a');
      git(f.repo, 'worktree', 'lock', '--reason', 'claude agent x (pid 4242 start Sun Oct  4 08:07:18 2026)', a);
      const io = captured();
      let polls = 0;
      const alive = () => {
        if (polls === 2) throw new Error('ps went away');
        return true;
      };
      assert.equal(main(['--wait'], { cwd: f.repo, ...env({ alive, sleep: () => polls++ }) }), 1);
      assert.equal(polls, 2);
      assert.ok(io.err.some((l) => l.includes('ps went away')), io.err.join('\n'));
      assert.ok(!existsSync(record(f)));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('refuses to run beside a live wait, without polling or touching its record', () => {
    const f = fixture();
    try {
      writeFileSync(record(f), '4242\n');
      const io = captured();
      let slept = false;
      const deps = env({ sleep: () => (slept = true), commandOf: (pid) => (pid === 4242 ? waitCommand : null) });
      assert.equal(main(['--wait'], { cwd: f.repo, ...deps }), 0);
      assert.deepEqual(io.out, ['watch: a wait is already armed (pid 4242)']);
      assert.equal(slept, false);
      assert.equal(readFileSync(record(f), 'utf8').trim(), '4242');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('takes over a record whose process is gone or is something else', () => {
    for (const command of [null, 'vim notes.txt']) {
      const f = fixture();
      try {
        writeFileSync(record(f), '4242\n');
        captured();
        const seen = [];
        const deps = env({ sleep: () => seen.push(readFileSync(record(f), 'utf8').trim()), commandOf: () => command });
        assert.equal(main(['--wait', '--every', '15', '--for', '15'], { cwd: f.repo, ...deps }), 0, String(command));
        assert.deepEqual(seen, [String(process.pid)]);
        vi.restoreAllMocks();
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    }
  });

  it('rejects a limit shorter than its interval, a non-positive number and other flags', () => {
    const f = fixture();
    try {
      captured();
      let slept = false;
      const deps = { cwd: f.repo, ...env({ sleep: () => (slept = true) }) };
      for (const argv of [
        ['--wait', '--every', '15', '--for', '10'],
        ['--wait', '--every', '0'],
        ['--wait', '--for', '-5'],
        ['--wait', '--every', 'x'],
        ['--wait', '--json'],
        ['--wait', '--fix'],
        ['--every', '15'],
      ]) assert.equal(main(argv, deps), 1, argv.join(' '));
      assert.equal(slept, false);
      assert.ok(!existsSync(record(f)));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe('waitHolder', () => {
  it('names the pid of a live wait, and nothing for a missing, dead or foreign record', () => {
    const f = fixture();
    try {
      assert.equal(waitHolder(f.repo, { commandOf: () => waitCommand }), null);
      writeFileSync(record(f), '4242\n');
      assert.equal(waitHolder(f.repo, { commandOf: (pid) => (pid === 4242 ? waitCommand : null) }), 4242);
      assert.equal(waitHolder(f.repo, { commandOf: () => null }), null);
      assert.equal(waitHolder(f.repo, { commandOf: () => 'node .claude/scripts/watch.mjs --json' }), null);
      writeFileSync(record(f), 'garbage\n');
      assert.equal(waitHolder(f.repo, { commandOf: () => waitCommand }), null);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
