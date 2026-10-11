import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';
import { ASK } from './owner-card.js';

// @traces 1168-FR-012 1168-FR-017 1168-FR-021

const CHIEF = '/m/.git\n/m/.git\n';
const WORKER = '/m/.git/worktrees/41-slug\n/m/.git\n';
const PLUGIN = 'motorfix-chief';
const CHAIN =
  'cd ~/projects/motor-fix && GH_TOKEN=$(gh auth token -u george-hutanu) gh secret set X';
const PANE = {
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
const withBlock = (body: string) =>
  `Run this in your terminal, then answer?\n\n\`\`\`sh\n${body}\n\`\`\``;

// Beneath the plugin: the engine's own dialog. The mod's own ask waits on the
// test (`answer`); a question the mod let through is answered "native".
function dialog(on) {
  const seen: string[] = [];
  let answer: (label: string | null) => void = () => {};
  let onAsk: () => void = () => {};
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0].question;
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

// A Code element keeps no key, as a Text does: found by type.
const codeOf = async (ui) =>
  (await ui.findAll({ type: 'Code' })).map((c) => c.props.source).join('\n');

const start = ($, surface = 'terminal', cwd = '/m') =>
  $.session.start({ cwd, isInteractive: true, surface });

test('Chief shows the chained command in a code element; Copy copies exactly it; Done closes the card', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF) });
  const d = dialog(on);
  for (const surface of ['terminal', 'desktop'] as const) {
    s.store.clear();
    s.copied.length = 0;
    await start($, surface);
    const asked = d.asked();
    const call = $.tool.call(question(withBlock(CHAIN)));
    await asked;
    expect(s.opened).toContain('motorfix-card');
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE });
    expect(await codeOf(ui)).toBe(CHAIN);
    await ui.press({ key: 'copy' });
    expect(s.copied).toEqual([CHAIN]);
    d.answer('Done');
    const r = await call;
    expect(Object.values(r.result.answers)).toEqual(['Done']);
    const card = [...s.store.entries()].find(([k]) =>
      k.startsWith('card:'),
    )?.[1];
    expect(card).toEqual({ answer: 'done', command: CHAIN, copied: true });
    expect(s.closed).toContain('motorfix-card');
    await ui.unmount();
  }
});

test('steps on separate lines are joined into one chain with &&', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF) });
  const d = dialog(on);
  await start($);
  const asked = d.asked();
  const call = $.tool.call(
    question(
      withBlock('cd ~/projects/motor-fix\nnpm ci \\\n  --silent\nnpm test'),
    ),
  );
  await asked;
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE });
  expect(await codeOf(ui)).toBe(
    'cd ~/projects/motor-fix && npm ci --silent && npm test',
  );
  d.answer('Done');
  await call;
  expect(s.closed).toContain('motorfix-card');
});

test('a dismissed card is recorded as not done and the session is told so', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF) });
  const d = dialog(on);
  await start($);
  const asked = d.asked();
  const call = $.tool.call(question(withBlock(CHAIN)));
  await asked;
  d.answer(null);
  const r = await call;
  expect(Object.values(r.result.answers)).toEqual(['Not done']);
  expect(r.context).toEqual([
    'motorfix-chief: the owner answered "Not done" to the command card; the command has not run.',
  ]);
  const card = [...s.store.entries()].find(([k]) => k.startsWith('card:'))?.[1];
  expect(card).toEqual({ answer: 'not done', command: CHAIN, copied: false });
});

test('a question with no command block, or with two, passes unchanged', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF) });
  const d = dialog(on);
  await start($);
  for (const text of [
    'Which library should we use?',
    `${withBlock('a')}\n${withBlock('b')}`,
  ]) {
    const r = await $.tool.call(question(text));
    expect(Object.values(r.result.answers)).toEqual(['native']);
  }
  expect(d.seen).not.toContain(ASK);
  expect(s.opened).not.toContain('motorfix-card');
});

test('a worker session, a cloud session or another surface passes the question unchanged', async ($, on) => {
  let gitOut = WORKER;
  let env = {};
  const s = stubs(on, {
    env: new Proxy({}, { get: (_t, k) => env[k as string] }),
    run: () => ok(gitOut),
  });
  const d = dialog(on);
  const cases: [string, string, Record<string, string>][] = [
    ['terminal', WORKER, {}],
    ['terminal', CHIEF, { CLAUDE_CODE_REMOTE: 'true' }],
    ['vscode', CHIEF, {}],
  ];
  for (const [surface, out, vars] of cases) {
    gitOut = out;
    env = vars;
    await start($, surface);
    const r = await $.tool.call(question(withBlock(CHAIN)));
    expect(Object.values(r.result.answers)).toEqual(['native']);
  }
  expect(d.seen).not.toContain(ASK);
  expect(s.opened).not.toContain('motorfix-card');
});
