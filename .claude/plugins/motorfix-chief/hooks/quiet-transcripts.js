// Part 8, quiet transcripts: display only, the model's text is
// untouched. A ci-wait result draws one pill per check (one "green" for empty
// output, nothing for the lone `PR QA: cancel`), and an Agent reply opening
// with the four-line envelope folds to STATUS, PR and NEXT. Everything else,
// and every surface but terminal and desktop, keeps the engine's own.
import { ciWaitCalls, role } from './chief-control.js';
import { ciLines, replyBlock } from './lib/parse.js';
import { canDraw } from './lib/surface.js';

const COLOR = { cancel: 'gray', fail: 'red', pending: 'yellow' };

function pills($, e, stdout) {
  const { Box, Text } = $.ui.resolve(e);
  const raw = stdout.trim();
  const checks = raw ? ciLines(raw) : [{ name: 'green', state: '' }];
  const pill = (c) =>
    h(
      Text,
      { color: COLOR[c.state], inverse: true },
      ` ${[c.name, c.state].filter(Boolean).join(' ')} `,
    );
  return h(
    Box,
    { flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
    ...checks.map(pill),
  );
}

function folded($, e, block) {
  const { Box, Text } = $.ui.resolve(e);
  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, {}, `STATUS: ${block.status}`),
    h(Text, { dimColor: true }, `PR: ${block.pr}`),
    h(Text, { dimColor: true }, `NEXT: ${block.next}`),
  );
}

const agentText = (output) =>
  (output?.content ?? []).map((c) => c.text ?? '').join('\n');

export function resultHook($, e, next) {
  const { isErrored, output, tool, tool_use_id } = e.props;
  if (isErrored || !canDraw(e.surface, role.remote)) return next(e);
  if (tool === 'Bash' && ciWaitCalls.has(tool_use_id)) {
    if (output?.backgroundTaskId) return next(e);
    return pills($, e, output?.stdout ?? '');
  }
  const block = tool === 'Agent' ? replyBlock(agentText(output)) : undefined;
  return block ? folded($, e, block) : next(e);
}
