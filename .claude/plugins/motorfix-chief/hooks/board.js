// Part 4, the build board: a pane and an above-prompt
// band in Chief, one row per PR and four buttons, each running one repo
// command as an argument list. Fast-forward main never pushes.
import { role } from './chief-control.js';
import { boardRow, holding } from './lib/ledger.js';
import { canDraw } from './lib/surface.js';

// The pane opens from Chief control's session.start: one hook per event.

const TIMEOUT_MS = 5 * 60_000;

// The last button's output, shown in the pane until the next press.
let output = '';

// Its own copy, as in chief-control.js: `$` does not cross a file.
async function readRows($) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith('pr:'));
  const rows = [];
  for (const k of keys) rows.push(await $.store.get(k));
  return rows.filter(Boolean).sort((a, b) => a.pr - b.pr);
}

async function context($) {
  return {
    agents: await $.agent.list(),
    now: await $.clock.now(),
    session: await $.session.id(),
  };
}

export const rowText = (r) =>
  `#${r.pr} ${r.stage} lap ${r.lap} ci ${r.ci} holder ${r.holder} age ${r.age}`;

// Ready (QA), offered a tail for its current head (CI and the QA run both
// passed), and nobody holds it.
async function tailable($, r, ctx) {
  if (r.stage !== 'QA' || r.ci !== 'pass' || holding(r, ctx)) return false;
  return Boolean(await $.store.get(`offer:${r.pr}:${r.head ?? 'nohead'}`));
}

function show($, text) {
  output = text.trim();
  $.ui.invalidate('ui.render');
}

async function runShown($, argv) {
  const r = await $.process.run(argv, {
    cwd: role.main,
    timeoutMs: TIMEOUT_MS,
  });
  show($, r.exitCode === 0 ? r.stdout : `exit ${r.exitCode}\n${r.stderr}`);
  return r;
}

async function fastForward($) {
  const r = await runShown($, [
    'git',
    '-C',
    role.main,
    'merge',
    '--ff-only',
    'origin/main',
  ]);
  await $.ui.toast(
    r.exitCode === 0
      ? 'motorfix-chief: main fast-forwarded'
      : 'motorfix-chief: main not fast-forwarded',
  );
}

async function tailReady($) {
  const ctx = await context($);
  const ready = [];
  for (const r of await readRows($)) {
    if (await tailable($, r, ctx)) ready.push(r);
  }
  if (!ready.length) {
    await $.ui.toast('motorfix-chief: no ready PR to tail');
    return;
  }
  const lines = ready.map((r) => `tail #${r.pr} after QA run ${r.qaRun}`);
  await $.prompt.submit({
    text: `motorfix-chief: tail these ready PRs, one task-runner each.\n${lines.join('\n')}`,
  });
}

function buttons($, Button) {
  return [
    h(Button, {
      key: 'status',
      label: 'Status',
      onPress: () =>
        runShown($, ['node', '.claude/scripts/status.mjs']).catch(() => {}),
    }),
    h(Button, {
      key: 'watch',
      label: 'Watch pass',
      onPress: () =>
        runShown($, ['node', '.claude/scripts/watch.mjs']).catch(() => {}),
    }),
    h(Button, {
      key: 'ff-main',
      label: 'Fast-forward main',
      onPress: () => fastForward($).catch(() => {}),
    }),
    h(Button, {
      key: 'tail',
      label: 'Tail ready PRs',
      onPress: () => tailReady($).catch(() => {}),
    }),
  ];
}

async function rowsDrawn($, Text) {
  const ctx = await context($);
  return (await readRows($)).map((r) => h(Text, {}, rowText(boardRow(r, ctx))));
}

const drawing = (e) => role.chief && canDraw(e.surface, role.remote);

export async function bandHook($, e, next) {
  if (!drawing(e) || e.props.hasSurvey) return next(e);
  const { Box, Button, Text } = $.ui.resolve(e);
  const rows = await rowsDrawn($, Text);
  if (!rows.length) return next(e);
  return h(
    Box,
    { flexDirection: 'column' },
    ...rows,
    h(Box, { flexDirection: 'row', gap: 1 }, ...buttons($, Button)),
  );
}

export async function paneHook($, e, next) {
  if (!drawing(e)) return next(e);
  const { Box, Button, Text } = $.ui.resolve(e);
  const rows = await rowsDrawn($, Text);
  return h(
    Box,
    { flexDirection: 'column' },
    ...(rows.length ? rows : [h(Text, {}, 'No PR in the ledger.')]),
    h(Box, { flexDirection: 'row', gap: 1 }, ...buttons($, Button)),
    ...(output ? [h(Text, { dimColor: true }, output)] : []),
  );
}
