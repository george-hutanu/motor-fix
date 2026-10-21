// An orphaned check attempt (ST-1356). Re-running a workflow keeps its run id
// and check suite and adds an attempt; GitHub can leave an earlier attempt's
// check run `in_progress` for good after the newer attempt completed (PR #466,
// check run 119285437128). Ranked as the newest because it never finished, it
// held the merge gate and the CI wait with every check green.
//
// An unfinished check run is an orphan when another check run of the same name
// in the same Actions run (the run id in its details URL) completed and started
// after it, and that run, whose status is its latest attempt's, has completed.
// Anything less stays pending: no run id or no start date (a third-party
// check), the run still going, or no newer completed attempt.
//
// Each check is { name, status, startedAt, runId, runStatus }, statuses in
// either case (REST writes them lower, gh's rollup upper). The merge gate
// (.claude/hooks/merge-gate.mjs) applies it, since it ranks an unfinished run
// as the newest; lib/gh-rest.mjs, and so ci-wait.mjs, reads every run
// (filter=all) and keeps the one started last, which by this definition is
// never the orphan.

const completed = (status) => String(status ?? "").toLowerCase() === "completed";
const started = (c) => Date.parse(c.startedAt ?? "");

/** The Actions run id in a check run's details URL, or null. */
export const runIdOf = (url) => /\/actions\/runs\/(\d+)/.exec(String(url ?? ""))?.[1] ?? null;

/** The orphaned attempts among `checks`. */
export function orphanedChecks(checks = []) {
  return (checks ?? []).filter(
    (c) =>
      !completed(c.status) &&
      c.runId != null &&
      completed(c.runStatus) &&
      Number.isFinite(started(c)) &&
      checks.some((d) => d !== c && d.name === c.name && String(d.runId) === String(c.runId) && completed(d.status) && started(d) > started(c)),
  );
}

/** One line naming the orphans a reader ignored on `sha`, or null for none. */
export function orphanLine(orphans, sha) {
  if (!orphans.length) return null;
  const each = orphans.map((c) => `${c.workflowName ? `${c.workflowName} / ` : ""}${c.name} (check run ${c.checkRunId ?? "?"}, run ${c.runId}, started ${c.startedAt})`);
  return `ignored ${orphans.length === 1 ? "an orphaned check attempt" : `${orphans.length} orphaned check attempts`} on ${String(sha ?? "").slice(0, 7)}, left unfinished after a newer attempt of the same run completed: ${each.join("; ")}`;
}
