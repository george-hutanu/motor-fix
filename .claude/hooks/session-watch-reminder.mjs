// Claude Code SessionStart hook — remind the orchestrating session to keep the
// agent watch armed while parallel work runs.
//
// The watch is kept by a background `watch.mjs --wait` that belongs to one
// session: a resumed or compacted session may have lost it, and a hook cannot
// start one. So this hook only speaks: when two or more worktrees hold live or
// in-flight work and no live wait holds the repository's record, it prints one
// line telling the session to arm the wait (the speckit-watch skill says how).
// Otherwise it prints nothing about the watch.
//
// In the main checkout it also names, first, a checkout that holds edits to
// tracked files or sits behind origin/main on `main`, with the fast-forward
// command: the main checkout is a mirror of origin/main (Constitution VII).
//
// It stays cheap and never blocks a session:
//   - a session isolated in a worktree never arms the watch, so the hook
//     returns before running anything there;
//   - a live wait already watches, so the watcher is not run;
//   - fewer than three worktrees (the main checkout plus two) cannot be
//     parallel work, so the watcher is not run;
//   - the watcher runs read-only (`--json`, never `--fix`) under a timeout,
//     SPECKIT_WATCH_REMINDER_TIMEOUT_MS (default 20000, past the 8-9 s a busy board takes); a timeout, a failure
//     or unreadable output prints nothing, and the hook always exits 0.
import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { isEntryPoint } from "../scripts/lib/entry.mjs";
import { waitHolder } from "../scripts/lib/watch-wait.mjs";
import { ffMainCommand, mainCheckoutState } from "../scripts/lib/worktrees.mjs";

export const DEFAULT_TIMEOUT_MS = 20_000;

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
  return count >= 2 ? `${count} worktrees active: if no watch wait is armed, arm one (see speckit-watch, "Keeping it scheduled").` : "";
}

/**
 * The watcher's `gh pr list` must run as george-hutanu, never gh's active
 * (work) account. SessionStart hooks run before github-identity.sh's GH_TOKEN
 * reaches the session, so it is resolved here the same way; an unresolvable
 * one becomes a sentinel, because gh reads an empty GH_TOKEN as unset.
 */
function ghToken(env) {
  if (env.GH_TOKEN) return env.GH_TOKEN;
  try {
    const token = execFileSync("gh", ["auth", "token", "--hostname", "github.com", "--user", "george-hutanu"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    if (token) return token;
  } catch {}
  return "george-hutanu-is-not-logged-in-to-gh";
}

/** The watcher's report, or null when it fails, times out or prints something unreadable. */
export function readWatch(repo, timeout, env = process.env) {
  const run = spawnSync(process.execPath, [join(repo, ".claude", "scripts", "watch.mjs"), "--json"], {
    cwd: repo,
    env: { ...env, GH_TOKEN: ghToken(env) },
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

/** One line when the main checkout holds tracked edits or is behind origin/main on `main`; "" otherwise or when git fails. No fetch. */
export function mainLine(repo) {
  const { dirty, ahead, behind } = mainCheckoutState(repo);
  if (dirty?.length > 0) return `main checkout dirty: ${dirty.join(", ")} — ${ffMainCommand(repo)}`;
  return ahead === 0 && behind > 0 ? `main checkout behind origin/main by ${behind} — ${ffMainCommand(repo)}` : "";
}

export function runReminder({ repo, watch, armed = () => waitHolder(repo) }) {
  const paths = git(repo, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])?.split("\n");
  if (paths?.length !== 2 || resolve(paths[0]) !== resolve(paths[1])) return "";
  const first = mainLine(repo);
  const worktrees = (git(repo, ["worktree", "list", "--porcelain"]) ?? "").split("\n").filter((l) => l.startsWith("worktree ")).length;
  if (worktrees < 3 || armed() !== null) return first;
  return [first, reminder(activeCount(watch()))].filter(Boolean).join("\n");
}

if (isEntryPoint(import.meta.url)) {
  try {
    const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const timeout = Number(process.env.SPECKIT_WATCH_REMINDER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const line = runReminder({ repo, watch: () => readWatch(repo, timeout) });
    if (line) console.log(line);
  } catch {
    // Fail open: a reminder is never worth a broken session start.
  }
  process.exit(0);
}
