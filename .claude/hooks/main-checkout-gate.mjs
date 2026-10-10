// Claude Code PreToolUse hook (matcher: Edit|Write|MultiEdit|NotebookEdit) —
// the main checkout is a mirror of origin/main (Constitution VII).
//
// An edit to a file git tracks in the main checkout blocks the fast-forward
// that keeps it current, and every session started there then reads stale
// gates and docs. So the gate refuses an edit whose target, followed through
// symlinks, sits in the repository whose git dir is the session checkout's
// common dir, and git tracks it. Everything else goes through: a worktree's
// files, untracked and ignored paths (.work/, settings.local.json, a new
// file), other repositories (the specs clone behind the `specs` symlink).
//
// SPECKIT_ALLOW_MAIN_EDIT=1 is the owner's escape hatch: the edit goes
// through with one line on stderr. In a cloud session (CLAUDE_CODE_REMOTE=true)
// the checkout is the story's own clone, so only an edit on `main` is refused.
// Any git failure (each call is cut off at 1.5 s), unreadable payload or
// missing path lets the edit through.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isEntryPoint } from "../scripts/lib/entry.mjs";

const git = (cwd, args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }).trim();
  } catch {
    return null;
  }
};

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/** The target's real path and the nearest directory of it that exists, so a file still to be written resolves too. */
export function locate(target) {
  let dir = dirname(target);
  const tail = [basename(target)];
  while (!existsSync(dir)) {
    const up = dirname(dir);
    if (up === dir) return null;
    tail.unshift(basename(dir));
    dir = up;
  }
  const realDir = real(dir);
  if (!realDir) return null;
  const file = real(target) ?? join(realDir, ...tail);
  return { file, dir: existsSync(file) ? dirname(file) : realDir };
}

/** null to let the edit through, or the refusal to print. */
export function judge({ target, sessionDir, env = process.env, run = git }) {
  const where = locate(target);
  if (!where) return null;
  const common = run(sessionDir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const own = run(where.dir, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!common || !own || real(common) !== real(own)) return null;
  if (env.CLAUDE_CODE_REMOTE === "true" && run(where.dir, ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") return null;
  if (run(where.dir, ["ls-files", "--error-unmatch", "--", where.file]) === null) return null;
  const checkout = dirname(real(common));
  return `main-checkout-gate: ${where.file} is tracked in the main checkout ${checkout}. The main checkout holds no edits to tracked files: every change rides a PR from a worktree (Constitution VII). Set SPECKIT_ALLOW_MAIN_EDIT=1 to edit it anyway.`;
}

if (isEntryPoint(import.meta.url)) {
  let code = 0;
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}").tool_input ?? {};
    const path = input.file_path ?? input.notebook_path;
    if (typeof path === "string" && path !== "") {
      const sessionDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const refusal = judge({ target: resolve(process.cwd(), path), sessionDir });
      if (refusal && process.env.SPECKIT_ALLOW_MAIN_EDIT === "1") {
        console.error("main-checkout-gate: SPECKIT_ALLOW_MAIN_EDIT is in force — editing a tracked file in the main checkout");
      } else if (refusal) {
        console.error(refusal);
        code = 2;
      }
    }
  } catch {
    code = 0;
  }
  process.exit(code);
}
