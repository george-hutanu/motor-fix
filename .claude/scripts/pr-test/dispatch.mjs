#!/usr/bin/env node
// The PR tester's mechanical run on GitHub Actions instead of this laptop:
// dispatch .github/workflows/pr-qa.yml for the PR's head commit, wait for it,
// and download its artifact (report.json, report.md, shots/, logs/) into --out
// (through a fresh folder of its own, so files from an earlier run never refuse it),
// where post.mjs and the pr-tester agent read it exactly as they read a local
// run.mjs report. It holds no heavy slot: nothing heavy runs here.
//
// The agent's flows file travels as the workflow's `flows` input, gzipped then
// base64: the simplest way that puts nothing in git and needs no secret. GitHub
// caps a dispatch's inputs at 65,535 characters, so an encoded file over
// FLOWS_LIMIT is refused; trim the flows, or run the lap with `run.mjs` under
// --local. The workflow runs only for people with write access, with read-only
// permissions and no secret, so the flows code it imports can reach nothing.
//
//   node .claude/scripts/pr-test/dispatch.mjs <pr> [--flows <file.mjs>] [--routes /,/cockpit]
//        [--lap <n>] [--out <dir>] [--ref main] [--no-wait | --run <id>]
//
// No agent waits on a run (its prompt cache would go cold): --no-wait dispatches,
// prints the hand-off line (`- QA run: <id> · head <sha> · lap <n> · <url>`,
// qa-run.mjs) and exits; --run <id> dispatches nothing and reads that finished
// run as a dispatched lap would, exiting 2 while it has not completed. With
// neither, it dispatches and watches the run, for a lap run by hand.
//
// --ref is the branch whose pr-qa.yml and tester scripts run (main; a branch
// that changes the tester itself can name its own). Exit 0 when the report says
// success, 1 when it says failure (blocking findings: read the report), 2 when
// the run left no usable report (an infrastructure failure, not a verdict).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { qaRunLine } from "./qa-run.mjs";

export const WORKFLOW = "pr-qa.yml";
export const ARTIFACT_PREFIX = "pr-qa-";
export const FLOWS_LIMIT = 60000;

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const VALUED = ["--flows", "--routes", "--lap", "--out", "--ref", "--run"];

export function parseArgs(argv) {
  const flag = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? d : argv[i + 1];
  };
  return {
    pr: argv.find((a, i) => /^\d+$/.test(a) && !VALUED.includes(argv[i - 1])),
    flows: flag("flows"),
    routes: flag("routes", "/,/cockpit"),
    lap: flag("lap", "1"),
    out: flag("out"),
    ref: flag("ref", "main"),
    noWait: argv.includes("--no-wait"),
    run: flag("run"),
  };
}

/** The flows file as the workflow's `flows` input: gzip, then base64. */
export function encodeFlows(text) {
  const encoded = gzipSync(Buffer.from(text, "utf8"), { level: 9 }).toString("base64");
  if (encoded.length > FLOWS_LIMIT)
    throw new Error(`the flows file is too large for a workflow input: ${encoded.length} encoded characters, the limit is ${FLOWS_LIMIT}. Trim it, or run this lap with --local.`);
  return encoded;
}

export function dispatchInputs({ pr, sha, lap, routes, flows, nonce }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error(`the head SHA must be the full 40 hex characters, got "${sha}"`);
  return { pr: String(pr), sha: String(sha), lap: String(lap), routes: String(routes), flows: flows ?? "", nonce: String(nonce) };
}

/** `gh` arguments and stdin for the dispatch: the inputs go as JSON on stdin, never on the command line. */
export function dispatchCommand({ ref, inputs }) {
  return { args: ["workflow", "run", WORKFLOW, "--ref", ref, "--json"], input: JSON.stringify(inputs) };
}

/** The run this dispatch started: its name carries the nonce (`run-name` in pr-qa.yml). */
export const findRun = (runs, nonce) => runs.find((r) => String(r.displayTitle ?? "").includes(nonce)) ?? null;

const STAGING_PREFIX = ".download-";

/** Remove the last lap's evidence and any download folder an interrupted lap left, so a run that uploads nothing leaves no report to misread. */
export function clearPrevious(out) {
  const leftovers = readdirSync(out).filter((name) => name.startsWith(STAGING_PREFIX));
  for (const f of ["report.json", "report.md", "ci-run.json", "shots", "logs", ...leftovers]) rmSync(join(out, f), { recursive: true, force: true });
}

/** A fresh, empty folder inside --out for one download: `gh run download` refuses to overwrite files an earlier run left. */
export const stagingDir = (out) => mkdtempSync(join(out, STAGING_PREFIX));

/** Move the downloaded artifact into --out, replacing only the entries it carries, then remove the download folder. */
export function placeDownload(staging, out) {
  if (resolve(dirname(staging)) !== resolve(out) || !basename(staging).startsWith(STAGING_PREFIX))
    throw new Error(`${staging} is not a download folder of ${out}`);
  for (const name of readdirSync(staging)) {
    rmSync(join(out, name), { recursive: true, force: true });
    renameSync(join(staging, name), join(out, name));
  }
  rmSync(staging, { recursive: true, force: true });
}

export const artifactName = (pr) => `${ARTIFACT_PREFIX}${pr}`;

/** Why a downloaded report cannot be used, or null when it can. */
export function checkReport(report, sha, conclusion) {
  if (conclusion === "cancelled") return "the run was cancelled before it finished, so its report is no verdict";
  if (!report) return "the run left no report (see the run's log)";
  if (report.sha !== sha) return `the report is about ${String(report.sha).slice(0, 7)}, not ${sha.slice(0, 7)}`;
  if (report.verdict !== "success" && report.verdict !== "failure") return "the report has no verdict";
  return null;
}

const gh = (args, opts = {}) => execFileSync("gh", args, { cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = Number(process.env.PR_QA_POLL_MS) || 5000;

/** Download a finished run's artifact into `out` and judge its report: 0 success, 1 failure, 2 unusable. */
function readRun({ pr, sha, out, run, conclusion, nonce = null }) {
  mkdirSync(out, { recursive: true });
  clearPrevious(out);
  const staging = stagingDir(out);
  try {
    gh(["run", "download", String(run.databaseId), "-n", artifactName(pr), "-D", staging]);
    placeDownload(staging, out);
  } catch (error) {
    console.error(`dispatch: could not download ${artifactName(pr)}: ${String(error.stderr ?? error.message).trim()}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  writeFileSync(join(out, "ci-run.json"), JSON.stringify({ id: run.databaseId, url: run.url, conclusion, nonce, sha }, null, 2));
  const file = join(out, "report.json");
  const report = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const problem = checkReport(report, sha, conclusion);
  if (problem) {
    console.error(`dispatch: ${problem}. Run: ${run.url} (${conclusion})`);
    return 2;
  }
  console.log(`dispatch: verdict ${report.verdict} — ${report.summary} Report: ${join(out, "report.md")}. Run: ${run.url}`);
  return report.verdict === "failure" ? 1 : 0;
}

async function main(argv) {
  const opt = parseArgs(argv);
  if (!opt.pr) {
    console.error("usage: dispatch.mjs <pr> [--flows file.mjs] [--routes …] [--lap n] [--out dir] [--ref main] [--no-wait | --run <id>]");
    return 64;
  }
  if (opt.run !== undefined && !/^\d+$/.test(opt.run)) {
    console.error(`dispatch: --run takes a run's number, got "${opt.run}"`);
    return 64;
  }
  const info = JSON.parse(gh(["pr", "view", opt.pr, "--json", "state,headRefOid"]));
  if (info.state !== "OPEN") {
    console.error(`dispatch: PR #${opt.pr} is ${info.state}; nothing to test`);
    return 3;
  }
  const sha = info.headRefOid;
  const out = resolve(opt.out ?? join(tmpdir(), "mf-prtest", `${opt.pr}-${sha.slice(0, 7)}`));
  if (opt.run) {
    const run = JSON.parse(gh(["run", "view", opt.run, "--json", "status,conclusion,url"]));
    if (run.status !== "completed") {
      console.error(`dispatch: run ${opt.run} is ${run.status}, not completed; there is nothing to read yet`);
      return 2;
    }
    return readRun({ pr: opt.pr, sha, out, run: { databaseId: Number(opt.run), url: run.url }, conclusion: run.conclusion });
  }
  const flows = opt.flows ? encodeFlows(readFileSync(opt.flows, "utf8")) : null;
  const nonce = `${opt.pr}-${sha.slice(0, 7)}-${Date.now().toString(36)}`;
  const { args, input } = dispatchCommand({ ref: opt.ref, inputs: dispatchInputs({ pr: opt.pr, sha, lap: opt.lap, routes: opt.routes, flows, nonce }) });
  gh(args, { input });
  console.error(`dispatch: ${WORKFLOW} on ${opt.ref} for #${opt.pr} at ${sha.slice(0, 7)} (nonce ${nonce})`);

  let run = null;
  for (let i = 0; i < 36; i++) {
    const runs = JSON.parse(gh(["run", "list", "--workflow", WORKFLOW, "--event", "workflow_dispatch", "--limit", "30", "--json", "databaseId,displayTitle,url"]));
    run = findRun(runs, nonce);
    if (run) break;
    await sleep(POLL_MS);
  }
  if (!run) {
    console.error(`dispatch: no ${WORKFLOW} run named after ${nonce} appeared within ${Math.round((36 * POLL_MS) / 1000)} s`);
    return 2;
  }
  console.error(`dispatch: run ${run.url}`);
  if (opt.noWait) {
    console.log(qaRunLine({ id: run.databaseId, sha, lap: opt.lap, url: run.url }));
    return 0;
  }
  // A failing run (blocking findings) still uploads its artifact; the report decides, not the exit code.
  try {
    execFileSync("gh", ["run", "watch", String(run.databaseId), "--exit-status", "--interval", "30"], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
  } catch {}
  const conclusion = gh(["run", "view", String(run.databaseId), "--json", "conclusion", "-q", ".conclusion"]);
  return readRun({ pr: opt.pr, sha, out, run, conclusion, nonce });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`dispatch: ${String(error.stderr ?? error.message).trim()}`);
    process.exit(2);
  }
}
