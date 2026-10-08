#!/usr/bin/env node
// The PR tester's mechanical run, start to finish, inside one heavy-command
// slot: a worktree at the PR head, private services and apps on free ports,
// health, the API calls, the viewport sweep, the agent's flows, a report — and teardown of everything it
// started, on success, on failure, and on SIGINT, SIGTERM or SIGHUP to this
// process (passed through heavy.sh to the inner run). A signal first writes
// the report, with a finding that names the signal and the phase, so the lap
// still ends with a verdict. SIGKILL cannot be caught: the next local lap
// removes what such a run left (cleanStale), and `post.mjs --missing` posts
// the failure the lap could not.
//
// --allow-closed sweeps a merged or closed PR (dry runs looking back);
// --langs and --schemes narrow the matrix for a quick lap. The pr-tester
// agent uses none of them on a real review.
//
// The affected unit tests and the end-to-end suite are off by default: CI's
// "Unit and integration tests" and "E2E tests" jobs run them on the merge result, and the merge
// gate refuses until CI is green, so running them here as well held a heavy
// slot for minutes and proved nothing new. --tests runs them anyway.
//
// --tree <dir> --sha <sha> is how the PR QA workflow (.github/workflows/pr-qa.yml)
// runs it on a GitHub runner: the PR is already checked out at <dir>, pinned
// to <sha>, with its dependencies installed; PostgreSQL, Redis and MinIO are
// the workflow's containers on the standard ports; the worker always boots.
// No gh, no worktree, nothing to tear down but the apps; the change is
// measured against origin/main.
//
//   node .claude/scripts/pr-test/run.mjs <pr> [--routes /,/cockpit] [--flows <file.mjs>]
//        [--out <dir>] [--lap <n>] [--langs ro,en] [--schemes light,dark] [--tests] [--allow-closed]
//        [--tree <dir> --sha <sha>] [--baseline <dir>]
//
// --baseline names the folder baseline.mjs downloaded an earlier run into
// (the PR QA workflow's "Baseline run of main" step): layout findings it already
// reported are marked pre-existing, and every screenshot is diffed against
// its namesake there into visual.json and diff/<shot>.png.
//
// It posts nothing: the pr-tester agent adds its own findings and posts with
// post.mjs. The report lands in --out (default <tmp>/mf-prtest/<pr>-<sha7>).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { callEndpoints, changedEndpoints, SEEDED, seedPassword, signIn } from "./endpoints.mjs";
import { diffShots, parseJson, readReport, visualOutcome } from "./baseline.mjs";
import { appsFor, cutOffFinding, markPreExisting, readinessOutcome, reportMarkdown, stepFinding, testFinding, touchesWeb, verdict } from "./findings.mjs";
import {
  APP_SCRIPTS,
  EXTERNAL_PORTS,
  HEALTH,
  apiHealth,
  appEnv,
  cleanStale,
  composePlan,
  createBucket,
  externalPlan,
  freePorts,
  localPlan,
  runDirPrefix,
  waitForHttp,
} from "./services.mjs";
import { VIEWPORTS, flowSignIn, runSweep, toFindings } from "./sweep.mjs";
import { createWorktree, depsToClone, removeWorktree } from "./worktree.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const self = fileURLToPath(import.meta.url);

export function parseArgs(argv) {
  const flag = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? d : argv[i + 1];
  };
  return {
    pr: argv.find((a) => /^\d+$/.test(a)),
    routes: flag("routes", "/,/cockpit").split(","),
    flows: flag("flows"),
    out: flag("out"),
    lap: Number(flag("lap", "1")),
    langs: flag("langs", "ro,en").split(","),
    schemes: flag("schemes", "light,dark").split(","),
    tests: argv.includes("--tests"),
    allowClosed: argv.includes("--allow-closed"),
    tree: flag("tree"),
    sha: flag("sha"),
    baseline: flag("baseline"),
  };
}

// What a PR's QA flows are called with: signIn(context, role) opens a guarded screen as a seeded account.
export const flowArgs = ({ webURL, apiURL, outDir, repoRoot, worktree, session }) => ({
  baseURL: webURL,
  apiURL,
  outDir,
  repoRoot,
  worktree,
  signIn: flowSignIn({ session, baseURL: webURL }),
  ...apiHealth(apiURL),
});

/** The affected unit tests between the base and the head, never answered from the Nx cache. */
export const testsCommand = ({ base, sha }) => ["nx", "affected", "-t", "test", `--base=${base}`, `--head=${sha}`, "--parallel=1", "--skip-nx-cache"];

const sh = (cmd, list, opts = {}) => execFileSync(cmd, list, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const has = (cmd, list) => spawnSync(cmd, list, { stdio: "ignore" }).status === 0;

async function main(argv) {
  const opt = parseArgs(argv);
  if (!opt.pr || (opt.tree && !/^[0-9a-f]{40}$/.test(opt.sha ?? ""))) {
    console.error("usage: run.mjs <pr> [--routes …] [--flows file.mjs] [--out dir] [--lap n] [--tests] [--tree dir --sha <40-hex sha>]");
    return 64;
  }
  // The whole boot-test-teardown sequence holds one heavy-command slot.
  // A signal to this outer process is passed on: heavy.sh stops the inner run,
  // whose own handlers tear everything down before it exits.
  if (process.env.HEAVY_HELD !== "1") {
    const child = spawn("sh", [join(repoRoot, "scripts", "heavy.sh"), process.execPath, self, ...argv], { stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
    return new Promise((done) => child.on("exit", (code, signal) => done(code ?? (signal ? 143 : 1))));
  }

  // Git questions go to the tree under test: the PR QA workflow's checkout, or this repository.
  const root = opt.tree ? resolve(opt.tree) : repoRoot;
  let info;
  if (opt.tree) {
    info = { number: Number(opt.pr), state: "OPEN", headRefOid: opt.sha, baseRefName: "main", repo: process.env.GITHUB_REPOSITORY ?? "" };
  } else {
    info = JSON.parse(sh("gh", ["pr", "view", opt.pr, "--json", "number,state,headRefOid,baseRefName,headRefName,url,mergeCommit"], { cwd: repoRoot }));
    if (info.state !== "OPEN" && !opt.allowClosed) {
      console.error(`run: PR #${opt.pr} is ${info.state}; nothing to test (--allow-closed to sweep it anyway)`);
      return 3;
    }
    info.repo = sh("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: repoRoot });
  }
  const sha = info.headRefOid;
  const out = resolve(opt.out ?? join(tmpdir(), "mf-prtest", `${opt.pr}-${sha.slice(0, 7)}`));
  const shots = join(out, "shots");
  const logs = join(out, "logs");
  mkdirSync(shots, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const findings = [];
  const notes = [];
  const booted = [];
  const teardown = [];
  const log = (line) => {
    console.error(`run: ${line}`);
    writeFileSync(join(out, "run.log"), `${new Date().toISOString()} ${line}\n`, { flag: "a" });
  };
  if (!opt.tree) {
    const run = (cmd, list) => {
      const r = spawnSync(cmd, list, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
      return { code: r.status ?? 1, stdout: r.stdout ?? "" };
    };
    for (const line of cleanStale({ tmp: tmpdir(), repo: repoRoot, run })) log(`stale: ${line}`);
  }
  const runDir = mkdtempSync(join(tmpdir(), runDirPrefix(opt.pr)));
  let phase = "setup";

  let tornDown = false;
  const tearDown = () => {
    if (tornDown) return;
    tornDown = true;
    for (const t of teardown.reverse()) {
      try {
        t.run();
        log(`teardown: ${t.name}`);
      } catch (error) {
        log(`teardown FAILED: ${t.name}: ${String(error.message).split("\n")[0]}`);
      }
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, () => {
      log(`${signal} during ${phase}: writing the report, then tearing down`);
      findings.push(cutOffFinding(signal, phase));
      try {
        finish();
      } catch (error) {
        log(`report FAILED: ${error.message}`);
      }
      tearDown();
      process.exit(130);
    });

  /** Run a step to a log file; a non-zero exit is a blocking finding and stops the run. */
  const step = (name, cmd, list, opts = {}) => {
    phase = name;
    log(`${name}: ${cmd} ${list.join(" ")}`);
    const file = join(logs, `${name.replace(/\W+/g, "-")}.log`);
    const fd = openSync(file, "w");
    const r = spawnSync(cmd, list, { stdio: ["ignore", fd, fd], timeout: opts.timeout ?? 20 * 60000, ...opts });
    closeSync(fd);
    const tail = readFileSync(file, "utf8").split("\n").slice(-30).join("\n");
    return { code: r.status ?? 1, tail, file };
  };
  const mustPass = (name, r) => {
    if (r.code === 0) return true;
    findings.push(stepFinding(`${name} failed (exit ${r.code})`, `See ${r.file}: ${r.tail.split("\n").slice(-3).join(" / ")}`));
    return false;
  };

  try {
    teardown.push({ name: `remove ${runDir}`, run: () => rmSync(runDir, { recursive: true, force: true }) });
    let wt;
    let against;
    if (opt.tree) {
      const head = sh("git", ["rev-parse", "HEAD"], { cwd: root });
      if (head !== sha) throw new Error(`the tree at ${root} is at ${head}, not ${sha}`);
      wt = { dir: root, sha };
      against = "origin/main";
      log(`tree ${root} at ${sha}`);
    } else {
      wt = createWorktree({ repo: repoRoot, pr: opt.pr, sha, root: runDir });
      teardown.push({ name: `remove worktree ${wt.dir}`, run: () => removeWorktree({ repo: repoRoot, dir: wt.dir }) });
      log(`worktree ${wt.dir} at ${sha}`);
      sh("git", ["fetch", "--quiet", "origin", info.baseRefName], { cwd: repoRoot });
      // A merged PR (a dry run looking back) is measured against main as it was before the merge.
      against = info.mergeCommit?.oid ? `${info.mergeCommit.oid}^1` : `origin/${info.baseRefName}`;
    }
    const base = sh("git", ["merge-base", against, sha], { cwd: root });
    info.base = base;
    const files = sh("git", ["diff", "--name-only", `${base}...${sha}`], { cwd: root }).split("\n").filter(Boolean);
    const web = touchesWeb(files);
    // On a runner the worker costs nothing extra, so it always boots there.
    const apps = { ...appsFor(files), ...(opt.tree ? { worker: true } : {}) };
    log(`${files.length} changed files; web code ${web ? "touched" : "untouched"}; worker ${apps.worker ? "booted" : "not needed"}`);

    const [pgPort, redisPort, minioPort, minioConsole, apiPort, webPort, workerPort] = await freePorts(7);
    const ports = opt.tree ? EXTERNAL_PORTS : { postgres: pgPort, redis: redisPort, minio: minioPort, minioConsole };
    const env = { ...process.env, ...appEnv({ ports }), NX_DAEMON: "false" };
    const project = `mf-prtest-${opt.pr}-${process.pid}`;
    let plan;
    if (opt.tree) {
      plan = externalPlan();
      const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id } = process.env;
      notes.push(`Ran on GitHub Actions${server && repo && id ? ` (${server}/${repo}/actions/runs/${id})` : ""}: PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.`);
    } else if (has("docker", ["info"])) {
      // The PR's own compose file: a PR that changes the stack is tested on it.
      plan = composePlan({ project, file: join(wt.dir, "docker-compose.yml"), ports });
      const composeEnv = { env: { ...process.env, ...plan.env } };
      teardown.push({ name: `docker compose -p ${project} down -v`, run: () => sh("docker", plan.down, composeEnv) });
      if (!mustPass("services", step("services", "docker", plan.up, composeEnv))) return finish();
      if (!mustPass("bucket setup", step("bucket-setup", "docker", plan.setup, composeEnv))) return finish();
    } else {
      plan = localPlan({ dir: runDir, ports, minio: has("minio", ["--version"]) });
      notes.push(
        plan.storage
          ? "No Docker on this machine: private PostgreSQL, Redis and MinIO (its binary) on free ports."
          : "No Docker on this machine: private PostgreSQL and Redis on free ports, and no object store (no minio binary; `brew install minio` adds one).",
      );
      // PostgreSQL refuses to start under a locale the C library cannot load.
      const cEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
      teardown.push({ name: "stop private PostgreSQL and Redis", run: () => plan.stop.forEach(([c, ...l]) => spawnSync(c, l, { stdio: "ignore", env: cEnv })) });
      for (const [i, [cmd, ...list]] of plan.start.entries())
        if (!mustPass(`services-${i + 1}`, step(`services-${i + 1}`, cmd, list, { env: cEnv }))) return finish();
      if (plan.minio) {
        phase = "minio";
        const fd = openSync(join(logs, "minio.out.log"), "w");
        const [cmd, ...list] = plan.minio.cmd;
        const child = spawn(cmd, list, { env: { ...process.env, ...plan.minio.env }, stdio: ["ignore", fd, fd], detached: true });
        closeSync(fd);
        writeFileSync(plan.minio.pidFile, String(child.pid));
        teardown.push({
          name: `stop MinIO (pid ${child.pid})`,
          run: () => {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {}
          },
        });
        const h = await waitForHttp(plan.minio.health, { timeoutMs: 30000, intervalMs: 250 });
        log(`health minio: ${h.ok ? `HTTP ${h.status}` : h.error}`);
        if (!h.ok) findings.push(stepFinding("MinIO did not come up", `${h.error}; see ${join(logs, "minio.out.log")}`));
        else
          await createBucket({ repoRoot, env })
            .then(() => log(`bucket ${env.STORAGE_BUCKET} ready`))
            .catch((error) => findings.push(stepFinding("Bucket setup failed", String(error.message).split("\n")[0])));
        if (findings.length) return finish();
      }
    }
    booted.push("postgres", "redis", ...(plan.storage ? ["minio"] : []));

    const deps = opt.tree ? null : depsToClone({ repoRoot, lock: readFileSync(join(wt.dir, "package-lock.json"), "utf8") });
    let install = { code: 1 };
    if (opt.tree && existsSync(join(wt.dir, "node_modules"))) install = { code: 0 };
    if (deps && process.platform === "darwin") install = step("install-clone", "cp", ["-cR", deps, join(wt.dir, "node_modules")]);
    if (install.code !== 0) install = step("install", "npm", ["ci", "--no-audit", "--no-fund"], { cwd: wt.dir, env });
    if (!mustPass("install", install)) return finish();
    if (!mustPass("prisma generate", step("prisma-generate", "npx", ["prisma", "generate", "--config", "libs/domain/prisma.config.ts"], { cwd: wt.dir, env }))) return finish();
    if (!mustPass("migrate", step("migrate", "npx", ["prisma", "migrate", "deploy", "--config", "libs/domain/prisma.config.ts"], { cwd: wt.dir, env }))) return finish();
    // The seeded accounts sign the endpoint calls and the signed-in routes in (CI's E2E job seeds the same way).
    const seeded = existsSync(join(wt.dir, "libs/domain/src/seed.ts"));
    if (seeded && !mustPass("seed", step("seed", "npx", ["prisma", "db", "seed"], { cwd: join(wt.dir, "libs/domain"), env }))) return finish();
    if (!seeded) notes.push("No seed in this PR (libs/domain/src/seed.ts): nothing can sign in.");
    const projects = ["api", "web", ...(apps.worker ? ["worker"] : [])];
    if (!mustPass("build", step("build", "npx", ["nx", "run-many", "-t", "build", "-p", projects.join(","), "--parallel=1"], { cwd: wt.dir, env }))) return finish();

    const apiURL = `http://127.0.0.1:${apiPort}`;
    const webURL = `http://127.0.0.1:${webPort}`;
    const launch = (name, extra) => {
      phase = `start ${name}`;
      const fd = openSync(join(logs, `${name}.out.log`), "w");
      const child = spawn(process.execPath, [APP_SCRIPTS[name]], { cwd: wt.dir, env: { ...env, ...extra }, stdio: ["ignore", fd, fd], detached: true });
      closeSync(fd);
      // A killed lap cannot tear its apps down; the next lap stops them by this file (cleanStale).
      if (!opt.tree) writeFileSync(join(runDir, `${name}.pid`), String(child.pid));
      teardown.push({
        name: `stop ${name} (pid ${child.pid})`,
        run: () => {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {}
        },
      });
      booted.push(name);
    };
    // The API writes links to the web app into its e-mails.
    launch("api", { PORT: String(apiPort), PUBLIC_WEB_URL: webURL });
    launch("web", { PORT: String(webPort), API_INTERNAL_URL: apiURL, PUBLIC_WEB_URL: webURL });
    if (apps.worker) launch("worker", { PORT: String(workerPort) });

    phase = "health";
    const live = [
      ["api", apiURL + HEALTH.live],
      ["web", `${webURL}/`],
      ...(apps.worker ? [["worker", `http://127.0.0.1:${workerPort}${HEALTH.live}`]] : []),
    ];
    for (const [name, url] of live) {
      const h = await waitForHttp(url, { timeoutMs: 90000 });
      log(`health ${name}: ${h.ok ? `HTTP ${h.status}` : h.error}`);
      if (!h.ok) findings.push(stepFinding(`${name} did not come up`, `${h.error}; see ${join(logs, `${name}.out.log`)}`));
    }
    if (findings.length) return finish();

    phase = "readiness";
    for (const [name, origin] of [["api", apiURL], ...(apps.worker ? [["worker", `http://127.0.0.1:${workerPort}`]] : [])]) {
      const res = await fetch(origin + HEALTH.ready, { signal: AbortSignal.timeout(15000) }).catch((e) => ({ status: 0, text: async () => e.message }));
      const body = await res.text();
      log(`ready ${name}: ${res.status} ${body.slice(0, 200)}`);
      const outcome = readinessOutcome({ name, status: res.status, body, storage: plan.storage, url: origin + HEALTH.ready });
      if (outcome.note) notes.push(outcome.note);
      if (outcome.finding) findings.push(outcome.finding);
    }

    phase = "sweep";
    log(`sweep: ${opt.routes.join(", ")} × ${Object.keys(VIEWPORTS).length} viewports × ${opt.schemes.join("/")} × ${opt.langs.join("/")}`);
    const session = async (role) => {
      if (!SEEDED[role]) throw new Error(`no seeded account for the role ${role}`);
      return (await signIn(apiURL, role, seedPassword())).refresh;
    };
    const sweep = await runSweep({ baseURL: webURL, routes: opt.routes, outDir: shots, schemes: opt.schemes, langs: opt.langs, repoRoot: root, session });
    // Evidence relative to the report: shots/ stays in --out, beside it; only the report is copied into specs/.
    // A layout finding the baseline run already reported is main's, not this PR's: kept, at medium at most.
    const swept = toFindings(sweep.observations, { web, origins: [webURL, apiURL] });
    const before = opt.baseline ? readReport(opt.baseline) : null;
    // `layout: true` marks a report from a tester that measured layout; an older one cannot tell main's findings from the PR's.
    const measured = !before || before.layout === true;
    if (!measured) notes.push("The baseline run measured no layout, so every layout finding is treated as pre-existing (medium at most) this lap.");
    for (const f of before ? markPreExisting(swept, before.findings ?? [], { measured, routes: before.routes }) : swept)
      findings.push(f.evidence ? { ...f, evidence: relative(out, f.evidence) } : f);
    writeFileSync(join(out, "observations.json"), JSON.stringify(sweep.observations, null, 2));
    const screenshots = sweep.screenshots;

    // The pixel diff against the baseline run's screenshots (baseline.mjs fetched them; baseline.json says which run).
    phase = "visual diff";
    const metaFile = opt.baseline && join(opt.baseline, "baseline.json");
    const meta = metaFile && existsSync(metaFile) ? parseJson(readFileSync(metaFile, "utf8")) : null;
    let shotsDiff = null;
    try {
      shotsDiff = meta && !meta.none ? await diffShots(out, opt.baseline, out, { root }) : null;
    } catch (error) {
      notes.push(`Visual diff skipped: ${String(error.message).split("\n")[0]}`);
    }
    const visual = visualOutcome({ meta, shots: shotsDiff, web });
    notes.push(...visual.notes);
    findings.push(...visual.findings);
    if (visual.visual) writeFileSync(join(out, "visual.json"), JSON.stringify(visual.visual, null, 2));
    log(visual.notes.join(" "));

    if (opt.flows) {
      phase = "flows";
      const flow = await import(pathToFileURL(resolve(opt.flows)).href);
      try {
        const extra = (await flow.default(flowArgs({ webURL, apiURL, outDir: shots, repoRoot: root, worktree: wt.dir, session }))) ?? [];
        findings.push(...extra);
        log(`flows: ${extra.length} finding(s)`);
      } catch (error) {
        findings.push(stepFinding("A flow threw", String(error.stack ?? error).split("\n").slice(0, 3).join(" / "), "high"));
      }
    }

    // Last before the suites: a changed DELETE or POST may change the rows the sweep and the flows sign in with.
    let baseDoc = null;
    try {
      baseDoc = JSON.parse(sh("git", ["show", `${base}:apps/api/openapi.json`], { cwd: root }));
    } catch {}
    const headFile = join(wt.dir, "apps/api/openapi.json");
    const headDoc = existsSync(headFile) ? JSON.parse(readFileSync(headFile, "utf8")) : null;
    const endpoints = changedEndpoints(baseDoc, headDoc);
    phase = "endpoint calls";
    const calls = await callEndpoints({ apiURL, endpoints, doc: headDoc });
    for (const line of [...calls.called, ...calls.skipped]) log(`endpoint ${line}`);
    findings.push(...calls.findings);
    if (calls.called.length) notes.push(`Called the changed operations: ${calls.called.join("; ")}.`);
    if (calls.skipped.length) notes.push(`Not called: ${calls.skipped.join("; ")}.`);
    if (!endpoints.length) notes.push("No API operation changed.");

    if (opt.tests) {
      const unit = step("affected-tests", "npx", testsCommand({ base, sha }), { cwd: wt.dir, env });
      const f1 = testFinding({ name: "Affected unit tests", command: `npx ${testsCommand({ base: base.slice(0, 7), sha: sha.slice(0, 7) }).join(" ")}`, code: unit.code, tail: unit.tail });
      if (f1) findings.push(f1);
      if (existsSync(join(wt.dir, "apps/web-e2e/playwright.config.mts"))) {
        const e2e = step("e2e", "npx", ["playwright", "test", "-c", "apps/web-e2e/playwright.config.mts", "--workers=1", "--reporter=line"], { cwd: wt.dir, env: { ...env, BASE_URL: webURL } });
        const f2 = testFinding({ name: "End-to-end suite", command: `BASE_URL=${webURL} npx playwright test -c apps/web-e2e/playwright.config.mts --workers=1`, code: e2e.code, tail: e2e.tail });
        if (f2) findings.push(f2);
      }
    } else notes.push("Unit and end-to-end tests left to CI (Unit and integration tests, E2E tests; the merge gate waits for them).");

    return finish(screenshots);
  } catch (error) {
    findings.push(stepFinding("The tester run failed", String(error.stack ?? error).split("\n").slice(0, 3).join(" / ")));
    return finish();
  } finally {
    tearDown();
  }

  function finish(screenshots = []) {
    const v = verdict(findings);
    const blocking = findings.filter((f) => f.severity === "blocker" || f.severity === "high").length;
    const summary = `${v === "failure" ? `${blocking} blocking finding(s)` : "No blocking findings"}; ${findings.length} in all. Booted ${booted.join(", ") || "nothing"}.`;
    const report = { pr: Number(opt.pr), repo: info.repo, sha, base: info.base, lap: opt.lap, layout: true, routes: opt.routes, verdict: v, summary, findings, booted, notes, screenshots: screenshots.map((s) => relative(out, s)) };
    report.markdown = reportMarkdown({ pr: opt.pr, sha, verdict: v, findings, booted, screenshots, lap: opt.lap, notes });
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(out, "report.md"), report.markdown);
    log(`verdict ${v}: ${summary} Report: ${join(out, "report.md")}`);
    return v === "failure" ? 1 : 0;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}

