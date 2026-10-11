import { expect, test } from 'claude-code/testing';

import {
  ageText,
  blank,
  boardRow,
  HOLD_MS,
  holding,
  ledgerBlock,
  merge,
  PENDING,
} from './ledger.js';

const MIN = 60_000;
const row = (patch = {}) => ({
  ...blank(363),
  holder: 'agent-7f3',
  holderSession: 'sess-a',
  ...patch,
});

test('merge stamps the time and caps the lap at 10', () => {
  expect(merge(blank(363), { head: 'abc1234', lap: 12 }, 5)).toMatchObject({
    head: 'abc1234',
    lap: 10,
    pr: 363,
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
  expect(holding(blank(363), { agents: [], now: 5, session: 'sess-a' })).toBe(
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
      pr: 370,
      stage: 'planning',
      worktree: '/m/.worktrees/1168-chief-mods',
    }),
    row({
      ci: 'pass',
      head: 'abc1234',
      lap: 3,
      qaRun: 38135939640,
      stage: 'QA',
      worktree: '/m/.worktrees/363-slug',
    }),
  ];
  expect(ledgerBlock(rows, ctx)).toBe(
    [
      '<!-- motorfix-chief ledger -->',
      '#363 QA lap 3/10 run 38135939640 ci pass head abc1234 holder agent-7f3 (live) worktree .worktrees/363-slug age 12m',
      '#370 planning lap 0/10 run – ci – head – holder – worktree .worktrees/1168-chief-mods age 12m',
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
    pr: 363,
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
