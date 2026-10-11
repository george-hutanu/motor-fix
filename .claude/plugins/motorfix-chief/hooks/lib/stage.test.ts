import { expect, test } from 'claude-code/testing';

import { stageCall } from './stage.js';

// @traces 1168-FR-010

const T = 'node .claude/scripts/tracker-sync.mjs';
const L = 'node .claude/scripts/lifecycle.mjs';

test('tracker and lifecycle verbs map to the PR stage labels', () => {
  expect(stageCall(`${T} start`)).toEqual({ stage: 'planning' });
  expect(stageCall(`${T} implement`)).toEqual({ stage: 'in development' });
  expect(stageCall(`${T} qa`)).toEqual({ stage: 'QA' });
  expect(stageCall(`${T} blocked "waits on CI"`)).toEqual({ stage: 'blocked' });
  expect(stageCall(`${T} finish --no-comment`)).toEqual({ stage: 'Done' });
  expect(stageCall(`${L} ready --pr 370`)).toEqual({ pr: 370, stage: 'QA' });
  expect(stageCall(`${L} merge --pr 368`)).toEqual({
    pr: 368,
    stage: 'merged',
  });
});

test('pr <n> names the PR; other commands are not stage changes', () => {
  expect(stageCall(`${T} pr 370`)).toEqual({ pr: 370 });
  expect(stageCall(`${T} pr x`)).toBeUndefined();
  expect(stageCall(`${T} unblock`)).toBeUndefined();
  expect(stageCall(`${T} debt`)).toBeUndefined();
  expect(stageCall('git status')).toBeUndefined();
});
