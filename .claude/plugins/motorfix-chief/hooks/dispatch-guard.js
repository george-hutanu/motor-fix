// Part 2, the dispatch guard (contracts/denials.md): one agent per PR, and a
// story run, tail or watch fix only as task-runner. A deny is the model's only
// answer; nothing here approves anything (FR-014).
import { blank, holding, key, merge, PENDING } from './lib/ledger.js';
import { needsTaskRunner, prTokens, worktreeTokens } from './lib/parse.js';

export const GENERAL_DENY =
  'motorfix-chief: this dispatch is a story run, tail or watch fix — task-runner is required (AGENTS.md step 4), never general-purpose.';

const tree = (path) =>
  path ? ` in ${path.slice(path.lastIndexOf('.worktrees/'))}` : '';

function heldLine(row, ctx) {
  if (row.holder === PENDING)
    return `motorfix-chief: PR #${row.pr} is being dispatched by session ${row.holderSession} — one agent per PR; wait for that dispatch.`;
  if (row.holderSession === ctx.session)
    return `motorfix-chief: PR #${row.pr} is held by agent ${row.holder} (live, dispatched by this session)${tree(row.worktree)} — one agent per PR; wait for it or stop it first.`;
  const mins = Math.floor((ctx.now - row.updatedAt) / 60_000);
  return `motorfix-chief: PR #${row.pr} is held by agent ${row.holder} (dispatched by session ${row.holderSession}, ${mins} min ago) — one agent per PR; it frees itself at 110 min.`;
}

// The rows this prompt claims: each PR it names, and each row whose worktree it names.
function claimed(prompt, rows) {
  const prs = prTokens(prompt);
  const trees = worktreeTokens(prompt);
  const byTree = rows.filter((r) =>
    trees.some((t) => r.worktree?.endsWith(`/.worktrees/${t}`)),
  );
  const worktree = trees.length
    ? (prompt.match(/[^\s'"`]*\.worktrees\/[\w.-]*[\w-]/)?.[0] ?? null)
    : null;
  const wanted = new Set([...prs, ...byTree.map((r) => r.pr)]);
  return [...wanted].map((pr) => {
    const row = rows.find((r) => r.pr === pr);
    return row ?? { ...blank(pr), worktree };
  });
}

// One check-and-claim at a time in this session, so two dispatches at once
// cannot both find the PR free (FR-020).
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function readRows($) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith('pr:'));
  const rows = [];
  for (const k of keys) rows.push(await $.store.get(k));
  return rows.filter(Boolean);
}

async function claim($, prompt) {
  const rows = await readRows($);
  const ctx = {
    agents: await $.agent.list(),
    now: await $.clock.now(),
    session: await $.session.id(),
  };
  const targets = claimed(prompt, rows);
  const busy = targets.filter((r) => holding(r, ctx));
  if (busy.length)
    return { deny: busy.map((r) => heldLine(r, ctx)).join('\n') };
  for (const r of targets)
    await $.store.set(
      key(r.pr),
      merge(r, { holder: PENDING, holderSession: ctx.session }, ctx.now),
    );
  return { ctx, targets };
}

async function settle($, targets, ctx, r) {
  const status = r?.result?.status;
  const holder = status === 'async_launched' ? r.result.agentId : null;
  for (const row of targets) {
    const now = await $.clock.now();
    await $.store.set(
      key(row.pr),
      merge(
        (await $.store.get(key(row.pr))) ?? row,
        { holder, holderSession: holder ? ctx.session : null },
        now,
      ),
    );
  }
}

async function dispatch($, e, next, prompt) {
  // A ledger that cannot be read never blocks a dispatch.
  const decided = await serial(() => claim($, prompt)).catch(() => null);
  if (decided?.deny) return decided;
  if (!decided?.targets.length) return next(e);
  let r;
  try {
    r = await next(e);
  } finally {
    // A claim left pending would hold the PR for 110 minutes: say so.
    await settle($, decided.targets, decided.ctx, r).catch(() =>
      $.ui
        .toast(
          `motorfix-chief: could not record the holder of ${decided.targets.map((t) => `#${t.pr}`).join(', ')}; its pending claim holds for 110 min`,
        )
        .catch(() => {}),
    );
  }
  return r;
}

// tool.call{tool=Agent}, listed first in register.js.
export function agentHook($, e, next) {
  const prompt = `${e.description ?? ''}\n${e.prompt ?? ''}`;
  if (e.subagent_type === 'general-purpose' && needsTaskRunner(prompt))
    return { deny: GENERAL_DENY };
  if (e.subagent_type !== 'task-runner') return next(e);
  return dispatch($, e, next, prompt);
}
