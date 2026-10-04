#!/usr/bin/env node
// Which stories are ready to work on, decided here so the rule is tested
// rather than re-judged from prose on every run. `notion-ready` gathers each
// item's status, blockers and any outside hold, asks this script, then ticks
// and unticks the Ready to work checkbox it names. `/speckit-archive` asks the
// same script whether the refresh ran after the story finished.
//
// Ready: still To do, every blocker Done (a story) or Merged (a timeline row),
// and no hold — a wait on the owner, the lawyer or anyone outside the build.
//
//   node .claude/scripts/notion-ready.mjs decide < items.json
//     items: [{ id, status, priority, blockers: [{ id, status }], hold, ticked }]
//     prints { tick, untick, ready: [{ id, priority }], held: [{ id, reason }] }
//   node .claude/scripts/notion-ready.mjs check specs/<feature>/notion-sync.md
//     exits 0 when a ready line follows the last finish line, else 1 with why
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FINISHED = new Set(['Done', 'Merged']);
const RANK = ['Highest', 'High', 'Medium', 'Low'];
const rank = (priority) => (RANK.includes(priority) ? RANK.indexOf(priority) : RANK.length);
const number = (id) => Number(String(id).match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);

function holdOf(item) {
  if (item.hold) return item.hold;
  const open = (item.blockers ?? []).filter((blocker) => !FINISHED.has(blocker.status));
  return open.length ? `waits on ${open.map((b) => `${b.id} (${b.status})`).join(', ')}` : null;
}

export function decideReady(items) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (items.some((item) => item?.id == null)) throw new TypeError('every item needs an id');
  const ready = [];
  const held = [];
  const tick = [];
  const untick = [];
  const seen = new Set();
  for (const item of items) {
    // One page, one checkbox: a repeated ID is the same item gathered twice.
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const reason = item.status === 'To do' ? holdOf(item) : null;
    const isReady = item.status === 'To do' && !reason;
    if (isReady) ready.push({ id: item.id, priority: item.priority ?? null });
    if (reason) held.push({ id: item.id, reason });
    if (isReady && !item.ticked) tick.push(item.id);
    if (!isReady && item.ticked) untick.push(item.id);
  }
  ready.sort((a, b) => rank(a.priority) - rank(b.priority) || number(a.id) - number(b.id) || String(a.id).localeCompare(String(b.id)));
  return { tick, untick, ready, held };
}

// Log lines are `- <date> · <event> · …`, some written without the ` · ` after
// the date. A failed refresh is logged `[NOTION-SYNC PENDING: ready …]`, as a
// bullet like every other line or bare.
const EVENT = /^- \d{4}-\d{2}-\d{2}(?: ·)? (\w+)\b/;
const PENDING_READY = /^(?:- )?\[NOTION-SYNC PENDING: ready\b/;

export function readyLogged(text) {
  let finish = -1;
  let ready = -1;
  text.split('\n').forEach((line, index) => {
    const event = line.match(EVENT)?.[1] ?? (PENDING_READY.test(line) ? 'ready' : null);
    if (event === 'finish') finish = index;
    if (event === 'ready') ready = index;
  });
  if (finish === -1) return { ok: false, reason: 'no finish line: run `speckit-notion-sync finish` once the PR has merged' };
  if (ready < finish) return { ok: false, reason: 'no ready line after the last finish: run `notion-ready <epic>` and log it' };
  return { ok: true, reason: 'ready refreshed after finish' };
}

function main([command, file]) {
  if (command === 'decide') {
    console.log(JSON.stringify(decideReady(JSON.parse(readFileSync(0, 'utf8')))));
    return 0;
  }
  if (command === 'check' && file) {
    const result = readyLogged(readFileSync(file, 'utf8'));
    (result.ok ? console.log : console.error)(result.reason);
    return result.ok ? 0 : 1;
  }
  console.error('usage: notion-ready.mjs decide < items.json | check <notion-sync.md>');
  return 2;
}

function run(argv) {
  try {
    return main(argv);
  } catch (error) {
    console.error(`notion-ready: ${error.message}`);
    return 2;
  }
}

// Real paths on both sides: a symlinked path (macOS temp dirs are one) must
// still run the CLI, or the archive check would pass by doing nothing.
const invoked = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

// exitCode, not exit(): exit() would cut stdout at the pipe buffer.
if (invoked) process.exitCode = run(process.argv.slice(2));
