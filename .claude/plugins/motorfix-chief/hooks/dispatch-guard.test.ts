import { expect, test } from 'claude-code/testing';

import { refusal, stubs } from './lib/stubs.ts';

// @traces 1168-FR-006 1168-FR-007 1168-FR-020

const MIN = 60_000;
const launched = (agentId: string) => () => ({
  result: {
    agentId,
    description: 'run',
    outputFile: '/tmp/out',
    prompt: 'p',
    status: 'async_launched',
  },
});
const agent = (prompt: string, subagent_type = 'task-runner') => ({
  description: 'run',
  prompt,
  subagent_type,
  tool: 'Agent' as const,
});
const held = (patch = {}) => ({
  ci: null,
  head: null,
  holder: 'agent-7f3',
  holderSession: 'sess-a',
  lap: 0,
  pr: 363,
  qaRun: null,
  stage: 'QA',
  updatedAt: 0,
  worktree: '/m/.worktrees/363-slug',
  ...patch,
});

test('a task-runner for a PR whose holder is live here is denied, naming the holder', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  expect(refusal(await $.tool.call(agent('tail #363 after QA run 1')))).toBe(
    'motorfix-chief: PR #363 is held by agent agent-7f3 (live, dispatched by this session) in .worktrees/363-slug — one agent per PR; wait for it or stop it first.',
  );
});

test('a worktree named in the prompt finds its row', async ($, on) => {
  stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  expect(
    refusal(await $.tool.call(agent('Resume in /m/.worktrees/363-slug'))),
  ).toMatch(/PR #363 is held by agent agent-7f3/);
});

test('a holder from another session holds for 110 minutes and says so', async ($, on) => {
  const s = stubs(on, {
    store: { 'pr:363': held({ holderSession: 'sess-9a2', updatedAt: 0 }) },
  });
  await s.clock.advance(41 * MIN);
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  expect(refusal(await $.tool.call(agent('tail #363')))).toBe(
    'motorfix-chief: PR #363 is held by agent agent-7f3 (dispatched by session sess-9a2, 41 min ago) — one agent per PR; it frees itself at 110 min.',
  );
});

test('a prompt naming several held PRs is denied with one line per PR', async ($, on) => {
  stubs(on, {
    agents: [
      { id: 'agent-7f3', status: 'running' },
      { id: 'agent-9', status: 'running' },
    ],
    store: {
      'pr:363': held(),
      'pr:368': held({ holder: 'agent-9', pr: 368, worktree: null }),
    },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  expect(refusal(await $.tool.call(agent('tail #363 then PR #368')))).toMatch(
    /PR #363 is held[^\n]*\n[^\n]*PR #368 is held/,
  );
});

test('a free PR passes, and the launched agent becomes its holder', async ($, on) => {
  const s = stubs(on, {
    agents: [{ id: 'agent-old', status: 'completed' }],
    store: { 'pr:363': held({ holder: 'agent-old' }) },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  const r = await $.tool.call(agent('tail #363 in /m/.worktrees/363-slug'));
  expect(r.result).toMatchObject({ agentId: 'agent-new' });
  expect(s.store.get('pr:363')).toMatchObject({
    holder: 'agent-new',
    holderSession: 'sess-a',
    pr: 363,
  });
});

test('a PR with no row gets one, with the worktree the prompt names', async ($, on) => {
  const s = stubs(on);
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  await $.tool.call(
    agent('Run /speckit-auto for PR #370 in /m/.worktrees/1168-chief-mods'),
  );
  expect(s.store.get('pr:370')).toMatchObject({
    holder: 'agent-new',
    worktree: '/m/.worktrees/1168-chief-mods',
  });
});

test('two dispatches for the same PR at once resolve to one holder', async ($, on) => {
  const s = stubs(on);
  let n = 0;
  on('tool.call', { tool: 'Agent' }, () => launched(`agent-${++n}`)());
  const results = await Promise.all([
    $.tool.call(agent('tail #363')),
    $.tool.call(agent('tail #363')),
  ]);
  expect(results.filter((r) => refusal(r))).toHaveLength(1);
  expect(s.store.get('pr:363')).toMatchObject({ holder: 'agent-1' });
});

test('a call the engine refuses releases the claim', async ($, on) => {
  const s = stubs(on);
  on('tool.call', { tool: 'Agent' }, () => ({ deny: 'no' }));
  expect(refusal(await $.tool.call(agent('tail #363')))).toBe('no');
  expect(s.store.get('pr:363')).toMatchObject({ holder: null });
});

test('general-purpose for a story run, tail or watch fix is denied', async ($, on) => {
  stubs(on);
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  for (const prompt of [
    'Run /speckit-auto "ST-1"',
    'tail #363 after QA run 1',
    '/speckit-watch fix rerun-qa for #363',
  ]) {
    expect(refusal(await $.tool.call(agent(prompt, 'general-purpose')))).toBe(
      'motorfix-chief: this dispatch is a story run, tail or watch fix — task-runner is required (AGENTS.md step 4), never general-purpose.',
    );
  }
});

test('other agent types and plain general-purpose work pass untouched', async ($, on) => {
  const s = stubs(on, {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    store: { 'pr:363': held() },
  });
  on('tool.call', { tool: 'Agent' }, launched('agent-new'));
  await $.tool.call(agent('review PR #363', 'code-reviewer'));
  await $.tool.call(agent('Find every caller of foo', 'general-purpose'));
  await $.tool.call(agent('Write a note with no PR'));
  expect(s.store.get('pr:363')).toMatchObject({ holder: 'agent-7f3' });
});
