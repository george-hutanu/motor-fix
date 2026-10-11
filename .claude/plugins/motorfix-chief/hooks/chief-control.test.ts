import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

const MIN = 60_000;
const CHIEF = '/m/.git\n/m/.git\n';
const WORKER = '/m/.git/worktrees/363-slug\n/m/.git\n';
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

test('Chief records its session at start and removes it at end (FR-010)', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF), session: 'sess-chief' });
  await start($);
  expect(s.store.get('chief')).toMatchObject({ sessionId: 'sess-chief' });
  await $.session.end({ reason: 'other' });
  expect(s.store.has('chief')).toBe(false);
});

test('a worker session writes no chief key and runs no gate (FR-003)', async ($, on) => {
  const s = stubs(on, { run: () => ok(WORKER) });
  await start($, '/m/.worktrees/363-slug');
  await s.clock.advance(60 * MIN);
  expect(s.store.has('chief')).toBe(false);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
});

test('dispatch.mjs fills the row from its QA-run line (FR-002)', async ($, on) => {
  const s = stubs(on, {
    store: { 'pr:363': row(363, { holder: 'agent-7f3' }) },
  });
  on(
    'tool.call',
    { tool: 'Bash' },
    bash('', '- QA run: 38135939640 · head 8e6a1b2c3d4e · lap 2 · https://x\n'),
  );
  await $.tool.call({
    command: 'node .claude/scripts/pr-test/dispatch.mjs 363 --no-wait',
    tool: 'Bash',
  });
  expect(s.store.get('pr:363')).toMatchObject({
    head: '8e6a1b2',
    holder: 'agent-7f3',
    lap: 2,
    qaRun: 38135939640,
  });
});

test('a foreground ci-wait with --run that comes back empty sets ci pass and offers the tail once per head (FR-004)', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { head: 'abc1234' }) } });
  on('tool.call', { tool: 'Bash' }, bash('', ''));
  const call = () =>
    $.tool.call({
      command: 'node .claude/scripts/pr-test/ci-wait.mjs 363 --run 99',
      tool: 'Bash',
    });
  const first = await call();
  expect(s.store.get('pr:363')).toMatchObject({ ci: 'pass', qaRun: 99 });
  expect(first.context?.join('\n')).toContain('tail #363 after QA run 99');
  expect(s.store.get('offer:363:abc1234')).toMatchObject({ runId: 99 });
  const second = await call();
  expect(second.context ?? []).toHaveLength(0);
});

test('a ci-wait without --run, or one that prints a failing check, offers nothing', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { head: 'abc1234' }) } });
  let out = '';
  on('tool.call', { tool: 'Bash' }, () => bash('', out)());
  const plain = await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 363',
    tool: 'Bash',
  });
  expect(plain.context ?? []).toHaveLength(0);
  out = 'Unit and integration tests: fail\n';
  const failed = await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 363 --run 99',
    tool: 'Bash',
  });
  expect(failed.context ?? []).toHaveLength(0);
  expect(s.store.get('pr:363')).toMatchObject({ ci: 'fail' });
});

test('a background ci-wait --run offers the tail on its notification, only on exit 0', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { head: 'abc1234' }) } });
  on('tool.call', { tool: 'Bash' }, bash('', '', { backgroundTaskId: 'bt14' }));
  await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 363 --run 99',
    run_in_background: true,
    tool: 'Bash',
  });
  expect(s.store.get('pr:363')).toMatchObject({ ci: 'pending' });
  const note = (code: number) =>
    `<task-notification>\n<task-id>bt14</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code ${code})</summary>\n</task-notification>`;
  const r = await $.prompt.submit({ text: note(0) });
  expect(r.context?.join('\n')).toContain('tail #363 after QA run 99');
  expect(s.store.get('pr:363')).toMatchObject({ ci: 'pass' });
});

test('the ledger block after compaction lists every row in PR order (SC-002, FR-023)', async ($, on) => {
  stubs(on, {
    run: () => ok(CHIEF),
    store: {
      'pr:12': row(12, { stage: 'planning' }),
      'pr:363': row(363, { qaRun: 5, stage: 'QA' }),
    },
  });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  const block = r.blocks.find((b) => b.name === 'motorfixLedger');
  expect(block?.text.split('\n')).toEqual([
    '<!-- motorfix-chief ledger -->',
    '#12 planning lap 0/10 run – ci – head – holder – worktree – age 0m',
    '#363 QA lap 0/10 run 5 ci – head – holder – worktree – age 0m',
  ]);
});

test('an empty ledger gives the one empty line', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  expect(r.blocks.find((b) => b.name === 'motorfixLedger')?.text).toBe(
    '<!-- motorfix-chief ledger -->\nNo PR is held.',
  );
});

test('the gate runs every 15 minutes in Chief with two active worktrees and wakes on exit 2 (SC-003)', async ($, on) => {
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv))
        return ok(
          watchJson([
            { number: 363, state: 'ready' },
            { number: 370, state: 'draft' },
          ]),
        );
      if (isGate(argv))
        return { exitCode: 2, stderr: '', stdout: 'tail #363\n' };
      return ok(CHIEF);
    },
  });
  await start($);
  await s.clock.advance(60 * MIN);
  const gates = s.runs.filter((r) => isGate(r.argv));
  expect(gates).toHaveLength(4);
  expect(gates[0].init).toMatchObject({ cwd: '/m', timeoutMs: 600_000 });
  expect(s.submitted[0]).toBe(
    'motorfix-chief watch gate: run /speckit-watch for these items.\ntail #363',
  );
});

test('a gate still running is never started twice', async ($, on) => {
  let release = () => {};
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv))
        return ok(
          watchJson([
            { number: 363, state: 'ready' },
            { number: 370, state: 'ready' },
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

test('one active worktree runs no gate; exit 1 shows one toast; a merged PR leaves the ledger', async ($, on) => {
  let prs = [
    { number: 363, state: 'merged' },
    { number: 370, state: 'draft' },
  ];
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv)) return ok(watchJson(prs));
      if (isGate(argv)) return { exitCode: 1, stderr: 'boom', stdout: '' };
      return ok(CHIEF);
    },
    store: { 'pr:363': row(363), 'pr:370': row(370) },
  });
  await start($);
  await s.clock.advance(15 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
  expect(s.store.has('pr:363')).toBe(false);
  expect(s.store.has('pr:370')).toBe(true);
  prs = [
    { number: 370, state: 'draft' },
    { number: 371, state: 'ready' },
  ];
  await s.clock.advance(15 * MIN);
  expect(s.toasts.filter((t) => t.includes('watch gate'))).toHaveLength(1);
  expect(s.submitted).toHaveLength(0);
});
