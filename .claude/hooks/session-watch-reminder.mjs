// Claude Code SessionStart hook — remind the orchestrating session to keep the
// agent watch scheduled while parallel work runs.
//
// `/speckit-watch` is scheduled with CronCreate, a session-only job: a resumed
// or compacted session has lost it, and a hook can neither see nor create one.
// So this hook only speaks: when two or more worktrees hold live or in-flight
// work, it prints one line telling the session to check CronList and schedule
// the watch (the speckit-watch skill says how). Otherwise it prints nothing.
//
// It stays cheap and never blocks a session:
//   - a session isolated in a worktree never schedules the watch, so the hook
//     returns before running anything there;
//   - fewer than three worktrees (the main checkout plus two) cannot be
//     parallel work, so the watcher is not run;
//   - the watcher runs read-only (`--json`, never `--fix`) under a timeout,
//     SPECKIT_WATCH_REMINDER_TIMEOUT_MS (default 10000); a timeout, a failure
//     or unreadable output prints nothing, and the hook always exits 0.
import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const git = (cwd, args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return null;
  }
};

/** Rows of the watcher's report that are work in flight: not the main checkout, not done, not blocked. */
export function activeCount(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows.filter((r) => r && !r.main && (r.verdict === "ok" || r.verdict === "stale")).length;
}

export function reminder(count) {
  return count >= 2 ? `${count} worktrees active: if no /speckit-watch is scheduled (CronList), schedule it (see speckit-watch).` : "";
}

/** The watcher's report, or null when it fails, times out or prints something unreadable. */
export function readWatch(repo, timeout) {
  const run = spawnSync(process.execPath, [join(repo, ".claude", "scripts", "watch.mjs"), "--json"], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) return null;
  try {
    return JSON.parse(run.stdout);
  } catch {
    return null;
  }
}

export function runReminder({ repo, watch }) {
  const paths = git(repo, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])?.split("\n");
  if (paths?.length !== 2 || resolve(paths[0]) !== resolve(paths[1])) return "";
  const worktrees = (git(repo, ["worktree", "list", "--porcelain"]) ?? "").split("\n").filter((l) => l.startsWith("worktree ")).length;
  if (worktrees < 3) return "";
  return reminder(activeCount(watch()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const timeout = Number(process.env.SPECKIT_WATCH_REMINDER_TIMEOUT_MS) || 10_000;
    const line = runReminder({ repo, watch: () => readWatch(repo, timeout) });
    if (line) console.log(line);
  } catch {
    // Fail open: a reminder is never worth a broken session start.
  }
  process.exit(0);
}
