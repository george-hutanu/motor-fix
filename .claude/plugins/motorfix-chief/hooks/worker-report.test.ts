import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

// @traces 1168-FR-010

const TREE = '/m/.worktrees/42-slug';
const WORKER = '/m/.git/worktrees/42-slug\n/m/.git\n';
const CHIEF = '/m/.git\n/m/.git\n';
const WATCH = JSON.stringify({
  rows: [
    { main: true, path: '/m', pr: null },
    {
      head: 'abc1234def5678abc1234def5678abc1234def56',
      main: false,
      path: TREE,
      pr: { number: 42, state: 'open' },
    },
  ],
});
const RECORDED = {
  chief: { sessionId: 'sess-chief', startedAt: 0 },
  'pr:42': { pr: 42, stage: 'in development', updatedAt: 0 },
};

// rev-parse answers as a worker (or Chief); watch.mjs finds the PR and the
// worktree's head.
const runner = (revParse: string) => (argv: readonly string[]) => {
  if (argv.includes('--git-common-dir')) return ok(revParse);
  if (argv.includes('--json')) return ok(WATCH);
  return ok();
};

// Beneath the plugin: the shell answers every Bash call, and a turn ends as answered.
function engine(on) {
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { interrupted: false, stderr: '', stdout: '' },
  }));
  on('turn.complete', (_$, e) => ({ text: e.answer }));
}

const start = ($, cwd = TREE) =>
  $.session.start({ cwd, isInteractive: true, surface: 'terminal' });
const sh = ($, command: string) => $.tool.call({ command, tool: 'Bash' });
const endTurn = ($, extra = {}) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    reason: 'answer',
    turnId: 't1',
    ...extra,
  });

test('a stage change in a worker turn sends one line to Chief at turn end', async ($, on) => {
  const s = stubs(on, { run: runner(WORKER), store: { ...RECORDED } });
  engine(on);
  await start($);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  expect(s.sent).toEqual([]);
  await endTurn($);
  expect(s.sent).toEqual([
    // The engine hands the hook beneath the address as the bare session id.
    { text: '#42 in development → QA abc1234', to: 'sess-chief' },
  ]);
  expect((s.store.get('pr:42') as { stage: string }).stage).toBe('QA');
  expect(s.runs.some((r) => r.argv.includes('HEAD'))).toBe(false);
  await endTurn($);
  expect(s.sent).toHaveLength(1);
});

test('the PR named on the command wins, and a merge reports merged', async ($, on) => {
  const s = stubs(on, {
    run: runner(WORKER),
    store: { ...RECORDED, 'pr:43': { pr: 43, stage: 'QA', updatedAt: 0 } },
  });
  engine(on);
  await start($);
  await sh($, 'node .claude/scripts/lifecycle.mjs merge --pr 43');
  await endTurn($);
  expect(s.sent.map((m) => m.text)).toEqual(['#43 QA → merged abc1234']);
});

test("a later turn that names no PR reports the worktree's own, not the earlier turn's", async ($, on) => {
  const s = stubs(on, {
    run: runner(WORKER),
    store: { ...RECORDED, 'pr:43': { pr: 43, stage: 'QA', updatedAt: 0 } },
  });
  engine(on);
  await start($);
  await sh($, 'node .claude/scripts/lifecycle.mjs merge --pr 43');
  await endTurn($);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  await endTurn($);
  expect(s.sent.map((m) => m.text)).toEqual([
    '#43 QA → merged abc1234',
    '#42 in development → QA abc1234',
  ]);
});

test('a turn with no stage change, a subagent turn and Chief itself send nothing', async ($, on) => {
  const s = stubs(on, { run: runner(WORKER), store: { ...RECORDED } });
  engine(on);
  await start($);
  await sh($, 'git status');
  await sh($, 'node .claude/scripts/tracker-sync.mjs unblock');
  await endTurn($);
  await sh($, 'node .claude/scripts/tracker-sync.mjs implement');
  await endTurn($, { agentId: 'helper-1' });
  expect(s.sent).toEqual([]);
});

test('Chief sends no report', async ($, on) => {
  const s = stubs(on, { run: runner(CHIEF), store: { ...RECORDED } });
  engine(on);
  await start($, '/m');
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  await endTurn($);
  expect(s.sent).toEqual([]);
});

for (const [name, options] of [
  ['no chief key', { store: { 'pr:42': RECORDED['pr:42'] } }],
  ['an undelivered send', { delivered: false, store: { ...RECORDED } }],
] as const) {
  test(`${name} logs one dim line and does not retry in that turn`, async ($, on) => {
    const s = stubs(on, { run: runner(WORKER), ...options });
    engine(on);
    await start($);
    await sh($, 'node .claude/scripts/tracker-sync.mjs blocked "waits"');
    await endTurn($);
    expect(s.logs).toEqual([
      'motorfix-chief: Chief not reachable; #42 in development → blocked abc1234 not sent',
    ]);
    expect(s.sent.length).toBeLessThanOrEqual(1);
  });
}
