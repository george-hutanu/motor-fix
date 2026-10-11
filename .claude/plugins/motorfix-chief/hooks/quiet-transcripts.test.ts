import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

// @traces 1168-FR-013

const PLUGIN = 'motorfix-chief';
const CHIEF = '/m/.git\n/m/.git\n';
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
const start = ($, surface = 'terminal') =>
  $.session.start({ cwd: '/m', isInteractive: true, surface });

// Beneath the plugin, the shell: prints what the next `ran` asks for and
// hands back the call's id, which the transcript's ToolResult carries.
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

const texts = async (ui) =>
  (await ui.findAll({ type: 'Text' })).map((t) => t.text);

test('a ci-wait result draws one pill per check, and one green pill when empty', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const ran = shell(on);
  await start($);
  const out = 'Unit and integration tests: fail\nQA run: success\n';
  const failing = await ran(
    $,
    'node .claude/scripts/pr-test/ci-wait.mjs 363 --run 77',
    out,
  );
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      ...result('Bash', failing, bash(out)),
    });
    expect(await texts(ui)).toEqual([
      ' Unit and integration tests fail ',
      ' QA run success ',
    ]);
    await ui.unmount();
  }
  const green = await ran(
    $,
    'node .claude/scripts/pr-test/ci-wait.mjs 363',
    '',
  );
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...result('Bash', green, bash('')),
  });
  expect(await texts(ui)).toEqual([' green ']);
});

test('the PR QA: cancel notice draws nothing', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const ran = shell(on);
  await start($);
  const id = await ran(
    $,
    'node .claude/scripts/pr-test/ci-wait.mjs 363',
    'PR QA: cancel\n',
  );
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    ...result('Bash', id, bash('PR QA: cancel\n')),
  });
  expect(await texts(ui)).toEqual([]);
});

test('an Agent reply that opens with the envelope folds to STATUS, PR and NEXT', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  await start($);
  const text =
    'STATUS: success — merged\nPR: #363 merged abc1234\nNEXT: none\nFILES: a.md\nlong body\nmore';
  const output = { agentId: 'a1', content: [{ text, type: 'text' }] };
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    ...result('Agent', 'toolu_agent', output),
  });
  expect(await texts(ui)).toEqual([
    'STATUS: success — merged',
    'PR: #363 merged abc1234',
    'NEXT: none',
  ]);
});

test('other results, a background ci-wait, and other surfaces keep the default rendering', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const ran = shell(on);
  await start($);
  const plain = await ran($, 'ls', 'a\nb\n');
  const agent = { agentId: 'a1', content: [{ text: 'hello', type: 'text' }] };
  const bg = await ran($, 'node .claude/scripts/pr-test/ci-wait.mjs 363', '');
  const cases = [
    ['terminal', result('Bash', plain, bash('a\nb\n'))],
    ['terminal', result('Agent', 'toolu_x', agent)],
    ['terminal', result('Bash', bg, bash('', { backgroundTaskId: 'b1' }))],
    ['vscode', result('Bash', bg, bash(''))],
  ] as const;
  for (const [surface, r] of cases) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...r });
    expect(await texts(ui)).toEqual(['engine']);
  }
});
