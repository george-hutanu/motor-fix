#!/usr/bin/env node
// Read or set the active feature's process level. The levels themselves live in
// `.claude/scripts/lib/feature.mjs` beside the resolver that reads them, because every
// gate already imports that file and a second source of truth for "how much
// process does this change get" is exactly the drift this repository keeps
// finding in its own specs.
//
// Usage:
//   node .claude/scripts/level.mjs                 what level is active, and why
//   node .claude/scripts/level.mjs set 1           write it to .specify/feature.json
//   node .claude/scripts/level.mjs --json
//   node .claude/scripts/level.mjs suggest "<work>" [--set]   classify; --set records a confident answer
//   node .claude/scripts/level.mjs suggest ST-<n>|<url> [--set] size from the Notion story first
//   node .claude/scripts/level.mjs point specs/NNN-x            point feature.json at a new feature, keeping its level
//   node .claude/scripts/level.mjs check [--ready] [--json]    raise a level 0/1 to 2 when a fact contradicts it
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  CONTRACT_PATHS,
  DEFAULT_LEVEL,
  FR_THRESHOLD,
  LEVELS,
  STORY_POINTS_THRESHOLD,
  activeFeature,
  featureKey,
  featureLevel,
  keyedState,
  levelApplies,
  parseLevel,
  pendingLevel,
  pendingTtlMinutes,
  pointTo,
} from "./lib/feature.mjs";

const statePath = (repo) => join(repo, ".specify", "feature.json");

/**
 * The level of the feature in hand, and the source that decided it — the
 * second half is what makes a surprise debuggable. "In hand" is the feature the
 * gates resolve (`activeFeature`), or the one feature.json points at when its
 * spec.md is not written yet.
 */
export function resolveLevel(repo, env = process.env) {
  const state = keyedState(repo, readState(repo));
  const active = activeFeature(repo);
  const target = active ? featureKey(repo, active.dir) : state.feature_directory;
  const level = featureLevel(repo, target);
  if (parseLevel(env.SPECKIT_FEATURE_LEVEL) !== null) return { level, source: "SPECKIT_FEATURE_LEVEL" };
  if (parseLevel(state.level) !== null && state.level_for !== "next") {
    if (levelApplies(state, target)) return { level, source: ".specify/feature.json" };
    const owner = state.level_for ?? state.feature_directory;
    return { level, source: owner ? `default — the recorded level ${state.level} was sized for ${owner}` : `default — the recorded level ${state.level} names no feature` };
  }
  return { level, source: "default" };
}

const readState = (repo) => {
  try {
    const state = JSON.parse(readFileSync(statePath(repo), "utf8"));
    return state && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
};

const writeState = (repo, state) => {
  mkdirSync(dirname(statePath(repo)), { recursive: true });
  writeFileSync(statePath(repo), `${JSON.stringify(state, null, 2)}\n`);
};

const currentBranch = (repo) => {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};

/**
 * What a level is being chosen for. On the feature's own branch, the feature
 * feature.json already points at; anywhere else (main, a fresh worktree), the
 * work /speckit-specify is about to create. `for` forces either.
 */
export function levelTarget(repo, state, { for: target, branch = currentBranch(repo) } = {}) {
  const dir = state.feature_directory;
  if (target === "next" || !dir) return "next";
  if (target === "current") return dir;
  return branch && basename(dir) === branch ? dir : "next";
}

/**
 * Record a level. Sized for a feature that exists, it is that feature's until
 * it is changed. Sized for "next", it is stamped: it waits `pendingTtlMinutes`
 * for /speckit-specify to create the feature, and applies to nothing meanwhile.
 */
export function setLevel(repo, value, options = {}) {
  const level = parseLevel(value);
  if (level === null) return { error: `level must be one of ${Object.keys(LEVELS).join(", ")} — got "${value}"` };
  const state = keyedState(repo, readState(repo));
  // "Current" is the feature the gates resolve, which is the pointer's unless
  // the environment or the branch names another.
  const active = activeFeature(repo);
  const current = active ? featureKey(repo, active.dir) : state.feature_directory;
  const level_for = levelTarget(repo, { ...state, feature_directory: current }, options);
  const next = { ...state, level, level_for };
  if (level_for === "next") next.level_at = new Date(options.now ?? Date.now()).toISOString();
  else delete next.level_at;
  writeState(repo, next);
  return { level, level_for };
}

// Whether HEAD already holds this feature's spec. Such a feature was specified
// before the level was sized, so it cannot be "the next one". No git, no
// commit yet or a path outside the repository all read as "new".
const inHead = (repo, key) => {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:./${key}/spec.md`], { cwd: repo, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Point feature.json at a feature directory; `pointTo` decides what happens to the level. */
export function pointFeature(repo, featureDirectory, { now = Date.now() } = {}) {
  const key = featureKey(repo, featureDirectory);
  const state = keyedState(repo, readState(repo));
  const next = pointTo(state, key, { now, existing: inHead(repo, key) });
  if (next !== state) writeState(repo, next);
  return next;
}

// The phases a level 2 run has and a level 1 run skips (/speckit-auto's
// Size table): what a promotion owes from that point on.
const OWED_BY_PROMOTION = ["context", "clarify", "plan", "checklist", "analyze", "converge", "refresh", "agent-context", "archive"];

/** Files the branch changed against origin/main, committed or not; null when that cannot be computed. */
function changedFiles(repo) {
  try {
    // -z: git quotes a path with non-ASCII bytes otherwise, and a quoted path
    // matches no project.
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = git("merge-base", "HEAD", "origin/main").trim();
    const files = [...git("diff", "-z", "--name-only", base).split("\0"), ...git("ls-files", "-z", "--others", "--exclude-standard").split("\0")];
    return [...new Set(files.filter(Boolean))];
  } catch {
    return null;
  }
}

/** The Nx project a file belongs to: the nearest project.json above it, or none. */
function nxProject(repo, file) {
  for (let dir = dirname(file); dir !== "." && dir !== "/" && dir !== ""; dir = dirname(dir)) {
    const project = join(repo, dir, "project.json");
    if (!existsSync(project)) continue;
    try {
      return JSON.parse(readFileSync(project, "utf8")).name ?? dir;
    } catch {
      return dir;
    }
  }
  return null;
}

/** The four wires, each tripped, clear or not checked, with the fact it read. */
function tripwires(repo, featureDir, files) {
  const specFile = featureDir ? join(featureDir, "spec.md") : null;
  const spec = specFile && existsSync(specFile) ? readFileSync(specFile, "utf8") : null;
  const wire = (name, state, fact) => ({ name, state, fact });
  const wires = [];
  if (spec === null) {
    wires.push(wire("fr-count", "not checked", "no spec.md"), wire("clarification", "not checked", "no spec.md"));
  } else {
    const frs = new Set(spec.match(/\*\*FR-\d+\*\*/g) ?? []).size;
    wires.push(wire("fr-count", frs > FR_THRESHOLD ? "tripped" : "clear", `${frs} functional requirements`));
    // A marker in backticks is the marker being named, not an open question.
    const marker = spec.match(/(?<!`)\[NEEDS CLARIFICATION[^\]]*\]/)?.[0];
    wires.push(wire("clarification", marker ? "tripped" : "clear", marker ?? "no marker"));
  }
  if (files === null) {
    wires.push(wire("contract", "not checked", "no diff against origin/main"), wire("projects", "not checked", "no diff against origin/main"));
  } else {
    const contract = files.find((f) => CONTRACT_PATHS.some((p) => p.test(f)));
    wires.push(wire("contract", contract ? "tripped" : "clear", contract ?? "no contract, schema or migration file"));
    const projects = [...new Set(files.map((f) => nxProject(repo, f)).filter(Boolean))].sort();
    wires.push(wire("projects", projects.length > 1 ? "tripped" : "clear", projects.join(", ") || "no Nx project"));
  }
  return wires;
}

/**
 * Check the level in hand against the facts. A tripped wire raises a level 0
 * or 1 to 2 and logs one line in the feature's auto-run.md; nothing here ever
 * lowers a level or touches a 2 or 3. With `ready`, also say what a level 2
 * still owes before the PR may go ready, and mark a level 2 whose diff is one
 * non-contract file as too heavy (evidence for tuning, no other effect).
 */
export function checkLevel(repo, { ready = false, files = changedFiles(repo), now = Date.now() } = {}) {
  const state = keyedState(repo, readState(repo));
  const active = activeFeature(repo);
  const feature = active ? featureKey(repo, active.dir) : null;
  const level = feature ? featureLevel(repo, feature) : state.level_for === "next" ? (parseLevel(state.level) ?? DEFAULT_LEVEL) : DEFAULT_LEVEL;
  const wires = tripwires(repo, active?.dir, files);
  const tripped = wires.filter((w) => w.state === "tripped");
  const result = { feature, level, promoted: null, wires };

  if (level < 2 && tripped.length) {
    setLevel(repo, 2, { for: feature ? "current" : "next", now });
    result.promoted = { from: level, to: 2 };
    result.level = 2;
    if (active) {
      const log = join(active.dir, "auto-run.md");
      const before = existsSync(log) ? readFileSync(log, "utf8") : "";
      const line = `- ${new Date(now).toISOString()} · level ${level} → 2 · ${tripped.map((w) => `${w.name}: ${w.fact}`).join("; ")}\n`;
      writeFileSync(log, `${before}${before && !before.endsWith("\n") ? "\n" : ""}${line}`);
    }
  }
  if (!ready) return result;

  if (!active) {
    if (result.promoted) Object.assign(result, { owed: ["specify", ...OWED_BY_PROMOTION], missing: ["a feature directory"] });
  } else if (result.level >= 2) {
    const missing = LEVELS[result.level].artifacts.filter((a) => !existsSync(join(active.dir, a)));
    if (missing.length) Object.assign(result, { owed: OWED_BY_PROMOTION, missing });
  }
  const counted = (files ?? []).filter((f) => !/^(specs|\.specify)\//.test(f));
  if (result.level === 2 && !result.promoted && counted.length === 1 && !CONTRACT_PATHS.some((p) => p.test(counted[0]))) {
    result.too_heavy = { feature, file: counted[0] };
    const pending = join(repo, ".specify", "telemetry", "pending.json");
    let marks = [];
    try {
      marks = JSON.parse(readFileSync(pending, "utf8")).too_heavy ?? [];
    } catch {}
    if (!marks.some((m) => m.feature === feature && m.file === counted[0])) {
      marks.push({ feature, level: 2, file: counted[0], at: new Date(now).toISOString() });
      mkdirSync(dirname(pending), { recursive: true });
      writeFileSync(pending, `${JSON.stringify({ too_heavy: marks }, null, 2)}\n`);
    }
  }
  return result;
}

function checkCommand(argv, repo) {
  const result = checkLevel(repo, { ready: argv.includes("--ready") });
  const refused = (result.missing ?? []).length > 0;
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result));
    return refused ? 2 : 0;
  }
  const head = result.promoted ? `level ${result.promoted.from} → 2 (promoted)` : `level ${result.level}, unchanged`;
  console.log(`${head}${result.feature ? ` for ${result.feature}` : ""}`);
  for (const w of result.wires) console.log(`  ${w.name}: ${w.state} (${w.fact})`);
  if (result.too_heavy) console.log(`  too heavy: a level 2 whose diff is one file (${result.too_heavy.file}), recorded in the ledger`);
  if (refused) {
    const fix = result.feature
      ? `run the phases it owes (${result.owed.join(", ")}) until ${result.missing.join(", ")} exist, then rerun`
      : "run the change through /speckit-specify first, then the phases a level 2 owes";
    console.error(`level check: not ready — level ${result.level} is missing ${result.missing.join(", ")}: ${fix}`);
  }
  return refused ? 2 : 0;
}

export function main(argv, repo, env = process.env) {
  const [command, value] = argv.filter((a) => !a.startsWith("--"));

  if (command === "check") return checkCommand(argv, repo);

  if (command === "set") {
    const target = argv.includes("--next") ? "next" : argv.includes("--current") ? "current" : undefined;
    const result = setLevel(repo, value, { for: target });
    if (result.error) {
      console.error(`level: ${result.error}`);
      return 1;
    }
    const where =
      result.level_for !== "next"
        ? `for ${result.level_for}`
        : result.level === 0
          ? "for the change in hand; it is never carried onto a feature"
          : `for the next feature, if /speckit-specify creates it within ${pendingTtlMinutes(env)} minutes`;
    console.log(`level ${result.level} (${LEVELS[result.level].name}) ${where} — ${LEVELS[result.level].note}`);
    return 0;
  }

  if (command === "point") {
    if (!value) {
      console.error("level: point needs a feature directory, e.g. level point specs/123-thing");
      return 1;
    }
    const before = keyedState(repo, readState(repo));
    const state = pointFeature(repo, value);
    const waited = before.level_for === "next" ? parseLevel(before.level) : null;
    if (levelApplies(state)) {
      console.log(`feature ${state.feature_directory}, level ${state.level} (${LEVELS[state.level].name})`);
      return 0;
    }
    // Say why a level that was waiting did not land: silence here reads as
    // "sized at 1" to whoever ran /speckit-size a moment ago.
    const why =
      waited === null || before.feature_directory === state.feature_directory
        ? ""
        : state.level_for === "next"
          ? ` — level ${waited} keeps waiting for a new feature; this one is already in HEAD`
          : waited === 0
            ? " — the level 0 sized earlier is not carried: a trivial change creates no feature"
            : ` — the level ${waited} sized earlier had expired (${pendingTtlMinutes(env)} minutes)`;
    const again = why && state.level_for !== "next" ? "; size this one with: node .claude/scripts/level.mjs set <0-3> --current" : "";
    console.log(`feature ${state.feature_directory}, level ${DEFAULT_LEVEL} (default)${why}${again}`);
    return 0;
  }

  if (command !== undefined) {
    console.error(`level: unknown command "${command}" (no argument to show, "set <0-3>" to change, "suggest", "point", "check")`);
    return 1;
  }

  const { level, source } = resolveLevel(repo, env);
  const feature = activeFeature(repo);
  const pending = pendingLevel(readState(repo), Date.now(), env);
  if (argv.includes("--json")) {
    const waiting = pending ? { level: pending.level, name: LEVELS[pending.level].name, minutes_left: pending.minutesLeft } : null;
    console.log(JSON.stringify({ level, source, name: LEVELS[level].name, artifacts: LEVELS[level].artifacts, feature: feature?.name ?? null, pending: waiting }, null, 2));
    return 0;
  }
  console.log(`level ${level} (${LEVELS[level].name}), from ${source}${level === DEFAULT_LEVEL && source === "default" ? " — nothing has chosen one" : ""}`);
  console.log(`  ${LEVELS[level].note}`);
  console.log(`  owes: ${LEVELS[level].artifacts.join(", ") || "no artifacts"}`);
  console.log(`  feature: ${feature?.name ?? "none"}`);
  if (pending) {
    const fate = pending.level === 0 ? "the change in hand, never carried onto a feature" : "the next feature /speckit-specify creates";
    console.log(`  pending: level ${pending.level} (${LEVELS[pending.level].name}) for ${fate} — ${pending.minutesLeft} min left`);
  }
  return 0;
}

// Words that put a change's intent beyond "obviously small". Any one of them
// means a contract, data, money, identity or a new surface is involved, and the
// classifier will not suggest less than level 2 — it may push a level up,
// never down. Kept deliberately broad: a false hit costs a plan.md, a miss
// ships a contract change with no design.
const RISK = [
  /\bapi\b/, /\bendpoints?\b/, /\broutes?\b/, /\bcontracts?\b/, /\bdtos?\b/, /\bopenapi\b/, /--json\b/, /\bwebhooks?\b/,
  /\bschema\b/, /\bmigrations?\b/, /\bmigrate\b/, /\bprisma\b/, /\bdatabase\b/, /\bpostgres/, /\bredis\b/, /\btables?\b/, /\bcolumns?\b/,
  /\bauth/, /\bsign[- ]?(in|up)\b/, /\blog[- ]?in\b/, /\bsessions?\b/, /\bpermissions?\b/, /\broles?\b/, /\bsecurity\b/, /\btokens?\b/,
  /\bpayments?\b/, /\bbilling\b/, /\binvoices?\b/, /\bsubscriptions?\b/, /\bprices?\b/, /\bpricing\b/,
  /\bgdpr\b/, /\bconsent\b/, /\bpersonal data\b/, /\bprivacy\b/,
  /\bmodels?\b/, /\benums?\b/, /\bentit(y|ies)\b/, /\b(request|response|payload)s?\b/,
  /\bbreaking\b/, /\bpublic\b/, /\bqueues?\b/, /\bworkers?\b/, /\bnotifications?\b/, /\bemails?\b/, /\bsms\b/, /\bcron\b/,
  /\bnew (screen|page|flow|feature|module|lib|library|integration)\b/, /\bintegrat/, /\bthird[- ]party\b/, /\bcache\b/, /\bsearch\b/,
];
const PROJECT = [/\bepics?\b/, /\bseveral features\b/, /\bmultiple features\b/, /\bnew (app|application|service|product)\b/, /\bre-?architect/, /\brewrite (the|our)\b/];
// "Trivial" is read off an edit to text, or to a name only the code reads —
// phrases, not single words: "comments", "copy", "docs" and "rename" are as
// often a feature ("a comments section", "copy the records") as a tidy-up.
const CODE_NAME = "helper|variable|function|method|constant|const|class|file|folder|directory|test|spec|import|alias|component|mixin|util|utility|hook|script";
const TRIVIAL = [
  /\btypos?\b/, /\bmisspell\w*\b/, /\bspelling\b/, /\bwording\b/, /\breword\b/,
  new RegExp(`\\brename (the |a |an |this |that )?(\\w+ ){0,2}(${CODE_NAME})\\b`),
  /\breadme\b/, /\bchangelog\b/, /\bjsdoc\b/, /\bdocumentation\b/, /\b(dev|developer|code|repo|contributing) docs\b/,
  /\b(code|inline|doc|todo|stale|outdated) comments?\b/, /\bwhitespace\b/, /\bindentation\b/, /\b(code|source|import) formatting\b/,
  /\blint (errors?|warnings?|fix(es)?)\b/, /\bdead code\b/, /\bunused (imports?|variables?|exports?|code|functions?|helpers?|files?)\b/,
  /\blog (message|line)\b/, /\b(ui|button|label|error|help|placeholder|tooltip|micro) ?copy\b/, /\bcopy (change|tweak|fix|edit|update)\b/,
];
// Words that say behaviour is being added, or that a name or a text something
// outside the code reads is changing. They do not make the change a feature;
// they mean "trivial" cannot be read off the words, so the answer is "unsure".
// Level 0 runs no phase at all, which makes a wrong 0 the costly mistake.
const NOT_TRIVIAL = [
  /\b(add|adds|adding|create|build|implement|introduce|support|allow|enable|let|show|display|make|new)\b/,
  /\burls?\b/, /\bslugs?\b/, /\blinks?\b/, /\bpaths?\b/, /\bfields?\b/, /\bkeys?\b/, /\benv\b/, /\bconfig/, /\bsettings?\b/, /\bflags?\b/,
  /\bparam/, /\bquery\b/, /\bcookies?\b/, /\bevents?\b/, /\bstatus(es)?\b/, /\brecords?\b/, /\bdata\b/, /\barchive/, /\bstorage\b/,
  /\bbuckets?\b/, /\bupload/, /\bdownload/, /\bexport/, /\bsections?\b/, /\busers?\b/, /\bdrivers?\b/, /\bmechanics?\b/, /\bcustomers?\b/,
  /\bdependenc(y|ies)\b/, /\bupgrade/, /\bversions?\b/, /\bmajor\b/,
  // More than one change, or one change in many places: the trivial word
  // describes only part of it.
  /\band\b/, /\balso\b/, /\bthen\b/, /\bplus\b/, /[,;&+]/, /\beverywhere\b/, /\bacross\b/, /\b(all|every|entire|whole)\b/, /\bglobal/,
];

/**
 * The classifier that runs before anything that costs a model call. It answers
 * only when the description leaves no room — a typo, a contract change, an
 * epic — and says "unsure" for everything else, which is where the judgement
 * (Jev, or the model running /speckit-size) is worth its tokens. It never
 * suggests level 1: "one coherent unit with clear intent" is a judgement, not a
 * keyword.
 */
export function classifyLevel(description) {
  const text = ` ${String(description).toLowerCase()} `;
  const hits = (patterns) => patterns.filter((p) => p.test(text)).map((p) => text.match(p)[0].trim());
  const project = hits(PROJECT);
  if (project.length) return { level: 3, confidence: 0.75, reason: `names ${project.join(", ")}` };
  const risk = hits(RISK);
  if (risk.length) return { level: 2, confidence: 0.8, reason: `touches ${risk.slice(0, 4).join(", ")}` };
  const trivial = hits(TRIVIAL);
  if (!trivial.length) return { unsure: true, reason: "no decisive words" };
  const more = hits(NOT_TRIVIAL);
  if (more.length) return { unsure: true, reason: `${trivial.join(", ")}, but also ${more.slice(0, 4).join(", ")}` };
  const words = text.trim().split(/\s+/).length;
  if (words > 15) return { unsure: true, reason: "too long to call trivial from words alone" };
  return { level: 0, confidence: 0.85, reason: `${trivial.join(", ")}, nothing riskier` };
}

/**
 * Which level a description of the work asks for.
 *
 * `/speckit-size` has always made this call in prose, which means it is made
 * differently depending on what else is in the context window — and it is the
 * one decision that determines how much process every later gate demands.
 * Asking it as a closed question makes it comparable between runs, and the
 * confidence makes "I am not sure" a first-class answer instead of a silent
 * default to 2.
 *
 * Suggests only. Nothing here writes `.specify/feature.json`; `level set`
 * does, and a human or /speckit-size runs it.
 */
export async function suggestLevel(description, { repo, fetchImpl } = {}) {
  const { ask, choice, choiceOf, unavailableNote } = await import("./lib/jev.mjs");
  const criteria = Object.fromEntries(
    Object.entries(LEVELS).map(([n, meta]) => [`${n}`, `${meta.name} — ${meta.note}`]),
  );
  const { answers, unavailable, reason } = await ask(
    { work: description, repository: "A TypeScript monorepo using spec-driven development; levels choose which artifacts the change owes." },
    { level: choice("How much process does this piece of work need?", criteria) },
    { repo, fetchImpl },
  );
  if (unavailable) return { unavailable: true, note: unavailableNote(reason) };
  const picked = choiceOf(answers.level);
  if (!picked) return { unavailable: true, note: unavailableNote("no answer") };
  return { level: Number(picked.choice), confidence: picked.confidence, unavailable: false };
}

/** Print a level answer the way every suggest path does; --set records it only when confident. */
function printLevel(result, { repo, argv, out }) {
  const meta = LEVELS[result.level];
  // Below 0.6 the model is guessing between two levels, and guessing wrong
  // either buries a small change in paperwork or ships a project with none.
  const confident = result.confidence >= 0.6;
  const hedge = confident ? "" : " — low confidence, ask rather than set it";
  out(`level ${result.level} (${meta.name}) suggested by ${result.by} at ${result.confidence.toFixed(2)} confidence${result.reason ? ` (${result.reason})` : ""}${hedge}`);
  out(`  owes: ${meta.artifacts.join(", ") || "no artifacts"}`);
  if (argv.includes("--set") && confident) {
    const set = setLevel(repo, result.level);
    out(`  recorded for ${set.level_for}`);
  } else {
    out(`  nothing was written — run: node .claude/scripts/level.mjs set ${result.level}`);
  }
}

/**
 * Size from a description: the local classifier first, since a clear case
 * costs nothing; only an unsure one goes to Jev, and only if Jev is also
 * unavailable does the caller have to reason it out.
 */
export async function suggestText(description, { repo, argv = [], out = console.log, fetchImpl } = {}) {
  const local = classifyLevel(description);
  let result = local.unsure ? null : { ...local, by: "classifier" };
  if (!result) {
    const jev = await suggestLevel(description, { repo, fetchImpl });
    if (jev.unavailable) {
      out(`unsure (${local.reason}) — answer the size question yourself, then: node .claude/scripts/level.mjs set <0-3>`);
      return 0;
    }
    result = { ...jev, by: "jev" };
  }
  printLevel(result, { repo, argv, out });
  return 0;
}

const STORY_REF = /^ST-(\d+)$/i;
const PAGE_REF = /^https?:\/\/[^/]*notion\.(?:so|site|com)\/.*?([0-9a-f]{32})(?:[?#].*)?$/i;

const plain = (block) => (block?.[block.type]?.rich_text ?? []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");
const headingLevel = (block) => (/^heading_[123]$/.test(block?.type) ? Number(block.type.at(-1)) : 0);
const rollupCount = (prop) => {
  const r = prop?.rollup;
  if (!r) return 0;
  if (r.type === "array") return r.array?.length ?? 0;
  if (r.type === "number") return r.number ?? 0;
  return 0;
};

async function childrenOf(client, id, { maxPages, NotionError }) {
  const blocks = [];
  let cursor;
  let pages = 0;
  do {
    if (++pages > maxPages) throw new NotionError("too many pages", `${id} children passed ${maxPages} pages`);
    const page = await client.request("GET", `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    blocks.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

/** The Build brief's sections and whether each has content, or "not found". */
async function briefOf(client, blocks, paging) {
  const at = blocks.findIndex((b) => headingLevel(b) && /build brief/i.test(plain(b)));
  if (at === -1) return { brief: "not found", text: "" };
  const head = blocks[at];
  let body = [];
  if (head.has_children) body = await childrenOf(client, head.id, paging);
  else for (const b of blocks.slice(at + 1)) {
    if (headingLevel(b) && headingLevel(b) <= headingLevel(head)) break;
    body.push(b);
  }
  const sections = [];
  const text = [];
  for (const b of body) {
    const t = plain(b);
    text.push(t);
    if (headingLevel(b)) sections.push({ name: t, filled: Boolean(b.has_children) });
    else if ((t.trim() || b.has_children || !b[b.type]?.rich_text) && sections.length) sections.at(-1).filled = true;
  }
  if (!sections.length) sections.push({ name: "Build brief", filled: text.some((t) => t.trim()) });
  return { brief: sections, text: text.join(" ") };
}

/** Read a story's sizing facts from Notion, or say why it could not be read. */
async function readStory(ref, { repo, env, fetchImpl }) {
  const { NotionError, clientLimits, notionClient, notionToken, readProp } = await import("./lib/notion.mjs");
  const token = notionToken(repo, env);
  if (!token) return { error: "no NOTION_TOKEN" };
  const limits = clientLimits(env);
  const client = notionClient({ token, fetchImpl, ...limits });
  const paging = { maxPages: limits.maxPages, NotionError };
  try {
    let page;
    const story = ref.match(STORY_REF);
    if (story) {
      const { STORIES } = await import("./notion-sync.mjs");
      page = (await client.query(STORIES, { filter: { property: "ID", unique_id: { equals: Number(story[1]) } } }))[0];
    } else page = await client.request("GET", `/pages/${ref.match(PAGE_REF)[1]}`);
    if (!page) return { error: `${ref} not found` };
    const { brief, text } = await briefOf(client, await childrenOf(client, page.id, paging), paging);
    const title = Object.values(page.properties ?? {}).find((p) => p?.type === "title");
    const points = readProp(page, "Story points");
    return {
      facts: {
        type: readProp(page, "Issue type"),
        labels: (page.properties?.Labels?.multi_select ?? []).map((l) => l.name),
        design: rollupCount(page.properties?.Design),
        boards: rollupCount(page.properties?.["Design boards"]),
        points: typeof points === "number" ? points : null,
        brief,
      },
      text: `${(title?.title ?? []).map((t) => t.plain_text ?? "").join("")} ${text}`.trim(),
    };
  } catch (error) {
    if (error instanceof NotionError) return { error: error.short };
    return { error: error?.message ?? String(error) };
  }
}

/**
 * The Notion rules, applied over the free classifier's answer: a classifier 2
 * or more stands; boards, an empty or missing brief section, or more than
 * STORY_POINTS_THRESHOLD points mean at least 2; a bug with no boards and a
 * complete brief is 1. Labels and Design are facts only. Never lowers.
 */
function sizeFromFacts(facts, classified) {
  const floors = [];
  if (facts.boards) floors.push(`boards: ${facts.boards}`);
  if (facts.brief === "not found") floors.push("brief: not found");
  else {
    const empty = facts.brief.filter((s) => !s.filled).map((s) => s.name);
    if (empty.length) floors.push(`brief empty: ${empty.join(", ")}`);
  }
  if (facts.points !== null && facts.points > STORY_POINTS_THRESHOLD) floors.push(`points: ${facts.points}`);
  if (!classified.unsure && classified.level >= 2)
    return { ...classified, by: "classifier", reason: [classified.reason, ...floors].join("; ") };
  if (floors.length) return { level: 2, confidence: 0.8, by: "notion", reason: floors.join("; "), askText: Boolean(classified.unsure) };
  if (facts.type === "Bug" && facts.brief.length && facts.brief.every((s) => s.filled))
    return { level: 1, confidence: 0.8, by: "notion", reason: "a bug with no boards and a complete brief" };
  return { unsure: true, reason: `no decisive facts: type ${facts.type ?? "none"}, no boards, brief complete` };
}

const describeFacts = (f) =>
  [
    `type ${f.type ?? "none"}`,
    `labels ${f.labels.join(", ") || "none"}`,
    `design ${f.design || "none"}`,
    `boards ${f.boards || "none"}`,
    `points ${f.points ?? "none"}`,
    f.brief === "not found" ? "brief: not found" : `brief ${f.brief.map((s) => `${s.name} ${s.filled ? "filled" : "empty"}`).join(", ")}`,
  ].join(" · ");

/** `suggest <text>` or `suggest ST-<n>|<story URL>`: the story's Notion facts first, then today's path. */
export async function suggestCommand(argv, { repo, env = process.env, fetchImpl, out = console.log } = {}) {
  const description = argv.filter((a) => !a.startsWith("--")).join(" ");
  if (!description) {
    console.error('level: suggest needs a description or a story, e.g. level suggest "add a --json flag to the rule check" or level suggest ST-123');
    return 1;
  }
  if (!STORY_REF.test(description) && !PAGE_REF.test(description)) return suggestText(description, { repo, argv, out, fetchImpl });

  const story = await readStory(description, { repo, env, fetchImpl });
  if (story.error) {
    out(`notion not read (${story.error}) — sizing from the text as given`);
    return suggestText(description, { repo, argv, out, fetchImpl });
  }
  out(`facts: ${describeFacts(story.facts)}`);
  const verdict = sizeFromFacts(story.facts, classifyLevel(story.text));
  if (verdict.unsure) {
    out(`unsure (notion: ${verdict.reason}) — sizing from the story's text`);
    return suggestText(story.text, { repo, argv, out, fetchImpl });
  }
  // A floor only raises: with the classifier unsure, the text path is
  // Jev, and a Jev answer above the floor stands.
  if (verdict.askText) {
    const jev = await suggestLevel(story.text, { repo, fetchImpl });
    if (!jev.unavailable && jev.level > verdict.level) {
      printLevel({ ...jev, by: "jev", reason: verdict.reason }, { repo, argv, out });
      return 0;
    }
  }
  printLevel(verdict, { repo, argv, out });
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (argv[0] === "suggest") process.exit(await suggestCommand(argv.slice(1), { repo }));
  process.exit(main(argv, repo));
}
