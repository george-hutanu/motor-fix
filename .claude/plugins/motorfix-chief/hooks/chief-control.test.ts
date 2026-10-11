import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

// @traces 1168-FR-002 1168-FR-003 1168-FR-004 1168-FR-005 1168-FR-010 1168-FR-023

const MIN = 60_000;
const CHIEF = '/m/.git\n/m/.git\n';
const WORKER = '/m/.git/worktrees/41-slug\n/m/.git\n';
const row = (pr: number, patch = {}) => ({
  ci: null,
  head: null,
  holder: null,
  holderSession: null,
  lap: 0,
  pr,
  qaRun: null,
  stage: null,
  updatedAt: 0,
  worktree: null,
  ...patch,
});
const watchJson = (prs: { number: number; state: string }[]) =>
  JSON.stringify({
    rows: prs.map((pr, i) => ({
      holder: 'none',
      main: false,
      path: `/m/.worktrees/w${i}`,
      pr,
    })),
  });
const isGate = (argv: readonly string[]) => argv.includes('--gate');
const isJson = (argv: readonly string[]) => argv.includes('--json');
const start = ($, cwd = '/m') =>
  $.session.start({ cwd, isInteractive: true, surface: 'terminal' });
const bash =
  (_command: string, stdout = '', extra = {}) =>
  () => ({
    result: { interrupted: false, stderr: '', stdout, ...extra },
  });

test('Chief records its session at start and removes it at end', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF), session: 'sess-chief' });
  await start($);
  expect(s.store.get('chief')).toMatchObject({ sessionId: 'sess-chief' });
  await $.session.end({ reason: 'other' });
  expect(s.store.has('chief')).toBe(false);
});

test('a worker session writes no chief key and runs no gate', async ($, on) => {
  const s = stubs(on, { run: () => ok(WORKER) });
  await start($, '/m/.worktrees/41-slug');
  await s.clock.advance(60 * MIN);
  expect(s.store.has('chief')).toBe(false);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
});

test('dispatch.mjs fills the row from its QA-run line', async ($, on) => {
  const s = stubs(on, {
    store: { 'pr:41': row(41, { holder: 'agent-7f3' }) },
  });
  on(
    'tool.call',
    { tool: 'Bash' },
    bash('', '- QA run: 9000000001 · head 8e6a1b2c3d4e · lap 2 · https://x\n'),
  );
  await $.tool.call({
    command: 'node .claude/scripts/pr-test/dispatch.mjs 41 --no-wait',
    tool: 'Bash',
  });
  expect(s.store.get('pr:41')).toMatchObject({
    head: '8e6a1b2',
    holder: 'agent-7f3',
    lap: 2,
    qaRun: 9000000001,
  });
});

test('a foreground ci-wait with --run whose QA run succeeded sets ci pass and offers the tail once per head', async ($, on) => {
  const s = stubs(on, { store: { 'pr:41': row(41, { head: 'abc1234' }) } });
  on('tool.call', { tool: 'Bash' }, bash('', 'QA run: success\n'));
  const call = () =>
    $.tool.call({
      command: 'node .claude/scripts/pr-test/ci-wait.mjs 41 --run 99',
      tool: 'Bash',
    });
  const first = await call();
  expect(s.store.get('pr:41')).toMatchObject({ ci: 'pass', qaRun: 99 });
  expect(first.context?.join('\n')).toContain('tail #41 after QA run 99');
  expect(s.store.get('offer:41:abc1234')).toMatchObject({ runId: 99 });
  const second = await call();
  expect(second.context ?? []).toHaveLength(0);
});

test('a ci-wait without --run, or one that prints a failing check, offers nothing', async ($, on) => {
  const s = stubs(on, { store: { 'pr:41': row(41, { head: 'abc1234' }) } });
  let out = '';
  on('tool.call', { tool: 'Bash' }, () => bash('', out)());
  const plain = await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 41',
    tool: 'Bash',
  });
  expect(plain.context ?? []).toHaveLength(0);
  out = 'Unit and integration tests: fail\n';
  const failed = await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 41 --run 99',
    tool: 'Bash',
  });
  expect(failed.context ?? []).toHaveLength(0);
  expect(s.store.get('pr:41')).toMatchObject({ ci: 'fail' });
  out = 'QA run: failure\n';
  const qaFailed = await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 41 --run 100',
    tool: 'Bash',
  });
  expect(qaFailed.context ?? []).toHaveLength(0);
  expect(s.store.get('pr:41')).toMatchObject({ ci: 'fail' });
  expect(s.store.get('offer:41:abc1234')).toBeUndefined();
});

// A background wait's output never reaches the plugin, so on its notification
// the plugin asks ci-wait.mjs again (everything has finished, so it answers at once).
const CI_WAIT = 'node .claude/scripts/pr-test/ci-wait.mjs 41 --run 99';
const note = (code: number) =>
  `<task-notification>\n<task-id>bt14</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code ${code})</summary>\n</task-notification>`;
async function waitInBackground($, on, recheck: string) {
  const s = stubs(on, {
    run: (argv) => (argv.join(' ') === CI_WAIT ? ok(recheck) : ok()),
    store: { 'pr:41': row(41, { head: 'abc1234' }) },
  });
  on('tool.call', { tool: 'Bash' }, bash('', '', { backgroundTaskId: 'bt14' }));
  await $.tool.call({
    command: CI_WAIT,
    run_in_background: true,
    tool: 'Bash',
  });
  expect(s.store.get('pr:41')).toMatchObject({ ci: 'pending' });
  return s;
}

test('a background ci-wait --run that exits 0 and reads green again offers the tail', async ($, on) => {
  const s = await waitInBackground($, on, 'QA run: success\n');
  const r = await $.prompt.submit({ text: note(0) });
  expect(r.context?.join('\n')).toContain('tail #41 after QA run 99');
  expect(s.store.get('pr:41')).toMatchObject({ ci: 'pass' });
  expect(s.runs.map((x) => x.argv.join(' '))).toContain(CI_WAIT);
});

for (const out of [
  'QA run: failure\n',
  'Unit and integration tests: fail\nQA run: success\n',
]) {
  test(`a background ci-wait --run that exits 0 but reads ${JSON.stringify(out)} offers nothing`, async ($, on) => {
    const s = await waitInBackground($, on, out);
    const r = await $.prompt.submit({ text: note(0) });
    expect(r.context ?? []).toHaveLength(0);
    expect(s.store.get('pr:41')).toMatchObject({ ci: 'fail' });
    expect(s.store.get('offer:41:abc1234')).toBeUndefined();
  });
}

test('a background recheck that cannot read CI leaves ci pending, offers nothing and says so', async ($, on) => {
  const s = stubs(on, {
    run: (argv) =>
      argv.join(' ') === CI_WAIT
        ? { exitCode: 2, stderr: 'gh failed', stdout: 'CI: unreadable\n' }
        : ok(),
    store: { 'pr:41': row(41, { head: 'abc1234' }) },
  });
  on('tool.call', { tool: 'Bash' }, bash('', '', { backgroundTaskId: 'bt14' }));
  await $.tool.call({
    command: CI_WAIT,
    run_in_background: true,
    tool: 'Bash',
  });
  const r = await $.prompt.submit({ text: note(0) });
  expect(r.context ?? []).toHaveLength(0);
  expect(s.store.get('pr:41')).toMatchObject({ ci: 'pending' });
  expect(s.toasts).toEqual([
    'motorfix-chief: could not re-read CI for #41; run ci-wait.mjs 41 --run 99 again',
  ]);
});

test('the ledger block after compaction lists every row in PR order', async ($, on) => {
  stubs(on, {
    run: () => ok(CHIEF),
    store: {
      'pr:12': row(12, { stage: 'planning' }),
      'pr:41': row(41, { qaRun: 5, stage: 'QA' }),
    },
  });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  const block = r.blocks.find((b) => b.name === 'motorfixLedger');
  expect(block?.text.split('\n')).toEqual([
    '<!-- motorfix-chief ledger -->',
    '#12 planning lap 0/10 run – ci – head – holder – worktree – age 0m',
    '#41 QA lap 0/10 run 5 ci – head – holder – worktree – age 0m',
  ]);
});

test('the ledger read clears a holder whose agent this session dispatched has ended', async ($, on) => {
  const s = stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'completed' }],
    run: () => ok(CHIEF),
    store: {
      'pr:41': row(41, {
        holder: 'agent-7f3',
        holderSession: 'sess-a',
        stage: 'QA',
      }),
      'pr:43': row(43, {
        holder: 'agent-9',
        holderSession: 'sess-b',
        stage: 'QA',
      }),
    },
  });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  expect(s.store.get('pr:41')).toMatchObject({
    holder: null,
    holderSession: null,
  });
  expect(s.store.get('pr:43')).toMatchObject({ holder: 'agent-9' });
  expect(r.blocks.find((b) => b.name === 'motorfixLedger')?.text).toContain(
    '#41 QA lap 0/10 run – ci – head – holder – ',
  );
});

test('an empty ledger gives the one empty line', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  expect(r.blocks.find((b) => b.name === 'motorfixLedger')?.text).toBe(
    '<!-- motorfix-chief ledger -->\nNo PR is held.',
  );
});

test('the gate runs every 15 minutes in Chief with two active worktrees and wakes on exit 2', async ($, on) => {
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv))
        return ok(
          watchJson([
            { number: 41, state: 'ready' },
            { number: 42, state: 'draft' },
          ]),
        );
      if (isGate(argv))
        return { exitCode: 2, stderr: '', stdout: 'tail #41\n' };
      return ok(CHIEF);
    },
  });
  await start($);
  await s.clock.advance(60 * MIN);
  const gates = s.runs.filter((r) => isGate(r.argv));
  expect(gates).toHaveLength(4);
  expect(gates[0].init).toMatchObject({ cwd: '/m', timeoutMs: 600_000 });
  expect(s.submitted[0]).toBe(
    'motorfix-chief watch gate: run /speckit-watch for these items.\ntail #41',
  );
});

test('a gate still running is never started twice', async ($, on) => {
  let release = () => {};
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv))
        return ok(
          watchJson([
            { number: 41, state: 'ready' },
            { number: 42, state: 'ready' },
          ]),
        );
      if (isGate(argv))
        return new Promise((resolve) => {
          release = () => resolve(ok());
        });
      return ok(CHIEF);
    },
  });
  await start($);
  await s.clock.advance(15 * MIN);
  await s.clock.advance(15 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(1);
  release();
});

test('one active worktree runs no gate; exit 1 shows one toast; a merged PR leaves the ledger with its tail offers', async ($, on) => {
  let prs = [
    { number: 41, state: 'merged' },
    { number: 42, state: 'draft' },
  ];
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv)) return ok(watchJson(prs));
      if (isGate(argv)) return { exitCode: 1, stderr: 'boom', stdout: '' };
      return ok(CHIEF);
    },
    store: {
      'offer:41:abc1234': { answer: null, offeredAt: 0, runId: 5 },
      'offer:41:def5678': { answer: null, offeredAt: 0, runId: 6 },
      'offer:42:abc1234': { answer: null, offeredAt: 0, runId: 8 },
      'offer:410:abc1234': { answer: null, offeredAt: 0, runId: 7 },
      'pr:41': row(41),
      'pr:42': row(42),
    },
  });
  await start($);
  await s.clock.advance(15 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
  expect(s.store.has('pr:41')).toBe(false);
  expect(s.store.has('pr:42')).toBe(true);
  expect(
    [...s.store.keys()].filter((k) => k.startsWith('offer:')).sort(),
  ).toEqual(['offer:410:abc1234', 'offer:42:abc1234']);
  prs = [
    { number: 42, state: 'draft' },
    { number: 44, state: 'ready' },
  ];
  await s.clock.advance(15 * MIN);
  expect(s.toasts.filter((t) => t.includes('watch gate'))).toHaveLength(1);
  expect(s.submitted).toHaveLength(0);
});
