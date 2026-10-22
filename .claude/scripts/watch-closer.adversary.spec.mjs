import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_THRESHOLDS, collect, fixOf, holderOf, phaseOf } from './watch.mjs';

vi.setConfig({ testTimeout: 60_000 });

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.parse('2026-10-04T12:00:00Z');
const opts = { now: NOW, thresholds: DEFAULT_THRESHOLDS };
const agentLock = 'claude agent agent-a1 (pid 2214 start Sun Oct  4 08:07:18 2026)';
const base = { main: false, lock: null, alive: () => false, qaLive: false, claim: null, threshold: 30, now: NOW };

const check = (conclusion) => ({ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion });
const reviewCtx = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const row = (over = {}) => ({ main: false, phase: 'review', holder: 'none', activity: { at: NOW, source: 'run-state' }, pr: null, clean: true, head: 'abc', unpushed: 0, closer: true, ...over });
const prOf = (over) => ({ number: 21, state: 'draft', head: 'abc', checks: 'pending', agentReview: null, mergeable: 'MERGEABLE', ...over });
const phase = (o) => phaseOf({ pr: null, runState: { status: 'in-progress', phase: null }, artifacts: null, qaLive: false, ...o });

describe('holderOf at a closer worktree', () => {
  // @traces 1360-FR-012
  it('reads a claude agent lock with a dead pid as no holder', () => {
    assert.equal(holderOf({ ...base, lock: agentLock, closer: true }), 'none');
  });

  // @traces 1360-FR-012
  it('lets a claim made exactly at the threshold hold the worktree and a claim one minute older not hold it', () => {
    const claim = (min) => ({ fix: 'resume', at: new Date(NOW - min * MIN).toISOString() });
    assert.equal(holderOf({ ...base, lock: agentLock, alive: () => true, closer: true, claim: claim(30) }), 'live');
    assert.equal(holderOf({ ...base, lock: agentLock, alive: () => true, closer: true, claim: claim(31) }), 'none');
  });

  // @traces 1360-FR-012
  it('keeps a dead claude session lock dead and a pid-less lock live', () => {
    assert.equal(holderOf({ ...base, lock: 'claude session s (pid 1 start Sun Oct  4 08:07:18 2026)', closer: true }), 'dead');
    assert.equal(holderOf({ ...base, lock: 'kept by hand', closer: true }), 'live');
  });

  // @traces 1360-FR-012
  it('treats a claim with a garbage time as no claim', () => {
    assert.equal(holderOf({ ...base, lock: agentLock, closer: true, claim: { fix: 'resume', at: 'soon' } }), 'none');
    assert.equal(holderOf({ ...base, lock: agentLock, closer: true, claim: { fix: 'resume', at: null } }), 'none');
  });
});

describe('fixOf at a closer worktree', () => {
  // @traces 1360-FR-012
  it('offers resume whatever the dead holder was', () => {
    for (const holder of ['none', 'dead']) assert.equal(fixOf(row({ holder }), opts).fix, 'resume', holder);
  });

  // @traces 1360-FR-012
  it('does not offer resume once the PR merged or closed', () => {
    for (const state of ['merged', 'closed']) {
      const r = fixOf(row({ phase: 'done', pr: prOf({ state }) }), opts);
      assert.equal(r.verdict, 'done');
      assert.notEqual(r.fix, 'resume');
    }
  });

  // @traces 1360-FR-012
  it('does not offer resume for a finished run', () => {
    assert.notEqual(fixOf(row({ phase: 'done', pr: prOf({ state: 'draft' }) }), opts).fix, 'resume');
  });

  // @traces 1360-FR-012
  it('offers resume to a closer worktree idle for more than a week rather than removing it', () => {
    const r = fixOf(row({ pr: null, activity: { at: NOW - 8 * DAY, source: 'commit' } }), opts);
    assert.equal(r.fix, 'resume');
  });

  // @traces 1360-FR-012
  it('offers resume to a draft with failing checks and with unpushed commits', () => {
    assert.equal(fixOf(row({ pr: prOf({ checks: 'fail' }), unpushed: 3, clean: false }), opts).fix, 'resume');
  });

  // @traces 1360-FR-012
  it('offers nothing once the closer has set refresh', () => {
    const r = fixOf(row({ closer: false, holder: 'live' }), opts);
    assert.equal(r.fix, null);
  });
});

describe('phaseOf order', () => {
  const runState = (status, p) => ({ status, phase: p });

  // @traces 1360-FR-011
  it('puts a merged or closed PR ahead of a blocked run', () => {
    for (const state of ['merged', 'closed']) assert.equal(phase({ pr: prOf({ state }), runState: runState('blocked', 'closer') }), 'done', state);
  });

  // @traces 1360-FR-011
  it('puts a blocked run ahead of a ready PR that passed everything', () => {
    assert.equal(phase({ pr: prOf({ state: 'ready', checks: 'pass', agentReview: 'success' }), runState: runState('blocked', 'merge') }), 'blocked');
  });

  // @traces 1360-FR-011
  it('says merging for a ready PR with every check passed and agent-review success', () => {
    assert.equal(phase({ pr: prOf({ state: 'ready', checks: 'pass', agentReview: 'success' }), runState: runState('in-progress', 'closer') }), 'merging');
  });

  // @traces 1360-FR-011
  it('says qa for a ready PR carrying an agent-review result that is not success', () => {
    assert.equal(phase({ pr: prOf({ state: 'ready', checks: 'pass', agentReview: 'failure' }), runState: runState('in-progress', 'closer') }), 'qa');
  });

  // @traces 1360-FR-011
  it('says qa for a ready PR whose QA run is live', () => {
    assert.equal(phase({ pr: prOf({ state: 'ready' }), qaLive: true, runState: runState('in-progress', 'closer') }), 'qa');
  });

  // @traces 1360-FR-011
  it('says qa for a ready PR with no agent-review result and no live QA run, whatever run-state says', () => {
    assert.equal(phase({ pr: prOf({ state: 'ready', agentReview: null }), qaLive: false, runState: runState('in-progress', 'closer') }), 'qa');
  });

  // @traces 1360-FR-011
  it('puts run-state done ahead of the phase table for a draft', () => {
    assert.equal(phase({ pr: prOf({ state: 'draft' }), runState: runState('done', 'closer') }), 'done');
  });

  // @traces 1360-FR-011
  it('treats an unknown PR as no PR', () => {
    assert.equal(phase({ pr: 'unknown', runState: runState('in-progress', 'closer') }), 'review');
  });
});

describe('phaseOf phase names', () => {
  // @traces 1360-FR-011
  it('falls through to the artifacts for names the table does not hold, including object property names', () => {
    const artifacts = { spec: true, plan: true, tasks: true, open: 2, done: 1 };
    for (const p of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'Closer', ' closer', 'closer ', '', null, undefined, 7, 'agent-context']) {
      assert.equal(phase({ runState: { status: 'in-progress', phase: p }, artifacts }), 'development', String(p));
    }
  });

  // @traces 1360-FR-011
  it('falls through to review when every task is done, and to planning when an artifact is missing', () => {
    const done = { spec: true, plan: true, tasks: true, open: 0, done: 4 };
    assert.equal(phase({ runState: { status: 'in-progress', phase: 'agent-context' }, artifacts: done }), 'review');
    assert.equal(phase({ runState: { status: 'in-progress', phase: 'agent-context' }, artifacts: { ...done, plan: false } }), 'planning');
  });

  // @traces 1360-FR-011
  it('says development with no feature and an empty run-state', () => {
    assert.equal(phase({ runState: {}, artifacts: null }), 'development');
  });

  // @traces 1360-FR-011
  it('reads the plan stage for every phase the table lists as planning', () => {
    for (const p of ['size', 'constitution', 'specify', 'context', 'clarify', 'plan', 'checklist', 'tasks', 'analyze']) assert.equal(phase({ runState: { status: 'in-progress', phase: p } }), 'planning', p);
  });
});

describe('collect with a closer worktree', () => {
  const roots = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
  });
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-closer-')));
    roots.push(root);
    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'README.md'), 'x\n');
    mkdirSync(join(repo, '.specify'));
    writeFileSync(join(repo, '.gitignore'), '.specify/run-state.json\n');
    git(repo, 'add', '.');
    const at = new Date(NOW).toISOString();
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at } });
    git(root, 'init', '-q', '--bare', 'origin.git');
    git(repo, 'remote', 'add', 'origin', join(root, 'origin.git'));
    git(repo, 'push', '-q', 'origin', 'main');
    const wt = join(root, 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', '906-closer', wt);
    mkdirSync(join(wt, '.specify'), { recursive: true });
    git(repo, 'worktree', 'lock', '--reason', 'claude agent x (pid 2214 start Sun Oct  4 08:07:18 2026)', wt);
    return { repo, wt };
  }
  const env = (over = {}) => ({ now: NOW, gh: () => [], alive: (pid) => pid === 2214, pidAlive: () => false, remove: (path) => ({ path, removed: false, reason: 'not run in tests' }), ...over });
  const state = (wt, s) => writeFileSync(join(wt, '.specify', 'run-state.json'), JSON.stringify({ updated: new Date(NOW - MIN).toISOString(), ...s }));
  const rowOf = (f, over) => collect(f.repo, env(over)).rows.find((x) => x.path === f.wt);

  // @traces 1360-FR-012
  it('does not offer resume when the run-state says done', () => {
    const f = fixture();
    state(f.wt, { status: 'done', phase: 'closer' });
    assert.notEqual(rowOf(f).fix, 'resume');
  });

  // @traces 1360-FR-012
  it('does not offer resume for a run-state that is not valid JSON', () => {
    const f = fixture();
    writeFileSync(join(f.wt, '.specify', 'run-state.json'), '{"phase":"closer"');
    assert.notEqual(rowOf(f).fix, 'resume');
  });

  // @traces 1360-FR-012
  it('offers resume for phase closer when the status is missing', () => {
    const f = fixture();
    state(f.wt, { phase: 'closer' });
    assert.equal(rowOf(f).fix, 'resume');
  });

  // @traces 1360-FR-012
  it('offers resume for phase closer even when the run-state was written a week ago', () => {
    const f = fixture();
    writeFileSync(join(f.wt, '.specify', 'run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'closer', updated: new Date(NOW - 7 * DAY).toISOString() }));
    assert.equal(rowOf(f).fix, 'resume');
  });

  // @traces 1360-FR-012
  it('reads a closer worktree behind a dead story agent lock as having no holder', () => {
    const f = fixture();
    state(f.wt, { status: 'in-progress', phase: 'closer' });
    const r = rowOf(f);
    assert.equal(r.fix, 'resume');
    assert.equal(r.holder, 'none');
  });
});
