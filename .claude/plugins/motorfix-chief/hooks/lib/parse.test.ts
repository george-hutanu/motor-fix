import { expect, test } from 'claude-code/testing';

import {
  bashCall,
  ciLines,
  commandBlock,
  needsTaskRunner,
  prTokens,
  qaRunLine,
  replyBlock,
  taskNotification,
  worktreeTokens,
} from './parse.js';

test('prTokens finds every PR a dispatch prompt names, once each', () => {
  expect(
    prTokens('Tail PR #41, then tail #43; see /pull/42 and PR 41'),
  ).toEqual([41, 43, 42]);
  expect(prTokens('issue #42 and ST-42')).toEqual([]);
});

test('worktreeTokens finds worktree names in absolute and relative paths', () => {
  expect(
    worktreeTokens(
      'Worktree: /Users/x/motor-fix/.worktrees/42-slug, also .worktrees/41-slug.',
    ),
  ).toEqual(['42-slug', '41-slug']);
});

test('needsTaskRunner spots a story run, a tail and a watch fix', () => {
  expect(needsTaskRunner('Run /speckit-auto "ST-1"')).toBe(true);
  expect(needsTaskRunner('tail #41 after QA run 1')).toBe(true);
  expect(needsTaskRunner('Read specs/x/handoff.md')).toBe(true);
  expect(needsTaskRunner('/speckit-watch fix rerun-qa for #41')).toBe(true);
  expect(needsTaskRunner('/speckit-watch list only')).toBe(false);
  expect(needsTaskRunner('Find every caller of foo')).toBe(false);
});

test('bashCall reads dispatch and ci-wait commands', () => {
  expect(
    bashCall('cd /w && node .claude/scripts/pr-test/dispatch.mjs 41 --no-wait'),
  ).toEqual({
    kind: 'dispatch',
    pr: 41,
    run: null,
  });
  expect(
    bashCall('node .claude/scripts/pr-test/ci-wait.mjs 41 --run 9000000001'),
  ).toEqual({
    kind: 'ci-wait',
    pr: 41,
    run: 9000000001,
  });
  expect(bashCall('node .claude/scripts/pr-test/ci-wait.mjs 41')).toEqual({
    kind: 'ci-wait',
    pr: 41,
    run: null,
  });
  expect(bashCall('git status')).toBeUndefined();
});

test('qaRunLine reads the run, head and lap dispatch.mjs prints', () => {
  expect(
    qaRunLine('- QA run: 9000000001 · head 8e6a1b2c3d4e · lap 2 · https://x'),
  ).toEqual({
    head: '8e6a1b2',
    lap: 2,
    qaRun: 9000000001,
  });
  expect(qaRunLine('nothing')).toBeUndefined();
});

test('replyBlock reads the four-line envelope and nothing else', () => {
  const reply =
    'STATUS: success — done\nPR: #41 ready abc1234\nNEXT: tail #41\nFILES: none\nbody';
  expect(replyBlock(reply)).toEqual({
    files: 'none',
    next: 'tail #41',
    pr: '#41 ready abc1234',
    status: 'success — done',
  });
  expect(replyBlock('hello\nSTATUS: x')).toBeUndefined();
});

test('ciLines turns ci-wait output into checks and drops the QA cancel notice', () => {
  expect(
    ciLines(
      'Unit and integration tests: fail\nPR QA: cancel\nQA run: success\n',
    ),
  ).toEqual([
    { name: 'Unit and integration tests', state: 'fail' },
    { name: 'QA run', state: 'success' },
  ]);
  expect(ciLines('')).toEqual([]);
});

test('commandBlock takes exactly one fenced block', () => {
  expect(
    commandBlock('Run this:\n```bash\ncd /a && npm ci\n```\nthen answer'),
  ).toBe('cd /a && npm ci');
  expect(commandBlock('no block')).toBeUndefined();
  expect(commandBlock('```\na\n```\n```\nb\n```')).toBeUndefined();
});

test('taskNotification reads id, status and exit code', () => {
  const text =
    '<task-notification>\n<task-id>bt14</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>';
  expect(taskNotification(text)).toEqual({
    exitCode: 0,
    id: 'bt14',
    status: 'completed',
  });
  expect(taskNotification('plain prompt')).toBeUndefined();
});
