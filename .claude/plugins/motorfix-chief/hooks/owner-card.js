// Part 7, the owner card (R8, FR-012, FR-021): an AskUserQuestion from Chief
// whose question holds exactly one fenced command becomes a pane with that
// command as one chain, a Copy button, and a Done / Not done answer. Anything
// else, a worker, a cloud session or another surface passes unchanged (FR-017).
import { role } from './chief-control.js';
import { CARD, canDraw } from './lib/surface.js';

export const ASK = 'Run the command in your terminal, then answer: is it done?';
const FENCE = /```[^\n]*\n([\s\S]*?)\n?```/g;
// A line ending in one of these continues on the next one.
const CONTINUED = /(\\|&&|\|\||\|)$/;

// The card on show, while its ask waits on the owner.
let shown = null;

// One command per line becomes one chain: `a && b`, continuations kept.
export function chain(block) {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let out = '';
  for (const line of lines) {
    if (!out) out = line;
    else if (out.endsWith('\\')) out = `${out.slice(0, -1).trimEnd()} ${line}`;
    else if (CONTINUED.test(out)) out = `${out} ${line}`;
    else out = `${out} && ${line}`;
  }
  return out;
}

function commandOf(e) {
  const text = (e.questions ?? [])
    .map((q) => `${q.question ?? ''}\n${q.description ?? ''}`)
    .join('\n');
  const blocks = [...text.matchAll(FENCE)];
  return blocks.length === 1 ? chain(blocks[0][1]) : null;
}

async function answerOf($) {
  try {
    return (await $.ui.ask(ASK, ['Done', 'Not done'])) === 'Done'
      ? 'Done'
      : 'Not done';
  } catch {
    return 'Not done';
  }
}

export async function cardHook($, e, next) {
  if (!role.chief || !canDraw(role.surface, role.remote)) return next(e);
  const command = commandOf(e);
  if (!command) return next(e);
  const card = { command, copied: false };
  shown = card;
  await $.ui.open(CARD).catch(() => {});
  const label = await answerOf($);
  shown = null;
  await $.ui.close({ id: CARD.id }).catch(() => {});
  const id = e.tool_use_id ?? String(await $.clock.now());
  await $.store.set(`card:${id}`, {
    answer: label === 'Done' ? 'done' : 'not done',
    command,
    copied: card.copied,
  });
  const answers = Object.fromEntries(
    e.questions.map((q) => [q.question, label]),
  );
  return {
    context: [
      label === 'Done'
        ? 'motorfix-chief: the owner answered "Done" to the command card.'
        : 'motorfix-chief: the owner answered "Not done" to the command card; the command has not run.',
    ],
    result: { answers, questions: e.questions },
  };
}

async function copy($, card, press) {
  const r = await $.ui.copy({ surface: press?.surface, text: card.command });
  card.copied = card.copied || Boolean(r?.isCopied);
}

export function cardPaneHook($, e, next) {
  const card = shown;
  if (!card) return next(e);
  const { Box, Button, Code, Text } = $.ui.resolve(e);
  return h(
    Box,
    { flexDirection: 'column', gap: 1 },
    h(Text, {}, 'Run this in your terminal, then answer the question.'),
    h(Code, { language: 'bash', source: card.command }),
    h(Button, {
      key: 'copy',
      label: 'Copy',
      onPress: (press) => copy($, card, press).catch(() => {}),
    }),
  );
}
