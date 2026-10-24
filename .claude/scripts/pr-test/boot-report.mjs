// The report of a PR QA run whose tester never started: a step before it (the
// services, the install) failed, so run.mjs wrote nothing and the artifact would
// be empty. The workflow runs this instead, so the tester still reads a failure
// verdict with the reason as its one blocking finding.
//
//   REASON=<why> node .claude/scripts/pr-test/boot-report.mjs --pr <n> --sha <sha> --lap <n> --out <dir>
//
// The reason comes from the environment, never the command line: the workflow
// sets it from an expression, and a value spliced into a script is a shell
// injection.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { isEntryPoint } from "../lib/entry.mjs";
import { isBlocking, reportMarkdown, stepFinding, verdict } from "./findings.mjs";

/** The report run.mjs would have written, for a run that booted nothing. */
function bootReport({ pr, sha, lap, reason }) {
  const findings = [stepFinding("The run never started", reason)];
  const notes = ["The tester run was skipped: a step before it failed."];
  const v = verdict(findings);
  const summary = `${findings.filter(isBlocking).length} blocking finding(s); ${findings.length} in all. Booted nothing.`;
  const report = { pr, sha, lap, verdict: v, summary, findings, booted: [], notes };
  report.markdown = reportMarkdown({ pr, sha, verdict: v, findings, booted: [], lap, notes });
  return report;
}

if (isEntryPoint(import.meta.url)) {
  const { values } = parseArgs({ options: { pr: { type: "string" }, sha: { type: "string" }, lap: { type: "string", default: "1" }, out: { type: "string" } } });
  // A boot failure always leaves a report, so a missing reason gets the generic one.
  const reason = process.env.REASON?.trim() || "a step before the tester run failed; see the workflow run log";
  if (!values.pr || !values.sha || !values.out) {
    console.error("usage: REASON=<why> boot-report.mjs --pr <n> --sha <sha> [--lap <n>] --out <dir>");
    process.exit(64);
  }
  const report = bootReport({ pr: Number(values.pr), sha: values.sha, lap: Number(values.lap), reason });
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(values.out, "report.md"), report.markdown);
  console.log(`verdict failure: ${reason}`);
}
