#!/usr/bin/env node
// Machine-readable run state for an unattended cycle. Borrowed from BMAD's
// `bmad-build-auto`, which writes a terminal `status` and `blocking_condition`
// into the spec's frontmatter and tells the operator to read THAT, never the
// chat output: "Human operators read the terminal status, blocking_condition,
// and review findings — not chat output — to make routing decisions."
//
// What this repository had instead: `/speckit-auto`'s Hard Stops as prose in a
// skill file and a narrative appended to `auto-run.md`. Both are for a human
// reading afterwards. An orchestrator that has to decide whether to resume,
// escalate or stop cannot parse either, and `routine-verify.sh` answers a
// different question — whether the CHECKS pass, not where the run is.
//
// Two things this adds that prose cannot:
//
//   1. A resumable position. `status` says which phase to re-enter.
//   2. A loop cap. BMAD blocks on "review repair loop exceeded 5 iterations";
//      a fix/re-verify cycle that does not converge is a real failure mode of
//      long autonomous runs and nothing here counted the laps.
//
// Usage:
//   node .claude/scripts/run-state.mjs show [--json]
//   node .claude/scripts/run-state.mjs set --status in-review [--phase harden] [--feature specs/002-x]
//   node .claude/scripts/run-state.mjs set --status blocked --blocking repair-loop-exceeded
//   node .claude/scripts/run-state.mjs repair [--max 5]      # count one lap; exit 1 at the cap
//   node .claude/scripts/run-state.mjs clear
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { activeFeature } from "./lib/feature.mjs";

export const STATUSES = ["draft", "ready", "in-progress", "in-review", "blocked", "done"];

// A fixed vocabulary, because the point of the field is that something other
// than a language model reads it. A free-text reason belongs in `note`.
export const BLOCKING_CONDITIONS = [
  "dirty-tree",
  "red-suite",
  "unclear-intent",
  "no-subagents",
  "repair-loop-exceeded",
  "verification-failed",
  "destructive-action",
  "product-call",
];

export const DEFAULT_MAX_REPAIRS = 10;

export const statePath = (repo) => join(repo, ".specify", "run-state.json");

export const emptyState = () => ({
  status: "draft",
  phase: null,
  feature: null,
  blocking_condition: null,
  note: null,
  repair_iterations: 0,
  updated: null,
});

/** The persisted state, or a fresh one. Never throws: a corrupt file is not a reason to stop a run. */
export function readState(repo) {
  const file = statePath(repo);
  if (!existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...emptyState(), ...parsed }
      : emptyState();
  } catch {
    return emptyState();
  }
}

export function writeState(repo, state) {
  const file = statePath(repo);
  mkdirSync(dirname(file), { recursive: true });
  const next = { ...state, updated: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * The transition, or an error explaining why it is refused. Exported so the
 * rules are testable without a filesystem.
 *
 * The one rule with teeth: `blocked` requires a condition from the vocabulary.
 * A run that stops without saying why is the failure this file exists to stop
 * — it reads, to an orchestrator, exactly like a run that finished.
 */
export function transition(current, { status, phase, feature, blocking, note }) {
  if (status !== undefined && !STATUSES.includes(status))
    return { error: `unknown status "${status}" (one of: ${STATUSES.join(", ")})` };
  if (blocking !== undefined && blocking !== null && !BLOCKING_CONDITIONS.includes(blocking))
    return { error: `unknown blocking condition "${blocking}" (one of: ${BLOCKING_CONDITIONS.join(", ")})` };

  const next = { ...current };
  if (status !== undefined) next.status = status;
  if (phase !== undefined) next.phase = phase;
  if (feature !== undefined) next.feature = feature;
  if (note !== undefined) next.note = note;
  if (blocking !== undefined) next.blocking_condition = blocking;

  if (next.status === "blocked" && !next.blocking_condition)
    return { error: `status "blocked" needs --blocking <condition> (one of: ${BLOCKING_CONDITIONS.join(", ")})` };
  // Leaving `blocked` clears the condition: a stale reason on a running cycle
  // is worse than none, because it is read as current.
  if (next.status !== "blocked") next.blocking_condition = null;
  // A finished or restarted cycle starts its repair count over. Carrying laps
  // across features would block the next run for the previous one's failure.
  if (status === "done" || status === "draft") next.repair_iterations = 0;
  return { state: next };
}

/** One repair lap. `blocked` when the cap is reached, so the caller never has to count. */
export function countRepair(current, max = DEFAULT_MAX_REPAIRS) {
  const repair_iterations = (current.repair_iterations ?? 0) + 1;
  if (repair_iterations > max) {
    return {
      state: { ...current, repair_iterations, status: "blocked", blocking_condition: "repair-loop-exceeded" },
      exceeded: true,
      max,
    };
  }
  return { state: { ...current, repair_iterations }, exceeded: false, max };
}

export const describe = (s) =>
  [
    `status   ${s.status}${s.blocking_condition ? ` (${s.blocking_condition})` : ""}`,
    `phase    ${s.phase ?? "—"}`,
    `feature  ${s.feature ?? "—"}`,
    `repairs  ${s.repair_iterations ?? 0}`,
    `updated  ${s.updated ?? "never"}`,
    ...(s.note ? [`note     ${s.note}`] : []),
  ].join("\n");

// --- CLI ---------------------------------------------------------------------

function flagValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1) return argv[i + 1] ?? "";
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? undefined : inline.slice(name.length + 3);
}

export function main(argv, repo, env = process.env) {
  const command = argv.find((a) => !a.startsWith("--")) ?? "show";
  const current = readState(repo);

  if (command === "show") {
    if (argv.includes("--json")) console.log(JSON.stringify(current, null, 2));
    else console.log(describe(current));
    return 0;
  }

  if (command === "clear") {
    writeState(repo, { ...emptyState(), feature: activeFeature(repo)?.name ?? null });
    console.log("run state cleared");
    return 0;
  }

  if (command === "set") {
    const result = transition(current, {
      status: flagValue(argv, "status"),
      phase: flagValue(argv, "phase"),
      feature: flagValue(argv, "feature"),
      blocking: flagValue(argv, "blocking"),
      note: flagValue(argv, "note"),
    });
    if (result.error) {
      console.error(`run-state: ${result.error}`);
      return 1;
    }
    console.log(describe(writeState(repo, result.state)));
    return 0;
  }

  if (command === "repair") {
    const max = Number(flagValue(argv, "max") ?? env.SPECKIT_MAX_REPAIR_ITERATIONS ?? DEFAULT_MAX_REPAIRS);
    const { state, exceeded } = countRepair(current, Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_REPAIRS);
    writeState(repo, state);
    if (exceeded) {
      console.error(
        `run-state: repair loop exceeded ${max} iterations — the run is blocked. ` +
          "A fix/re-verify cycle that has not converged in that many laps is not one lap away from converging: " +
          "read the findings, decide whether the requirement or the approach is wrong, and say so.",
      );
      return 1;
    }
    console.log(`repair iteration ${state.repair_iterations} of ${max}`);
    return 0;
  }

  console.error(`run-state: unknown command "${command}" (show, set, repair, clear)`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2), process.env.CLAUDE_PROJECT_DIR ?? process.cwd()));
}
