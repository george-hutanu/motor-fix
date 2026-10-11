// Part 1, Chief Control: the ledger from Bash calls, the ledger in context after
// a compaction, the 15-minute watch gate, the tail offer and the chief key, and
// part 3's forward, which shares its prompt.submit hook.
// Agent dispatches reach the ledger through the guard.
import {
  blank,
  DEAD,
  deadHolder,
  FREED,
  key,
  ledgerBlock,
  merge,
} from './lib/ledger.js';
import { bashCall, ciLines, qaRunLine, taskNotification } from './lib/parse.js';
import { fromRevParse, REV_PARSE } from './lib/role.js';
import { stageCall } from './lib/stage.js';
import { canDraw, PANE } from './lib/surface.js';

const TICK_MS = 15 * 60_000;
const GATE_TIMEOUT_MS = 10 * 60_000;
const WATCH = '.claude/scripts/watch.mjs';
const CLOSED = new Set(['merged', 'closed']);

// This session's role (the board reads it too) and its background ci-waits
// (task id → PR and run).
export const role = {
  chief: false,
  cwd: null,
  main: null,
  remote: null,
  surface: null,
  ticking: false,
};
const waits = new Map();
// The ci-wait calls' tool_use_ids, so Quiet transcripts (part 8) knows their results.
export const ciWaitCalls = new Set();
// Part 5: the stage this turn moved the PR to, and the PR a command named.
export const turn = { pr: undefined, stage: undefined };

function noteStage(command, r) {
  const change = !r.isError && stageCall(command);
  if (change) Object.assign(turn, change);
  return r;
}

// Each part keeps its own copy: the engine hands `$` only to the hooks of the
// file that registered them, so a helper taking `$` is not shared across files.
async function readRows($) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith('pr:'));
  const rows = [];
  for (const k of keys) rows.push(await $.store.get(k));
  return rows.filter(Boolean);
}

async function patch($, pr, fields) {
  const row = (await $.store.get(key(pr))) ?? blank(pr);
  const next = merge(row, fields, await $.clock.now());
  await $.store.set(key(pr), next);
  return next;
}

// One offer per PR and head, once CI and the QA run both finished green.
async function offer($, pr, run) {
  const row = await patch($, pr, { ci: 'pass', qaRun: run });
  const id = `offer:${pr}:${row.head ?? 'nohead'}`;
  if (await $.store.get(id)) return [];
  await $.store.set(id, {
    answer: null,
    offeredAt: await $.clock.now(),
    runId: run,
  });
  return [
    `motorfix-chief: CI and QA run ${run} finished for PR #${pr}. Tail it now: dispatch a task-runner with "tail #${pr} after QA run ${run}".`,
  ];
}

async function finished($, wait, passed) {
  if (passed && wait.run) return offer($, wait.pr, wait.run);
  await patch($, wait.pr, { ci: passed ? 'pass' : 'fail' });
  return [];
}

const withContext = (r, lines) =>
  lines.length ? { ...r, context: [...(r.context ?? []), ...lines] } : r;

async function afterDispatch($, call, r) {
  const line = qaRunLine(r.result?.stdout ?? '');
  if (line && !r.isError) await patch($, call.pr, line);
  return r;
}

// ci-wait prints nothing when every check (and the QA run, with --run) passed.
// ci-wait --run exits 0 and prints "QA run: <conclusion>" once the run ends,
// and lists any check that did not pass: only no lines, or a successful QA run
// alone, is green.
const green = (stdout) =>
  ciLines(stdout).every((l) => l.name === 'QA run' && l.state === 'success');

const CI_WAIT = '.claude/scripts/pr-test/ci-wait.mjs';
const RECHECK_MS = 2 * 60_000;

// A background wait's output never reaches the plugin: on its exit-0
// notification ci-wait is asked again, and answers at once since all finished.
async function recheck($, wait) {
  const argv = ['node', CI_WAIT, String(wait.pr)];
  if (wait.run) argv.push('--run', String(wait.run));
  const r = await $.process.run(argv, {
    cwd: role.main ?? undefined,
    timeoutMs: RECHECK_MS,
  });
  return r.exitCode === 0 && green(r.stdout);
}

async function afterCiWait($, call, r) {
  if (r.result?.backgroundTaskId) {
    waits.set(r.result.backgroundTaskId, call);
    return r;
  }
  const passed =
    !r.isError && !r.result?.interrupted && green(r.result?.stdout ?? '');
  return withContext(r, await finished($, call, passed));
}

export async function bashHook($, e, next) {
  const call = bashCall(e.command ?? '');
  if (!call) return noteStage(e.command ?? '', await next(e));
  if (call.kind === 'dispatch') return afterDispatch($, call, await next(e));
  if (e.tool_use_id) ciWaitCalls.add(e.tool_use_id);
  await patch($, call.pr, {
    ci: 'pending',
    ...(call.run ? { qaRun: call.run } : {}),
  });
  return afterCiWait($, call, await next(e));
}

// Part 3: a helper's result that reached this session
// while the runner that spawned it still runs goes to that runner instead.
// Here, not in a file of its own: one prompt.submit hook per plugin.
async function forward($, id, text) {
  const agents = await $.agent.list();
  const helper = agents.find((a) => a.id === id);
  const runner = agents.find((a) => a.id === helper?.parentId);
  if (!runner || DEAD.has(runner.status)) return undefined;
  const sent = await $.session.send({ text, to: { agentId: runner.id } });
  if (!sent?.isDelivered) return undefined;
  await $.store.set(`forward:${id}`, {
    at: await $.clock.now(),
    to: runner.id,
  });
  await $.ui.toast(
    `motorfix-chief: forwarded ${id} to its runner ${runner.id}`,
  );
  return { drop: `motorfix-chief forwarded it to ${runner.id}` };
}

export async function submitHook($, e, next) {
  const note = taskNotification(e.text ?? '');
  const sent = note?.id && !e.agentId && (await forward($, note.id, e.text));
  if (sent) return sent;
  const wait = note && waits.get(note.id);
  if (!wait) return next(e);
  waits.delete(note.id);
  const passed =
    note.exitCode === 0 && (await recheck($, wait).catch(() => false));
  const lines = await finished($, wait, passed);
  return withContext(await next(e), lines);
}

// Refresh the ledger from watch.mjs, then gate only with two or more active worktrees.
async function refresh($) {
  const r = await $.process.run(['node', WATCH, '--json'], {
    cwd: role.main,
    timeoutMs: 120_000,
  });
  if (r.exitCode !== 0) return 0;
  const rows = JSON.parse(r.stdout).rows ?? [];
  const gone = rows
    .filter((w) => w.pr?.number && CLOSED.has(w.pr.state))
    .map((w) => w.pr.number);
  if (gone.length) {
    // A merged or closed PR leaves the ledger with every tail offer it had.
    const offers = (await $.store.keys()).filter((k) => k.startsWith('offer:'));
    for (const pr of gone) {
      await $.store.delete(key(pr));
      for (const k of offers.filter((o) => o.startsWith(`offer:${pr}:`)))
        await $.store.delete(k);
    }
  }
  return rows.filter(
    (w) =>
      !w.main &&
      ((w.pr && !CLOSED.has(w.pr.state)) || (w.holder && w.holder !== 'none')),
  ).length;
}

// The host refuses a plugin prompt that begins with "/" (it would run as the
// person's command), so the wake names the skill instead of typing it.
export const wakeText = (stdout) =>
  `motorfix-chief watch gate: run /speckit-watch for these items.\n${stdout.trim()}`;

async function gate($) {
  const r = await $.process.run(['node', WATCH, '--gate'], {
    cwd: role.main,
    timeoutMs: GATE_TIMEOUT_MS,
  });
  if (r.exitCode === 2) await $.prompt.submit({ text: wakeText(r.stdout) });
  else if (r.exitCode !== 0)
    await $.ui.toast(`motorfix-chief: watch gate exit ${r.exitCode}`);
}

async function tick($) {
  if (role.ticking) return;
  role.ticking = true;
  try {
    if ((await refresh($)) >= 2) await gate($);
  } catch (err) {
    await $.ui.toast(
      `motorfix-chief: watch gate failed (${err?.message ?? err})`,
    );
  } finally {
    role.ticking = false;
  }
}

async function onStart($, e) {
  role.remote = (await $.env.get('CLAUDE_CODE_REMOTE')) ?? null;
  role.surface = e.surface ?? null;
  role.cwd = e.cwd ?? null;
  const r = await $.process.run(REV_PARSE, { cwd: e.cwd, timeoutMs: 10_000 });
  Object.assign(role, fromRevParse(r.exitCode === 0 ? r.stdout : ''));
  if (!role.chief) return;
  await $.store.set('chief', {
    sessionId: await $.session.id(),
    startedAt: await $.clock.now(),
  });
  if (role.remote !== 'true') $.clock.every(TICK_MS, () => tick($));
  // Part 4: the board's pane; one session.start hook per plugin.
  if (canDraw(e.surface, role.remote)) await $.ui.open(PANE).catch(() => {});
}

async function onEnd($) {
  if (!role.chief) return;
  const mine = await $.store.get('chief');
  if (mine?.sessionId === (await $.session.id())) await $.store.delete('chief');
}

export async function contextHook($, e, next) {
  const r = await next(e);
  if (!role.chief) return r;
  const ctx = {
    agents: await $.agent.list(),
    now: await $.clock.now(),
    session: await $.session.id(),
  };
  const rows = [];
  for (const row of await readRows($)) {
    if (!deadHolder(row, ctx)) {
      rows.push(row);
      continue;
    }
    const freed = merge(row, FREED, ctx.now);
    await $.store.set(key(row.pr), freed);
    rows.push(freed);
  }
  const text = ledgerBlock(rows, ctx);
  return { ...r, blocks: [...r.blocks, { name: 'motorfixLedger', text }] };
}

export async function startHook($, e, next) {
  const r = await next(e);
  await onStart($, e);
  return r;
}

export async function endHook($, e, next) {
  await onEnd($);
  return next(e);
}
