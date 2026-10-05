// Claude Code PreToolUse hook (Bash) — Constitution VII: a PR merges only
// after the PR tester passed it. Refuses `gh pr merge` and the REST merge
// call while the PR's head commit has no `agent-review` success status.
//
// The status is per commit, so a push after the tester ran (a fix, a merge of
// origin/main) leaves the new head without one, and the tester runs again.
//
// The tester runs beside CI rather than after it, so an agent-review success
// does not imply CI finished: the gate also refuses while any other check is
// failing or still running, or while CI OK has not reported at all.
//
// Fail-open where the gate cannot see: a gh that cannot be reached cannot
// merge either. SPECKIT_PR_STATE (the PR as JSON) replaces the gh read for the
// eval cases; hook processes take Claude Code's environment, not a Bash
// call's, so an agent cannot set it for a real gate run.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { hasAgentReview } from "./pr-lifecycle-gate.mjs";

const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const checkName = (c) => c.context ?? c.name;

/** The PR a command merges ({ pr: null } for the current branch), or null for any other command. */
// Flags of `gh` and `gh pr merge` that take a value, so the value is not read as the PR.
const VALUED = new Set(["-R", "--repo", "-t", "--subject", "-b", "--body", "-F", "--body-file", "--match-head-commit", "-A", "--author-email"]);

export function mergeTarget(command) {
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const words = part.trim().split(/\s+/);
    const gh = words.findIndex((w) => w === "gh" || w.endsWith("/gh"));
    if (gh === -1) continue;
    const positional = [];
    const rest = words.slice(gh + 1);
    for (let i = 0; i < rest.length; i++) {
      if (VALUED.has(rest[i])) i++;
      else if (!rest[i].startsWith("-")) positional.push(rest[i]);
    }
    const [sub, verb, arg] = positional;
    if (sub === "pr" && verb === "merge") return { pr: arg ?? null };
    if (sub === "api") {
      const m = part.match(/repos\/[^/\s]+\/[^/\s]+\/pulls\/(\d+)\/merge\b/);
      if (m) return { pr: m[1] };
    }
  }
  return null;
}

/** The refusal for this PR, or null when it may merge. */
export function decideMerge(pr) {
  if (pr.state && pr.state !== "OPEN") return null;
  const checks = pr.statusCheckRollup ?? [];
  const sha = String(pr.headRefOid ?? "").slice(0, 7);
  if (hasAgentReview(checks)) return ciRefusal(pr, checks, sha);
  const review = checks.find((c) => (c.context ?? c.name) === "agent-review");
  const said = review ? `agent-review is ${String(review.state ?? review.conclusion).toLowerCase()}` : "there is no agent-review status";
  return `PR #${pr.number} cannot merge: on its head commit ${sha} ${said}. Run the PR tester (/speckit-pr-test ${pr.number}), fix every blocking finding, and merge on an agent-review success.`;
}

/** Why CI does not yet allow the merge, or null when every other check is green. */
function ciRefusal(pr, checks, sha) {
  // A check re-run or cancelled by a newer run appears once per run: judge the latest only.
  // gh dates a run that has not started 0001-01-01, so an unfinished run counts as the newest;
  // a run cancelled before it started is finished and keeps that date, the oldest.
  const when = (c) => (c.status && c.status !== "COMPLETED" ? Infinity : Date.parse(c.startedAt ?? c.createdAt ?? "") || 0);
  // Jobs in different workflows may share a name; a status context has one entry per context.
  const key = (c) => c.context ?? `${c.workflowName ?? ""}\u0000${c.name}`;
  const latest = new Map();
  for (const c of checks) {
    const k = key(c);
    if (checkName(c) !== "agent-review" && (!latest.has(k) || when(c) >= when(latest.get(k)))) latest.set(k, c);
  }
  const ci = [...latest.values()];
  const result = (c) => c.conclusion ?? c.state;
  const pending = ci.filter((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED" || result(c) == null);
  const red = ci.filter((c) => !pending.includes(c) && !GREEN.has(result(c)));
  const list = (cs) => cs.map(checkName).join(", ");
  if (red.length) return `PR #${pr.number} cannot merge: CI failed on ${sha} (${list(red)}). Read gh pr checks ${pr.number}, fix it on the branch, and run the PR tester again on the new head.`;
  if (pending.length) return `PR #${pr.number} cannot merge yet: CI is still running on ${sha} (${list(pending)}). Wait for gh pr checks ${pr.number} --watch, in the background, and merge when it is green.`;
  if (!ci.some((c) => checkName(c) === "CI OK")) return `PR #${pr.number} cannot merge: there is no CI OK check on ${sha}. Wait for CI (gh pr checks ${pr.number}) before merging.`;
  return null;
}

function readPr(target, cwd) {
  const raw = process.env.SPECKIT_PR_STATE;
  if (raw) return JSON.parse(raw);
  const out = execFileSync(
    "gh",
    ["pr", "view", ...(target ? [target] : []), "--json", "number,state,headRefOid,statusCheckRollup"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
  );
  return JSON.parse(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const payload = JSON.parse(raw || "{}");
    const target = mergeTarget(String(payload.tool_input?.command ?? ""));
    if (!target) process.exit(0);
    let pr;
    try {
      pr = readPr(target.pr, payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
    } catch {
      process.exit(0);
    }
    const why = decideMerge(pr);
    if (!why) process.exit(0);
    console.error(`Merge gate (Constitution VII): ${why}`);
    process.exit(2);
  });
}
