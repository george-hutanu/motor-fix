// Lints a feature's own artifacts — spec.md, tasks.md, plan.md — for defects
// no human reads for and no other check covers. /speckit-analyze judges whether
// the artifacts AGREE; this judges whether each one is internally sound, which
// is cheap, mechanical, and exactly the class of mistake a long autonomous run
// makes: an FR added late that no task covers, a duplicate id from two edits in
// the same session, a task naming a file that was never created.
//
//   node .claude/scripts/artifact-lint.mjs              # active feature, semantic lane on
//   node .claude/scripts/artifact-lint.mjs specs/010-x  # a named one
//   node .claude/scripts/artifact-lint.mjs --check      # exit 1 on any ERROR, lane off
//   node .claude/scripts/artifact-lint.mjs --no-jev     # report without the lane
//
// Findings are ERROR (a real defect) or WARN (worth a look, not a blocker).
//
// The semantic lane adds the judgements the rules below structurally cannot
// make. Every rule here reads tokens: `fr-untasked` knows an id is absent
// from tasks.md, never that the task naming it does something else, and
// nothing anywhere asks whether a requirement could be tested at all. Those
// defects were only ever caught by spec-challenger — one subagent, one skill,
// once.
//
// It is ON for a report and OFF for `--check`, which is the form every
// automated caller uses. A gate has to be fast and give the same answer
// twice; a report does not, and an opt-in flag that nobody remembers to pass
// is a lane that never runs. `--jev` forces it on even under --check, which
// is safe because it cannot reach the exit code: every finding it makes is a
// WARN and --check exits on ERRORs alone.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LEVELS, activeFeature, featureLevel } from "./lib/feature.mjs";
import { validateFeature } from "./capabilities.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const args = new Set(process.argv.slice(2));
const check = args.delete("--check");
const forceJev = args.delete("--jev");
const useJev = !args.delete("--no-jev") && (forceJev || !check);
const named = [...args][0];

const feature = named
  ? { dir: join(repo, named), name: named.replace(/^specs\//, "") }
  : activeFeature(repo);

if (!feature) {
  console.error("artifact-lint: no active feature (see .claude/scripts/lib/feature.mjs)");
  process.exit(check ? 1 : 0);
}

const read = (name) => {
  const p = join(feature.dir, name);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const spec = read("spec.md");
const tasks = read("tasks.md");
const plan = read("plan.md");
const findings = [];
const add = (level, rule, message) => findings.push({ level, rule, message });
/** Declared FR ids, hoisted so the --jev lane can reuse the parse. */
let frIds = [];

if (spec === null) {
  add("ERROR", "spec-missing", `${feature.name}/spec.md does not exist`);
} else {
  // FR ids: declared where the requirement is DEFINED (bolded at line start),
  // not where it is merely mentioned in prose elsewhere in the document.
  const declared = [...spec.matchAll(/^- \*\*(FR-\d{3})\*\*/gm)].map((m) => m[1]);
  const seen = new Set();
  for (const id of declared) {
    if (seen.has(id)) add("ERROR", "fr-duplicate", `${id} is declared twice in spec.md`);
    seen.add(id);
  }

  // A gap usually means a requirement was deleted without renumbering, and the
  // missing id then reads as an FR someone forgot to write.
  const nums = [...seen].map((id) => Number(id.slice(3))).sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i += 1) {
    const prev = nums[i - 1];
    const gap = nums[i] - prev;
    if (gap > 1) {
      const missing = Array.from({ length: gap - 1 }, (_, k) => `FR-${String(prev + k + 1).padStart(3, "0")}`);
      add("WARN", "fr-gap", `spec.md skips ${missing.join(", ")}`);
    }
  }

  if (seen.size === 0) add("WARN", "fr-none", "spec.md declares no FR ids");
  frIds = [...seen];

  // Every FR needs at least one task. tasks.md cites ids in free prose, so a
  // plain substring search over the whole file is the honest check.
  if (tasks !== null) {
    for (const id of seen) {
      if (!tasks.includes(id)) add("ERROR", "fr-untasked", `${id} has no task in tasks.md`);
    }
  }
}

if (tasks === null) {
  add("WARN", "tasks-missing", `${feature.name}/tasks.md does not exist`);
} else {
  const lines = tasks.split("\n");
  const open = lines.filter((l) => /^\s*- \[ \]/.test(l)).length;
  const done = lines.filter((l) => /^\s*- \[[Xx]\]/.test(l)).length;
  if (open + done === 0) add("WARN", "tasks-none", "tasks.md holds no task checkboxes");

  const ids = [...tasks.matchAll(/^\s*- \[[ Xx]\] (T\d{3})\b/gm)].map((m) => m[1]);
  const seenTask = new Set();
  for (const id of ids) {
    if (seenTask.has(id)) add("ERROR", "task-duplicate", `${id} appears twice in tasks.md`);
    seenTask.add(id);
  }

  // Files a task names must exist once that task is checked off. Backticked
  // repo paths only — prose file names are too loose to judge.
  for (const line of lines) {
    if (!/^\s*- \[[Xx]\]/.test(line)) continue;
    const id = line.match(/- \[[Xx]\] (T\d{3})/)?.[1] ?? "a checked task";
    for (const [, path] of line.matchAll(/`((?:apps|libs|e2e)\/[^`\s]+\.[a-z]+)`/g)) {
      if (!existsSync(join(repo, path))) {
        add("ERROR", "task-phantom-file", `${id} is checked but ${path} does not exist`);
      }
    }
  }

  // The spec growing after the tasks were all checked is how a late
  // requirement ships untasked and untested.
  if (spec !== null && open === 0 && done > 0) {
    const untasked = findings.filter((f) => f.rule === "fr-untasked").length;
    if (untasked > 0) {
      add("ERROR", "spec-outran-tasks", `tasks.md is fully checked while ${untasked} FR(s) have no task`);
    }
  }
}

// A level says which artifacts a change owes. Levels 0 and 1 owe no plan, so
// demanding one is noise — the point of routing by size is that a one-session
// change is not made to carry a feature's paperwork. The level never softens a
// finding about an artifact the level DOES owe.
const level = featureLevel(repo, feature.dir);
const owes = new Set(LEVELS[level].artifacts);
if (plan === null && owes.has("plan.md")) add("WARN", "plan-missing", `${feature.name}/plan.md does not exist`);

// The `## Spec Delta` rules live in .claude/scripts/capabilities.mjs and fire
// from both entry points, so `capabilities validate` and `artifact-lint` can
// never disagree about whether a delta is sound.
for (const f of validateFeature(repo, { ...feature, num: feature.num ?? feature.name.slice(0, 3) }))
  add(f.level, f.rule, f.message);

// The semantic lane. Imported dynamically so a run without --jev — which is
// every run inside the specs and every --check in the commit gate — never
// loads it and never reads .env.
if (useJev && spec !== null && frIds.length > 0) {
  const { ask, noul, noulOf, qid, score, scoreOf } = await import("./lib/jev.mjs");

  // The requirement AS WRITTEN, not the whole spec: a paragraph of context
  // three sections away is what makes a vague requirement look answerable.
  // Requirements wrap across lines in every spec here, so the declaration
  // line alone truncates mid-sentence — and half a requirement reads as
  // compound or untestable when the whole one is neither.
  const specLines = spec.split("\n");
  const textOf = (id) => {
    const start = specLines.findIndex((l) => l.startsWith(`- **${id}**`));
    if (start === -1) return id;
    const body = [specLines[start]];
    for (let i = start + 1; i < specLines.length; i += 1) {
      const line = specLines[i];
      if (line.trim() === "" || /^\s*- /.test(line) || /^#/.test(line)) break;
      body.push(line);
    }
    return body.join(" ").replace(/\s+/g, " ").trim();
  };
  const tasksFor = (id) =>
    (tasks ?? "")
      .split("\n")
      .filter((l) => l.includes(id))
      .join("\n") || "(no task mentions this requirement)";

  const questions = {};
  for (const id of frIds) {
    questions[qid(id, "testable")] = noul(
      `Is requirement ${id} objectively testable exactly as written?`,
      "an automated test could pass or fail on it without further interpretation",
      "it is vague, subjective, or uses an unquantified word like fast, robust, simple or intuitive",
    );
    // Graded, not binary. This repo's house style writes a requirement as
    // several clauses on purpose, so "is it exactly one?" answers no for half
    // the spec and the lane becomes noise. What is worth an interruption is
    // the requirement that has grown into several, which is the top level.
    questions[qid(id, "atomic")] = score(
      `How many separable requirements — each needing its own test — does ${id} contain?`,
      ["one", "two closely related", "several that should be split"],
    );
    questions[qid(id, "covered")] = score(
      `How completely do the tasks listed for ${id} implement that requirement?`,
      ["no task implements it", "partially implemented", "fully implemented"],
    );
  }

  const state = {
    requirements: Object.fromEntries(frIds.map((id) => [id, textOf(id)])),
    tasks: Object.fromEntries(frIds.map((id) => [id, tasksFor(id)])),
  };
  const { answers, unavailable, reason } = await ask(state, questions, { repo });

  if (unavailable) {
    // The printer adds its own mark, so the bare reason — `unavailableNote`
    // is for callers that print a whole line themselves.
    findings.push({ level: "NOTE", rule: "jev-unavailable", message: `${reason} — mechanical findings only` });
  } else {
    // Thresholds, not certainties. A noul is a truth value: 0.35 means the
    // model leans no, and that is the point at which a human reading is
    // worth the interruption.
    const NO = 0.35;
    for (const id of frIds) {
      const testable = noulOf(answers[qid(id, "testable")]);
      if (testable !== undefined && testable <= NO)
        add("WARN", "fr-untestable", `${id} is not objectively testable as written (jev ${testable.toFixed(2)})`);

      const atomic = scoreOf(answers[qid(id, "atomic")]);
      if (atomic !== undefined && atomic.score >= 1.5 && atomic.confidence >= 0.6)
        add("WARN", "fr-compound", `${id} holds ${atomic.label ?? "several requirements"} (jev ${atomic.score.toFixed(2)})`);

      const covered = scoreOf(answers[qid(id, "covered")]);
      if (covered !== undefined && covered.score < 1 && covered.confidence >= 0.5)
        add("WARN", "fr-uncovered", `${id}: ${covered.label ?? "tasks do not implement it"} (jev ${covered.score.toFixed(2)})`);
    }
  }
}

const errors = findings.filter((f) => f.level === "ERROR");
const warnings = findings.filter((f) => f.level === "WARN");
const mark = { ERROR: "✗", WARN: "!", NOTE: "·" };
console.log(`artifact-lint: ${feature.name} — ${errors.length} error(s), ${warnings.length} warning(s)`);
for (const f of findings) console.log(`  ${mark[f.level] ?? "!"} [${f.rule}] ${f.message}`);
if (findings.length === 0) console.log("  ✓ clean");

process.exit(check && errors.length > 0 ? 1 : 0);
