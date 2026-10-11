// Part 5's reading of a worker's own Bash calls: which stage label a
// tracker or lifecycle command moves the PR to, and the PR it names. Pure.
const TRACKER = {
  blocked: 'blocked',
  finish: 'Done',
  implement: 'in development',
  qa: 'QA',
  start: 'planning',
};
const LIFECYCLE = { merge: 'merged', ready: 'QA' };

const prOf = (args) => {
  const at = args.indexOf('--pr');
  const n = Number(at >= 0 ? args[at + 1] : Number.NaN);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

// `{ stage?, pr? }` for a tracker-sync.mjs or lifecycle.mjs call, else undefined.
export function stageCall(command) {
  const m = /\b(tracker-sync|lifecycle)\.mjs\s+(\S+)(.*)$/m.exec(command);
  if (!m) return undefined;
  const [, script, verb, rest] = m;
  const args = rest.trim().split(/\s+/);
  if (script === 'tracker-sync' && verb === 'pr') {
    const pr = Number(args[0]);
    return Number.isInteger(pr) && pr > 0 ? { pr } : undefined;
  }
  const stage = (script === 'lifecycle' ? LIFECYCLE : TRACKER)[verb];
  if (!stage) return undefined;
  const pr = prOf(args);
  return pr ? { pr, stage } : { stage };
}
