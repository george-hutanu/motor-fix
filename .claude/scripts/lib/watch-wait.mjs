// The record that keeps one `watch.mjs --wait` per repository. Kept apart from
// watch.mjs so the session-start reminder can read it with nothing but Node and
// git, and never fail on an import the watcher needs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const WAIT_RECORD = "speckit-watch-wait.pid";

export const commonDir = (cwd) => {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
};

export const defaultCommandOf = (pid) => {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

/** The pid of the live `watch.mjs --wait` holding this repository's record, or null: a dead or recycled pid holds nothing. */
export function waitHolder(repo, { commandOf = defaultCommandOf } = {}) {
  const dir = commonDir(repo);
  if (!dir) return null;
  let pid;
  try {
    pid = Number(readFileSync(join(dir, WAIT_RECORD), "utf8").trim());
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const command = commandOf(pid);
  return command && /watch\.mjs/.test(command) && /(^|\s)--wait(\s|$)/.test(command) ? pid : null;
}
