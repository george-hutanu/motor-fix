// Claude Code PreToolUse hook (Bash) — Constitution VII: a PR merges only
// after the PR tester passed it. Refuses `gh pr merge` and the REST merge
// call while the PR's head commit has no `agent-review` success status.
//
// A PR opened by Dependabot (its author, read from gh) needs no agent-review
// status, only every other check green: a failing, pending or missing one
// still refuses, and so does an agent review that failed.
//
// The status is per commit, so a push after the tester ran (a fix, a merge of
// origin/main) leaves the new head without one, and the tester runs again.
//
// Fail-open where the gate cannot see: a gh that cannot be reached cannot
// merge either. SPECKIT_PR_STATE (the PR as JSON) replaces the gh read for the
// eval cases; hook processes take Claude Code's environment, not a Bash
// call's, so an agent cannot set it for a real gate run.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { allGreen, hasAgentReview, isDependabot } from "./pr-lifecycle-gate.mjs";

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
  if (hasAgentReview(checks)) return null;
  const sha = String(pr.headRefOid ?? "").slice(0, 7);
  const review = checks.find((c) => (c.context ?? c.name) === "agent-review");
  if (!review && isDependabot(pr)) return dependabotRefusal(pr, checks);
  const said = review ? `agent-review is ${String(review.state ?? review.conclusion).toLowerCase()}` : "there is no agent-review status";
  return `PR #${pr.number} cannot merge: on its head commit ${sha} ${said}. Run the PR tester (/speckit-pr-test ${pr.number}), fix every blocking finding, and merge on an agent-review success.`;
}

/** A Dependabot PR merges on every check green; the refusal names the ones that are not. */
function dependabotRefusal(pr, checks) {
  if (allGreen(checks)) return null;
  const waiting = checks.filter((c) => !allGreen([c])).map((c) => c.name ?? c.context ?? "unnamed check");
  const said = checks.length ? `${waiting.join(", ")} is not green` : "it has no checks yet";
  return `PR #${pr.number} cannot merge: it is a Dependabot PR, so it needs no agent review, but every other check must be green and ${said}. Wait for the checks or fix them, then merge.`;
}

function readPr(target, cwd) {
  const raw = process.env.SPECKIT_PR_STATE;
  if (raw) return JSON.parse(raw);
  const out = execFileSync(
    "gh",
    ["pr", "view", ...(target ? [target] : []), "--json", "author,number,state,headRefOid,statusCheckRollup"],
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
