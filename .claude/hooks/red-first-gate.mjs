// Claude Code PreToolUse hook (matcher: Edit|Write|MultiEdit) — the red-first
// implementation gate, ported from speckit-demo. TDAD (arXiv:2603.17973v2)
// found concrete failing-test context cuts regressions ~70% while advisory TDD
// prose makes them worse, so this is mechanical, not a prompt.
//
// Fires only when ALL of these hold (otherwise silently passes):
//   - the edit targets implementation code: apps/<x>/src/** or libs/<x>/src/**
//     (never a *.spec.ts / *.test.ts — editing tests is how you satisfy it)
//   - an active feature resolves (see .claude/scripts/lib/feature.mjs; the
//     branch here is usually a Jira key, so this reads .specify/feature.json)
//   - that feature is not grandfathered in .specify/trace-baseline.json
//   - its spec.md declares FR-XXX ids
//   - its tasks.md still has unchecked tasks — a finished feature can be
//     refactored freely
//
// Gate condition (Constitution II): this branch must carry test work. At
// least one *.spec.ts / *.test.ts is added or modified relative to the default
// branch, counting the working tree and untracked files so that writing the
// spec unblocks the edit immediately, without a commit. None → block, with the
// instruction to run /speckit-tests first.
//
// It used to require a `// @traces NNN-FR-XXX` token in every file. It asks
// only for test work now: a whole-line `// @traces` comment in a test file is
// the one id form Principle II allows, and trace-matrix.mjs reads it on
// demand. A per-file "sibling spec must exist" rule was rejected in turn because entry points and barrel files (apps/server/src/main.ts,
// libs/contracts/src/index.ts) legitimately have none.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { activeFeature, grandfathered } from "../scripts/lib/feature.mjs";

const isTestFile = (name) => /\.(spec|test)\.[cm]?tsx?$/.test(name);

const git = (repo, args) => {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

// Every test file this branch touches: committed since it diverged, plus
// whatever is uncommitted or untracked right now.
const branchTestFiles = (repo) => {
  const base = (git(repo, ["merge-base", "HEAD", "main"]) ?? "").trim();
  const lists = [
    base ? git(repo, ["diff", "--name-only", `${base}..HEAD`]) : null,
    git(repo, ["diff", "--name-only", "HEAD"]),
    git(repo, ["ls-files", "--others", "--exclude-standard"]),
  ];
  // A repo with no `main` to diff against gives us nothing to judge; the
  // working tree and untracked lists still apply.
  return lists
    .filter((out) => out !== null)
    .flatMap((out) => out.split("\n"))
    .filter((p) => p && isTestFile(p));
};

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let filePath = "";
  try {
    filePath = JSON.parse(raw).tool_input?.file_path ?? "";
  } catch {
    process.exit(0);
  }
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const rel = filePath.startsWith(repo) ? filePath.slice(repo.length + 1) : filePath;

  // Implementation code only: a package's src/, excluding its tests.
  if (!/^(apps|libs)\/[^/]+\/src\//.test(rel) || isTestFile(rel)) process.exit(0);

  const feature = activeFeature(repo);
  if (!feature) process.exit(0);
  if (grandfathered(repo).has(feature.name)) process.exit(0);

  const specFile = join(feature.dir, "spec.md");
  const tasksFile = join(feature.dir, "tasks.md");
  if (!existsSync(specFile) || !existsSync(tasksFile)) process.exit(0);
  if (!/\bFR-\d{3}\b/.test(readFileSync(specFile, "utf8"))) process.exit(0);
  if (!/- \[ \]/.test(readFileSync(tasksFile, "utf8"))) process.exit(0);

  if (branchTestFiles(repo).length > 0) process.exit(0);

  console.error(
    `Red-first gate: feature ${feature.name} has FR requirements and open tasks, but this branch ` +
      "adds or modifies no *.spec.ts / *.test.ts file. Write the failing acceptance tests first — " +
      "run /speckit-tests — then implement. Test titles stay plain and carry no FR ids, ticket " +
      "keys, or other internal identifiers (Constitution Principle II); the one exception is a " +
      "whole-line `// @traces <feature>-FR-<n>` comment in a test file."
  );
  process.exit(2);
});
