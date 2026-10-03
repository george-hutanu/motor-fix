// `node .claude/scripts/harness-eval.mjs` — does the harness still behave the way it
// was specified to behave?
//
// Borrowed from ECC's agent-eval ("every 'which agent is best?' comparison runs
// on vibes — this systematises it"), narrowed to what can be measured without
// spending a model call: the gates. Each case is a declared payload and the
// decision it must produce, so the suite answers "what fraction of the harness's
// specified behaviour still holds" with a number that can be ratcheted, the way
// the mutation floor is.
//
// This is not a duplicate of the unit tests. The unit tests check a gate's
// internals; a case here goes through .claude/settings.json's own entry point
// (run-hook.mjs <id>), so it also covers registration, profiles and wiring — the
// parts that break silently.
//
//   node .claude/scripts/harness-eval.mjs           run every case
//   node .claude/scripts/harness-eval.mjs --check   fail below .claude/evals/baseline.json
//   node .claude/scripts/harness-eval.mjs --json    machine form
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// evals/ lives inside .claude here: the whole harness is git-excluded in this
// repo, and a tracked top-level evals/ would be the one piece that was not.
export const casesDir = (repo) => join(repo, ".claude", "evals", "cases");

export function loadCases(repo) {
  const dir = casesDir(repo);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return (Array.isArray(parsed) ? parsed : [parsed]).map((c) => ({ ...c, file: f }));
    });
}

/** Compare a case's expectation with what the gate actually did. */
export function evaluate(testCase, result) {
  const expected = testCase.expect ?? {};
  if (typeof expected.exit === "number" && result.status !== expected.exit)
    return { pass: false, detail: `expected exit ${expected.exit}, got ${result.status}` };
  for (const stream of ["stdout", "stderr"]) {
    if (!expected[stream]) continue;
    if (!new RegExp(expected[stream], "i").test(result[stream] ?? ""))
      return { pass: false, detail: `${stream} did not match /${expected[stream]}/` };
  }
  return { pass: true, detail: "" };
}

export const passRate = (results) =>
  results.length ? Number((results.filter((r) => r.pass).length / results.length).toFixed(4)) : 0;

/** Build the payload, materialising a transcript file when the case declares one. */
function buildPayload(testCase, scratch) {
  const payload = { ...(testCase.payload ?? {}) };
  if (testCase.transcript) {
    const file = join(scratch, `${testCase.id}.jsonl`);
    writeFileSync(
      file,
      testCase.transcript
        .map((text) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }))
        .join("\n") + "\n",
    );
    payload.transcript_path = file;
  }
  return payload;
}

export function runCases(repo, cases = loadCases(repo)) {
  const runner = join(repo, ".claude", "hooks", "run-hook.mjs");
  const scratch = mkdtempSync(join(tmpdir(), "harness-eval-"));
  try {
    return cases.map((testCase) => {
      const started = Date.now();
      const result = spawnSync(process.execPath, [runner, testCase.hook], {
        input: JSON.stringify(buildPayload(testCase, scratch)),
        encoding: "utf8",
        cwd: repo,
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...(testCase.env ?? {}) },
      });
      const verdict = evaluate(testCase, result);
      return { id: testCase.id, hook: testCase.hook, rationale: testCase.why, ms: Date.now() - started, ...verdict };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export const baselineFor = (repo) => {
  const file = join(repo, ".claude", "evals", "baseline.json");
  if (!existsSync(file)) return { pass_rate: 1 };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { pass_rate: 1 };
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const cases = loadCases(repo);
  const results = runCases(repo, cases);
  const rate = passRate(results);
  const floor = baselineFor(repo).pass_rate ?? 1;

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ pass_rate: rate, floor, cases: results }));
  } else {
    for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.hook.padEnd(28)} ${r.id}`);
    for (const r of results.filter((x) => !x.pass))
      console.log(`\nFAILED ${r.id}: ${r.detail}\n  this case exists because: ${r.rationale ?? "(no rationale recorded)"}`);
    const slowest = [...results].sort((a, b) => b.ms - a.ms)[0];
    console.log(
      `\n${results.filter((r) => r.pass).length}/${results.length} gate behaviours hold (pass rate ${rate}, floor ${floor})` +
        (slowest ? `, slowest ${slowest.id} at ${slowest.ms}ms` : ""),
    );
    if (rate > floor) console.log(`Pass rate is above the floor — raise "pass_rate" in .claude/evals/baseline.json to ${rate} to keep it there.`);
  }
  process.exit(process.argv.includes("--check") && rate < floor ? 1 : 0);
}
