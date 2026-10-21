#!/usr/bin/env node
// Whether speckit-auto's preflight may skip the full typecheck, lint and test
// run (ST-1355): only on a clean worktree whose HEAD is its merge base with
// origin/main and whose commit has a successful CI OK check, which already ran
// that suite. Prints `skip <sha7>` or `run <reason>`; any failed read prints
// `run`, never `skip`.
//
//   node .claude/scripts/lib/preflight-skip.mjs
import { isEntryPoint } from "./entry.mjs";
import { ciOkOn, spawnRun } from "./gh-rest.mjs";

export function canSkipSuite({ porcelain, head, mergeBase, ciOk }) {
  if (porcelain.trim()) return { skip: false, reason: "the tree has uncommitted changes" };
  if (!head || head !== mergeBase) return { skip: false, reason: "HEAD is not its merge base with origin/main" };
  if (!ciOk) return { skip: false, reason: `${head.slice(0, 7)} has no successful CI OK check` };
  return { skip: true };
}

export function main(run = spawnRun()) {
  const git = (...args) => {
    const r = run("git", args);
    if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
    return r.stdout;
  };
  try {
    git("fetch", "-q", "origin", "main");
    const head = git("rev-parse", "HEAD").trim();
    const verdict = canSkipSuite({
      porcelain: git("status", "--porcelain"),
      head,
      mergeBase: git("merge-base", "HEAD", "origin/main").trim(),
      ciOk: ciOkOn(run, head),
    });
    return verdict.skip ? `skip ${head.slice(0, 7)}` : `run ${verdict.reason}`;
  } catch (e) {
    return `run ${String(e.message).split("\n")[0]}`;
  }
}

if (isEntryPoint(import.meta.url)) console.log(main());
