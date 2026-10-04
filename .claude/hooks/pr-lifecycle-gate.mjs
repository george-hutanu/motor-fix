// Claude Code Stop hook — Constitution VII: every task runs its own PR
// lifecycle. Before a session ends on a task branch with work ahead of main,
// the work must be pushed, the branch must have a PR, and a ready PR whose
// checks all passed must be merged, not left for the user.
//
// What it does NOT block: main or a detached HEAD, a branch with nothing ahead
// of origin/main, a draft PR (the work is not done yet), a PR whose checks are
// pending, failing or missing (fix or wait, then merge), a merged or closed PR.
//
// Fail-open on purpose where the gate cannot see: no origin/main ref, or a gh
// that cannot be reached. A gate that traps a session because GitHub is down
// helps nobody. Blocks once per turn: `stop_hook_active` means it already did.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Every check concluded green; an empty rollup is not green. */
export function allGreen(checks) {
  return (
    checks.length > 0 &&
    checks.every((c) => GREEN.has(c.conclusion ?? c.state ?? ""))
  );
}

/** The refusal for this state, or null when the session may end. */
export function decide({ branch, ahead, unpushed, pr }) {
  if (!branch || branch === "HEAD" || branch === "main" || ahead === 0)
    return null;
  if (unpushed > 0)
    return `${unpushed} commit(s) on ${branch} are not pushed. Push them (git push -u origin ${branch}); work on a task is pushed as it goes.`;
  if (pr === null)
    return `${branch} has no PR. Open it as a draft (gh pr create --draft --base main --head ${branch}); a task's PR opens at its start.`;
  if (pr.state !== "OPEN" || pr.isDraft) return null;
  if (pr.mergeable === "MERGEABLE" && allGreen(pr.statusCheckRollup ?? []))
    return `PR #${pr.number} is ready and every check passed. Merge it (gh pr merge ${pr.number} --merge), then run speckit-notion-sync finish; merging on green CI does not wait for the user.`;
  return null;
}

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** The branch's state, or null when the gate cannot see enough to judge. */
function readState(cwd) {
  let branch;
  let ahead;
  try {
    branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    ahead = Number(git(cwd, ["rev-list", "--count", "origin/main..HEAD"]));
  } catch {
    return null;
  }
  if (branch === "HEAD" || branch === "main" || ahead === 0) return { branch, ahead };
  let unpushed = ahead;
  try {
    unpushed = Number(git(cwd, ["rev-list", "--count", "@{u}..HEAD"]));
  } catch {
    // no upstream: nothing of this branch has been pushed
  }
  let pr = null;
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", branch, "--json", "number,state,isDraft,mergeable,statusCheckRollup"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
    );
    pr = JSON.parse(out);
  } catch (error) {
    const said = `${error.stderr ?? ""}`;
    if (!/no pull requests found/i.test(said)) return null;
  }
  return { ahead, branch, pr, unpushed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let payload = {};
    try {
      payload = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      process.exit(0);
    }
    if (payload.stop_hook_active) process.exit(0);
    const cwd = payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const state = readState(cwd);
    const why = state && decide(state);
    if (!why) process.exit(0);
    console.error(`PR lifecycle (Constitution VII): ${why}`);
    process.exit(2);
  });
}
