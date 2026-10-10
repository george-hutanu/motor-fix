// The git worktree helpers that watch.mjs, worktree-remove.mjs and
// lifecycle.mjs share: parse `git worktree list --porcelain`, read the pid out
// of a worktree lock, ask whether a pid is alive, and read the main checkout
// against origin/main (watch.mjs and the session-start reminder). Kept apart
// from watch.mjs so worktree-remove.mjs and watch.mjs do not import each other.
import { execFileSync } from "node:child_process";

export function parseWorktrees(porcelain) {
  const records = porcelain
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  return records.map((block, i) => {
    const line = (key) => block.split("\n").find((l) => l === key || l.startsWith(`${key} `));
    const value = (key) => line(key)?.slice(key.length + 1) ?? null;
    return {
      path: value("worktree"),
      head: value("HEAD"),
      branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
      lock: line("locked") ? (value("locked") ?? "") : null,
      prunable: Boolean(line("prunable")),
      main: i === 0,
    };
  });
}

export function lockPid(lock) {
  const m = lock?.match(/\(pid ([1-9]\d*)\b/);
  return m ? Number(m[1]) : null;
}

export const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** The one command that brings a clean main checkout level with origin/main. */
export const ffMainCommand = (path) => `git -C ${path} merge --ff-only origin/main`;

const gitOut = (cwd, args) => {
  try {
    return execFileSync("git", ["--no-optional-locks", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
  } catch {
    return null;
  }
};

/** Paths from `git status --porcelain -z`: unquoted, a rename or copy by its new path (its old one follows it). */
function parseStatusZ(status) {
  const fields = status.split("\0");
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    paths.push(fields[i].slice(3));
    if (/[RC]/.test(fields[i].slice(0, 2))) i++;
  }
  return paths;
}

/**
 * The main checkout against origin/main, without a fetch (worktrees share its
 * refs): `dirty` lists tracked files modified, staged or deleted (null when git
 * cannot say), and `ahead`/`behind` count commits on `main` only (null off it
 * or unreadable).
 */
export function mainCheckoutState(path, run = gitOut) {
  const status = run(path, ["status", "--porcelain", "-z", "--untracked-files=no"]);
  if (status === null) return { dirty: null, ahead: null, behind: null };
  const dirty = parseStatusZ(status);
  if (run(path, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() !== "main") return { dirty, ahead: null, behind: null };
  const counts = (run(path, ["rev-list", "--left-right", "--count", "HEAD...origin/main"]) ?? "").trim().split(/\s+/);
  const [ahead, behind] = counts.length === 2 && counts.every((c) => /^\d+$/.test(c)) ? counts.map(Number) : [null, null];
  return { dirty, ahead, behind };
}
