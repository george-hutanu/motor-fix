import { expect, test } from 'claude-code/testing';

import {
  ageText,
  blank,
  boardRow,
  deadHolder,
  HOLD_MS,
  holding,
  ledgerBlock,
  merge,
  PENDING,
} from './ledger.js';

const MIN = 60_000;
const row = (patch = {}) => ({
  ...blank(41),
  holder: 'agent-7f3',
  holderSession: 'sess-a',
  ...patch,
});

test('merge stamps the time and caps the lap at 10', () => {
  expect(merge(blank(41), { head: 'abc1234', lap: 12 }, 5)).toMatchObject({
    head: 'abc1234',
    lap: 10,
    pr: 41,
    updatedAt: 5,
  });
  expect(merge(row({ lap: 3 }), { head: 'def5678' }, 9).lap).toBe(3);
});

test('in its own session a holder holds while the agent list shows it live', () => {
  const ctx = { now: 10 * HOLD_MS, session: 'sess-a' };
  expect(
    holding(row(), {
      ...ctx,
      agents: [{ id: 'agent-7f3', status: 'running' }],
    }),
  ).toBe(true);
  expect(
    holding(row(), {
      ...ctx,
      agents: [{ id: 'agent-7f3', status: 'completed' }],
    }),
  ).toBe(false);
  expect(holding(row(), { ...ctx, agents: [] })).toBe(false);
});

test('a row from another session, or a pending claim, holds for 110 minutes', () => {
  const other = { agents: [], session: 'sess-b' };
  expect(holding(row({ updatedAt: 0 }), { ...other, now: HOLD_MS - 1 })).toBe(
    true,
  );
  expect(holding(row({ updatedAt: 0 }), { ...other, now: HOLD_MS })).toBe(
    false,
  );
  expect(
    holding(row({ holder: PENDING }), {
      agents: [],
      now: 5,
      session: 'sess-a',
    }),
  ).toBe(true);
  expect(holding(blank(41), { agents: [], now: 5, session: 'sess-a' })).toBe(
    false,
  );
});

test('age is whole minutes under two hours, whole hours after', () => {
  expect(ageText(12 * MIN + 59_000)).toBe('12m');
  expect(ageText(119 * MIN)).toBe('119m');
  expect(ageText(150 * MIN)).toBe('2h');
});

test('the ledger block has one line per row, in PR order, or one line when empty', () => {
  const ctx = {
    agents: [{ id: 'agent-7f3', status: 'running' }],
    now: 12 * MIN,
    session: 'sess-a',
  };
  const rows = [
    row({
      holder: null,
      holderSession: null,
      pr: 42,
      stage: 'planning',
      worktree: '/m/.worktrees/42-slug',
    }),
    row({
      ci: 'pass',
      head: 'abc1234',
      lap: 3,
      qaRun: 9000000001,
      stage: 'QA',
      worktree: '/m/.worktrees/41-slug',
    }),
  ];
  expect(ledgerBlock(rows, ctx)).toBe(
    [
      '<!-- motorfix-chief ledger -->',
      '#41 QA lap 3/10 run 9000000001 ci pass head abc1234 holder agent-7f3 (live) worktree .worktrees/41-slug age 12m',
      '#42 planning lap 0/10 run – ci – head – holder – worktree .worktrees/42-slug age 12m',
    ].join('\n'),
  );
  expect(ledgerBlock([], ctx)).toBe(
    '<!-- motorfix-chief ledger -->\nNo PR is held.',
  );
});

test('a board row shows stage, lap, CI, holder and age in their fixed values', () => {
  const ctx = { agents: [], now: 3 * 60 * MIN, session: 'sess-a' };
  expect(boardRow(row({ ci: 'fail', lap: 4, stage: 'QA' }), ctx)).toEqual({
    age: '3h',
    ci: 'fail',
    holder: 'none',
    lap: '4/10',
    pr: 41,
    stage: 'QA',
  });
  expect(boardRow(blank(9), { ...ctx, now: 0 })).toEqual({
    age: '0m',
    ci: 'none',
    holder: 'none',
    lap: '0/10',
    pr: 9,
    stage: 'none',
  });
});

test('a holder of this session whose agent finished, failed, was killed or is gone is dead', () => {
  const ctx = { now: 0, session: 'sess-a' };
  for (const status of ['completed', 'failed', 'killed'])
    expect(
      deadHolder(row(), { ...ctx, agents: [{ id: 'agent-7f3', status }] }),
    ).toBe(true);
  expect(deadHolder(row(), { ...ctx, agents: [] })).toBe(true);
  expect(
    deadHolder(row(), {
      ...ctx,
      agents: [{ id: 'agent-7f3', status: 'running' }],
    }),
  ).toBe(false);
  expect(deadHolder(row({ holder: PENDING }), { ...ctx, agents: [] })).toBe(
    false,
  );
  expect(
    deadHolder(row({ holderSession: 'sess-b' }), { ...ctx, agents: [] }),
  ).toBe(false);
  expect(deadHolder(blank(41), { ...ctx, agents: [] })).toBe(false);
});
