import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

const MIN = 60_000;
const CHIEF = '/m/.git\n/m/.git\n';
const WORKER = '/m/.git/worktrees/363-slug\n/m/.git\n';
const PLUGIN = 'motorfix-chief';
const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    bodyColumns: 120,
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    scroll: { bodyRows: 11, offset: 0 },
    view: {},
  },
};
const PANE = {
  component: 'Pane' as const,
  props: {
    bodyColumns: 80,
    isFocused: false,
    placement: 'dock' as const,
    scroll: { bodyRows: 20, offset: 0 },
    title: 'MotorFix board',
    view: {},
  },
  requestId: 'motorfix-board',
};
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
const LEDGER = {
  'pr:12': row(12, { stage: 'planning' }),
  'pr:363': row(363, {
    ci: 'pass',
    holder: 'agent-7f3',
    holderSession: 'sess-a',
    lap: 2,
    qaRun: 99,
    stage: 'QA',
  }),
  'pr:368': row(368, { ci: 'pass', qaRun: 77, stage: 'QA' }),
  'pr:370': row(370, { ci: 'pending', qaRun: 80, stage: 'QA' }),
};
const texts = async (ui) =>
  (await ui.findAll({ type: 'Text' })).map((t) => t.text);
const start = ($, surface = 'terminal', cwd = '/m') =>
  $.session.start({ cwd, isInteractive: true, surface });

test('the band shows one row per PR with fixed column values, and four buttons (FR-009, FR-022)', async ($, on) => {
  const s = stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    run: () => ok(CHIEF),
    store: LEDGER,
  });
  await s.clock.advance(150 * MIN);
  for (const surface of ['terminal', 'desktop'] as const) {
    await start($, surface);
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND });
    expect(await texts(ui)).toEqual([
      '#12 planning lap 0/10 ci none holder none age 2h',
      '#363 QA lap 2/10 ci pass holder agent-7f3 age 2h',
      '#368 QA lap 0/10 ci pass holder none age 2h',
      '#370 QA lap 0/10 ci pending holder none age 2h',
    ]);
    expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual([
      'status',
      'watch',
      'ff-main',
      'tail',
    ]);
    await ui.unmount();
  }
});

test('the pane lists the same rows and opens at Chief start', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF), store: LEDGER });
  await start($, 'desktop');
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE });
  expect(await texts(ui)).toContain(
    '#368 QA lap 0/10 ci pass holder none age 0m',
  );
  expect(s.opened).toEqual(['motorfix-board']);
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(4);
});

test('nothing is drawn off desktop and terminal, in a cloud session, or in a worker (FR-017)', async ($, on) => {
  let gitOut = CHIEF;
  let env = {};
  stubs(on, {
    env: new Proxy({}, { get: (_t, k) => env[k as string] }),
    run: () => ok(gitOut),
    store: LEDGER,
  });
  for (const surface of ['vscode', 'mobile'] as const) {
    await start($, surface);
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND });
    expect(await texts(ui)).toEqual(['engine']);
  }
  env = { CLAUDE_CODE_REMOTE: 'true' };
  await start($);
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect(await texts(ui)).toEqual(['engine']);
  env = {};
  gitOut = WORKER;
  await start($, 'terminal', '/m/.worktrees/363-slug');
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect(await texts(ui)).toEqual(['engine']);
});

test('Status, Watch pass and Fast-forward main run their one command as argument lists, never a push (FR-009, FR-018)', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF), store: LEDGER });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE });
  const before = s.runs.length;
  await ui.press({ key: 'status' });
  await ui.press({ key: 'watch' });
  await ui.press({ key: 'ff-main' });
  const pressed = s.runs.slice(before);
  expect(pressed.map((r) => r.argv)).toEqual([
    ['node', '.claude/scripts/status.mjs'],
    ['node', '.claude/scripts/watch.mjs'],
    ['git', '-C', '/m', 'merge', '--ff-only', 'origin/main'],
  ]);
  expect(pressed.every((r) => (r.init as { cwd: string }).cwd === '/m')).toBe(
    true,
  );
});

test('Tail ready PRs offers one tail per ready, finished, unheld PR', async ($, on) => {
  const s = stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    run: () => ok(CHIEF),
    store: LEDGER,
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  await ui.press({ key: 'tail' });
  expect(s.submitted).toEqual([
    'motorfix-chief: tail these ready PRs, one task-runner each.\ntail #368 after QA run 77',
  ]);
});
