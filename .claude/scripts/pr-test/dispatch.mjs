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
//   node .claude/scripts/pr-test/dispatch.mjs <pr> [--flows <file.mjs> [--spec <spec.md>] [--proof]] [--routes /,/cockpit]
//        (each route path[?query][@role][:status]; one the run would refuse is refused here, exit 64)
//        [--lap <n>] [--out <dir>] [--ref main] [--no-wait | --run <id>]
//
// No agent waits on a run (its prompt cache would go cold): --no-wait dispatches,
// prints the hand-off line (`- QA run: <id> · head <sha> · lap <n> · <url>`,
// qa-run.mjs) and exits; --run <id> dispatches nothing and reads that finished
// run as a dispatched lap would, exiting 2 while it has not completed. With
// neither, it dispatches and watches the run, for a lap run by hand.
//
// --flows dispatches flows that load and cover the spec's scenarios
// (precheck.mjs's static check), with every --routes entry served by the
// checkout's router (sweep.mjs routerTable); the run itself is the proof.
// --proof, for a story that changed the flows' ground, also asks for a clean
// `precheck.mjs --flows <f> --check` for the PR head, read from the proof it
// left in this checkout; a proof for an earlier commit holds while every
// commit since changes documentation only (scripts/docs-only.ts) or no file at
// all. Anything else is refused, exit 64.
//
// The PR is read over REST everywhere (GraphQL is a budget every session
// shares). A head gets one QA run: on the laptop the dispatched one, so the PR
// loses its `qa: on-push` label first and pr-qa.yml's pull_request run skips.
// A cloud session (CLAUDE_CODE_REMOTE=true) cannot dispatch (403), so it
// dispatches nothing: `lifecycle.mjs ready` labelled the PR there, the
// workflow starts by itself when it is marked ready or pushed to, and this
// finds that pull_request run for the head commit over REST and prints the
// same hand-off line. --flows, --routes and --ref cannot reach such a run (it
// runs the default routes, no flows).
//
// --ref is the branch whose pr-qa.yml and tester scripts run (main; a branch
// that changes the tester itself can name its own). Exit 0 when the report says
// success, 1 when it says failure (blocking findings: read the report), 2 when
// the run left no usable report (an infrastructure failure, not a verdict).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { isDocsOnly, isDocumentation } from "../../../scripts/docs-only.ts";
import { activeFeature } from "../lib/feature.mjs";
import { checkFlows, flowsHash, PROOF_DIR, proofPath } from "./precheck.mjs";
import { qaRunLine } from "./qa-run.mjs";
import { routeProblem, routerTable } from "./sweep.mjs";

export const WORKFLOW = "pr-qa.yml";
const ON_PUSH_LABEL = "qa: on-push";
export const ARTIFACT_PREFIX = "pr-qa-";
export const FLOWS_LIMIT = 60000;

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const VALUED = ["--flows", "--spec", "--routes", "--lap", "--out", "--ref", "--run"];

export function parseArgs(argv) {
  const flag = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? d : (argv[i + 1] ?? "");
  };
  return {
    pr: argv.find((a, i) => /^\d+$/.test(a) && !VALUED.includes(argv[i - 1])),
    flows: flag("flows"),
    spec: flag("spec"),
    routes: flag("routes", "/,/cockpit"),
    lap: flag("lap", "1"),
    out: flag("out"),
    ref: flag("ref", "main"),
    noWait: argv.includes("--no-wait"),
    proof: argv.includes("--proof"),
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

/** The newest pull_request run among a REST listing of the workflow's runs for one head. */
export function findPrRun(workflowRuns) {
  const newest = [...workflowRuns].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
  return newest ? { databaseId: newest.id, url: newest.html_url } : null;
}

const PROOF_NAME = /^([0-9a-f]{40})-([0-9a-f]{16})$/;

/**
 * The proof that flows of `hash` passed --check at `sha` in the checkout at `root`: `{ proof }` with its
 * path, or `{ refused }` naming what is missing. A proof for an ancestor holds while the commits since it
 * change documentation only, or no file at all (an empty commit). Once a proof holds, the stamps for
 * commits off the head's history (an abandoned or rewritten branch) are removed, so they do not pile up;
 * a stamp for the head or an ancestor stays, whatever its flows. A refusal removes nothing.
 */
export function proofFor({ root, sha, hash }) {
  const git = (...args) => spawnSync("git", ["-C", root, "-c", "core.quotePath=off", ...args], { encoding: "utf8" });
  const dir = join(root, PROOF_DIR);
  const stamps = (existsSync(dir) ? readdirSync(dir) : []).map((n) => PROOF_NAME.exec(n)).filter(Boolean).map(([, at, h]) => ({ name: `${at}-${h}`, at, h }));
  const prune = () => {
    for (const s of stamps)
      if (s.at !== sha && git("merge-base", "--is-ancestor", s.at, sha).status !== 0) rmSync(join(dir, s.name), { force: true });
  };
  const exact = proofPath(root, sha, hash);
  if (existsSync(exact)) {
    prune();
    return { proof: exact };
  }
  const behind = stamps
    .filter((s) => s.h === hash && git("merge-base", "--is-ancestor", s.at, sha).status === 0)
    .map((s) => ({ ...s, count: Number(git("rev-list", "--count", `${s.at}..${sha}`).stdout) }))
    .sort((x, y) => x.count - y.count);
  const head = sha.slice(0, 7);
  const fix = `run precheck.mjs --flows <file> --check at ${head}, then dispatch again`;
  let code = null;
  for (const s of behind) {
    const paths = git("diff", "--name-only", "--no-renames", `${s.at}..${sha}`).stdout.split("\n").filter((p) => p.trim());
    if (paths.length === 0 || isDocsOnly(paths)) {
      prune();
      return { proof: proofPath(root, s.at, hash) };
    }
    code ??= { at: s.at, files: paths.filter((p) => !isDocumentation(p)) };
  }
  if (code) return { refused: `the flows were proven at ${code.at.slice(0, 7)}, and the commits since change code (${code.files.slice(0, 3).join(", ")}${code.files.length > 3 ? ` and ${code.files.length - 3} more` : ""}): ${fix}` };
  if (stamps.some((s) => s.at === sha)) return { refused: `the proof for ${head} is for other flows content (the file changed since its check): ${fix}` };
  return { refused: `no flows proof for ${head}: ${fix}` };
}

const STAGING_PREFIX = ".download-";

/** Remove the last lap's evidence and any download folder an interrupted lap left, so a run that uploads nothing leaves no report to misread. */
export function clearPrevious(out) {
  const leftovers = readdirSync(out).filter((name) => name.startsWith(STAGING_PREFIX));
  for (const f of ["report.json", "report.md", "run.log", "observations.json", "ci-run.json", "shots", "logs", ...leftovers]) rmSync(join(out, f), { recursive: true, force: true });
}

/** A fresh, empty folder inside --out for one download: `gh run download` refuses to overwrite files an earlier run left. */
export const stagingDir = (out) => mkdtempSync(join(out, STAGING_PREFIX));

/** Move the downloaded artifact into --out, replacing only the entries it carries; the caller removes the emptied download folder. */
export function placeDownload(staging, out) {
  if (resolve(dirname(staging)) !== resolve(out) || !basename(staging).startsWith(STAGING_PREFIX))
    throw new Error(`${staging} is not a download folder of ${out}`);
  for (const name of readdirSync(staging)) {
    rmSync(join(out, name), { recursive: true, force: true });
    renameSync(join(staging, name), join(out, name));
  }
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
// How often and how many times the run is looked for after the dispatch; the specs set
// PR_QA_POLL_MS to poll at once and PR_QA_POLL_TRIES to give up after a few lookups.
const POLL_MS = Number(process.env.PR_QA_POLL_MS) || 5000;

/** The number of lookups PR_QA_POLL_TRIES asks for: a positive integer, else 36 (three minutes at 5 s). */
export function pollTries(value) {
  return /^[1-9]\d*$/.test(value ?? "") ? Number(value) : 36;
}
const POLL_TRIES = pollTries(process.env.PR_QA_POLL_TRIES);

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

/** The PR's state and head over REST, never GraphQL, shaped as `gh pr view --json state,headRefOid`. */
function restPr(pr) {
  const p = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/${pr}`]));
  return { state: String(p.state).toUpperCase(), headRefOid: p.head.sha };
}

/** Cloud: wait for the run the pull_request event started for `sha`, print the hand-off line. */
async function awaitPrRun(opt, sha) {
  if (opt.flows) console.error(`dispatch: the flows in ${opt.flows} are not sent: a cloud session cannot dispatch, and the pull_request run takes no flows`);
  const path = `repos/{owner}/{repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&event=pull_request&per_page=30`;
  let run = null;
  for (let i = 0; i < POLL_TRIES && !run; i++) {
    run = findPrRun(JSON.parse(gh(["api", path])).workflow_runs ?? []);
    if (!run) await sleep(POLL_MS);
  }
  if (!run) {
    console.error(`dispatch: no ${WORKFLOW} run for #${opt.pr} at ${sha.slice(0, 7)} appeared within ${Math.round((POLL_TRIES * POLL_MS) / 1000)} s (is the PR ready, not a draft?)`);
    return 2;
  }
  console.error(`dispatch: run ${run.url}`);
  if (opt.noWait) {
    console.log(qaRunLine({ id: run.databaseId, sha, lap: opt.lap, url: run.url }));
    return 0;
  }
  try {
    execFileSync("gh", ["run", "watch", String(run.databaseId), "--exit-status", "--interval", "30"], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
  } catch {}
  const conclusion = gh(["run", "view", String(run.databaseId), "--json", "conclusion", "-q", ".conclusion"]);
  const out = resolve(opt.out ?? join(tmpdir(), "mf-prtest", `${opt.pr}-${sha.slice(0, 7)}`));
  return readRun({ pr: opt.pr, sha, out, run, conclusion });
}

async function main(argv) {
  const opt = parseArgs(argv);
  if (!opt.pr) {
    console.error("usage: dispatch.mjs <pr> [--flows file.mjs [--spec spec.md] [--proof]] [--routes …] [--lap n] [--out dir] [--ref main] [--no-wait | --run <id>]");
    return 64;
  }
  if (opt.run !== undefined && !/^\d+$/.test(opt.run)) {
    console.error(`dispatch: --run takes a run's number, got "${opt.run}"`);
    return 64;
  }
  if (opt.run !== undefined && opt.noWait) {
    console.error("dispatch: --no-wait dispatches a run and --run reads one; pass one of them");
    return 64;
  }
  // The workflow's own check, and the sweep's, before a run is spent on a route either would refuse.
  const table = routerTable(repoRoot);
  const refused = opt.routes.split(",").map((route) => routeProblem(route, table)).filter(Boolean);
  if (refused.length) {
    for (const line of refused) console.error(`dispatch: ${line}`);
    console.error("dispatch: nothing was dispatched");
    return 64;
  }
  const cloud = process.env.CLAUDE_CODE_REMOTE === "true";
  const info = restPr(opt.pr);
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
  if (cloud) return awaitPrRun(opt, sha);
  if (opt.flows) {
    // The flows' own lap-1 failures, caught before a run is spent on them (precheck.mjs).
    const feature = activeFeature(repoRoot);
    const problems = await checkFlows({ flows: opt.flows, spec: opt.spec ?? (feature && join(feature.dir, "spec.md")) });
    if (problems.length) {
      for (const p of problems) console.error(`dispatch: ${p}`);
      console.error("dispatch: the flows fail the pre-check; nothing was dispatched");
      return 64;
    }
    if (!opt.proof) console.error("dispatch: flows: proof skipped (no --proof)");
    else {
      const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
      const { refused } = top.status === 0 ? proofFor({ root: top.stdout.trim(), sha, hash: flowsHash(opt.flows) }) : { refused: "not in a git checkout, where precheck.mjs --check leaves its proof" };
      if (refused) {
        console.error(`dispatch: ${refused}; nothing was dispatched`);
        return 64;
      }
    }
  }
  const flows = opt.flows ? encodeFlows(readFileSync(opt.flows, "utf8")) : null;
  const nonce = `${opt.pr}-${sha.slice(0, 7)}-${Date.now().toString(36)}`;
  const { args, input } = dispatchCommand({ ref: opt.ref, inputs: dispatchInputs({ pr: opt.pr, sha, lap: opt.lap, routes: opt.routes, flows, nonce }) });
  // The label starts a pull_request run beside this one; a PR without it answers 404, which is the usual
  // case. Any other failure is named, and the lap is dispatched anyway.
  try {
    gh(["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/${opt.pr}/labels/${encodeURIComponent(ON_PUSH_LABEL)}`]);
  } catch (error) {
    const stderr = String(error.stderr ?? error.message);
    if (!/\bHTTP 404\b/.test(stderr)) console.error(`dispatch: could not remove the ${ON_PUSH_LABEL} label: ${stderr.trim().split("\n")[0]}`);
  }
  gh(args, { input });
  console.error(`dispatch: ${WORKFLOW} on ${opt.ref} for #${opt.pr} at ${sha.slice(0, 7)} (nonce ${nonce})`);

  let run = null;
  for (let i = 0; i < POLL_TRIES; i++) {
    const runs = JSON.parse(gh(["run", "list", "--workflow", WORKFLOW, "--event", "workflow_dispatch", "--limit", "30", "--json", "databaseId,displayTitle,url"]));
    run = findRun(runs, nonce);
    if (run) break;
    await sleep(POLL_MS);
  }
  if (!run) {
    console.error(`dispatch: no ${WORKFLOW} run named after ${nonce} appeared within ${Math.round((POLL_TRIES * POLL_MS) / 1000)} s`);
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
