import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  DEFAULT_THRESHOLDS,
  QA_CAP,
  applyFixes,
  collect,
  dispatchPlan,
  fixOf,
  holderOf,
  lockPid,
  main,
  parseStale,
  parseWorktrees,
  phaseOf,
  scratchRun,
  summarizePr,
  writeClaim,
} from './watch.mjs';

const MIN = 60_000;
const NOW = Date.parse('2026-10-04T12:00:00Z');
const DEAD_LOCK = 'claude agent agent-x (pid 999999 start Sun Oct  4 08:07:18 2026)';
const PHASES = ['planning', 'tests', 'development', 'review', 'qa', 'merging', 'blocked', 'done'];

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

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-adv-')));
  roots.push(root);
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
  const scratch = (prNumber, pid) => {
    const path = join(root, `mf-prtest-${prNumber}-abcdef1-${pid}`);
    git(repo, 'worktree', 'add', '-q', '--detach', path);
    return path;
  };
  return { root, repo, add, scratch };
}

const quietCommit = (path, minutesAgo) => {
  const date = new Date(NOW - minutesAgo * MIN).toISOString();
  writeFileSync(join(path, `f${minutesAgo}.txt`), 'x\n');
  git(path, 'add', '.');
  execFileSync('git', ['commit', '-q', '-m', 'w'], { cwd: path, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
};

const lock = (f, path, reason) => (reason === undefined ? git(f.repo, 'worktree', 'lock', path) : git(f.repo, 'worktree', 'lock', '--reason', reason, path));
const head = (path) => git(path, 'rev-parse', 'HEAD');
const env = (over = {}) => ({ now: NOW, gh: () => [], alive: () => false, pidAlive: () => false, ...over });
const rowOf = (report, path) => report.rows.find((r) => r.path === path);
const listed = (f) => git(f.repo, 'worktree', 'list', '--porcelain');
const branches = (f) => git(f.repo, 'branch', '--format=%(refname:short)=%(objectname)').split('\n').sort();

function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = relative(root, p);
      if (e.isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(p);
      } else if (e.name !== 'index' && !e.name.endsWith('.lock')) {
        const s = lstatSync(p);
        out[rel] = `${s.size}:${s.mtimeMs}`;
      }
    }
  };
  walk(root);
  return out;
}

const run = (fn) => {
  const out = [];
  const err = [];
  const { log, error, warn } = console;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  console.warn = (...a) => err.push(a.join(' '));
  try {
    return { status: fn(), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
    console.warn = warn;
  }
};

describe('worktree records, hostile input', () => {
  it('reads nothing from empty output', () => {
    assert.deepEqual(parseWorktrees(''), []);
    assert.deepEqual(parseWorktrees('\n\n'), []);
  });

  it('keeps spaces in a path and slashes in a branch name', () => {
    const [w] = parseWorktrees(['worktree /tmp/my repo/wt one', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/chore/slash-name', ''].join('\n'));
    assert.equal(w.path, '/tmp/my repo/wt one');
    assert.equal(w.branch, 'chore/slash-name');
  });

  it('gives a detached worktree no branch', () => {
    const [w] = parseWorktrees(['worktree /a', 'HEAD ' + 'a'.repeat(40), 'detached', ''].join('\n'));
    assert.ok(w.branch === null || w.branch === undefined || w.branch === '');
  });

  it('treats a lock with no reason as a lock, not as no lock', () => {
    const [w] = parseWorktrees(['worktree /a', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/x', 'locked', ''].join('\n'));
    assert.notEqual(w.lock, null);
    assert.notEqual(w.lock, undefined);
    assert.notEqual(w.lock, false);
  });

  it('marks only the first record as the main worktree', () => {
    const text = ['worktree /a', 'HEAD ' + '1'.repeat(40), 'branch refs/heads/main', '', 'worktree /b', 'HEAD ' + '2'.repeat(40), 'branch refs/heads/x', ''].join('\n');
    assert.deepEqual(parseWorktrees(text).map((w) => w.main), [true, false]);
  });
});

describe('scratch worktree names, hostile input', () => {
  it('rejects names that only look like a PR-tester checkout', () => {
    assert.equal(scratchRun('/tmp/mf-prtest-12-e57edba'), null);
    assert.equal(scratchRun('/tmp/mf-prtest-abc-e57edba-4242'), null);
    assert.equal(scratchRun('/tmp/mf-prtest--e57edba-4242'), null);
    assert.equal(scratchRun('/tmp/mf-prtest-12-e57edba-4242x'), null);
    assert.equal(scratchRun('/tmp/my-mf-prtest-12-e57edba-4242'), null);
    assert.equal(scratchRun(''), null);
  });

  it('reads a scratch path that ends in a slash', () => {
    assert.deepEqual(scratchRun('/tmp/mf-prtest-12-e57edba-4242/'), { pr: 12, pid: 4242 });
  });
});

describe('lock reasons, hostile input', () => {
  it('reads a pid only from a well-formed reason, and returns a number', () => {
    assert.equal(lockPid('claude agent a (pid 7 start x)'), 7);
    assert.equal(lockPid(''), null);
    assert.equal(lockPid(undefined), null);
    assert.equal(lockPid('waiting on pid review'), null);
    assert.equal(lockPid('claude agent a (pid abc start x)'), null);
    assert.equal(lockPid('claude agent a (pid -5 start x)'), null);
    assert.equal(lockPid('claude agent a (pid  start x)'), null);
  });

  it('does not read a pid that is zero', () => {
    assert.equal(lockPid('claude agent a (pid 0 start x)'), null);
  });
});

describe('holder, edges', () => {
  const lockText = 'claude agent a (pid 2214 start Sun Oct  4 08:07:18 2026)';
  const base = { main: false, lock: null, alive: () => false, qaLive: false, claim: null, threshold: 30, now: NOW };
  const claimAt = (ms) => ({ fix: 'resume', at: new Date(ms).toISOString() });

  it('is owner for the main worktree whatever else is said about it', () => {
    assert.equal(holderOf({ ...base, main: true, lock: lockText }), 'owner');
  });

  it('asks about the lock pid, as a number', () => {
    const seen = [];
    holderOf({ ...base, lock: lockText, alive: (pid) => { seen.push(pid); return true; } });
    assert.deepEqual(seen, [2214]);
  });

  it('keeps a claim live at exactly the threshold and drops it one millisecond later', () => {
    assert.equal(holderOf({ ...base, claim: claimAt(NOW - 30 * MIN) }), 'live');
    assert.equal(holderOf({ ...base, claim: claimAt(NOW - 30 * MIN - 1) }), 'none');
  });

  it('ignores a claim that is malformed', () => {
    for (const claim of [{}, { fix: 'resume' }, { fix: 'resume', at: 'garbage' }, { fix: 'resume', at: null }, { fix: 'resume', at: {} }, 'resume', 7, []]) {
      assert.equal(holderOf({ ...base, claim }), 'none', JSON.stringify(claim));
    }
  });

  it('lets a live claim hold a worktree whose lock is dead', () => {
    assert.equal(holderOf({ ...base, lock: lockText, claim: claimAt(NOW - MIN) }), 'live');
  });

  it('is live while a QA run tests the PR even with no lock', () => {
    assert.equal(holderOf({ ...base, qaLive: true }), 'live');
  });
});

describe('PR summary, edges', () => {
  it('names a merged PR merged even when it is also marked draft', () => {
    assert.equal(summarizePr(pr({ state: 'MERGED', isDraft: true })).state, 'merged');
  });

  it('reads a missing or null rollup as no checks', () => {
    assert.equal(summarizePr(pr({ statusCheckRollup: null })).checks, 'none');
    assert.equal(summarizePr(pr({ statusCheckRollup: undefined })).checks, 'none');
  });

  it('skips null entries in the rollup', () => {
    assert.equal(summarizePr(pr({ statusCheckRollup: [null, check('SUCCESS')] })).checks, 'pass');
  });

  it('counts only the agent-review result as no check at all', () => {
    const s = summarizePr(pr({ statusCheckRollup: [review('SUCCESS')] }));
    assert.equal(s.checks, 'none');
    assert.equal(s.agentReview, 'success');
  });

  it('reads cancelled, timed-out and failed-to-start runs and an errored status as failures', () => {
    for (const entry of [check('CANCELLED'), check('TIMED_OUT'), check('STARTUP_FAILURE'), { __typename: 'StatusContext', context: 'ci/other', state: 'ERROR' }, { __typename: 'StatusContext', context: 'ci/other', state: 'FAILURE' }]) {
      assert.equal(summarizePr(pr({ statusCheckRollup: [check('SUCCESS'), entry] })).checks, 'fail', JSON.stringify(entry));
    }
  });

  it('reads a queued run and a pending status as pending', () => {
    assert.equal(summarizePr(pr({ statusCheckRollup: [check(null, 'QUEUED')] })).checks, 'pending');
    assert.equal(summarizePr(pr({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/other', state: 'PENDING' }] })).checks, 'pending');
  });

  it('lets a failure outrank a pending check', () => {
    assert.equal(summarizePr(pr({ statusCheckRollup: [check(null, 'IN_PROGRESS'), check('FAILURE')] })).checks, 'fail');
  });
});

describe('phase, precedence and the stage table', () => {
  const none = { pr: null, runState: { status: 'in-progress', phase: null }, artifacts: null, qaLive: false };
  const ready = (entries = [check('SUCCESS')]) => summarizePr(pr({ statusCheckRollup: entries }));

  it('maps every run-state phase the spec names to its stage', () => {
    const table = {
      planning: ['size', 'constitution', 'specify', 'context', 'clarify', 'plan', 'checklist', 'tasks', 'analyze'],
      tests: ['tests'],
      development: ['implement', 'converge', 'harden'],
      review: ['refresh', 'review', 'agent-context', 'retro', 'archive', 'hand-off'],
      qa: ['pr-test', 'qa'],
      merging: ['merge'],
    };
    for (const [stage, phases] of Object.entries(table)) {
      for (const phase of phases) assert.equal(phaseOf({ ...none, runState: { status: 'in-progress', phase } }), stage, phase);
    }
  });

  it('falls through to the artifacts for an unknown run-state phase', () => {
    const artifacts = { spec: true, plan: true, tasks: true, open: 2, done: 1 };
    for (const phase of ['bogus', '', 'IMPLEMENT', 42, {}, 'constructor', '__proto__']) {
      assert.equal(phaseOf({ ...none, runState: { status: 'in-progress', phase }, artifacts }), 'development', String(phase));
    }
  });

  it('reads an empty run-state as nothing recorded', () => {
    assert.equal(phaseOf({ ...none, runState: {} }), 'development');
    assert.equal(phaseOf({ ...none, runState: {}, artifacts: { spec: true, plan: true, tasks: true, open: 0, done: 3 } }), 'review');
  });

  it('is planning when any one of the three artifacts is missing', () => {
    const full = { spec: true, plan: true, tasks: true, open: 1, done: 0 };
    for (const missing of ['spec', 'plan', 'tasks']) {
      assert.equal(phaseOf({ ...none, runState: {}, artifacts: { ...full, [missing]: false } }), 'planning', missing);
    }
  });

  it('is development while any task is open, even with others done', () => {
    assert.equal(phaseOf({ ...none, runState: {}, artifacts: { spec: true, plan: true, tasks: true, open: 1, done: 40 } }), 'development');
  });

  it('is done for a merged or closed PR even with a live QA run and a blocked run-state', () => {
    for (const state of ['MERGED', 'CLOSED']) {
      assert.equal(phaseOf({ ...none, pr: summarizePr(pr({ state })), qaLive: true, runState: { status: 'blocked', phase: 'pr-test' } }), 'done', state);
    }
  });

  it('is blocked for a draft PR with a blocked run-state, and done for a draft PR with a done run-state', () => {
    const draft = summarizePr(pr({ isDraft: true }));
    assert.equal(phaseOf({ ...none, pr: draft, runState: { status: 'blocked', phase: 'implement' } }), 'blocked');
    assert.equal(phaseOf({ ...none, pr: draft, runState: { status: 'done', phase: 'archive' } }), 'done');
  });

  it('is qa, not merging, when a check is pending or failed but agent-review succeeded', () => {
    assert.equal(phaseOf({ ...none, pr: ready([check(null, 'IN_PROGRESS'), review('SUCCESS')]) }), 'qa');
    assert.equal(phaseOf({ ...none, pr: ready([check('FAILURE'), review('SUCCESS')]) }), 'qa');
  });

  it('is qa for a ready PR under a live QA run even when run-state says done', () => {
    assert.equal(phaseOf({ ...none, pr: ready(), qaLive: true, runState: { status: 'done', phase: 'archive' } }), 'qa');
  });

  it('is merging for a ready, fully passed PR even when run-state names an earlier phase', () => {
    assert.equal(phaseOf({ ...none, pr: ready([check('SUCCESS'), review('SUCCESS')]), runState: { status: 'in-progress', phase: 'implement' } }), 'merging');
  });
});

describe('stale and the fix, edges', () => {
  const opts = { now: NOW, thresholds: DEFAULT_THRESHOLDS };
  const ready = (entries) => summarizePr(pr({ statusCheckRollup: entries }));
  const quiet = { activity: { at: NOW - 600 * MIN, source: 'commit' } };

  it('applies each phase threshold exactly: quiet for the threshold is ok, one millisecond more is stale', () => {
    for (const [phase, minutes] of Object.entries(DEFAULT_THRESHOLDS).filter(([phase]) => phase !== 'done')) {
      assert.equal(fixOf(row({ phase, activity: { at: NOW - minutes * MIN, source: 'commit' } }), opts).verdict, 'ok', `${phase} at the threshold`);
      assert.equal(fixOf(row({ phase, activity: { at: NOW - minutes * MIN - 1, source: 'commit' } }), opts).verdict, 'stale', `${phase} past the threshold`);
    }
  });

  it('has the documented default thresholds', () => {
    assert.deepEqual(DEFAULT_THRESHOLDS, { planning: 30, tests: 45, development: 45, review: 30, qa: 30, merging: 30, done: 30 });
  });

  it('removes a merged worktree only past the done threshold: quiet for it is kept, one millisecond more is removed (ST-481)', () => {
    const merged = summarizePr(pr({ state: 'MERGED', headRefOid: 'abc' }));
    const at = (ms) => fixOf(row({ phase: 'done', pr: merged, head: 'abc', clean: true, activity: { at: NOW - ms, source: 'commit' } }), opts).fix;
    assert.equal(at(DEFAULT_THRESHOLDS.done * MIN), null);
    assert.equal(at(DEFAULT_THRESHOLDS.done * MIN + 1), 'remove-worktree');
  });

  it('is stale at the epoch', () => {
    assert.equal(fixOf(row({ activity: { at: 0, source: 'commit' } }), opts).verdict, 'stale');
  });

  it('treats a dead holder as not holding, and a live or owner holder as holding', () => {
    assert.equal(fixOf(row({ ...quiet, holder: 'dead' }), opts).verdict, 'stale');
    assert.equal(fixOf(row({ ...quiet, holder: 'owner' }), opts).verdict, 'ok');
  });

  it('proposes merge only for a ready PR; a draft with every check passed is resumed', () => {
    const entries = [check('SUCCESS'), review('SUCCESS')];
    assert.equal(fixOf(row({ ...quiet, phase: 'merging', pr: summarizePr(pr({ isDraft: true, statusCheckRollup: entries })) }), opts).fix, 'resume');
  });

  it('proposes fix-ci for a ready PR with a failed check even when agent-review succeeded', () => {
    assert.equal(fixOf(row({ ...quiet, phase: 'qa', pr: ready([check('FAILURE'), review('SUCCESS')]) }), opts).fix, 'fix-ci');
  });

  // Constitution VII v1.7.0: QA runs beside CI, so pending checks start the
  // tester; they still never start a merge.
  it('reruns QA, never merges, on a ready PR whose checks are still pending', () => {
    assert.equal(fixOf(row({ ...quiet, phase: 'qa', pr: ready([check(null, 'IN_PROGRESS')]) }), opts).fix, 'rerun-qa');
    assert.notEqual(fixOf(row({ ...quiet, phase: 'qa', pr: ready([check(null, 'IN_PROGRESS'), review('SUCCESS')]) }), opts).fix, 'merge');
  });

  it('resumes, not reruns QA, for an agent-review failure on a ready PR with passed checks', () => {
    assert.equal(fixOf(row({ ...quiet, phase: 'qa', pr: ready([check('SUCCESS'), review('FAILURE')]) }), opts).fix, 'resume');
  });

  it('never proposes a PR fix when the PR state is unknown', () => {
    for (const phase of ['review', 'qa', 'merging']) {
      assert.equal(fixOf(row({ ...quiet, phase, pr: 'unknown' }), opts).fix, 'resume', phase);
    }
  });

  it('proposes nothing for a closed PR and says it was closed', () => {
    const closed = summarizePr(pr({ state: 'CLOSED', statusCheckRollup: [check('FAILURE')] }));
    const r = fixOf(row({ phase: 'done', pr: closed, ...quiet }), opts);
    assert.equal(r.verdict, 'done');
    assert.equal(r.fix, null);
    assert.match(r.reason, /closed/i);
  });

  it('does not remove a clean worktree whose run is done but whose PR is not merged', () => {
    assert.equal(fixOf(row({ phase: 'done', pr: null }), opts).fix, null);
    assert.equal(fixOf(row({ phase: 'done', pr: 'unknown' }), opts).fix, null);
    assert.equal(fixOf(row({ phase: 'done', pr: summarizePr(pr({ state: 'CLOSED' })) }), opts).fix, null);
  });

  it('does not remove when neither the PR nor the worktree has a known head', () => {
    const merged = summarizePr(pr({ state: 'MERGED', headRefOid: undefined }));
    assert.equal(fixOf(row({ phase: 'done', pr: merged, head: undefined }), opts).fix, null);
  });

  it('does not remove when the PR has no head and the worktree has one', () => {
    const merged = summarizePr(pr({ state: 'MERGED', headRefOid: undefined }));
    assert.equal(fixOf(row({ phase: 'done', pr: merged, head: 'abc' }), opts).fix, null);
  });

  it('does not remove when the PR head and the worktree head are both null', () => {
    const merged = summarizePr(pr({ state: 'MERGED', headRefOid: null }));
    assert.equal(fixOf(row({ phase: 'done', pr: merged, head: null }), opts).fix, null);
  });

  it('removes a merged clean worktree whose lock is dead but not one held by a claim or a QA run', () => {
    const merged = summarizePr(pr({ state: 'MERGED' }));
    assert.equal(fixOf(row({ phase: 'done', pr: merged, holder: 'dead' }), opts).fix, 'remove-worktree');
    assert.equal(fixOf(row({ phase: 'done', pr: merged, holder: 'live' }), opts).fix, null);
  });

  it('explains an uncommitted tree and proposes nothing', () => {
    const r = fixOf(row({ phase: 'done', pr: summarizePr(pr({ state: 'MERGED' })), clean: false }), opts);
    assert.equal(r.fix, null);
    assert.match(r.reason, /uncommitted/);
  });

  it('never fixes the main worktree even when it carries a merged PR and is quiet', () => {
    const r = fixOf(row({ main: true, holder: 'owner', phase: 'done', pr: summarizePr(pr({ state: 'MERGED' })), activity: { at: 0, source: 'commit' } }), opts);
    assert.equal(r.fix, null);
    assert.notEqual(r.verdict, 'stale');
  });

  it('leaves a blocked row alone with a dead holder and old activity', () => {
    const r = fixOf(row({ phase: 'blocked', holder: 'dead', activity: { at: 0, source: 'commit' } }), opts);
    assert.equal(r.verdict, 'blocked');
    assert.equal(r.fix, null);
  });
});

describe('stale threshold parsing', () => {
  it('returns the defaults for no arguments and leaves the defaults object untouched', () => {
    const before = JSON.stringify(DEFAULT_THRESHOLDS);
    assert.deepEqual(parseStale([], DEFAULT_THRESHOLDS), DEFAULT_THRESHOLDS);
    parseStale(['qa=1'], DEFAULT_THRESHOLDS);
    assert.equal(JSON.stringify(DEFAULT_THRESHOLDS), before);
  });

  it('reads several phases from one comma list and from separate arguments', () => {
    const joined = parseStale(['qa=10,planning=20'], DEFAULT_THRESHOLDS);
    const split = parseStale(['qa=10', 'planning=20'], DEFAULT_THRESHOLDS);
    assert.deepEqual(joined, split);
    assert.equal(joined.qa, 10);
    assert.equal(joined.planning, 20);
    assert.equal(joined.review, 30);
  });

  for (const bad of ['qa=', 'qa=-5', 'qa=NaN', 'qa=Infinity', 'qa=10abc', 'qa=ten', 'qa=10=20', 'qa=0x10', 'qa=1,5']) {
    it(`rejects the value in ${JSON.stringify(bad)}`, () => {
      assert.throws(() => parseStale([bad], DEFAULT_THRESHOLDS));
    });
  }

  for (const bad of ['=10', 'blocked=10', 'merge=10', 'constructor=10', 'toString=5', '__proto__=1', 'qa']) {
    it(`rejects the name in ${JSON.stringify(bad)}`, () => {
      assert.throws(() => parseStale([bad], DEFAULT_THRESHOLDS));
    });
  }
});

describe('dispatch plan, edges', () => {
  const stale = (path, fix, minutesQuiet) => ({ path, verdict: 'stale', fix, activity: { at: NOW - minutesQuiet * MIN }, claim: null });
  const liveClaim = (path, fix) => ({ path, verdict: 'ok', fix: null, activity: { at: NOW }, claim: { fix, at: new Date(NOW - MIN).toISOString(), live: true } });
  const spent = (path, fix) => ({ path, verdict: 'stale', fix: 'resume', activity: { at: NOW - 999 * MIN }, claim: { fix, at: new Date(NOW - 999 * MIN).toISOString(), live: false } });

  it('plans nothing for no rows', () => {
    assert.deepEqual(dispatchPlan([], { qaLive: 0, now: NOW }), []);
  });

  it('never exceeds the QA cap or 2 other agents across thousands of stale rows', () => {
    const rows = [];
    for (let i = 0; i < 5000; i += 1) rows.push(stale(`q${i}`, 'rerun-qa', 40 + i), stale(`r${i}`, i % 2 ? 'resume' : 'fix-ci', 40 + i));
    const plan = dispatchPlan(rows, { qaLive: 0, now: NOW });
    assert.equal(plan.filter((p) => p.fix === 'rerun-qa').length, QA_CAP);
    assert.equal(plan.filter((p) => p.fix !== 'rerun-qa').length, 2);
  });

  it('plans no QA run when the cap or more are already live', () => {
    for (const qaLive of [QA_CAP, QA_CAP + 1, QA_CAP + 2, 1000]) {
      assert.deepEqual(dispatchPlan([stale('a', 'rerun-qa', 90), stale('b', 'rerun-qa', 80)], { qaLive, now: NOW }), [], String(qaLive));
    }
  });

  it('still plans other agents while the QA places are full, and the reverse', () => {
    const rows = [stale('a', 'rerun-qa', 90), stale('b', 'resume', 80), stale('c', 'merge', 70), stale('d', 'fix-ci', 60)];
    assert.deepEqual(dispatchPlan(rows, { qaLive: QA_CAP, now: NOW }).map((p) => p.path), ['b', 'c']);
    const claimed = [liveClaim('x', 'resume'), liveClaim('y', 'fix-ci')];
    assert.deepEqual(dispatchPlan([...rows, ...claimed], { qaLive: 0, now: NOW }).map((p) => p.path), ['a']);
  });

  it('counts a live QA claim against the QA places and not against the other agents', () => {
    const rows = [stale('a', 'rerun-qa', 90), stale('b', 'rerun-qa', 80), stale('c', 'resume', 70)];
    const plan = dispatchPlan([...rows, liveClaim('z', 'rerun-qa')], { qaLive: QA_CAP - 1, now: NOW });
    assert.deepEqual(plan.map((p) => p.path), ['c']);
  });

  it('counts a live QA claim together with live QA runs, so cap − 2 runs and 1 claim leave one place', () => {
    const rows = [stale('a', 'rerun-qa', 50), stale('b', 'rerun-qa', 90), stale('c', 'rerun-qa', 70)];
    assert.deepEqual(dispatchPlan([...rows, liveClaim('z', 'rerun-qa')], { qaLive: QA_CAP - 2, now: NOW }).map((p) => p.path), ['b']);
  });

  it('does not count an expired claim', () => {
    const expired = { path: 's', verdict: 'ok', fix: null, activity: { at: NOW }, claim: { fix: 'resume', at: new Date(NOW - 999 * MIN).toISOString(), live: false } };
    const rows = [stale('a', 'resume', 90), stale('b', 'resume', 80), expired, { ...expired, path: 't' }];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, now: NOW }).map((p) => p.path), ['a', 'b']);
  });

  it('orders by oldest activity across fixes, without reordering its input', () => {
    const rows = [stale('a', 'resume', 50), stale('b', 'fix-ci', 90), stale('c', 'merge', 70)];
    const before = rows.map((r) => r.path);
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, now: NOW }).map((p) => p.path), ['b', 'c']);
    assert.deepEqual(rows.map((r) => r.path), before);
  });

  it('gives the same plan when called twice', () => {
    const rows = [stale('a', 'resume', 50), stale('b', 'rerun-qa', 90)];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 1, now: NOW }), dispatchPlan(rows, { qaLive: 1, now: NOW }));
  });

  it('plans only the four agent fixes, and only for stale rows', () => {
    const rows = [
      stale('a', 'delete-branch', 90),
      stale('b', 'remove-worktree', 90),
      stale('c', null, 90),
      { ...stale('d', 'resume', 90), verdict: 'blocked' },
      { ...stale('e', 'resume', 90), verdict: 'done' },
      { ...stale('f', 'resume', 90), verdict: 'ok' },
    ];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, now: NOW }), []);
  });

  it('plans nothing for any fix when the PR state is unknown', () => {
    const rows = [stale('a', 'rerun-qa', 90), stale('b', 'resume', 90), stale('c', 'merge', 90)];
    assert.deepEqual(dispatchPlan(rows, { qaLive: 0, now: NOW, prsKnown: false }), []);
  });
});

describe('collect against gh that misbehaves', () => {
  const garbage = [
    ['a string', 'oops'],
    ['null', null],
    ['undefined', undefined],
    ['an empty object', {}],
    ['an error object', { error: 'rate limited' }],
    ['a number', 42],
    ['a promise', Promise.resolve([])],
  ];

  for (const [name, value] of garbage) {
    it(`marks the PR unknown and plans nothing when gh returns ${name}`, () => {
      const f = fixture();
      const a = f.add('agent-a', '901-a');
      quietCommit(a, 120);
      const report = collect(f.repo, env({ gh: () => value }));
      assert.equal(report.rows.length, 2);
      assert.equal(rowOf(report, a).pr, 'unknown');
      assert.deepEqual(report.plan, []);
    });
  }

  it('survives gh throwing something that is not an Error', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 120);
    const report = collect(f.repo, env({ gh: () => { throw 'boom'; } }));
    assert.equal(rowOf(report, a).pr, 'unknown');
    assert.deepEqual(report.plan, []);
  });

  it('survives a list of junk entries and still reports the worktree', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 120);
    const report = collect(f.repo, env({ gh: () => [null, 42, 'x', {}, [], { number: 'abc' }, { headRefName: 7 }] }));
    assert.equal(report.rows.length, 2);
    assert.equal(rowOf(report, a).fix, 'resume');
  });

  it('does not match a PR with no branch name to a detached worktree', () => {
    const f = fixture();
    const d = join(f.root, 'detached');
    git(f.repo, 'worktree', 'add', '-q', '--detach', d);
    const sha = head(d);
    const junk = [
      { number: 5, state: 'MERGED', headRefName: null, headRefOid: sha, statusCheckRollup: [] },
      { number: 6, state: 'MERGED', headRefOid: sha, statusCheckRollup: [] },
      { number: 7, state: 'MERGED', headRefName: '', headRefOid: sha, statusCheckRollup: [] },
    ];
    const report = collect(f.repo, env({ gh: () => junk, now: Date.now() + 10_000 * MIN }));
    const r = rowOf(report, d);
    assert.ok(r.pr === null || r.pr === undefined, JSON.stringify(r.pr));
    assert.notEqual(r.fix, 'remove-worktree');
    applyFixes(f.repo, report);
    assert.ok(existsSync(d));
  });

  it('picks the open PR when a merged PR from an earlier life of the branch is also listed, in either order', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    const sha = head(a);
    const merged = pr({ number: 5, headRefName: '901-a', state: 'MERGED', headRefOid: sha });
    const open = pr({ number: 9, headRefName: '901-a', state: 'OPEN', headRefOid: sha });
    for (const list of [[merged, open], [open, merged]]) {
      const report = collect(f.repo, env({ gh: () => list, now: Date.now() + 10_000 * MIN }));
      const r = rowOf(report, a);
      assert.equal(r.pr.number, 9);
      assert.notEqual(r.fix, 'remove-worktree');
      applyFixes(f.repo, report);
      assert.ok(existsSync(a));
    }
  });

  it('matches a branch with a slash to its PR', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore/slash-name');
    const report = collect(f.repo, env({ gh: () => [pr({ number: 8, headRefName: 'chore/slash-name', headRefOid: head(a) })] }));
    assert.equal(rowOf(report, a).pr.number, 8);
  });
});

describe('collect against corrupt local files', () => {
  const bytes = {
    'not json': 'not json{',
    'an empty file': '',
    'an array': '[]',
    'null': 'null',
    'a string': '"text"',
    'wrong types': '{"status":42,"phase":{},"updated":[]}',
    'UTF-16 with a byte order mark': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"status":"blocked"}', 'utf16le')]),
    'Latin-1 text': Buffer.from('{"status":"in-progress","phase":"caf\xe9"}', 'latin1'),
    'a binary blob': Buffer.from([0, 1, 2, 3, 0xff, 0xfe, 0x80, 0x00]),
  };

  for (const [name, content] of Object.entries(bytes)) {
    it(`reads a run-state of ${name} as empty`, () => {
      const f = fixture();
      const a = f.add('agent-a', 'chore-x');
      quietCommit(a, 300);
      writeFileSync(join(a, '.specify', 'run-state.json'), content);
      const r = rowOf(collect(f.repo, env()), a);
      assert.equal(r.phase, 'development');
      assert.equal(r.activity.source, 'commit');
      assert.equal(r.verdict, 'stale');
    });

    it(`reads a claim of ${name} as no claim`, () => {
      const f = fixture();
      const a = f.add('agent-a', 'chore-x');
      quietCommit(a, 300);
      mkdirSync(join(a, '.specify', '.cache'), { recursive: true });
      writeFileSync(join(a, '.specify', '.cache', 'watch-claim.json'), content);
      const r = rowOf(collect(f.repo, env()), a);
      assert.equal(r.holder, 'none');
      assert.equal(r.verdict, 'stale');
    });
  }

  it('reads a claim file that is a directory as no claim', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    mkdirSync(join(a, '.specify', '.cache', 'watch-claim.json'), { recursive: true });
    assert.equal(rowOf(collect(f.repo, env()), a).holder, 'none');
  });

  it('reads a claim with a missing or unparseable time as no claim', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    mkdirSync(join(a, '.specify', '.cache'), { recursive: true });
    for (const text of ['{"fix":"resume"}', '{"fix":"resume","at":"garbage"}', '{"fix":"resume","at":12}']) {
      writeFileSync(join(a, '.specify', '.cache', 'watch-claim.json'), text);
      assert.equal(rowOf(collect(f.repo, env()), a).holder, 'none', text);
    }
  });

  it('falls back to the commit when run-state carries an unparseable updated time', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    writeFileSync(join(a, '.specify', 'run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'implement', updated: 'not a date' }));
    const r = rowOf(collect(f.repo, env()), a);
    assert.equal(r.activity.source, 'commit');
    assert.equal(r.activity.at, NOW - 300 * MIN);
  });

  it('never calls a blocked run-state stale, whatever the lock and age', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 5000);
    writeFileSync(join(a, '.specify', 'run-state.json'), JSON.stringify({ status: 'blocked', phase: 'harden' }));
    const report = collect(f.repo, env());
    const r = rowOf(report, a);
    assert.equal(r.verdict, 'blocked');
    assert.equal(r.fix, null);
    assert.deepEqual(report.plan, []);
  });

  for (const text of ['{{', '', 'null', '[]', '{"feature_directory":123}', '{"feature_directory":null}', '{"feature_directory":[]}', '{"feature_directory":{}}']) {
    it(`reads the feature pointer ${JSON.stringify(text)} as no feature`, () => {
      const f = fixture();
      const a = f.add('agent-a', 'chore-x');
      quietCommit(a, 300);
      writeFileSync(join(a, '.specify', 'feature.json'), text);
      assert.equal(rowOf(collect(f.repo, env()), a).phase, 'development');
    });
  }

  it('counts uppercase and lowercase checked tasks, CRLF lines and Latin-1 text correctly', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    const dir = join(a, 'specs', '900-x');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(a, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/900-x' }));
    for (const name of ['spec.md', 'plan.md']) writeFileSync(join(dir, name), '# x\n');
    const phase = () => rowOf(collect(f.repo, env()), a).phase;
    writeFileSync(join(dir, 'tasks.md'), '- [X] T001 a\n- [x] T002 b\n');
    assert.equal(phase(), 'review');
    writeFileSync(join(dir, 'tasks.md'), '- [x] T001 a\r\n- [ ] T002 b\r\n');
    assert.equal(phase(), 'development');
    writeFileSync(join(dir, 'tasks.md'), Buffer.from('- [x] T001 caf\xe9\n- [ ] T002 d\xe9j\xe0\n', 'latin1'));
    assert.equal(phase(), 'development');
  });

  it('survives a tasks file in UTF-16 or one that is a binary blob', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    const dir = join(a, 'specs', '900-x');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(a, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/900-x' }));
    for (const name of ['spec.md', 'plan.md']) writeFileSync(join(dir, name), '# x\n');
    for (const content of [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('- [ ] T001 a\n', 'utf16le')]), Buffer.from([0, 255, 254, 0, 1, 2])]) {
      writeFileSync(join(dir, 'tasks.md'), content);
      assert.ok(PHASES.includes(rowOf(collect(f.repo, env()), a).phase));
    }
  });
});

describe('last activity from changed files', () => {
  it('uses a file whose name has spaces and accents', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    const file = join(a, 'café au lait.txt');
    writeFileSync(file, 'x\n');
    utimesSync(file, (NOW - 7 * MIN) / 1000, (NOW - 7 * MIN) / 1000);
    const r = rowOf(collect(f.repo, env()), a);
    assert.equal(r.activity.source, 'file');
    assert.equal(r.activity.at, NOW - 7 * MIN);
  });

  it('uses a file inside an untracked directory', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    mkdirSync(join(a, 'deep', 'er'), { recursive: true });
    const file = join(a, 'deep', 'er', 'wip.txt');
    writeFileSync(file, 'x\n');
    utimesSync(file, (NOW - 9 * MIN) / 1000, (NOW - 9 * MIN) / 1000);
    for (const dir of [join(a, 'deep', 'er'), join(a, 'deep')]) utimesSync(dir, (NOW - 500 * MIN) / 1000, (NOW - 500 * MIN) / 1000);
    const r = rowOf(collect(f.repo, env()), a);
    assert.equal(r.activity.source, 'file');
    assert.equal(r.activity.at, NOW - 9 * MIN);
    assert.equal(r.clean, false);
  });

  it('survives a tracked file that was deleted, a staged rename and a dangling symlink', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    rmSync(join(a, 'README.md'));
    git(a, 'mv', 'f300.txt', 'moved.txt');
    symlinkSync(join(f.root, 'nowhere'), join(a, 'dangling'));
    const r = rowOf(collect(f.repo, env()), a);
    assert.equal(r.clean, false);
    assert.ok(Number.isFinite(r.activity.at));
  });

  it('does not follow a symlink out of the tree to judge activity', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    const outside = join(f.root, 'outside.txt');
    writeFileSync(outside, 'x\n');
    utimesSync(outside, (NOW - 1 * MIN) / 1000, (NOW - 1 * MIN) / 1000);
    symlinkSync(outside, join(a, 'link'));
    const r = rowOf(collect(f.repo, env({ now: NOW + 600 * MIN })), a);
    assert.ok(r.activity.at !== NOW - 1 * MIN);
  });

  it('reads a 30 MB untracked file by its time alone', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    const big = join(a, 'big.bin');
    writeFileSync(big, Buffer.alloc(30 * 1024 * 1024, 0xff));
    utimesSync(big, (NOW - 4 * MIN) / 1000, (NOW - 4 * MIN) / 1000);
    const r = rowOf(collect(f.repo, env()), a);
    assert.equal(r.activity.source, 'file');
    assert.equal(r.activity.at, NOW - 4 * MIN);
  }, 60_000);

  it('survives a 30 MB run-state and claim', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    mkdirSync(join(a, '.specify', '.cache'), { recursive: true });
    writeFileSync(join(a, '.specify', 'run-state.json'), Buffer.alloc(30 * 1024 * 1024, 0x61));
    writeFileSync(join(a, '.specify', '.cache', 'watch-claim.json'), Buffer.alloc(30 * 1024 * 1024, 0x61));
    const r = rowOf(collect(f.repo, env()), a);
    assert.equal(r.phase, 'development');
    assert.equal(r.holder, 'none');
  }, 60_000);

  it('does not count its own claim as activity', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    writeClaim(a, 'resume', NOW - 200 * MIN);
    const r = rowOf(collect(f.repo, env({ now: NOW + 600 * MIN })), a);
    assert.equal(r.activity.source, 'commit');
    assert.equal(r.verdict, 'stale');
  });
});

describe('holder from locks and QA runs, with real worktrees', () => {
  it('reads a lock whose process is running but is not claude as dead', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 300);
    lock(f, a, 'claude agent agent-a (pid 4242 start Sun Oct  4 08:07:18 2026)');
    const r = rowOf(collect(f.repo, env({ alive: () => false, pidAlive: () => true })), a);
    assert.equal(r.holder, 'dead');
    assert.equal(r.verdict, 'stale');
  });

  it('reads a session lock whose process is claude as live, and never stale', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    quietCommit(a, 3000);
    lock(f, a, 'claude session agent-a (pid 4242 start Sun Oct  4 08:07:18 2026)');
    const report = collect(f.repo, env({ alive: (pid) => pid === 4242 }));
    assert.equal(rowOf(report, a).holder, 'live');
    assert.equal(rowOf(report, a).verdict, 'ok');
    assert.deepEqual(report.plan, []);
  });

  it('reads a lock with no pid, and one with no reason, as live', () => {
    const f = fixture();
    const a = f.add('agent-a', 'chore-x');
    const b = f.add('agent-b', 'chore-y');
    quietCommit(a, 3000);
    quietCommit(b, 3000);
    lock(f, a, 'kept by hand');
    lock(f, b);
    const report = collect(f.repo, env());
    for (const p of [a, b]) {
      assert.equal(rowOf(report, p).holder, 'live', p);
      assert.equal(rowOf(report, p).verdict, 'ok', p);
    }
  });

  it('holds the worktree while a QA run tests its PR, and not for a PR whose number merely starts the same', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 3000);
    const gh = () => [pr({ number: 21, headRefName: '901-a', isDraft: true, headRefOid: head(a) })];
    f.scratch(2, 4242);
    let r = rowOf(collect(f.repo, env({ gh, pidAlive: (pid) => pid === 4242 })), a);
    assert.equal(r.holder, 'none');
    assert.equal(r.verdict, 'stale');
    f.scratch(21, 4343);
    r = rowOf(collect(f.repo, env({ gh, pidAlive: (pid) => pid === 4343 })), a);
    assert.equal(r.holder, 'live');
    assert.equal(r.verdict, 'ok');
  });

  it('does not count a scratch worktree whose process is gone, nor list it, nor touch it', () => {
    const f = fixture();
    const s = f.scratch(12, 4242);
    const report = collect(f.repo, env({ alive: () => true, pidAlive: () => false }));
    assert.deepEqual(report.qaRuns, []);
    assert.equal(report.rows.length, 1);
    applyFixes(f.repo, report);
    assert.ok(existsSync(s));
  });

  it('asks about the scratch pid with the plain process check, not the claude check', () => {
    const f = fixture();
    f.scratch(12, 4242);
    const report = collect(f.repo, env({ alive: () => false, pidAlive: (pid) => pid === 4242 }));
    assert.deepEqual(report.qaRuns, [{ pr: 12, pid: 4242 }]);
  });

  it('keeps a worktree named like a PR-tester checkout but not matching it as a row', () => {
    const f = fixture();
    const odd = f.add('mf-prtest-abc-xyz-1', '901-odd');
    const report = collect(f.repo, env());
    assert.ok(rowOf(report, odd));
    assert.deepEqual(report.qaRuns, []);
  });

  it('does not remove a merged clean worktree while a QA run tests its PR', () => {
    const f = fixture();
    const a = f.add('agent-a', '922-b');
    f.scratch(22, 4242);
    const report = collect(f.repo, env({ gh: () => [pr({ number: 22, headRefName: '922-b', state: 'MERGED', headRefOid: head(a) })], pidAlive: () => true, now: Date.now() + 10_000 * MIN }));
    assert.notEqual(rowOf(report, a).fix, 'remove-worktree');
    applyFixes(f.repo, report);
    assert.ok(existsSync(a));
  });
});

describe('the QA cap with live claims and live runs, with real worktrees', () => {
  const staleReady = (f, name, number, minutes) => {
    const p = f.add(name, `0${number}-${name}`);
    quietCommit(p, minutes);
    return { path: p, pr: pr({ number, headRefName: `0${number}-${name}`, headRefOid: head(p), statusCheckRollup: [check('SUCCESS')] }) };
  };

  it('leaves one QA place when cap − 2 runs and 1 claim are live, and gives it to the oldest', () => {
    const f = fixture();
    for (let i = 0; i < QA_CAP - 2; i += 1) f.scratch(90 + i, 1001 + i);
    const claimed = staleReady(f, 'claimed', 30, 120);
    writeClaim(claimed.path, 'rerun-qa', NOW - MIN);
    const s1 = staleReady(f, 's1', 31, 100);
    const s2 = staleReady(f, 's2', 32, 200);
    const s3 = staleReady(f, 's3', 33, 150);
    const report = collect(f.repo, env({ gh: () => [claimed.pr, s1.pr, s2.pr, s3.pr], pidAlive: (pid) => pid >= 1001 && pid < 1001 + QA_CAP - 2 }));
    assert.equal(report.qaRuns.length, QA_CAP - 2);
    assert.deepEqual(report.plan.map((p) => [p.path, p.fix]), [[s2.path, 'rerun-qa']]);
  });

  it('plans no QA run while the cap of scratch runs are live, but still plans 2 other agents', () => {
    const f = fixture();
    for (let i = 0; i < QA_CAP; i += 1) f.scratch(90 + i, 1000 + i);
    const qa = staleReady(f, 'qa', 31, 100);
    const r1 = f.add('r1', 'chore-r1');
    const r2 = f.add('r2', 'chore-r2');
    const r3 = f.add('r3', 'chore-r3');
    quietCommit(r1, 90);
    quietCommit(r2, 120);
    quietCommit(r3, 150);
    const report = collect(f.repo, env({ gh: () => [qa.pr], pidAlive: (pid) => pid >= 1000 && pid < 1000 + QA_CAP }));
    assert.equal(report.qaRuns.length, QA_CAP);
    assert.equal(report.plan.filter((p) => p.fix === 'rerun-qa').length, 0);
    assert.deepEqual(report.plan.map((p) => p.path), [r3, r2]);
  });

  it('plans no more than 2 other agents when 2 claims are live, and plans QA regardless', () => {
    const f = fixture();
    const c1 = f.add('c1', 'chore-c1');
    const c2 = f.add('c2', 'chore-c2');
    quietCommit(c1, 300);
    quietCommit(c2, 300);
    writeClaim(c1, 'resume', NOW - MIN);
    writeClaim(c2, 'fix-ci', NOW - MIN);
    const r1 = f.add('r1', 'chore-r1');
    quietCommit(r1, 400);
    const qa = staleReady(f, 'qa', 31, 100);
    const report = collect(f.repo, env({ gh: () => [qa.pr] }));
    assert.deepEqual(report.plan.map((p) => p.path), [qa.path]);
  });

  it('does not count a claim that has aged out', () => {
    const f = fixture();
    const c1 = f.add('c1', 'chore-c1');
    quietCommit(c1, 600);
    writeClaim(c1, 'resume', NOW - 200 * MIN);
    const r1 = f.add('r1', 'chore-r1');
    const r2 = f.add('r2', 'chore-r2');
    quietCommit(r1, 400);
    quietCommit(r2, 500);
    const report = collect(f.repo, env());
    assert.equal(report.plan.length, 2);
  });

  it('does not dispatch twice onto the same work: a second pass after claiming the first plan plans nothing new', () => {
    const f = fixture();
    const paths = [];
    for (const [i, minutes] of [[1, 100], [2, 200], [3, 300]]) {
      const p = f.add(`w${i}`, `chore-w${i}`);
      quietCommit(p, minutes);
      paths.push(p);
    }
    const first = collect(f.repo, env());
    assert.equal(first.plan.length, 2);
    for (const item of first.plan) writeClaim(item.path, item.fix, NOW);
    assert.deepEqual(collect(f.repo, env()).plan, []);
    const later = collect(f.repo, env({ now: NOW + 46 * MIN }));
    assert.equal(later.plan.length, 2);
  });
});

describe('--fix never harms work', () => {
  const mergedFor = (a, branch, number = 22) => pr({ number, headRefName: branch, state: 'MERGED', headRefOid: head(a) });
  const later = () => Date.now() + 10_000 * MIN;

  it('keeps a worktree with a modified tracked file, a staged file, an untracked file or a file in an untracked directory', () => {
    const f = fixture();
    const mod = f.add('mod', '931-mod');
    const staged = f.add('staged', '932-staged');
    const untracked = f.add('untracked', '933-untracked');
    const nested = f.add('nested', '934-nested');
    writeFileSync(join(mod, 'README.md'), 'changed\n');
    writeFileSync(join(staged, 'new.txt'), 'x\n');
    git(staged, 'add', 'new.txt');
    writeFileSync(join(untracked, 'wip.txt'), 'x\n');
    mkdirSync(join(nested, 'sub', 'dir'), { recursive: true });
    writeFileSync(join(nested, 'sub', 'dir', 'wip.txt'), 'x\n');
    const prs = [mod, staged, untracked, nested].map((p, i) => mergedFor(p, `93${i + 1}-${['mod', 'staged', 'untracked', 'nested'][i]}`, 40 + i));
    const before = branches(f);
    const report = collect(f.repo, env({ gh: () => prs, now: later() }));
    for (const p of [mod, staged, untracked, nested]) {
      assert.equal(rowOf(report, p).fix, null, p);
      assert.match(rowOf(report, p).reason, /uncommitted/, p);
    }
    applyFixes(f.repo, report);
    for (const p of [mod, staged, untracked, nested]) assert.ok(existsSync(p), p);
    assert.equal(readFileSync(join(mod, 'README.md'), 'utf8'), 'changed\n');
    assert.deepEqual(branches(f), before);
  });

  it('keeps a worktree with commits made after the PR merged', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    const merged = mergedFor(a, '901-a', 21);
    quietCommit(a, 5);
    const report = collect(f.repo, env({ gh: () => [merged], now: later() }));
    assert.equal(rowOf(report, a).fix, null);
    applyFixes(f.repo, report);
    assert.ok(existsSync(a));
    assert.ok(existsSync(join(a, 'f5.txt')));
  });

  it('keeps a worktree whose merged PR names a different head', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    const other = pr({ number: 21, headRefName: '901-a', state: 'MERGED', headRefOid: 'f'.repeat(40) });
    const report = collect(f.repo, env({ gh: () => [other], now: later() }));
    assert.equal(rowOf(report, a).fix, null);
    applyFixes(f.repo, report);
    assert.ok(existsSync(a));
  });

  it('keeps a worktree whose PR was closed without merging, and one whose PR is still open', () => {
    const f = fixture();
    const closed = f.add('closed', '921-closed');
    const open = f.add('open', '922-open');
    const prs = [
      pr({ number: 21, headRefName: '921-closed', state: 'CLOSED', headRefOid: head(closed) }),
      pr({ number: 22, headRefName: '922-open', state: 'OPEN', headRefOid: head(open) }),
    ];
    const report = collect(f.repo, env({ gh: () => prs, now: later() }));
    assert.equal(rowOf(report, closed).verdict, 'done');
    assert.equal(rowOf(report, closed).fix, null);
    applyFixes(f.repo, report);
    assert.ok(existsSync(closed));
    assert.ok(existsSync(open));
  });

  it('keeps a merged clean worktree held by a live lock or a hand lock', () => {
    const f = fixture();
    const live = f.add('live', '921-live');
    const hand = f.add('hand', '922-hand');
    lock(f, live, 'claude session live (pid 4242 start Sun Oct  4 08:07:18 2026)');
    lock(f, hand, 'kept by hand');
    const prs = [mergedFor(live, '921-live', 21), mergedFor(hand, '922-hand', 22)];
    const report = collect(f.repo, env({ gh: () => prs, alive: (pid) => pid === 4242, now: later() }));
    const actions = applyFixes(f.repo, report);
    assert.deepEqual(actions, []);
    assert.ok(existsSync(live));
    assert.ok(existsSync(hand));
    assert.match(listed(f), /locked claude session live/);
    assert.match(listed(f), /locked kept by hand/);
  });

  it('never unlocks a live lock or a lock with no pid, and unlocks a dead one', () => {
    const f = fixture();
    const live = f.add('live', '921-live');
    const hand = f.add('hand', '922-hand');
    const none = f.add('none', '923-none');
    const dead = f.add('dead', '924-dead');
    lock(f, live, 'claude session live (pid 4242 start Sun Oct  4 08:07:18 2026)');
    lock(f, hand, 'kept by hand');
    lock(f, none);
    lock(f, dead, DEAD_LOCK);
    const report = collect(f.repo, env({ alive: (pid) => pid === 4242, now: later() }));
    const actions = applyFixes(f.repo, report);
    assert.equal(actions.filter((a) => a.ok).length, 1, JSON.stringify(actions));
    const text = listed(f);
    assert.match(text, /locked claude session live/);
    assert.match(text, /locked kept by hand/);
    assert.equal((text.match(/^locked/gm) ?? []).length, 3);
    assert.doesNotMatch(text, /999999/);
  });

  it('unlocks a dead lock and removes the merged clean worktree in the same pass', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    lock(f, a, DEAD_LOCK);
    const report = collect(f.repo, env({ gh: () => [mergedFor(a, '901-a', 21)], now: later() }));
    assert.equal(rowOf(report, a).holder, 'dead');
    assert.equal(rowOf(report, a).fix, 'remove-worktree');
    const actions = applyFixes(f.repo, report);
    assert.ok(!existsSync(a), JSON.stringify(actions));
    assert.ok(branches(f).some((b) => b.startsWith('901-a=')));
  });

  it('keeps the stale proposal for a worktree whose dead lock it released', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 300);
    lock(f, a, DEAD_LOCK);
    const report = collect(f.repo, env());
    assert.equal(rowOf(report, a).verdict, 'stale');
    assert.deepEqual(report.plan.map((p) => [p.path, p.fix]), [[a, 'resume']]);
    applyFixes(f.repo, report);
    assert.ok(existsSync(a));
    const again = collect(f.repo, env());
    assert.equal(rowOf(again, a).holder, 'none');
    assert.equal(rowOf(again, a).verdict, 'stale');
  });

  it('refuses to remove a worktree that became dirty after the report was taken', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    const report = collect(f.repo, env({ gh: () => [mergedFor(a, '901-a', 21)], now: later() }));
    assert.equal(rowOf(report, a).fix, 'remove-worktree');
    writeFileSync(join(a, 'late.txt'), 'precious\n');
    const actions = applyFixes(f.repo, report);
    assert.ok(existsSync(join(a, 'late.txt')));
    assert.equal(readFileSync(join(a, 'late.txt'), 'utf8'), 'precious\n');
    assert.equal(actions.filter((x) => x.ok).length, 0, JSON.stringify(actions));
  });

  it('refuses to remove a worktree whose tracked file was edited after the report was taken', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    const report = collect(f.repo, env({ gh: () => [mergedFor(a, '901-a', 21)], now: later() }));
    writeFileSync(join(a, 'README.md'), 'edited late\n');
    applyFixes(f.repo, report);
    assert.equal(readFileSync(join(a, 'README.md'), 'utf8'), 'edited late\n');
  });

  it('refuses to remove a worktree that was locked after the report was taken', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    const report = collect(f.repo, env({ gh: () => [mergedFor(a, '901-a', 21)], now: later() }));
    lock(f, a, 'claude agent late (pid 4242 start Sun Oct  4 08:07:18 2026)');
    applyFixes(f.repo, report);
    assert.ok(existsSync(a));
  });

  it('never removes the main worktree, even when it is on a branch whose PR merged', () => {
    const f = fixture();
    git(f.repo, 'checkout', '-q', '-b', '921-on-main');
    const report = collect(f.repo, env({ gh: () => [mergedFor(f.repo, '921-on-main', 21)], now: later() }));
    const r = rowOf(report, f.repo);
    assert.equal(r.holder, 'owner');
    assert.equal(r.fix, null);
    assert.notEqual(r.verdict, 'stale');
    applyFixes(f.repo, report);
    assert.ok(existsSync(join(f.repo, 'README.md')));
  });

  it('never removes the main worktree from a hand-edited report', () => {
    const f = fixture();
    const crafted = { rows: [{ path: f.repo, main: true, holder: 'dead', fix: 'remove-worktree', verdict: 'done', clean: true }], plan: [], qaRuns: [], prunable: [] };
    applyFixes(f.repo, crafted);
    assert.ok(existsSync(join(f.repo, 'README.md')));
    assert.ok(existsSync(join(f.repo, '.git')));
  });

  it('does not delete a directory that is not a worktree named by a hand-edited report', () => {
    const f = fixture();
    const plain = join(f.root, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'keep.txt'), 'x\n');
    applyFixes(f.repo, { rows: [{ path: plain, main: false, holder: 'none', fix: 'remove-worktree', verdict: 'done', clean: true }], plan: [], qaRuns: [], prunable: [] });
    assert.equal(readFileSync(join(plain, 'keep.txt'), 'utf8'), 'x\n');
  });

  it('does not delete a branch or move one, through every kind of fix', () => {
    const f = fixture();
    const merged = f.add('merged', '921-merged');
    const dead = f.add('dead', '922-dead');
    const gone = f.add('gone', '923-gone');
    quietCommit(dead, 300);
    lock(f, dead, DEAD_LOCK);
    rmSync(gone, { recursive: true, force: true });
    git(f.repo, 'tag', 'keep-me');
    const before = branches(f);
    const report = collect(f.repo, env({ gh: () => [mergedFor(merged, '921-merged', 21)], now: later() }));
    applyFixes(f.repo, report);
    assert.deepEqual(branches(f), before);
    assert.equal(git(f.repo, 'tag'), 'keep-me');
  });

  it('prunes a deleted worktree, and a second pass then does nothing', () => {
    const f = fixture();
    const gone = f.add('gone', '921-gone');
    rmSync(gone, { recursive: true, force: true });
    const report = collect(f.repo, env());
    assert.equal(report.rows.length, 1);
    const actions = applyFixes(f.repo, report);
    assert.equal(actions.filter((a) => a.ok).length, 1, JSON.stringify(actions));
    assert.doesNotMatch(listed(f), /921-gone/);
    assert.deepEqual(applyFixes(f.repo, collect(f.repo, env())), []);
  });

  it('does not prune the record of a deleted worktree whose lock is live', () => {
    const f = fixture();
    const gone = f.add('gone', '921-gone');
    lock(f, gone, 'claude agent gone (pid 4242 start Sun Oct  4 08:07:18 2026)');
    rmSync(gone, { recursive: true, force: true });
    applyFixes(f.repo, collect(f.repo, env({ alive: (pid) => pid === 4242 })));
    assert.match(listed(f), /locked claude agent gone/);
  });

  it('still does the local fixes when gh fails, and removes nothing on a guess', () => {
    const f = fixture();
    const dead = f.add('dead', '921-dead');
    const merged = f.add('merged', '922-merged');
    lock(f, dead, DEAD_LOCK);
    const report = collect(f.repo, env({ gh: () => { throw new Error('offline'); }, now: later() }));
    const actions = applyFixes(f.repo, report);
    assert.equal(actions.filter((a) => a.ok).length, 1, JSON.stringify(actions));
    assert.doesNotMatch(listed(f), /999999/);
    assert.ok(existsSync(merged));
    assert.ok(existsSync(dead));
  });

  it('does not touch the dirty state of the main worktree', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    writeFileSync(join(f.repo, 'README.md'), 'owner edit\n');
    writeFileSync(join(f.repo, 'owner.txt'), 'x\n');
    applyFixes(f.repo, collect(f.repo, env({ gh: () => [mergedFor(a, '901-a', 21)], now: later() })));
    assert.equal(readFileSync(join(f.repo, 'README.md'), 'utf8'), 'owner edit\n');
    assert.ok(existsSync(join(f.repo, 'owner.txt')));
  });

  it('matches the worktree it is run from as live, and never removes it', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 600);
    const merged = pr({ number: 21, headRefName: '901-a', state: 'MERGED', headRefOid: head(a) });
    const report = collect(a, env({ gh: () => [merged], now: later() }));
    const r = rowOf(report, a);
    assert.equal(r.holder, 'live');
    assert.equal(r.fix, null);
    applyFixes(a, report);
    assert.ok(existsSync(a));
  });

  it('treats a run from a subdirectory of a worktree as run from that worktree', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 600);
    mkdirSync(join(a, 'sub'));
    const { status, out } = run(() => main(['--json'], { cwd: join(a, 'sub'), ...env({ gh: () => [] }) }));
    assert.equal(status, 0);
    const mine = JSON.parse(out).rows.find((r) => r.path === a);
    assert.equal(mine.holder, 'live');
    assert.equal(mine.verdict, 'ok');
  });
});

describe('a pass with nothing to do writes nothing', () => {
  const quietSetup = () => {
    const f = fixture();
    const live = f.add('live', '921-live');
    const hand = f.add('hand', '922-hand');
    const fresh = f.add('fresh', '923-fresh');
    lock(f, live, 'claude session live (pid 4242 start Sun Oct  4 08:07:18 2026)');
    lock(f, hand, 'kept by hand');
    return { f, live, hand, fresh };
  };

  it('changes no file, lock, ref or worktree record', () => {
    const { f } = quietSetup();
    const deps = { cwd: f.repo, ...env({ now: Date.now(), alive: (pid) => pid === 4242 }) };
    const before = snapshot(f.root);
    const first = run(() => main(['--fix'], deps));
    assert.equal(first.status, 0);
    assert.deepEqual(snapshot(f.root), before);
    run(() => main(['--fix', '--json'], deps));
    assert.deepEqual(snapshot(f.root), before);
  });

  it('writes no claim and no cache directory', () => {
    const { f, live, hand, fresh } = quietSetup();
    run(() => main(['--fix'], { cwd: f.repo, ...env({ now: Date.now(), alive: (pid) => pid === 4242 }) }));
    for (const p of [live, hand, fresh, f.repo]) assert.ok(!existsSync(join(p, '.specify', '.cache')), p);
  });

  it('writes no claim for a stale worktree, because dispatching is the skill\'s job', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 300);
    const before = snapshot(f.root);
    const { status } = run(() => main(['--fix'], { cwd: f.repo, ...env() }));
    assert.equal(status, 0);
    assert.deepEqual(snapshot(f.root), before);
    assert.ok(!existsSync(join(a, '.specify', '.cache', 'watch-claim.json')));
  });

  it('changes nothing when run without --fix, even with a dead lock, a merged clean worktree and a deleted one', () => {
    const f = fixture();
    const dead = f.add('dead', '921-dead');
    const merged = f.add('merged', '922-merged');
    const gone = f.add('gone', '923-gone');
    lock(f, dead, DEAD_LOCK);
    rmSync(gone, { recursive: true, force: true });
    const gh = () => [pr({ number: 22, headRefName: '922-merged', state: 'MERGED', headRefOid: head(merged) })];
    const before = snapshot(f.root);
    const listBefore = listed(f);
    for (const argv of [[], ['--json']]) {
      const { status } = run(() => main(argv, { cwd: f.repo, ...env({ gh, now: Date.now() + 10_000 * MIN }) }));
      assert.equal(status, 0);
    }
    assert.deepEqual(snapshot(f.root), before);
    assert.equal(listed(f), listBefore);
  });
});

describe('the command, hostile arguments', () => {
  it('refuses a stale flag with no value and applies nothing', () => {
    const f = fixture();
    const merged = f.add('merged', '922-merged');
    const gh = () => [pr({ number: 22, headRefName: '922-merged', state: 'MERGED', headRefOid: head(merged) })];
    const { status } = run(() => main(['--fix', '--stale'], { cwd: f.repo, ...env({ gh, now: Date.now() + 10_000 * MIN }) }));
    assert.equal(status, 1);
    assert.ok(existsSync(merged));
  });

  it('refuses a stale flag that swallows the next flag and applies nothing', () => {
    const f = fixture();
    const merged = f.add('merged', '922-merged');
    const gh = () => [pr({ number: 22, headRefName: '922-merged', state: 'MERGED', headRefOid: head(merged) })];
    const { status } = run(() => main(['--stale', '--fix'], { cwd: f.repo, ...env({ gh, now: Date.now() + 10_000 * MIN }) }));
    assert.equal(status, 1);
    assert.ok(existsSync(merged));
  });

  it('refuses a bad threshold without running a pass', () => {
    const f = fixture();
    for (const bad of ['qa=soon', 'lunch=10', 'qa=-1', 'qa=']) {
      assert.equal(run(() => main(['--stale', bad], { cwd: f.repo, ...env() })).status, 1, bad);
    }
  });

  it('applies a stale override from the command line to one phase only', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 15);
    const gh = () => [pr({ number: 21, headRefName: '901-a', headRefOid: head(a), statusCheckRollup: [check('SUCCESS'), review('FAILURE')] })];
    const verdict = (argv) => JSON.parse(run(() => main(['--json', ...argv], { cwd: f.repo, ...env({ gh }) })).out).rows.find((r) => r.path === a);
    assert.equal(verdict([]).verdict, 'ok');
    assert.equal(verdict(['--stale', 'qa=10']).verdict, 'stale');
    assert.equal(verdict(['--stale', 'planning=10']).verdict, 'ok');
  });

  it('refuses unknown positional words and unknown flags', () => {
    const f = fixture();
    for (const argv of [['bogus'], ['--frobnicate'], ['--fix', 'extra'], ['claim']]) {
      assert.equal(run(() => main(argv, { cwd: f.repo, ...env() })).status, 1, argv.join(' '));
    }
  });

  it('returns non-zero outside a git repository instead of crashing', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'watch-adv-plain-')));
    roots.push(dir);
    const result = run(() => main(['--json'], { cwd: dir, ...env() }));
    assert.equal(typeof result.status, 'number');
    assert.notEqual(result.status, 0);
  });

  it('keeps the JSON parseable when --fix prints its actions', () => {
    const f = fixture();
    const dead = f.add('dead', '921-dead');
    lock(f, dead, DEAD_LOCK);
    const { status, out } = run(() => main(['--fix', '--json'], { cwd: f.repo, ...env() }));
    assert.equal(status, 0);
    assert.doesNotThrow(() => JSON.parse(out));
  });

  it('prints each action it took, naming the worktree', () => {
    const f = fixture();
    const dead = f.add('dead', '921-dead');
    const merged = f.add('merged', '922-merged');
    lock(f, dead, DEAD_LOCK);
    const gh = () => [pr({ number: 22, headRefName: '922-merged', state: 'MERGED', headRefOid: head(merged) })];
    const { out } = run(() => main(['--fix'], { cwd: f.repo, ...env({ gh, now: Date.now() + 10_000 * MIN }) }));
    assert.match(out, /unlock/i);
    assert.match(out, /remove/i);
    assert.ok(out.includes('921-dead') || out.includes(dead));
    assert.ok(out.includes('922-merged') || out.includes(merged));
  });

  it('prints the board with the PR unknown and an empty plan when gh fails', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 300);
    const { status, out } = run(() => main(['--json'], { cwd: f.repo, ...env({ gh: () => { throw new Error('offline'); } }) }));
    assert.equal(status, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.rows.find((r) => r.path === a).pr, 'unknown');
    assert.deepEqual(parsed.plan, []);
  });
});

describe('claims, hostile input', () => {
  it('writes the claim through the command and then holds the worktree', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 300);
    const { status } = run(() => main(['claim', a, 'resume'], { cwd: f.repo, ...env() }));
    assert.equal(status, 0);
    const claim = JSON.parse(readFileSync(join(a, '.specify', '.cache', 'watch-claim.json'), 'utf8'));
    assert.equal(claim.fix, 'resume');
    assert.equal(git(a, 'status', '--porcelain'), '');
    assert.equal(rowOf(collect(f.repo, env()), a).holder, 'live');
  });

  it('refuses a fix that is not one of the four agent fixes and writes no file', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    for (const fix of ['remove-worktree', 'delete-branch', '', 'RESUME', '../x']) {
      const { status } = run(() => main(['claim', a, fix], { cwd: f.repo, ...env() }));
      assert.equal(status, 1, JSON.stringify(fix));
    }
    assert.ok(!existsSync(join(a, '.specify', '.cache', 'watch-claim.json')));
  });

  it('refuses a path that does not exist and creates nothing there', () => {
    const f = fixture();
    const ghost = join(f.root, 'no', 'such', 'worktree');
    const { status } = run(() => main(['claim', ghost, 'resume'], { cwd: f.repo, ...env() }));
    assert.equal(status, 1);
    assert.ok(!existsSync(join(f.root, 'no')));
  });

  it('overwrites an earlier claim with the later one', () => {
    const f = fixture();
    const a = f.add('agent-a', '901-a');
    quietCommit(a, 300);
    writeClaim(a, 'resume', NOW - 200 * MIN);
    writeClaim(a, 'fix-ci', NOW - MIN);
    const claim = JSON.parse(readFileSync(join(a, '.specify', '.cache', 'watch-claim.json'), 'utf8'));
    assert.equal(claim.fix, 'fix-ci');
    assert.equal(rowOf(collect(f.repo, env()), a).holder, 'live');
  });
});

describe('boundaries of the repository itself', () => {
  it('lists just the main worktree when there are no others', () => {
    const f = fixture();
    const report = collect(f.repo, env());
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].holder, 'owner');
    assert.equal(report.rows[0].verdict, 'ok');
    assert.deepEqual(report.plan, []);
    assert.deepEqual(report.qaRuns, []);
  });

  it('lists a repository with no commits yet without crashing', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-adv-empty-')));
    roots.push(root);
    git(root, 'init', '-q', '-b', 'main');
    const report = collect(root, env());
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].holder, 'owner');
  });

  it('keeps the main worktree out of the plan however quiet and however failed its PR', () => {
    const f = fixture();
    git(f.repo, 'checkout', '-q', '-b', '921-x');
    const gh = () => [pr({ number: 21, headRefName: '921-x', isDraft: true, headRefOid: head(f.repo), statusCheckRollup: [check('FAILURE')] })];
    const report = collect(f.repo, env({ gh, now: Date.now() + 10_000 * MIN }));
    assert.equal(rowOf(report, f.repo).verdict, 'ok');
    assert.deepEqual(report.plan, []);
  });

  it('lists 28 worktrees in under 30 seconds', () => {
    const f = fixture();
    for (let i = 0; i < 28; i += 1) f.add(`w${i}`, `chore-w${i}`);
    const started = Date.now();
    const report = collect(f.repo, env());
    assert.equal(report.rows.length, 29);
    assert.ok(Date.now() - started < 30_000);
  }, 180_000);
});
