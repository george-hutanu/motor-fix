import { expect, test } from 'claude-code/testing';

import { ok, refusal, stubs } from './lib/stubs.ts';
import { ASK } from './owner-card.js';

const MIN = 60_000;
const CHIEF = '/m/.git\n/m/.git\n';
const PLUGIN = 'motorfix-chief';
const TREE = '/m/.worktrees/1168-chief-mods';
const WORKER_TREE = '/m/.git/worktrees/1168-chief-mods\n/m/.git\n';

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
const held = (patch = {}) =>
  row(363, {
    holder: 'agent-7f3',
    holderSession: 'sess-a',
    stage: 'QA',
    worktree: '/m/.worktrees/363-slug',
    ...patch,
  });
const launched = (agentId: string) => () => ({
  result: {
    agentId,
    description: 'run',
    outputFile: '/tmp/out',
    prompt: 'p',
    status: 'async_launched',
  },
});
const agent = (prompt: unknown, subagent_type: unknown = 'task-runner') => ({
  description: 'run',
  prompt,
  subagent_type,
  tool: 'Agent' as const,
});
const start = ($, cwd = '/m', surface = 'terminal') =>
  $.session.start({ cwd, isInteractive: true, surface });
const bashOut =
  (stdout = '', extra = {}) =>
  () => ({ result: { interrupted: false, stderr: '', stdout, ...extra } });
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
const texts = async (ui) =>
  (await ui.findAll({ type: 'Text' })).map((t) => t.text);

// the dispatch guard

test('a prompt naming one held and one free PR is denied for the held one only', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  const text = refusal(await $.tool.call(agent('tail #368 and tail #363')));
  expect(text).toMatch(/PR #363 is held by agent agent-7f3/);
  expect(text).not.toMatch(/PR #368/);
});

test('two dispatches for different PRs at once both pass', async ($, on) => {
  const s = stubs(on);
  let n = 0;
  on('tool.call', { tool: 'Agent' }, () => launched(`agent-${++n}`)());
  const results = await Promise.all([
    $.tool.call(agent('tail #363')),
    $.tool.call(agent('tail #368')),
  ]);
  expect(results.filter((r) => refusal(r))).toHaveLength(0);
  expect(s.store.get('pr:363')).toMatchObject({ pr: 363 });
  expect(s.store.get('pr:368')).toMatchObject({ pr: 368 });
});

test('three dispatches for one PR at once leave exactly one holder', async ($, on) => {
  const s = stubs(on);
  let n = 0;
  // The engine lists a launched agent as running, as $.agent.list() does live.
  on('tool.call', { tool: 'Agent' }, () => {
    const id = `agent-${++n}`;
    s.agents.push({ id, status: 'running' });
    return launched(id)();
  });
  const results = await Promise.all([
    $.tool.call(agent('tail #363')),
    $.tool.call(agent('tail #363')),
    $.tool.call(agent('PR 363 resume')),
  ]);
  expect(results.filter((r) => refusal(r))).toHaveLength(2);
});

test('a holder from another session is denied at 109 minutes and free at 111', async ($, on) => {
  const s = stubs(on, {
    store: { 'pr:363': held({ holderSession: 'sess-9a2', updatedAt: 0 }) },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  await s.clock.advance(109 * MIN);
  expect(refusal(await $.tool.call(agent('tail #363')))).toMatch(
    /dispatched by session sess-9a2, 109 min ago/,
  );
  await s.clock.advance(2 * MIN);
  const r = await $.tool.call(agent('tail #363'));
  expect(refusal(r)).toBeUndefined();
  expect(s.store.get('pr:363')).toMatchObject({ holder: 'agent-new' });
});

test('a claim another session wrote but has not settled says the dispatch is under way', async ($, on) => {
  stubs(on, {
    store: {
      'pr:363': held({ holder: 'pending', holderSession: 'sess-other' }),
    },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  expect(refusal(await $.tool.call(agent('tail #363')))).toBe(
    'motorfix-chief: PR #363 is being dispatched by session sess-other — one agent per PR; wait for that dispatch.',
  );
});

for (const status of ['pending', 'running', 'waiting', 'idle']) {
  test(`a holder whose status is ${status} is live and blocks`, async ($, on) => {
    stubs(on, {
      agents: [{ id: 'agent-7f3', status }],
      store: { 'pr:363': held() },
    });
    on('tool.call', { tool: 'Agent' }, launched('agent-new'));
    expect(refusal(await $.tool.call(agent('tail #363')))).toMatch(
      /held by agent agent-7f3/,
    );
  });
}

for (const status of ['completed', 'failed', 'killed']) {
  test(`a holder whose status is ${status} is free and its row is cleared when read`, async ($, on) => {
    const s = stubs(on, {
      agents: [{ id: 'agent-7f3', status }],
      store: { 'pr:363': held() },
    });
    on('tool.call', { tool: 'Agent' }, launched('agent-new'));
    expect(refusal(await $.tool.call(agent('tail #363')))).toBeUndefined();
    expect(s.store.get('pr:363')).toMatchObject({ holder: 'agent-new' });
  });
}

test('a holder missing from the agent list is free', async ($, on) => {
  stubs(on, { agents: [], store: { 'pr:363': held() } });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  expect(refusal(await $.tool.call(agent('tail #363')))).toBeUndefined();
});

test('a denied dispatch leaves the held row untouched', async ($, on) => {
  const s = stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held({ lap: 4, qaRun: 55 }) },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  const before = JSON.stringify(s.store.get('pr:363'));
  await $.tool.call(agent('tail #363'));
  expect(JSON.stringify(s.store.get('pr:363'))).toBe(before);
});

test('general-purpose for work with a held PR but no task-runner marker passes', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  const r = await $.tool.call(
    agent('summarize PR #363 for me', 'general-purpose'),
  );
  expect(r.result).toMatchObject({ agentId: 'agent-new' });
});

test('general-purpose that names a hand-off note is denied', async ($, on) => {
  stubs(on);
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  for (const prompt of [
    'Read specs/x/handoff.md and finish',
    'open specs/x/tail.md',
    '/speckit-watch fix merge-main #12',
  ]) {
    expect(
      refusal(await $.tool.call(agent(prompt, 'general-purpose'))),
    ).toMatch(/task-runner is required/);
  }
});

test('a /speckit-watch mention without a fix name does not force task-runner', async ($, on) => {
  stubs(on);
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  const r = await $.tool.call(
    agent('explain what /speckit-watch does', 'general-purpose'),
  );
  expect(refusal(r)).toBeUndefined();
});

test('every non-task agent type passes even when its prompt names a held PR and /speckit-auto', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  for (const type of [
    'code-reviewer',
    'pr-tester',
    'claude',
    'test-adversary',
  ]) {
    const r = await $.tool.call(agent('/speckit-auto tail #363', type));
    expect(refusal(r)).toBeUndefined();
  }
});

test('an empty prompt, a missing prompt and a missing agent type pass without throwing', async ($, on) => {
  stubs(on);
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  for (const call of [
    agent(''),
    agent(undefined),
    agent(null),
    agent('tail #363', undefined),
    agent('tail #363', null),
  ]) {
    const r = await $.tool.call(call);
    expect(refusal(r)).toBeUndefined();
  }
});

test('a half-written ledger row is treated as free, not as a crash', async ($, on) => {
  const s = stubs(on, {
    store: { 'pr:363': 'garbage', 'pr:368': null, 'pr:370': { pr: 370 } },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  for (const n of [363, 368, 370]) {
    const r = await $.tool.call(agent(`tail #${n}`));
    expect(r.result).toMatchObject({ agentId: 'agent-new' });
  }
  expect(s.store.get('pr:363')).toMatchObject({ holder: 'agent-new' });
});

test('a prompt of a megabyte with ten thousand PR tokens still resolves', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  const prompt = `${'x'.repeat(1_000_000)} ${'#1 '.repeat(10_000)} tail #363`;
  const text = refusal(await $.tool.call(agent(prompt)));
  expect(text).toMatch(/PR #363 is held by agent agent-7f3/);
});

test('a prompt with a hash that is not a PR number names no PR', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  for (const prompt of ['use color #fff', 'see ticket #', 'item #abc']) {
    expect(refusal(await $.tool.call(agent(prompt)))).toBeUndefined();
  }
});

test('lower-case "pr 363" and "PR #363" both find the row', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  for (const prompt of ['resume pr 363', 'resume PR #363', 'resume Pr 363']) {
    expect(refusal(await $.tool.call(agent(prompt)))).toMatch(
      /PR #363 is held/,
    );
  }
});

test('a launch that errors releases the claim so the retry is not denied', async ($, on) => {
  const s = stubs(on);
  on('tool.call', { tool: 'Agent' }, () => {
    throw new Error('spawn failed');
  });
  await $.tool.call(agent('tail #363')).catch(() => undefined);
  expect(s.store.get('pr:363')).not.toMatchObject({ holder: 'pending' });
});

// the ledger and the watch gate

test('a dispatch.mjs lap above the cap is held at 10', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363) } });
  on(
    'tool.call',
    { tool: 'Bash' },
    bashOut('- QA run: 7 · head 8e6a1b2c3d4e · lap 11 · https://x\n'),
  );
  await $.tool.call({
    command: 'node .claude/scripts/pr-test/dispatch.mjs 363 --no-wait',
    tool: 'Bash',
  });
  expect(s.store.get('pr:363')).toMatchObject({ lap: 10 });
});

test('a new head does not reset the lap', async ($, on) => {
  const s = stubs(on, {
    store: { 'pr:363': row(363, { head: 'aaaaaaa', lap: 3 }) },
  });
  on(
    'tool.call',
    { tool: 'Bash' },
    bashOut('- QA run: 8 · head bbbbbbbbbbbb · lap 4 · https://x\n'),
  );
  await $.tool.call({
    command: 'node .claude/scripts/pr-test/dispatch.mjs 363 --no-wait',
    tool: 'Bash',
  });
  expect(s.store.get('pr:363')).toMatchObject({ head: 'bbbbbbb', lap: 4 });
});

test('dispatch.mjs output with no QA-run line leaves the row as it was', async ($, on) => {
  const s = stubs(on, {
    store: { 'pr:363': row(363, { head: 'abc1234', lap: 2, qaRun: 5 }) },
  });
  on('tool.call', { tool: 'Bash' }, bashOut('gh: rate limited\n'));
  await $.tool.call({
    command: 'node .claude/scripts/pr-test/dispatch.mjs 363 --no-wait',
    tool: 'Bash',
  });
  expect(s.store.get('pr:363')).toMatchObject({
    head: 'abc1234',
    lap: 2,
    qaRun: 5,
  });
});

test('a Bash call that is neither dispatch nor ci-wait touches no row', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { lap: 2 }) } });
  on(
    'tool.call',
    { tool: 'Bash' },
    bashOut('- QA run: 9 · head abc1234 · lap 5\n'),
  );
  for (const command of [
    'ls',
    'echo dispatch.mjs 363',
    'cat ci-wait.mjs',
    'node .claude/scripts/status.mjs 363',
  ]) {
    await $.tool.call({ command, tool: 'Bash' });
  }
  expect(s.store.get('pr:363')).toEqual(row(363, { lap: 2 }));
  expect([...s.store.keys()]).toEqual(['pr:363']);
});

test('a ci-wait --run that was interrupted offers nothing', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { head: 'abc1234' }) } });
  on('tool.call', { tool: 'Bash' }, bashOut('', { interrupted: true }));
  const r = await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 363 --run 99',
    tool: 'Bash',
  });
  expect(r.context ?? []).toHaveLength(0);
  expect(s.store.has('offer:363:abc1234')).toBe(false);
});

test('a new head gets its own tail offer', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { head: 'abc1234' }) } });
  on('tool.call', { tool: 'Bash' }, bashOut(''));
  const call = () =>
    $.tool.call({
      command: 'node .claude/scripts/pr-test/ci-wait.mjs 363 --run 99',
      tool: 'Bash',
    });
  await call();
  const row1 = s.store.get('pr:363') as Record<string, unknown>;
  s.store.set('pr:363', { ...row1, head: 'def5678' });
  const r = await call();
  expect(r.context?.join('\n')).toContain('tail #363 after QA run 99');
  expect(s.store.has('offer:363:def5678')).toBe(true);
});

test('a ci-wait for a PR with no row does not throw', async ($, on) => {
  stubs(on);
  on('tool.call', { tool: 'Bash' }, bashOut(''));
  const r = await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 999 --run 5',
    tool: 'Bash',
  });
  expect(r.result).toMatchObject({ stdout: '' });
});

test('a background notification with no task-id passes through unchanged and changes no row', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { ci: 'pending' }) } });
  const text =
    '<task-notification>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>';
  const r = await $.prompt.submit({ text });
  expect(r.text).toBe(text);
  expect(r.context ?? []).toHaveLength(0);
  expect(s.store.get('pr:363')).toMatchObject({ ci: 'pending' });
});

test('a notification for a task the mod never saw changes nothing', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { ci: 'pending' }) } });
  const text =
    '<task-notification>\n<task-id>nope</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>';
  const r = await $.prompt.submit({ text });
  expect(r.context ?? []).toHaveLength(0);
  expect(s.store.get('pr:363')).toMatchObject({ ci: 'pending' });
});

test('a failed background ci-wait marks the row fail and offers no tail', async ($, on) => {
  const s = stubs(on, { store: { 'pr:363': row(363, { head: 'abc1234' }) } });
  on('tool.call', { tool: 'Bash' }, bashOut('', { backgroundTaskId: 'bt1' }));
  await $.tool.call({
    command: 'node .claude/scripts/pr-test/ci-wait.mjs 363 --run 99',
    run_in_background: true,
    tool: 'Bash',
  });
  const r = await $.prompt.submit({
    text: '<task-notification>\n<task-id>bt1</task-id>\n<status>failed</status>\n<summary>Background command "x" failed (exit code 1)</summary>\n</task-notification>',
  });
  expect(r.context ?? []).toHaveLength(0);
  expect(s.store.get('pr:363')).toMatchObject({ ci: 'fail' });
});

test('an empty prompt and a megabyte prompt are submitted unchanged', async ($, on) => {
  stubs(on);
  expect((await $.prompt.submit({ text: '' })).text).toBe('');
  const big = 'y'.repeat(1_000_000);
  expect((await $.prompt.submit({ text: big })).text).toBe(big);
});

test('the ledger block lists rows in numeric PR order, not text order', async ($, on) => {
  stubs(on, {
    run: () => ok(CHIEF),
    store: { 'pr:9': row(9), 'pr:100': row(100), 'pr:363': row(363) },
  });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  const lines = r.blocks
    .find((b) => b.name === 'motorfixLedger')
    ?.text.split('\n')
    .map((l) => l.split(' ')[0]);
  expect(lines).toEqual(['<!--', '#9', '#100', '#363']);
});

test('the ledger block marks a live holder', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    run: () => ok(CHIEF),
    store: { 'pr:363': held() },
  });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  expect(r.blocks.find((b) => b.name === 'motorfixLedger')?.text).toContain(
    'holder agent-7f3 (live)',
  );
});

test('an unreadable row does not hide the other rows from the ledger block', async ($, on) => {
  stubs(on, {
    run: () => ok(CHIEF),
    store: { 'pr:12': 'junk', 'pr:363': row(363, { stage: 'QA' }) },
  });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  expect(r.blocks.find((b) => b.name === 'motorfixLedger')?.text).toContain(
    '#363 QA lap 0/10',
  );
});

test('the ledger block keeps the blocks the engine passed in', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  await start($);
  const r = await $.prompt.context({
    blocks: [{ name: 'other', text: 'keep me' }],
  });
  expect(r.blocks.map((b) => b.name)).toEqual(
    expect.arrayContaining(['other', 'motorfixLedger']),
  );
});

test('a watch --json that is not JSON runs no gate and the next tick still works', async ($, on) => {
  let body = 'not json{';
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv)) return ok(body);
      if (isGate(argv)) return { exitCode: 0, stderr: '', stdout: '' };
      return ok(CHIEF);
    },
  });
  await start($);
  await s.clock.advance(15 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
  body = watchJson([
    { number: 1, state: 'ready' },
    { number: 2, state: 'ready' },
  ]);
  await s.clock.advance(15 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(1);
});

for (const [name, body] of [
  ['an empty object', '{}'],
  ['rows that are not a list', '{"rows":"x"}'],
  ['an empty string', ''],
  ['a null', 'null'],
  ['rows holding null', '{"rows":[null,null]}'],
] as const) {
  test(`watch --json with ${name} runs no gate`, async ($, on) => {
    const s = stubs(on, {
      run: (argv) => (isJson(argv) ? ok(body) : ok(CHIEF)),
    });
    await start($);
    await s.clock.advance(30 * MIN);
    expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
  });
}

test('a gate that throws shows one toast and the next tick runs it again', async ($, on) => {
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv))
        return ok(
          watchJson([
            { number: 1, state: 'ready' },
            { number: 2, state: 'ready' },
          ]),
        );
      if (isGate(argv)) throw new Error('spawn ENOENT');
      return ok(CHIEF);
    },
  });
  await start($);
  await s.clock.advance(15 * MIN);
  expect(s.toasts.filter((t) => t.includes('watch gate'))).toHaveLength(1);
  await s.clock.advance(15 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(2);
});

test('a watch --json call that throws runs no gate and does not stop the timer', async ($, on) => {
  let fail = true;
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv)) {
        if (fail) throw new Error('boom');
        return ok(
          watchJson([
            { number: 1, state: 'ready' },
            { number: 2, state: 'ready' },
          ]),
        );
      }
      return ok(CHIEF);
    },
  });
  await start($);
  await s.clock.advance(15 * MIN);
  fail = false;
  await s.clock.advance(15 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(1);
});

test('gate exit 0 submits nothing and shows no toast', async ($, on) => {
  const s = stubs(on, {
    run: (argv) => {
      if (isJson(argv))
        return ok(
          watchJson([
            { number: 1, state: 'ready' },
            { number: 2, state: 'ready' },
          ]),
        );
      if (isGate(argv)) return { exitCode: 0, stderr: 'noise', stdout: 'x' };
      return ok(CHIEF);
    },
  });
  await start($);
  await s.clock.advance(15 * MIN);
  expect(s.submitted).toEqual([]);
  expect(s.toasts).toEqual([]);
});

test('the gate runs nothing before the first 15 minutes pass', async ($, on) => {
  const s = stubs(on, {
    run: (argv) =>
      isJson(argv)
        ? ok(
            watchJson([
              { number: 1, state: 'ready' },
              { number: 2, state: 'ready' },
            ]),
          )
        : ok(CHIEF),
  });
  await start($);
  await s.clock.advance(14 * MIN + 59_000);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
  await s.clock.advance(1_000);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(1);
});

test('a cloud session runs no gate and draws no band', async ($, on) => {
  const s = stubs(on, {
    env: { CLAUDE_CODE_REMOTE: 'true' },
    run: (argv) =>
      isJson(argv)
        ? ok(
            watchJson([
              { number: 1, state: 'ready' },
              { number: 2, state: 'ready' },
            ]),
          )
        : ok(CHIEF),
    store: { 'pr:363': row(363, { stage: 'QA' }) },
  });
  await start($, '/m', 'desktop');
  await s.clock.advance(60 * MIN);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
  const ui = await $.ui.mount({
    component: 'AbovePrompt',
    plugin: PLUGIN,
    props: {
      bodyColumns: 120,
      hasSurvey: false,
      isWorking: false,
      maxRows: 12,
      scroll: { bodyRows: 11, offset: 0 },
      view: {},
    },
    surface: 'desktop',
  });
  expect(await texts(ui)).toEqual(['engine']);
});

test('a session whose git check throws still starts and writes no chief key', async ($, on) => {
  const s = stubs(on, {
    run: () => {
      throw new Error('git missing');
    },
  });
  await start($);
  expect(s.store.has('chief')).toBe(false);
});

test('a session whose git check prints nothing is a worker', async ($, on) => {
  const s = stubs(on, { run: () => ok('') });
  await start($);
  await s.clock.advance(60 * MIN);
  expect(s.store.has('chief')).toBe(false);
  expect(s.runs.filter((r) => isGate(r.argv))).toHaveLength(0);
});

test('ending a session that never started deletes nothing and does not throw', async ($, on) => {
  const s = stubs(on, {
    store: { chief: { sessionId: 'other', startedAt: 0 } },
  });
  await $.session.end({ reason: 'other' });
  expect(s.store.get('chief')).toMatchObject({ sessionId: 'other' });
});

// the board

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

test('age is whole minutes under two hours and whole hours from two hours', async ($, on) => {
  const s = stubs(on, {
    run: () => ok(CHIEF),
    store: { 'pr:1': row(1), 'pr:2': row(2, { updatedAt: -60 * MIN }) },
  });
  await s.clock.advance(119 * MIN + 59_000);
  await start($);
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect((await texts(ui))[0]).toMatch(/age 119m$/);
  await ui.unmount();
  await s.clock.advance(1_000);
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect((await texts(ui))[0]).toMatch(/age 2h$/);
  await ui.unmount();
  await s.clock.advance(59 * MIN);
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect((await texts(ui))[0]).toMatch(/age 2h$/);
});

test('a stored lap above 10 is drawn as 10/10 and an unknown CI value as none', async ($, on) => {
  stubs(on, {
    run: () => ok(CHIEF),
    store: { 'pr:5': row(5, { ci: 'weird', lap: 15, stage: 'QA' }) },
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect(await texts(ui)).toEqual([
    '#5 QA lap 10/10 ci none holder none age 0m',
  ]);
});

test('a holder that is no longer live is drawn as none', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'killed' }],
    run: () => ok(CHIEF),
    store: { 'pr:363': held() },
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect((await texts(ui))[0]).toContain('holder none');
});

test('a corrupt row does not stop the band drawing the others', async ($, on) => {
  stubs(on, {
    run: () => ok(CHIEF),
    store: { 'pr:12': 42, 'pr:363': row(363, { stage: 'QA' }) },
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect(await texts(ui)).toContain(
    '#363 QA lap 0/10 ci none holder none age 0m',
  );
});

test('the band keeps its four buttons with two hundred PRs', async ($, on) => {
  const store = Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [`pr:${i + 1}`, row(i + 1)]),
  );
  stubs(on, { run: () => ok(CHIEF), store });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual([
    'status',
    'watch',
    'ff-main',
    'tail',
  ]);
});

test('Tail ready PRs offers nothing for a failing CI, a missing QA run or a held PR, and no prompt at all when none is ready', async ($, on) => {
  const s = stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    run: () => ok(CHIEF),
    store: {
      'pr:1': row(1, { ci: 'fail', qaRun: 5, stage: 'QA' }),
      'pr:2': row(2, { ci: 'pass', qaRun: null, stage: 'QA' }),
      'pr:3': row(3, { ci: 'pending', qaRun: 6, stage: 'QA' }),
      'pr:4': row(4, {
        ci: 'pass',
        holder: 'agent-7f3',
        holderSession: 'sess-a',
        qaRun: 7,
        stage: 'QA',
      }),
    },
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  await ui.press({ key: 'tail' });
  expect(s.submitted).toEqual([]);
});

test('Tail ready PRs offers every ready PR in one prompt, in PR order', async ($, on) => {
  const s = stubs(on, {
    run: () => ok(CHIEF),
    store: {
      'pr:3': row(3, { ci: 'pass', qaRun: 6, stage: 'QA' }),
      'pr:20': row(20, { ci: 'pass', qaRun: 8, stage: 'QA' }),
    },
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  await ui.press({ key: 'tail' });
  expect(s.submitted).toHaveLength(1);
  expect(s.submitted[0]).toMatch(
    /tail #3 after QA run 6\ntail #20 after QA run 8$/,
  );
});

test('Fast-forward main that fails does not retry with a push and does not throw', async ($, on) => {
  const s = stubs(on, {
    run: (argv) =>
      argv.includes('--ff-only')
        ? {
            exitCode: 128,
            stderr: 'fatal: Not possible to fast-forward',
            stdout: '',
          }
        : ok(CHIEF),
    store: { 'pr:1': row(1) },
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  const before = s.runs.length;
  await ui.press({ key: 'ff-main' });
  const pressed = s.runs.slice(before).map((r) => r.argv);
  expect(pressed).toEqual([
    ['git', '-C', '/m', 'merge', '--ff-only', 'origin/main'],
  ]);
});

test('a Status button whose script throws does not take the session down', async ($, on) => {
  const s = stubs(on, {
    run: (argv) => {
      if (argv.includes('.claude/scripts/status.mjs')) throw new Error('boom');
      return ok(CHIEF);
    },
    store: { 'pr:1': row(1) },
  });
  await start($);
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND });
  await ui.press({ key: 'status' });
  await ui.press({ key: 'watch' });
  expect(s.runs.map((r) => r.argv.join(' '))).toContain(
    'node .claude/scripts/watch.mjs',
  );
});

test('a vscode or remote desktop session draws no pane and opens none', async ($, on) => {
  let env = {};
  const s = stubs(on, {
    env: new Proxy({}, { get: (_t, k) => env[k as string] }),
    run: () => ok(CHIEF),
    store: { 'pr:1': row(1) },
  });
  await start($, '/m', 'vscode');
  expect(s.opened).toEqual([]);
  env = { CLAUDE_CODE_REMOTE: 'true' };
  await start($, '/m', 'desktop');
  expect(s.opened).toEqual([]);
});

// worker reports

const runner =
  (revParse: string, watch: string) => (argv: readonly string[]) => {
    if (argv.includes('--git-common-dir')) return ok(revParse);
    if (argv.includes('HEAD')) return ok('abc1234\n');
    if (argv.includes('--json')) return ok(watch);
    return ok();
  };
function engine(on) {
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { interrupted: false, stderr: '', stdout: '' },
  }));
  on('turn.complete', (_$, e) => ({ text: e.answer }));
}
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
const WATCH = JSON.stringify({
  rows: [{ main: false, path: TREE, pr: { number: 370, state: 'open' } }],
});
const RECORDED = {
  chief: { sessionId: 'sess-chief', startedAt: 0 },
  'pr:370': { pr: 370, stage: 'in development', updatedAt: 0 },
};

test('a worker whose tree has no PR in watch.mjs sends nothing and does not throw', async ($, on) => {
  const s = stubs(on, {
    run: runner(
      WORKER_TREE,
      JSON.stringify({ rows: [{ main: false, path: TREE, pr: null }] }),
    ),
    store: { ...RECORDED },
  });
  engine(on);
  await start($, TREE);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  await endTurn($);
  expect(s.sent).toEqual([]);
});

test('a worker whose watch.mjs prints malformed JSON sends nothing', async ($, on) => {
  const s = stubs(on, {
    run: runner(WORKER_TREE, '{"rows": [ {'),
    store: { ...RECORDED },
  });
  engine(on);
  await start($, TREE);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  await endTurn($);
  expect(s.sent).toEqual([]);
});

test('a worker whose watch.mjs throws sends nothing', async ($, on) => {
  const s = stubs(on, {
    run: (argv) => {
      if (argv.includes('--json')) throw new Error('boom');
      return runner(WORKER_TREE, WATCH)(argv);
    },
    store: { ...RECORDED },
  });
  engine(on);
  await start($, TREE);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  await endTurn($);
  expect(s.sent).toEqual([]);
});

test('a stage set to the value it already has sends nothing', async ($, on) => {
  const s = stubs(on, {
    run: runner(WORKER_TREE, WATCH),
    store: {
      ...RECORDED,
      'pr:370': { pr: 370, stage: 'QA', updatedAt: 0 },
    },
  });
  engine(on);
  await start($, TREE);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  await endTurn($);
  expect(s.sent).toEqual([]);
});

test('finish reports Done', async ($, on) => {
  const s = stubs(on, {
    run: runner(WORKER_TREE, WATCH),
    store: {
      ...RECORDED,
      'pr:370': { pr: 370, stage: 'merged', updatedAt: 0 },
    },
  });
  engine(on);
  await start($, TREE);
  await sh($, 'node .claude/scripts/tracker-sync.mjs finish');
  await endTurn($);
  expect(s.sent.map((m) => m.text)).toEqual(['#370 merged → Done abc1234']);
});

test('a failed undelivered send is not retried on the next empty turn', async ($, on) => {
  const s = stubs(on, {
    delivered: false,
    run: runner(WORKER_TREE, WATCH),
    store: { ...RECORDED },
  });
  engine(on);
  await start($, TREE);
  await sh($, 'node .claude/scripts/tracker-sync.mjs qa');
  await endTurn($);
  const after = s.sent.length;
  await endTurn($);
  expect(s.sent.length).toBe(after);
});

// usage guard

const RESET = '2026-10-11T17:00:00Z';
const FABLE_OFF = 'node .claude/scripts/fable.mjs off';
const measure = ($, rateLimits: unknown) =>
  $.session.measure({ changed: ['rateLimits'], context: {}, rateLimits });
function ask(on, label: string | null) {
  const asked: string[] = [];
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0].question;
    asked.push(q);
    if (label === null) return { deny: 'dismissed' };
    return { result: { answers: { [q]: label }, questions: e.questions } };
  });
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  return asked;
}
const fableRuns = (s) => s.runs.filter((r) => r.argv.join(' ') === FABLE_OFF);

test('79.99 percent shows nothing and exactly 80 shows one warning', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const asked = ask(on, 'Not now');
  await start($);
  await measure($, [
    { kind: 'five_hour', percentUsed: 79.99, resetsAt: RESET },
  ]);
  expect(asked).toEqual([]);
  await measure($, [{ kind: 'five_hour', percentUsed: 80, resetsAt: RESET }]);
  expect(asked).toHaveLength(1);
});

test('two windows crossing in one measure warn once each', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const asked = ask(on, 'Not now');
  await start($);
  await measure($, [
    { kind: 'five_hour', percentUsed: 90, resetsAt: RESET },
    { kind: 'seven_day', percentUsed: 95, resetsAt: '2026-10-15T00:00:00Z' },
  ]);
  expect(asked).toHaveLength(2);
});

test('dropping below 80 and crossing again in the same window warns once', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const asked = ask(on, 'Not now');
  await start($);
  for (const p of [85, 40, 85, 90]) {
    await measure($, [{ kind: 'five_hour', percentUsed: p, resetsAt: RESET }]);
  }
  expect(asked).toHaveLength(1);
});

test('a window already answered before a restart does not warn again', async ($, on) => {
  stubs(on, {
    run: () => ok(CHIEF),
    store: {
      [`usage:five_hour:${RESET}`]: { answer: 'declined', percentUsed: 85 },
    },
  });
  const asked = ask(on, 'Not now');
  await start($);
  await measure($, [{ kind: 'five_hour', percentUsed: 95, resetsAt: RESET }]);
  expect(asked).toEqual([]);
});

for (const [name, limits] of [
  ['an empty list', []],
  ['no list', undefined],
  ['null', null],
  ['a missing percentage', [{ kind: 'five_hour', resetsAt: RESET }]],
  [
    'a null percentage',
    [{ kind: 'five_hour', percentUsed: null, resetsAt: RESET }],
  ],
  [
    'a string percentage',
    [{ kind: 'five_hour', percentUsed: 'NaN', resetsAt: RESET }],
  ],
  [
    'a NaN percentage',
    [{ kind: 'five_hour', percentUsed: Number.NaN, resetsAt: RESET }],
  ],
] as const) {
  test(`a measure with ${name} shows nothing and runs nothing`, async ($, on) => {
    const s = stubs(on, { run: () => ok(CHIEF) });
    const asked = ask(on, 'Remap fable to Opus');
    await start($);
    await measure($, limits);
    expect(asked).toEqual([]);
    expect(fableRuns(s)).toEqual([]);
  });
}

test('an accepted remap whose script fails does not throw and is not run twice', async ($, on) => {
  const s = stubs(on, {
    run: (argv) =>
      argv.join(' ') === FABLE_OFF
        ? { exitCode: 1, stderr: 'no', stdout: '' }
        : ok(CHIEF),
  });
  ask(on, 'Remap fable to Opus');
  await start($);
  await measure($, [{ kind: 'five_hour', percentUsed: 90, resetsAt: RESET }]);
  await measure($, [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]);
  expect(fableRuns(s)).toHaveLength(1);
});

// the owner card

const CHAIN = 'cd ~/projects/motor-fix && npm ci';
const question = (text: string) => ({
  questions: [
    {
      header: 'Owner',
      multiSelect: false,
      options: [
        { description: 'ran it', label: 'Done' },
        { description: 'did not', label: 'Not done' },
      ],
      question: text,
    },
  ],
  tool: 'AskUserQuestion' as const,
});
const withBlock = (body: string, lang = 'sh') =>
  `Run this, then answer?\n\n\`\`\`${lang}\n${body}\n\`\`\``;
function native(on) {
  const seen: string[] = [];
  let answer: (label: string | null) => void = () => {};
  let onAsk: () => void = () => {};
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions?.[0]?.question;
    seen.push(q);
    if (q !== ASK)
      return { result: { answers: { [q]: 'native' }, questions: e.questions } };
    const label = await new Promise<string | null>((r) => {
      answer = r;
      onAsk();
    });
    if (label === null) return { deny: 'dismissed' };
    return { result: { answers: { [q]: label }, questions: e.questions } };
  });
  return {
    answer: (l: string | null) => answer(l),
    asked: () =>
      new Promise<void>((r) => {
        onAsk = r;
      }),
    seen,
  };
}
const codeOf = async (ui) =>
  (await ui.findAll({ type: 'Code' })).map((c) => c.props.source).join('\n');
const CARD_PANE = {
  component: 'Pane' as const,
  props: {
    bodyColumns: 100,
    isFocused: true,
    placement: 'dock' as const,
    scroll: { bodyRows: 20, offset: 0 },
    title: 'Owner command',
    view: {},
  },
  requestId: 'motorfix-card',
};

test('an empty command block, or a block of blank lines, passes unchanged', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF) });
  const d = native(on);
  await start($);
  for (const body of ['', '   ', '\n\n']) {
    const r = await $.tool.call(question(withBlock(body)));
    expect(Object.values(r.result.answers)).toEqual(['native']);
  }
  expect(d.seen).not.toContain(ASK);
  expect(s.opened).not.toContain('motorfix-card');
});

test('a command with shell metacharacters and unicode reaches the clipboard byte for byte', async ($, on) => {
  const tricky =
    'cd "/Users/ion/Mașini și piese" && echo \'$(whoami)\' | tee ~/x; echo "ț→ü"';
  const s = stubs(on, { run: () => ok(CHIEF) });
  const d = native(on);
  await start($);
  const asked = d.asked();
  const call = $.tool.call(question(withBlock(tricky)));
  await asked;
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...CARD_PANE,
  });
  expect(await codeOf(ui)).toBe(tricky);
  await ui.press({ key: 'copy' });
  expect(s.copied).toEqual([tricky]);
  d.answer('Done');
  await call;
});

test('CRLF line endings in the block still join into one chain', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const d = native(on);
  await start($);
  const asked = d.asked();
  const call = $.tool.call(question(withBlock('cd ~/x\r\nnpm ci\r\nnpm test')));
  await asked;
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...CARD_PANE,
  });
  expect(await codeOf(ui)).toBe('cd ~/x && npm ci && npm test');
  d.answer('Done');
  await call;
});

test('a question call with no questions passes through without throwing', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const d = native(on);
  await start($);
  const r = await $.tool
    .call({ questions: [], tool: 'AskUserQuestion' })
    .catch((e) => e);
  expect(d.seen).not.toContain(ASK);
  expect(r).not.toBeInstanceOf(TypeError);
});

test('the card is gone from the store key space after Done only as a done record', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF) });
  const d = native(on);
  await start($);
  const asked = d.asked();
  const call = $.tool.call(question(withBlock(CHAIN)));
  await asked;
  d.answer('Done');
  await call;
  const keys = [...s.store.keys()].filter((k) => k.startsWith('card:'));
  expect(keys).toHaveLength(1);
  expect(s.store.get(keys[0])).toMatchObject({
    answer: 'done',
    command: CHAIN,
  });
});

// quiet transcripts

const bash = (stdout: string, extra = {}) => ({
  interrupted: false,
  stderr: '',
  stdout,
  ...extra,
});
const result = (tool: string, tool_use_id: string, output: unknown) => ({
  component: 'ToolResult' as const,
  props: { isErrored: false, output, tool, tool_use_id },
  requestId: tool_use_id,
});
function shell(on) {
  let id = '';
  let stdout = '';
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    id = e.tool_use_id;
    return { result: bash(stdout) };
  });
  return async ($, command: string, out: string) => {
    stdout = out;
    await $.tool.call({ command, tool: 'Bash' });
    return id;
  };
}

test('output that merely ends with the cancel notice keeps its default rendering', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const ran = shell(on);
  await start($);
  const out = 'build failed: 3 errors\nPR QA: cancel\n';
  const id = await ran($, 'npm test', out);
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...result('Bash', id, bash(out)),
  });
  expect(await texts(ui)).toEqual(['engine']);
});

test('an Agent reply with a preface before the envelope keeps its default rendering', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  await start($);
  const text =
    'Sure, here you go.\nSTATUS: success — x\nPR: none\nNEXT: none\nFILES: none';
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...result('Agent', 'toolu_b', {
      agentId: 'a',
      content: [{ text, type: 'text' }],
    }),
  });
  expect(await texts(ui)).toEqual(['engine']);
});

test('an Agent reply with CRLF line endings folds without carriage returns', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  await start($);
  const text =
    'STATUS: success — x\r\nPR: #1 ready abc1234\r\nNEXT: none\r\nFILES: none\r\nbody';
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...result('Agent', 'toolu_c', {
      agentId: 'a',
      content: [{ text, type: 'text' }],
    }),
  });
  expect(await texts(ui)).toEqual([
    'STATUS: success — x',
    'PR: #1 ready abc1234',
    'NEXT: none',
  ]);
});

for (const [name, output] of [
  ['undefined', undefined],
  ['null', null],
  ['a bare string', 'STATUS: success'],
  ['an empty content list', { agentId: 'a', content: [] }],
  ['content without text', { agentId: 'a', content: [{ type: 'image' }] }],
  ['a number', 7],
] as const) {
  test(`an Agent result whose output is ${name} keeps its default rendering`, async ($, on) => {
    stubs(on, { run: () => ok(CHIEF) });
    await start($);
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      ...result('Agent', 'toolu_d', output),
    });
    expect(await texts(ui)).toEqual(['engine']);
  });
}

test('a Bash result for a call the mod never saw keeps its default rendering', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  await start($);
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...result('Bash', 'toolu_unseen', bash('Unit: fail\n')),
  });
  expect(await texts(ui)).toEqual(['engine']);
});

test('a ci-wait result with a hundred failing checks draws one pill per check', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const ran = shell(on);
  await start($);
  const out = Array.from({ length: 100 }, (_, i) => `check ${i}: fail`).join(
    '\n',
  );
  const id = await ran($, 'node .claude/scripts/pr-test/ci-wait.mjs 363', out);
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...result('Bash', id, bash(out)),
  });
  expect(await texts(ui)).toHaveLength(100);
});

test('two dispatches for one PR written as "#363" and "PR 363" resolve to one holder', async ($, on) => {
  const s = stubs(on);
  let n = 0;
  // The engine lists a launched agent as running, as $.agent.list() does live.
  on('tool.call', { tool: 'Agent' }, () => {
    const id = `agent-${++n}`;
    s.agents.push({ id, status: 'running' });
    return launched(id)();
  });
  const results = await Promise.all([
    $.tool.call(agent('tail #363')),
    $.tool.call(agent('PR 363 resume')),
  ]);
  expect(results.filter((r) => refusal(r))).toHaveLength(1);
});
