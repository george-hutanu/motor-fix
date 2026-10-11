import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

// @traces 1168-FR-008

const CHIEF = '/m/.git\n/m/.git\n';
const HELPER = {
  id: 'helper-1',
  parentId: 'runner-1',
  status: 'completed',
  type: 'Explore',
};
const RUNNER = { id: 'runner-1', status: 'running', type: 'task-runner' };
const note = (id: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "probe" completed</summary>\n<result>found it</result>\n</task-notification>`;
const start = ($) =>
  $.session.start({ cwd: '/m', isInteractive: true, surface: 'terminal' });

test("a helper's result reaches its waiting runner and leaves the main session", async ($, on) => {
  const s = stubs(on, { agents: [HELPER, RUNNER], run: () => ok(CHIEF) });
  await start($);
  const r = await $.prompt.submit({ text: note('helper-1') });
  expect(r.drop).toBe('motorfix-chief forwarded it to runner-1');
  expect(s.submitted).toEqual([]);
  expect(s.sent).toEqual([{ text: note('helper-1'), to: 'runner-1' }]);
  expect(s.store.get('forward:helper-1')).toEqual({ at: 0, to: 'runner-1' });
  expect(s.toasts).toEqual([
    'motorfix-chief: forwarded helper-1 to its runner runner-1',
  ]);
});

for (const [name, agents, options] of [
  ['a parent that finished', [HELPER, { ...RUNNER, status: 'completed' }], {}],
  ['an agent with no parent', [RUNNER], {}],
  ['an undelivered send', [HELPER, RUNNER], { delivered: false }],
] as const) {
  test(`${name} leaves the notification in the main session`, async ($, on) => {
    const s = stubs(on, {
      agents: [...agents],
      run: () => ok(CHIEF),
      ...options,
    });
    await start($);
    const id = agents.length === 1 ? 'runner-1' : 'helper-1';
    const r = await $.prompt.submit({ text: note(id) });
    expect(r.drop).toBeUndefined();
    expect(s.submitted).toEqual([note(id)]);
    expect(s.store.get(`forward:${id}`)).toBeUndefined();
  });
}
