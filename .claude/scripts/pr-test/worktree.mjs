// The PR tester's own checkout: the PR head, detached, in a new worktree
// outside the caller's tree, removed when the run ends.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * Fetch `pull/<pr>/head` from origin and add a detached worktree at it under
 * `root`. With `sha`, refuse a head that moved: the tester reports on one
 * commit, and that commit is the one its status lands on.
 */
export function createWorktree({ repo, pr, sha, root }) {
  git(repo, "fetch", "--quiet", "origin", `+refs/pull/${pr}/head:refs/pr-test/${pr}`);
  const head = git(repo, "rev-parse", `refs/pr-test/${pr}`);
  if (sha && !head.startsWith(sha)) throw new Error(`PR #${pr} head is ${head}, not ${sha}; it moved since the tester was asked to run`);
  mkdirSync(root, { recursive: true });
  const dir = join(root, `mf-prtest-${pr}-${head.slice(0, 7)}-${process.pid}`);
  git(repo, "worktree", "add", "--quiet", "--detach", dir, head);
  return { dir, sha: head };
}

export function removeWorktree({ repo, dir }) {
  try {
    git(repo, "worktree", "remove", "--force", dir);
  } catch {
    // already gone, or never registered: fall through to the directory
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  git(repo, "worktree", "prune");
}
