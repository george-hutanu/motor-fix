// Part 6, the usage-limit guard (FR-011, FR-018): the first time a rate-limit
// window reaches 80 %, once per window kind and reset time across sessions,
// ask whether to remap fable to Opus; only a yes runs `fable.mjs off`, as an
// argument list in the main checkout. Drawn only where the mod draws (FR-017).
import { role } from './chief-control.js';
import { canDraw } from './lib/surface.js';

const THRESHOLD = 80;
const REMAP = 'Remap fable to Opus';
const FABLE_OFF = ['node', '.claude/scripts/fable.mjs', 'off'];

async function answerOf($, limit) {
  const question = `The ${limit.kind} usage window is at ${limit.percentUsed} % (resets ${limit.resetsAt ?? 'unknown'}). Remap fable to Opus with fable.mjs off?`;
  try {
    return (await $.ui.ask(question, [REMAP, 'Not now'])) === REMAP;
  } catch {
    return false;
  }
}

async function warn($, limit) {
  const id = `usage:${limit.kind}:${limit.resetsAt ?? 'unknown'}`;
  if (await $.store.get(id)) return;
  const row = { answer: null, percentUsed: limit.percentUsed };
  await $.store.set(id, row);
  const remap = await answerOf($, limit);
  await $.store.set(id, { ...row, answer: remap ? 'remap' : 'declined' });
  if (!remap) return;
  const r = await $.process.run(FABLE_OFF, {
    cwd: role.main,
    timeoutMs: 30_000,
  });
  await $.ui.toast(
    r.exitCode === 0
      ? 'motorfix-chief: fable now maps to Opus for new sessions'
      : `motorfix-chief: fable.mjs off failed (exit ${r.exitCode})`,
  );
}

export async function measureHook($, e, next) {
  const r = await next(e);
  if (!canDraw(role.surface, role.remote) || !role.main) return r;
  for (const limit of e.rateLimits ?? [])
    if (limit.percentUsed >= THRESHOLD) await warn($, limit).catch(() => {});
  return r;
}
