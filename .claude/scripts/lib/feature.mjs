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
//   3. branch name                 — only when it looks like N-slug and
//                                    specs/<branch>/, or the same number
//                                    zero-padded, exists (branchFeatureDir)
//
// The feature NUMBER always comes from the directory basename's NNN- prefix,
// never from the branch, because that is what the `NNN-FR-XXX` test tokens are
// keyed on.
//
// Usage as a module:  import { activeFeature } from "./lib/feature.mjs"
// Usage from shell:   node .claude/scripts/lib/feature.mjs   # prints "dir\tnum\tlevel"
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

// What `level.mjs check` reads as a fact that contradicts a level 0 or 1.
// Constants, not settings: tune them here once the ledger shows a number.
// More functional requirements than this is more than one coherent unit.
export const FR_THRESHOLD = 5;
// More story points than this, when Notion carries any, is never below level 2.
export const STORY_POINTS_THRESHOLD = 5;
// A file here changes a contract, the data or the generated client.
export const CONTRACT_PATHS = [/^libs\/contracts\//, /^libs\/data-access\//, /^apps\/api\/openapi\.json$/, /(^|\/)schema\.prisma$/, /(^|\/)migrations\//];

/** How long a level sized for "the next feature" waits for /speckit-specify. */
export const PENDING_TTL_MINUTES = 30;

/** A level from the vocabulary, or null: `""`, `null` and `true` are not 0 or 1. */
export const parseLevel = (value) => {
  const n = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n in LEVELS ? n : null;
};

export const pendingTtlMinutes = (env = process.env) => {
  const minutes = Number(env.SPECKIT_LEVEL_TTL_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : PENDING_TTL_MINUTES;
};

/**
 * A feature directory as feature.json stores it: relative to the repository,
 * forward slashes, no trailing one. `specs/002-x`, `./specs/002-x/` and
 * `<repo>/specs/002-x` are the same feature and must compare equal, or a
 * level is lost (or kept) on how a path was typed.
 */
export function featureKey(repo, dir) {
  if (typeof dir !== "string" || dir === "") return undefined;
  let key = dir.replaceAll("\\", "/");
  const base = typeof repo === "string" && repo !== "" ? `${repo.replaceAll("\\", "/").replace(/\/+$/, "")}/` : null;
  if (base && key.startsWith(base)) key = key.slice(base.length);
  key = key.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  return key === "" ? undefined : key;
}

const readState = (repo) => {
  try {
    const state = JSON.parse(readFileSync(join(repo, ".specify", "feature.json"), "utf8"));
    return state && typeof state === "object" && !Array.isArray(state) ? state : null;
  } catch {
    // Missing or malformed state is not this resolver's problem to report.
    return null;
  }
};

/** feature.json with its two paths as `featureKey`s, so they compare however they were written. */
export function keyedState(repo, state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const keyed = { ...state };
  if (typeof state.feature_directory === "string") keyed.feature_directory = featureKey(repo, state.feature_directory);
  if (typeof state.level_for === "string" && state.level_for !== "next") keyed.level_for = featureKey(repo, state.level_for);
  return keyed;
}

/**
 * The level of one feature: $SPECKIT_FEATURE_LEVEL, then the level
 * `.specify/feature.json` holds FOR THAT FEATURE, then the default. Same
 * precedence as every other harness setting — the environment wins so a
 * one-off run never has to edit a file.
 *
 * `featureDir` is the feature being asked about; without it, the one
 * feature.json points at. The file holds one level and says whose it is, so a
 * feature resolved some other way (the branch, $SPECIFY_FEATURE_DIRECTORY, a
 * path on the command line) gets the default rather than a neighbour's level.
 */
export function featureLevel(repo, featureDir) {
  const fromEnv = parseLevel(process.env.SPECKIT_FEATURE_LEVEL);
  if (fromEnv !== null) return fromEnv;
  const state = keyedState(repo, readState(repo));
  const target = featureKey(repo, featureDir) ?? state.feature_directory;
  return (levelApplies(state, target) ? parseLevel(state.level) : null) ?? DEFAULT_LEVEL;
}

/**
 * Whether the level in feature.json belongs to `target` (by default the
 * feature the file points at). A level carries `level_for`: the feature
 * directory it was sized for, or "next" when /speckit-size ran before
 * /speckit-specify created one.
 *
 * - Sized for another feature: stale, ignored, so an old "trivial" never
 *   shrinks the process of new work — the default (the full chain) applies.
 * - Sized for "next": belongs to no feature that exists. It waits for
 *   `pointTo` to hand it to the feature /speckit-specify creates.
 * - Written before `level_for` existed: the pointed feature's, nobody else's.
 */
export function levelApplies(state, target = state?.feature_directory) {
  if (!state || typeof state !== "object" || state.level === undefined || !target) return false;
  const owner = state.level_for === undefined ? state.feature_directory : state.level_for;
  return owner !== "next" && owner === target;
}

// The one stamp shape both this and `_pending_level` in common.py read alike on
// every machine and Python version: a zone is required, since Date.parse reads
// a zone-less stamp as local time and Python as UTC, and the hour stops at 23,
// since Date.parse reads 24:00 as the next midnight and Python refuses it. The
// day must be one its month has: Date.parse rolls 30 February into March, and
// Python refuses it, as it refuses year 0.
const LEVEL_AT = /^(\d{4})-(\d\d)-(\d\d)T(?:[01]\d|2[0-3]):\d\d(?::\d\d(?:\.\d{3}|\.\d{6})?)?(?:Z|[+-]\d\d:\d\d)$/;

function parseLevelAt(stamp) {
  const fields = typeof stamp === "string" ? LEVEL_AT.exec(stamp) : null;
  if (!fields) return Number.NaN;
  const [year, month, day] = fields.slice(1, 4).map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= lastDay ? Date.parse(stamp) : Number.NaN;
}

/**
 * The level waiting for the next feature, while it is still fresh. It was
 * sized at `level_at` for work about to be specified; after
 * PENDING_TTL_MINUTES ($SPECKIT_LEVEL_TTL_MINUTES) it is somebody else's
 * work, and the default is the safe answer.
 */
export function pendingLevel(state, now = Date.now(), env = process.env) {
  if (!state || typeof state !== "object" || state.level_for !== "next") return null;
  const level = parseLevel(state.level);
  const at = parseLevelAt(state.level_at);
  if (level === null || Number.isNaN(at)) return null;
  const left = pendingTtlMinutes(env) * 60_000 - (now - at);
  // One minute of slack for two clocks; a level from further ahead is not trusted.
  if (left <= 0 || at - now > 60_000) return null;
  return { level, minutesLeft: Math.ceil(left / 60_000) };
}

/**
 * The feature.json that points at `featureDirectory` (already a
 * `featureKey`). Mirrored by `persist_feature_json` in
 * .specify/scripts/python/common.py; level.spec.mjs holds the two together.
 *
 * - The same directory again: nothing changes. A waiting level is for a NEW
 *   feature, and re-writing the pointer creates none.
 * - A new directory: a fresh waiting level becomes this feature's — once; it
 *   is used up. Level 0 never does: a trivial change creates no feature, so a
 *   feature being created was not what was sized.
 * - `existing`: the directory is a feature HEAD already holds, so it cannot be
 *   "the next one". A fresh waiting level keeps waiting.
 * - Anything else — a level sized for another feature, an expired one — is
 *   dropped, and the default applies.
 */
export function pointTo(state, featureDirectory, { now = Date.now(), existing = false, env = process.env } = {}) {
  const base = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  if (base.feature_directory === featureDirectory) return base;
  const next = { ...base, feature_directory: featureDirectory };
  const pending = pendingLevel(base, now, env);
  if (pending && existing) return next;
  delete next.level_at;
  if (pending && pending.level !== 0) {
    next.level = pending.level;
    next.level_for = featureDirectory;
  } else if (base.level === undefined || base.level_for !== featureDirectory) {
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
    return { dir: abs, name: basename(abs), num: m[1], level: featureLevel(repo, abs) };
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
    const dir = branchFeatureDir(repo, branch);
    return dir ? fromDir(dir) : null;
  } catch {
    // Not a git repo / detached weirdness — no feature, no gate.
    return null;
  }
}

/**
 * The specs/ folder a NNN-slug branch names, relative to the repo:
 * `specs/<branch>` when it exists, else the folder with the same number
 * (leading zeros ignored) and the same slug, so branch `83-x` finds
 * `specs/083-x`. null when there is none.
 */
export function branchFeatureDir(repo, branch) {
  const exact = join("specs", branch);
  if (existsSync(join(repo, exact))) return exact;
  const [, number, slug] = /^(\d+)-(.+)$/.exec(branch) ?? [];
  if (number === undefined) return null;
  let names;
  try {
    names = readdirSync(join(repo, "specs"));
  } catch {
    return null;
  }
  const padded = names.find((name) => {
    const [, n, s] = /^(\d+)-(.+)$/.exec(name) ?? [];
    return n !== undefined && Number(n) === Number(number) && s === slug;
  });
  return padded ? join("specs", padded) : null;
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
