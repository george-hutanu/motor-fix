// Part 5, the worker stage report: a worker session that moved its PR's
// stage this turn sends Chief one line at the turn's end; an unreachable Chief
// gets one dim transcript line and no retry. Chief control's Bash hook fills
// `turn`.
import { role, turn } from './chief-control.js';
import { blank, key, merge } from './lib/ledger.js';

const WATCH = '.claude/scripts/watch.mjs';

// This worktree's row in watch.mjs: its PR and its head.
async function treeRow($) {
  const r = await $.process.run(['node', WATCH, '--json'], {
    cwd: role.main,
    timeoutMs: 120_000,
  });
  if (r.exitCode !== 0) return undefined;
  return (JSON.parse(r.stdout).rows ?? []).find((w) => w.path === role.cwd);
}

async function deliver($, text) {
  const chief = await $.store.get('chief');
  const r = chief
    ? await $.session.send({ text, to: { sessionId: chief.sessionId } })
    : null;
  if (!r?.isDelivered)
    $.ui.log(`motorfix-chief: Chief not reachable; ${text} not sent`);
}

async function report($, stage, named) {
  const tree = await treeRow($).catch(() => undefined);
  const pr = named ?? tree?.pr?.number;
  if (!pr) return;
  const sha7 = tree?.head ? tree.head.slice(0, 7) : 'unknown';
  const row = (await $.store.get(key(pr))) ?? blank(pr);
  if (row.stage === stage) return;
  await $.store.set(key(pr), merge(row, { stage }, await $.clock.now()));
  await deliver($, `#${pr} ${row.stage ?? '–'} → ${stage} ${sha7}`);
}

export async function turnHook($, e, next) {
  const r = await next(e);
  const { pr, stage } = turn;
  if (e.agentId || role.chief || !stage) return r;
  turn.stage = undefined;
  turn.pr = undefined;
  await report($, stage, pr).catch(() => {});
  return r;
}
