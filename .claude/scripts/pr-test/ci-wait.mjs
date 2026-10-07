// Wait for a PR's CI, and its QA run, to finish before the tail starts.
//
//   node .claude/scripts/pr-test/ci-wait.mjs <n> [--run <id>]
//
// `gh pr checks <n> --watch` ends at once when the head has no checks yet,
// which is every head in the seconds after a push, so a wait built on it
// could hand the tail a CI that had not started. This one polls until the
// head has checks and none is pending (a PR that has none after
// SPECKIT_CI_NO_CHECKS_MIN minutes, by default 10, is the tail's Hard Stop),
// then until the run has completed. It prints only what did not pass, one
// "<check>: <bucket>" line each and "QA run: <conclusion>", so empty output
// means green. Exit 0 finished, 1 no checks, 2 gh failed.
//
// In a cloud session gh's GraphQL is refused, so `pr checks` goes through
// .claude/scripts/gh.mjs, which reads it over REST.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "../lib/entry.mjs";
import { realGh } from "./post.mjs";

const NO_CHECKS = /no checks reported/i;

/** Polls `gh` until CI (and the run, when given) has finished; never throws. */
export async function waitForCi({ pr, run, gh, sleep, now, noChecksMs = 10 * 60_000, pollMs = 15_000 }) {
  const start = now();
  let checks;
  for (;;) {
    const out = await gh(["pr", "checks", String(pr), "--json", "name,bucket"]);
    if (out.code !== 0 && !NO_CHECKS.test(out.stderr)) return { code: 2, lines: [`CI: ${String(out.stderr).trim()}`] };
    checks = out.code === 0 ? JSON.parse(out.stdout || "[]") : [];
    if (checks.length === 0 && now() - start >= noChecksMs) return { code: 1, lines: [`CI: no checks on #${pr} after ${Math.round(noChecksMs / 60_000)} min`] };
    if (checks.length > 0 && !checks.some((c) => c.bucket === "pending")) break;
    await sleep(pollMs);
  }
  const lines = checks.filter((c) => c.bucket !== "pass" && c.bucket !== "skipping").map((c) => `${c.name}: ${c.bucket}`);
  if (!run) return { code: 0, lines };
  for (;;) {
    const out = await gh(["run", "view", String(run), "--json", "status,conclusion"]);
    if (out.code !== 0) return { code: 2, lines: [...lines, `QA run: ${String(out.stderr).trim()}`] };
    const { status, conclusion } = JSON.parse(out.stdout);
    if (status === "completed") return { code: 0, lines: [...lines, `QA run: ${conclusion}`] };
    await sleep(pollMs);
  }
}

if (isEntryPoint(import.meta.url)) {
  const [pr, flag, run] = process.argv.slice(2);
  if (!/^\d+$/.test(pr ?? "") || (flag && (flag !== "--run" || !/^\d+$/.test(run ?? "")))) {
    console.error("usage: ci-wait.mjs <n> [--run <id>]");
    process.exit(64);
  }
  const ghScript = join(dirname(fileURLToPath(import.meta.url)), "..", "gh.mjs");
  const cloud = process.env.CLAUDE_CODE_REMOTE === "true";
  const gh = async (args) => {
    if (!cloud || args[0] !== "pr") return realGh(args);
    const { execFileSync } = await import("node:child_process");
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [ghScript, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" };
    } catch (error) {
      return { code: error.status ?? 1, stdout: `${error.stdout ?? ""}`, stderr: `${error.stderr ?? error.message}` };
    }
  };
  const minutes = Number(process.env.SPECKIT_CI_NO_CHECKS_MIN) || 10;
  const out = await waitForCi({ pr, run, gh, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now, noChecksMs: minutes * 60_000 });
  for (const line of out.lines) console.log(line);
  process.exit(out.code);
}
