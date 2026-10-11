// The ledger's rows and the rules over them (data-model.md, contracts/store-keys.md).
// Pure but readRows: callers pass the session id, the agent list and the time.

export const HOLD_MS = 110 * 60_000;
export const LAP_CAP = 10;
// The guard's claim, written before its Agent call goes through (FR-020).
export const PENDING = 'pending';
export const MARKER = '<!-- motorfix-chief ledger -->';
const DEAD = new Set(['completed', 'failed', 'killed']);

export const key = (pr) => `pr:${pr}`;

export const blank = (pr) => ({
  ci: null,
  head: null,
  holder: null,
  holderSession: null,
  lap: 0,
  pr,
  qaRun: null,
  stage: null,
  updatedAt: 0,
  worktree: null,
});

export const merge = (row, patch, now) => ({
  ...row,
  ...patch,
  lap: Math.min(LAP_CAP, patch.lap ?? row.lap),
  updatedAt: now,
});

// FR-006: in the dispatching session the agent list decides; a claim, or a row
// from another session, holds until it is 110 minutes old.
export function holding(row, { session, agents, now }) {
  if (!row?.holder) return false;
  if (row.holder === PENDING || row.holderSession !== session)
    return now - row.updatedAt < HOLD_MS;
  const agent = agents.find((a) => a.id === row.holder);
  return Boolean(agent) && !DEAD.has(agent.status);
}

export const ageText = (ms) =>
  ms < 2 * 60 * 60_000
    ? `${Math.floor(ms / 60_000)}m`
    : `${Math.floor(ms / 3_600_000)}h`;

const shortTree = (path) =>
  path ? path.slice(path.lastIndexOf('.worktrees/')) : '–';
const dash = (value) => value ?? '–';

export function ledgerBlock(rows, ctx) {
  if (!rows.length) return `${MARKER}\nNo PR is held.`;
  const line = (r) => {
    const holder = r.holder
      ? `${r.holder} (${holding(r, ctx) ? 'live' : 'free'})`
      : '–';
    return `#${r.pr} ${dash(r.stage)} lap ${r.lap}/${LAP_CAP} run ${dash(r.qaRun)} ci ${dash(r.ci)} head ${dash(r.head)} holder ${holder} worktree ${shortTree(r.worktree)} age ${ageText(ctx.now - r.updatedAt)}`;
  };
  return [MARKER, ...[...rows].sort((a, b) => a.pr - b.pr).map(line)].join(
    '\n',
  );
}

export const boardRow = (r, ctx) => ({
  age: ageText(ctx.now - r.updatedAt),
  ci: r.ci ?? 'none',
  holder: holding(r, ctx) ? r.holder : 'none',
  lap: `${r.lap}/${LAP_CAP}`,
  pr: r.pr,
  stage: r.stage ?? 'none',
});

// Every ledger row in the machine-wide store.
export async function readRows($) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith('pr:'));
  return (await Promise.all(keys.map((k) => $.store.get(k)))).filter(Boolean);
}
