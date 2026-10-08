// The git worktree helpers that watch.mjs, worktree-remove.mjs and
// lifecycle.mjs share: parse `git worktree list --porcelain`, read the pid out
// of a worktree lock, ask whether a pid is alive. Kept apart from watch.mjs so
// worktree-remove.mjs and watch.mjs do not import each other.

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
