// Active-feature resolution, shared by the gates in .claude/hooks and the
// checks in .claude/scripts. Ported from speckit-demo, where the branch name
// IS the feature dir (`002-task-filters`) so a regex on the branch was enough.
// Here it is not: per .claude/skills/speckit-git-feature/SKILL.md, a ticketed
// feature's branch is the Jira key verbatim (`BKP-1270`), which says nothing
// about which specs/ directory is in play. So resolve the way spec-kit 1.0.5's
// own scripts do, in the same order:
//
//   1. $SPECIFY_FEATURE_DIRECTORY  — explicit override, wins over everything
//   2. .specify/feature.json       — written by /speckit-specify; the norm
//   3. branch name                 — only when it looks like NNN-slug and
//                                    specs/<branch>/ exists (ticketless work)
//
// The feature NUMBER always comes from the directory basename's NNN- prefix,
// never from the branch, because that is what the `NNN-FR-XXX` test tokens are
// keyed on.
//
// Usage as a module:  import { activeFeature } from "./lib/feature.mjs"
// Usage from shell:   node .claude/scripts/lib/feature.mjs   # prints "dir\tnum\tlevel"
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename, isAbsolute } from "node:path";

// How much process a change gets. Borrowed from BMAD's scale-adaptive routing,
// which asks one question — "is the intent already well defined?" — and routes
// into Trivial / One Session / Epic / Project, each with its own artifact set:
// "You need a PRD when more than one person must agree on what the product is,
// or more than one epic must not diverge; otherwise skip it."
//
// What this repository had instead: one size. `/speckit-auto` runs fourteen
// phases for a typo — constitution check, research.md, data-model.md,
// contracts/, checklist, analyze — and the only escapes were the bug-triage
// cycle and the pre-spec assess pipeline.
//
// A level chooses which ARTIFACTS a change owes and which phases run. It never
// decides whether tests come first: `pre:edit:red-first` and the spec-drift
// check read the spec and the tasks, not this number, so a level cannot be set
// to 0 to get out of a gate. Weakening a gate has to look like weakening a
// gate.
export const LEVELS = {
  0: { name: "trivial", artifacts: [], note: "obvious, low-risk: change, edit, verify — no specs/ directory" },
  1: { name: "one-session", artifacts: ["spec.md", "tasks.md"], note: "one coherent implementation unit; no plan, research or contracts" },
  2: { name: "feature", artifacts: ["spec.md", "plan.md", "tasks.md"], note: "the full chain — the default" },
  3: { name: "project", artifacts: ["spec.md", "plan.md", "tasks.md"], note: "several features, one outcome; needs a shared brief they cannot diverge from" },
};

export const DEFAULT_LEVEL = 2;

/**
 * The active level: $SPECKIT_FEATURE_LEVEL, then `.specify/feature.json`, then
 * the default. Same precedence as every other harness setting — the
 * environment wins so a one-off run never has to edit a file.
 */
export function featureLevel(repo) {
  const fromEnv = process.env.SPECKIT_FEATURE_LEVEL;
  const parse = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n in LEVELS ? n : null;
  };
  if (fromEnv !== undefined && fromEnv !== "") {
    const parsed = parse(fromEnv);
    if (parsed !== null) return parsed;
  }
  const stateFile = join(repo, ".specify", "feature.json");
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      const parsed = levelApplies(state) ? parse(state.level) : null;
      if (parsed !== null) return parsed;
    } catch {
      // Malformed state is not this resolver's problem to report.
    }
  }
  return DEFAULT_LEVEL;
}

/**
 * Whether the level in feature.json was chosen for the work in hand. A level
 * carries `level_for`: the feature directory it was sized for, or "next" when
 * /speckit-size ran before /speckit-specify created one. A level sized for some
 * other feature is stale and is ignored, so an old "trivial" never shrinks the
 * process of new work — the default (the full chain) applies instead. A file
 * written before `level_for` existed is honoured as it always was.
 */
export function levelApplies(state) {
  if (!state || typeof state !== "object" || state.level === undefined) return false;
  if (state.level_for === undefined) return true;
  return state.level_for === "next" || state.level_for === state.feature_directory;
}

/**
 * The feature.json that points at `featureDirectory`, keeping a level sized for
 * it ("next" or that directory) and dropping one sized for anything else.
 * Mirrored by `persist_feature_json` in .specify/scripts/python/common.py.
 */
export function pointTo(state, featureDirectory) {
  const next = { ...(state && typeof state === "object" ? state : {}), feature_directory: featureDirectory };
  if (next.level !== undefined && (next.level_for === "next" || next.level_for === featureDirectory)) {
    next.level_for = featureDirectory;
  } else {
    delete next.level;
    delete next.level_for;
  }
  return next;
}

export function activeFeature(repo) {
  const fromDir = (dir) => {
    if (!dir) return null;
    const abs = isAbsolute(dir) ? dir : join(repo, dir);
    if (!existsSync(join(abs, "spec.md"))) return null;
    const m = basename(abs).match(/^(\d{3})-/);
    if (!m) return null;
    return { dir: abs, name: basename(abs), num: m[1], level: featureLevel(repo) };
  };

  const fromEnv = fromDir(process.env.SPECIFY_FEATURE_DIRECTORY);
  if (fromEnv) return fromEnv;

  const stateFile = join(repo, ".specify", "feature.json");
  if (existsSync(stateFile)) {
    try {
      const fromState = fromDir(JSON.parse(readFileSync(stateFile, "utf8")).feature_directory);
      if (fromState) return fromState;
    } catch {
      // Malformed state file is not this gate's problem to report — fall through.
    }
  }

  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repo,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (/^\d{3}-/.test(branch)) return fromDir(join(repo, "specs", branch));
  } catch {
    // Not a git repo / detached weirdness — no feature, no gate.
  }
  return null;
}

/** Feature dirs exempted from the traceability gate (.specify/trace-baseline.json). */
export function grandfathered(repo) {
  const f = join(repo, ".specify", "trace-baseline.json");
  if (!existsSync(f)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(f, "utf8")).grandfathered ?? []);
  } catch {
    return new Set();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = activeFeature(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!f) process.exit(1);
  console.log(`${f.name}\t${f.num}\t${f.level}`);
}
