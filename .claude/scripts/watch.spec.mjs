import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_THRESHOLDS,
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

const rollup = (...entries) => entries;
const check = (conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name: 'ci', status, conclusion });
const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });

const pr = (over = {}) => ({
  number: 21,
  headRefName: '901-fixture-urls',
  state: 'OPEN',
  isDraft: false,
  headRefOid: 'abc',
  statusCheckRollup: rollup(check('SUCCESS')),
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
    const s = summarizePr(pr({ statusCheckRollup: rollup(check('SUCCESS'), review('SUCCESS')) }));
    assert.equal(s.checks, 'pass');
    assert.equal(s.agentReview, 'success');
  });

  it('reads a failed, a pending and an absent check', () => {
    assert.equal(summarizePr(pr({ statusCheckRollup: rollup(check('SUCCESS'), check('FAILURE')) })).checks, 'fail');
    assert.equal(summarizePr(pr({ statusCheckRollup: rollup(check(null, 'IN_PROGRESS')) })).checks, 'pending');
    assert.equal(summarizePr(pr({ statusCheckRollup: rollup(check('SKIPPED'), check('NEUTRAL')) })).checks, 'pass');
    assert.equal(summarizePr(pr({ statusCheckRollup: [] })).checks, 'none');
    assert.equal(summarizePr(pr({ statusCheckRollup: rollup(review('FAILURE')) })).agentReview, 'failure');
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
    assert.equal(phaseOf({ ...none, pr: ready, runState: { status: 'done', phase: 'retro' } }), 'review');
    assert.equal(phaseOf({ ...none, pr: ready, runState: { status: 'blocked', phase: 'pr-test' } }), 'blocked');
  });

  it('is merging, qa or review for a ready PR', () => {
    const ready = (rollupEntries) => summarizePr(pr({ statusCheckRollup: rollupEntries }));
    assert.equal(phaseOf({ ...none, pr: ready(rollup(check('SUCCESS'), review('SUCCESS'))) }), 'merging');
    assert.equal(phaseOf({ ...none, pr: ready(rollup(check('SUCCESS'), review('FAILURE'))) }), 'qa');
    assert.equal(phaseOf({ ...none, pr: ready(rollup(check('SUCCESS'))), qaLive: true }), 'qa');
    assert.equal(phaseOf({ ...none, pr: ready(rollup(check('SUCCESS'))) }), 'review');
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
    assert.equal(fixOf(row({ ...quiet, phase: 'merging', pr: ready(rollup(check('SUCCESS'), review('SUCCESS'))) }), opts).fix, 'merge');
    assert.equal(fixOf(row({ ...quiet, pr: summarizePr(pr({ isDraft: true, statusCheckRollup: rollup(check('FAILURE')) })) }), opts).fix, 'fix-ci');
    assert.equal(fixOf(row({ ...quiet, phase: 'review', pr: ready(rollup(check('SUCCESS'))) }), opts).fix, 'rerun-qa');
    assert.equal(fixOf(row({ ...quiet, phase: 'qa', pr: ready(rollup(check('SUCCESS'), review('FAILURE'))) }), opts).fix, 'resume');
    assert.equal(fixOf(row({ ...quiet, pr: summarizePr(pr({ isDraft: true })) }), opts).fix, 'resume');
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

  it('never fixes a blocked worktree', () => {
    const r = fixOf(row({ phase: 'blocked', activity: { at: 0, source: 'commit' } }), opts);
    assert.equal(r.verdict, 'blocked');
    assert.equal(r.fix, null);
  });
});

describe('dispatch plan', () => {
  const stale = (path, fix, minutesQuiet) => ({ path, verdict: 'stale', fix, activity: { at: NOW - minutesQuiet * MIN }, claim: null });

  it('dispatches no QA run while 4 are live', () => {
    const plan = dispatchPlan([stale('a', 'rerun-qa', 50), stale('b', 'rerun-qa', 60)], { qaLive: 4, now: NOW });
    assert.deepEqual(plan, []);
  });

  it('fills the free QA places, oldest first', () => {
    const rows = [stale('a', 'rerun-qa', 50), stale('b', 'rerun-qa', 90), stale('c', 'rerun-qa', 70)];
    const plan = dispatchPlan(rows, { qaLive: 2, now: NOW });
    assert.deepEqual(plan.map((p) => p.path), ['b', 'c']);
  });

  it('runs at most 2 other agent fixes at once, counting live claims', () => {
    const rows = [stale('a', 'resume', 50), stale('b', 'fix-ci', 60), stale('c', 'merge', 70)];
    assert.equal(dispatchPlan(rows, { qaLive: 0, now: NOW }).length, 2);
    const claimed = { path: 'z', verdict: 'ok', fix: null, claim: { fix: 'resume', at: new Date(NOW - MIN).toISOString(), live: true } };
    assert.equal(dispatchPlan([...rows, claimed], { qaLive: 0, now: NOW }).length, 1);
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
