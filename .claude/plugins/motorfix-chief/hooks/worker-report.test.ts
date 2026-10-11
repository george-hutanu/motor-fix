import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

const TREE = '/m/.worktrees/1168-chief-mods';
const WORKER = '/m/.git/worktrees/1168-chief-mods\n/m/.git\n';
const CHIEF = '/m/.git\n/m/.git\n';
const WATCH = JSON.stringify({
  rows: [
    { main: true, path: '/m', pr: null },
    { main: false, path: TREE, pr: { number: 370, state: 'open' } },
  ],
});
const RECORDED = {
  chief: { sessionId: 'sess-chief', startedAt: 0 },
  'pr:370': { pr: 370, stage: 'in development', updatedAt: 0 },
};

// rev-parse answers as a worker (or Chief), HEAD is abc1234, watch.mjs finds the PR.
const runner = (revParse: string) => (argv: readonly string[]) => {
  if (argv.includes('--git-common-dir')) return ok(revParse);
  if (argv.includes('HEAD')) return ok('abc1234\n');
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

test('a stage change in a worker turn sends one line to Chief at turn end (FR-010)', async ($, on) => {
  const s = stubs(on, { run: runner(WORKER), store: { ...RECORDED } });
  engine(on);
  await start($);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  expect(s.sent).toEqual([]);
  await endTurn($);
  expect(s.sent).toEqual([
    // The engine hands the hook beneath the address as the bare session id.
    { text: '#370 in development → QA abc1234', to: 'sess-chief' },
  ]);
  expect((s.store.get('pr:370') as { stage: string }).stage).toBe('QA');
  await endTurn($);
  expect(s.sent).toHaveLength(1);
});

test('the PR named on the command wins, and a merge reports merged', async ($, on) => {
  const s = stubs(on, {
    run: runner(WORKER),
    store: { ...RECORDED, 'pr:368': { pr: 368, stage: 'QA', updatedAt: 0 } },
  });
  engine(on);
  await start($);
  await sh($, 'node .claude/scripts/lifecycle.mjs merge --pr 368');
  await endTurn($);
  expect(s.sent.map((m) => m.text)).toEqual(['#368 QA → merged abc1234']);
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
  ['no chief key', { store: { 'pr:370': RECORDED['pr:370'] } }],
  ['an undelivered send', { delivered: false, store: { ...RECORDED } }],
] as const) {
  test(`${name} logs one dim line and does not retry in that turn`, async ($, on) => {
    const s = stubs(on, { run: runner(WORKER), ...options });
    engine(on);
    await start($);
    await sh($, 'node .claude/scripts/tracker-sync.mjs blocked "waits"');
    await endTurn($);
    expect(s.logs).toEqual([
      'motorfix-chief: Chief not reachable; #370 in development → blocked abc1234 not sent',
    ]);
    expect(s.sent.length).toBeLessThanOrEqual(1);
  });
}
