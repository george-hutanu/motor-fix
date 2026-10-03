#!/usr/bin/env node
// Spec-drift detector. Same intent as speckit-demo's port — "code changed
// behavior without the spec moving" — but the mechanism had to change, and it
// is worth being explicit about why.
//
// In speckit-demo the rule is: a feat/fix/perf commit staging bin/ or src/
// must also STAGE specs/. That is unimplementable here: .git/info/exclude
// keeps specs/ (and .specify/, .claude/) out of version control entirely, so
// a spec file can never appear in `git diff --cached`. Testing for it would
// either pass always (if inverted) or block always (as written).
//
// Adapted rule, same guarantee, one indirection:
//   A gated commit that stages implementation code must be accompanied by a
//   CHANGE to the active feature's spec.md + tasks.md content since the last
//   gated commit. The content hash of those two files is recorded in
//   .claude/.spec-drift-state.json; an unchanged hash means the spec did not
//   move while behavior did — that is drift.
//
// Known imprecision, deliberately accepted: the state is recorded when the
// check PASSES, not when the commit actually lands, because a PreToolUse hook
// cannot see the commit's exit status. If a commit is abandoned after passing
// the gate, the next one is judged against the abandoned run's hash. Worst
// case that skips one gate; it never blocks legitimate work. The first commit
// for a feature has no baseline and always passes.
//
// Gated types are feat/fix/perf — refactor, test, chore, docs, style, ci and
// build legitimately change code with no spec impact. That distinction only
// works because commit messages here are Conventional Commits (enforced by
// .claude/hooks/commit-msg-policy.js).
//
// Usage:
//   node .claude/scripts/spec-drift.mjs --staged "feat(scanner): ..."   gate
//   node .claude/scripts/spec-drift.mjs --status                        show state
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { activeFeature } from "./lib/feature.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const stagedIdx = args.indexOf("--staged");
const status = args.includes("--status");
const check = args.includes("--check");

const STATE_FILE = join(repo, ".claude", ".spec-drift-state.json");
const GATED_TYPES = /^(feat|fix|perf)(\(|!|:)/;
const CODE_DIRS = /^(apps|libs)\//;
const TEST_FILE = /\.(spec|test)\.[cm]?tsx?$/;

const git = (cmd) => execSync(`git ${cmd}`, { cwd: repo }).toString().trim();

const specHash = (feature) => {
  const h = createHash("sha256");
  for (const f of ["spec.md", "tasks.md"]) {
    const p = join(feature.dir, f);
    h.update(existsSync(p) ? readFileSync(p) : Buffer.alloc(0));
  }
  return h.digest("hex").slice(0, 16);
};

const readState = () => {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
};

const writeState = (state) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
};

if (check) {
  console.log(
    "spec-drift --check (history scan) is not available in this repo: specs/ is git-excluded, " +
      "so past commits carry no spec files to compare against. Use --staged in the pre-commit " +
      "gate, and /speckit-converge to backfill a spec that has fallen behind the code."
  );
  process.exit(0);
}

if (status) {
  const feature = activeFeature(repo);
  const state = readState();
  if (!feature) {
    console.log("No active feature (SPECIFY_FEATURE_DIRECTORY / .specify/feature.json / branch).");
  } else {
    const recorded = state[feature.name];
    console.log(`Active feature: ${feature.name}`);
    console.log(`  spec+tasks hash now: ${specHash(feature)}`);
    console.log(
      recorded
        ? `  last gated commit:   ${recorded.hash} (recorded ${recorded.recorded_at} at ${recorded.commit})`
        : "  last gated commit:   none recorded — the next gated commit sets the baseline"
    );
  }
  process.exit(0);
}

if (stagedIdx === -1) {
  console.error('Usage: spec-drift.mjs --staged "<commit message>" | --status');
  process.exit(1);
}

const msg = args[stagedIdx + 1] ?? "";
if (!GATED_TYPES.test(msg)) process.exit(0);

const staged = git("diff --cached --name-only").split("\n").filter(Boolean);
const touchesCode = staged.some((f) => CODE_DIRS.test(f) && !TEST_FILE.test(f));
if (!touchesCode) process.exit(0);

const feature = activeFeature(repo);
if (!feature) {
  // Maintenance outside any feature: there is no spec that could have moved.
  // Not silently ignored — say so, so the absence is visible in the log.
  console.error(
    "spec-drift: no active feature resolved; skipping the gate for this commit. " +
      "Feature work should have .specify/feature.json set by /speckit-specify."
  );
  process.exit(0);
}

const state = readState();
const now = specHash(feature);
const recorded = state[feature.name];

if (recorded && recorded.hash === now) {
  console.error(
    `Spec drift: "${msg}" changes behavior (${staged.filter((f) => CODE_DIRS.test(f) && !TEST_FILE.test(f)).length} code file(s) staged) ` +
      `but ${feature.name}'s spec.md + tasks.md are byte-identical to the last gated commit. ` +
      "Update the spec (or flip the tasks.md entries this commit completes) so the artifacts " +
      "match the code, or use type refactor/chore for pure code motion. " +
      "/speckit-converge backfills a spec that has fallen behind."
  );
  process.exit(2);
}

state[feature.name] = {
  hash: now,
  recorded_at: new Date().toISOString(),
  commit: (() => {
    try {
      return git("rev-parse --short HEAD");
    } catch {
      return "unborn";
    }
  })(),
};
writeState(state);
process.exit(0);
