import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOCKING_CONDITIONS,
  DEFAULT_MAX_REPAIRS,
  countRepair,
  emptyState,
  main,
  readState,
  statePath,
  transition,
  writeState,
} from './run-state.mjs';

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-runstate-'));
  mkdirSync(join(dir, '.specify'), { recursive: true });
  return dir;
};

const capture = (fn) => {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    return { status: fn(), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
};

describe('run state on disk', () => {
  it('reads a fresh state when nothing has been written', () => {
    const dir = repo();
    try {
      assert.deepEqual(readState(dir), emptyState());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a corrupt file as fresh rather than throwing', () => {
    // A run that cannot start because its own bookkeeping is malformed is a
    // worse failure than one that starts from the beginning.
    const dir = repo();
    try {
      writeFileSync(statePath(dir), '{ not json');
      assert.equal(readState(dir).status, 'draft');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stamps every write with a timestamp and round-trips', () => {
    const dir = repo();
    try {
      const written = writeState(dir, { ...emptyState(), status: 'in-progress', phase: 'implement' });
      assert.match(written.updated, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(readState(dir).phase, 'implement');
      assert.match(readFileSync(statePath(dir), 'utf8'), /\n$/, 'the file stays newline-terminated');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('transitions', () => {
  it('applies only the fields it is given', () => {
    const { state } = transition({ ...emptyState(), phase: 'plan' }, { status: 'in-progress' });
    assert.equal(state.status, 'in-progress');
    assert.equal(state.phase, 'plan', 'an unspecified field keeps its value');
  });

  it('refuses a status outside the vocabulary', () => {
    const { error } = transition(emptyState(), { status: 'nearly-done' });
    assert.match(error, /unknown status/);
  });

  it('refuses blocked with no condition — a run that stops silently reads as one that finished', () => {
    const { error, state } = transition(emptyState(), { status: 'blocked' });
    assert.equal(state, undefined);
    assert.match(error, /needs --blocking/);
  });

  it('accepts blocked with a condition from the vocabulary and refuses one outside it', () => {
    const ok = transition(emptyState(), { status: 'blocked', blocking: 'unclear-intent' });
    assert.equal(ok.state.blocking_condition, 'unclear-intent');
    assert.match(transition(emptyState(), { status: 'blocked', blocking: 'vibes' }).error, /unknown blocking condition/);
  });

  it('clears the condition when the run leaves blocked', () => {
    const blocked = transition(emptyState(), { status: 'blocked', blocking: 'red-suite' }).state;
    const resumed = transition(blocked, { status: 'in-progress' }).state;
    assert.equal(resumed.blocking_condition, null, 'a stale reason on a running cycle is read as current');
  });

  it('resets the repair count when a cycle finishes or restarts, and not otherwise', () => {
    const laps = { ...emptyState(), repair_iterations: 3 };
    assert.equal(transition(laps, { status: 'done' }).state.repair_iterations, 0);
    assert.equal(transition(laps, { status: 'draft' }).state.repair_iterations, 0);
    assert.equal(transition(laps, { status: 'in-review' }).state.repair_iterations, 3);
  });

  it('names every blocking condition it accepts in the error it raises', () => {
    const { error } = transition(emptyState(), { status: 'blocked', blocking: 'nope' });
    for (const condition of BLOCKING_CONDITIONS) assert.ok(error.includes(condition), `${condition} must be listed`);
  });
});

describe('the repair cap', () => {
  it('counts laps below the cap without blocking', () => {
    let state = emptyState();
    for (let i = 1; i <= DEFAULT_MAX_REPAIRS; i += 1) {
      const result = countRepair(state);
      state = result.state;
      assert.equal(result.exceeded, false);
      assert.equal(state.repair_iterations, i);
      assert.equal(state.status, 'draft', 'a lap under the cap changes nothing but the count');
    }
  });

  it('blocks the run on the lap past the cap', () => {
    const at = { ...emptyState(), status: 'in-review', repair_iterations: DEFAULT_MAX_REPAIRS };
    const { state, exceeded } = countRepair(at);
    assert.equal(exceeded, true);
    assert.equal(state.status, 'blocked');
    assert.equal(state.blocking_condition, 'repair-loop-exceeded');
  });

  it('honours a lower cap', () => {
    const { exceeded } = countRepair({ ...emptyState(), repair_iterations: 1 }, 1);
    assert.equal(exceeded, true);
  });
});

describe('the run-state command', () => {
  it('prints the state as JSON for an orchestrator and as text for a human', () => {
    const dir = repo();
    try {
      writeState(dir, { ...emptyState(), status: 'in-review', phase: 'harden' });
      const json = capture(() => main(['show', '--json'], dir));
      assert.equal(JSON.parse(json.out).phase, 'harden');
      const text = capture(() => main(['show'], dir));
      assert.match(text.out, /status\s+in-review/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a transition and refuses an invalid one without touching the file', () => {
    const dir = repo();
    try {
      assert.equal(capture(() => main(['set', '--status', 'in-progress', '--phase', 'implement'], dir)).status, 0);
      assert.equal(readState(dir).status, 'in-progress');
      const bad = capture(() => main(['set', '--status', 'blocked'], dir));
      assert.equal(bad.status, 1);
      assert.match(bad.err, /needs --blocking/);
      assert.equal(readState(dir).status, 'in-progress', 'a refused transition must not be half applied');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts --flag=value as well as --flag value', () => {
    const dir = repo();
    try {
      capture(() => main(['set', '--status=done', '--phase=review'], dir));
      assert.equal(readState(dir).status, 'done');
      assert.equal(readState(dir).phase, 'review');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts a repair lap, and exits non-zero with the state blocked at the cap', () => {
    const dir = repo();
    try {
      const first = capture(() => main(['repair', '--max', '2'], dir));
      assert.equal(first.status, 0);
      assert.match(first.out, /iteration 1 of 2/);
      capture(() => main(['repair', '--max', '2'], dir));
      const over = capture(() => main(['repair', '--max', '2'], dir));
      assert.equal(over.status, 1, 'the cap must be reportable by exit code, not only in prose');
      assert.match(over.err, /repair loop exceeded 2/);
      assert.equal(readState(dir).status, 'blocked');
      assert.equal(readState(dir).blocking_condition, 'repair-loop-exceeded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes the cap from the environment when no flag says otherwise', () => {
    const dir = repo();
    try {
      writeState(dir, { ...emptyState(), repair_iterations: 1 });
      const result = capture(() => main(['repair'], dir, { SPECKIT_MAX_REPAIR_ITERATIONS: '1' }));
      assert.equal(result.status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the default cap when the environment value is nonsense', () => {
    const dir = repo();
    try {
      writeState(dir, { ...emptyState(), repair_iterations: 1 });
      assert.equal(capture(() => main(['repair'], dir, { SPECKIT_MAX_REPAIR_ITERATIONS: 'lots' })).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clears back to a fresh state', () => {
    const dir = repo();
    try {
      writeState(dir, { ...emptyState(), status: 'blocked', blocking_condition: 'red-suite', repair_iterations: 4 });
      capture(() => main(['clear'], dir));
      const cleared = readState(dir);
      assert.equal(cleared.status, 'draft');
      assert.equal(cleared.blocking_condition, null);
      assert.equal(cleared.repair_iterations, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unknown command instead of doing something else', () => {
    const dir = repo();
    try {
      const result = capture(() => main(['finish'], dir));
      assert.equal(result.status, 1);
      assert.match(result.err, /unknown command/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
