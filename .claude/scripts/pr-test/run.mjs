#!/usr/bin/env node
// The PR tester's mechanical run, start to finish, inside one heavy-command
// slot: a worktree at the PR head, private services and apps on free ports,
// health, the API calls, the viewport sweep, the agent's flows, the affected
// tests and the end-to-end suite, a report — and teardown of everything it
// started, on success, on failure, and on SIGINT, SIGTERM or SIGHUP to this
// process (passed through heavy.sh to the inner run). SIGKILL cannot be
// caught: after one, `git worktree prune` and the run directory under the
// temp dir are what is left to clean.
//
// --allow-closed sweeps a merged or closed PR (dry runs looking back);
// --langs and --schemes narrow the matrix for a quick lap; --no-tests skips
// the test runs. The pr-tester agent uses none of them on a real review.
//
//   node .claude/scripts/pr-test/run.mjs <pr> [--routes /,/cockpit] [--flows <file.mjs>]
//        [--out <dir>] [--lap <n>] [--langs ro,en] [--schemes light,dark] [--no-tests] [--allow-closed]
//
// It posts nothing: the pr-tester agent adds its own findings and posts with
// post.mjs. The report lands in --out (default <tmp>/mf-prtest/<pr>-<sha7>).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { appsFor, changedGetEndpoints, endpointFinding, reportMarkdown, stepFinding, testFinding, touchesWeb, verdict } from "./findings.mjs";
import { appEnv, composePlan, freePorts, localPlan, waitForHttp } from "./services.mjs";
import { runSweep, toFindings } from "./sweep.mjs";
import { createWorktree, removeWorktree } from "./worktree.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const self = fileURLToPath(import.meta.url);

function args(argv) {
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
    tests: !argv.includes("--no-tests"),
    allowClosed: argv.includes("--allow-closed"),
  };
}

const sh = (cmd, list, opts = {}) => execFileSync(cmd, list, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const has = (cmd, list) => spawnSync(cmd, list, { stdio: "ignore" }).status === 0;

async function main(argv) {
  const opt = args(argv);
  if (!opt.pr) {
    console.error("usage: run.mjs <pr> [--routes …] [--flows file.mjs] [--out dir] [--lap n] [--no-tests]");
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

  const info = JSON.parse(sh("gh", ["pr", "view", opt.pr, "--json", "number,state,headRefOid,baseRefName,headRefName,url,mergeCommit"], { cwd: repoRoot }));
  if (info.state !== "OPEN" && !opt.allowClosed) {
    console.error(`run: PR #${opt.pr} is ${info.state}; nothing to test (--allow-closed to sweep it anyway)`);
    return 3;
  }
  info.repo = sh("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: repoRoot });
  const sha = info.headRefOid;
  const out = resolve(opt.out ?? join(tmpdir(), "mf-prtest", `${opt.pr}-${sha.slice(0, 7)}`));
  const shots = join(out, "shots");
  const logs = join(out, "logs");
  mkdirSync(shots, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const runDir = mkdtempSync(join(tmpdir(), `mf-prtest-${opt.pr}-`));
  const findings = [];
  const notes = [];
  const booted = [];
  const teardown = [];
  const log = (line) => {
    console.error(`run: ${line}`);
    writeFileSync(join(out, "run.log"), `${new Date().toISOString()} ${line}\n`, { flag: "a" });
  };

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
      log(`${signal}: tearing down`);
      tearDown();
      process.exit(130);
    });

  /** Run a step to a log file; a non-zero exit is a blocking finding and stops the run. */
  const step = (name, cmd, list, opts = {}) => {
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
    const wt = createWorktree({ repo: repoRoot, pr: opt.pr, sha, root: runDir });
    teardown.push({ name: `remove worktree ${wt.dir}`, run: () => removeWorktree({ repo: repoRoot, dir: wt.dir }) });
    log(`worktree ${wt.dir} at ${sha}`);

    sh("git", ["fetch", "--quiet", "origin", info.baseRefName], { cwd: repoRoot });
    // A merged PR (a dry run looking back) is measured against main as it was before the merge.
    const against = info.mergeCommit?.oid ? `${info.mergeCommit.oid}^1` : `origin/${info.baseRefName}`;
    const base = sh("git", ["merge-base", against, sha], { cwd: repoRoot });
    info.base = base;
    const files = sh("git", ["diff", "--name-only", `${base}...${sha}`], { cwd: repoRoot }).split("\n").filter(Boolean);
    const web = touchesWeb(files);
    const apps = appsFor(files);
    log(`${files.length} changed files; web code ${web ? "touched" : "untouched"}; worker ${apps.worker ? "booted" : "not needed"}`);

    const [pgPort, redisPort, minioPort, apiPort, webPort, workerPort] = await freePorts(6);
    const ports = { postgres: pgPort, redis: redisPort, minio: minioPort };
    const env = { ...process.env, ...appEnv({ ports }), NX_DAEMON: "false" };
    const project = `mf-prtest-${opt.pr}-${process.pid}`;
    let plan;
    if (has("docker", ["info"])) {
      plan = composePlan({ project, file: join(repoRoot, "docker-compose.yml"), ports });
      teardown.push({ name: `docker compose -p ${project} down -v`, run: () => sh("docker", plan.down, { env: { ...process.env, ...plan.env } }) });
      if (!mustPass("services", step("services", "docker", plan.up, { env: { ...process.env, ...plan.env } }))) return finish();
    } else {
      plan = localPlan({ dir: runDir, ports });
      notes.push("No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.");
      // PostgreSQL refuses to start under a locale the C library cannot load.
      const cEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
      teardown.push({ name: "stop private PostgreSQL and Redis", run: () => plan.stop.forEach(([c, ...l]) => spawnSync(c, l, { stdio: "ignore", env: cEnv })) });
      for (const [i, [cmd, ...list]] of plan.start.entries())
        if (!mustPass(`services-${i + 1}`, step(`services-${i + 1}`, cmd, list, { env: cEnv }))) return finish();
    }
    booted.push("postgres", "redis", ...(plan.storage ? ["minio"] : []));

    const sameLock = existsSync(join(repoRoot, "node_modules")) && readFileSync(join(repoRoot, "package-lock.json"), "utf8") === readFileSync(join(wt.dir, "package-lock.json"), "utf8");
    let install = { code: 1 };
    if (sameLock && process.platform === "darwin") install = step("install-clone", "cp", ["-cR", join(repoRoot, "node_modules"), join(wt.dir, "node_modules")]);
    if (install.code !== 0) install = step("install", "npm", ["ci", "--no-audit", "--no-fund"], { cwd: wt.dir, env });
    if (!mustPass("install", install)) return finish();
    if (!mustPass("prisma generate", step("prisma-generate", "npx", ["prisma", "generate", "--config", "libs/domain/prisma.config.ts"], { cwd: wt.dir, env }))) return finish();
    if (!mustPass("migrate", step("migrate", "npx", ["prisma", "migrate", "deploy", "--config", "libs/domain/prisma.config.ts"], { cwd: wt.dir, env }))) return finish();
    const projects = ["api", "web", ...(apps.worker ? ["worker"] : [])];
    if (!mustPass("build", step("build", "npx", ["nx", "run-many", "-t", "build", "-p", projects.join(","), "--parallel=1"], { cwd: wt.dir, env }))) return finish();

    const apiURL = `http://127.0.0.1:${apiPort}`;
    const webURL = `http://127.0.0.1:${webPort}`;
    const launch = (name, script, extra) => {
      const fd = openSync(join(logs, `${name}.out.log`), "w");
      const child = spawn(process.execPath, [script], { cwd: wt.dir, env: { ...env, ...extra }, stdio: ["ignore", fd, fd], detached: true });
      closeSync(fd);
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
    launch("api", "dist/apps/api/main.js", { PORT: String(apiPort) });
    launch("web", "dist/apps/web/server/server.mjs", { PORT: String(webPort), API_INTERNAL_URL: apiURL, PUBLIC_WEB_URL: webURL });
    if (apps.worker) launch("worker", "dist/apps/worker/main.js", { PORT: String(workerPort) });

    const live = [
      ["api", `${apiURL}/health/live`],
      ["web", `${webURL}/`],
      ...(apps.worker ? [["worker", `http://127.0.0.1:${workerPort}/health/live`]] : []),
    ];
    for (const [name, url] of live) {
      const h = await waitForHttp(url, { timeoutMs: 90000 });
      log(`health ${name}: ${h.ok ? `HTTP ${h.status}` : h.error}`);
      if (!h.ok) findings.push(stepFinding(`${name} did not come up`, `${h.error}; see ${join(logs, `${name}.out.log`)}`));
    }
    if (findings.length) return finish();

    for (const [name, origin] of [["api", apiURL], ...(apps.worker ? [["worker", `http://127.0.0.1:${workerPort}`]] : [])]) {
      const res = await fetch(`${origin}/health/ready`).catch((e) => ({ status: 0, text: async () => e.message }));
      const body = await res.text();
      log(`ready ${name}: ${res.status} ${body.slice(0, 200)}`);
      if (res.status === 200) continue;
      let failed = [];
      try {
        failed = Object.entries(JSON.parse(body).checks ?? {}).filter(([, v]) => v !== "ok").map(([k]) => k);
      } catch {}
      if (!plan.storage && failed.length === 1 && failed[0] === "storage")
        findings.push(stepFinding(`${name} readiness: storage down`, "No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.", "medium"));
      else findings.push(stepFinding(`${name} readiness failed: ${failed.join(", ") || res.status}`, `GET ${origin}/health/ready answered ${res.status}: ${body.slice(0, 300)}`));
    }

    let baseDoc = null;
    try {
      baseDoc = JSON.parse(sh("git", ["show", `${base}:apps/api/openapi.json`], { cwd: repoRoot }));
    } catch {}
    const headFile = join(wt.dir, "apps/api/openapi.json");
    const endpoints = existsSync(headFile) ? changedGetEndpoints(baseDoc, JSON.parse(readFileSync(headFile, "utf8"))) : [];
    for (const path of endpoints) {
      const res = await fetch(`${apiURL}${path}`).catch(() => ({ status: 599, text: async () => "no answer" }));
      const f = endpointFinding({ method: "GET", path, status: res.status, body: await res.text() });
      log(`GET ${path}: ${res.status}`);
      if (f) findings.push(f);
    }
    notes.push(endpoints.length ? `Called changed endpoints: ${endpoints.join(", ")}.` : "No changed GET endpoint without path parameters.");

    log(`sweep: ${opt.routes.join(", ")} × 3 viewports × ${opt.schemes.join("/")} × ${opt.langs.join("/")}`);
    const sweep = await runSweep({ baseURL: webURL, routes: opt.routes, outDir: shots, schemes: opt.schemes, langs: opt.langs, repoRoot });
    // Evidence relative to the report, so the report reads the same once copied into specs/.
    for (const f of toFindings(sweep.observations, { web, origins: [webURL, apiURL] }))
      findings.push(f.evidence ? { ...f, evidence: relative(out, f.evidence) } : f);
    writeFileSync(join(out, "observations.json"), JSON.stringify(sweep.observations, null, 2));
    const screenshots = sweep.screenshots;

    if (opt.flows) {
      const flow = await import(pathToFileURL(resolve(opt.flows)).href);
      try {
        const extra = (await flow.default({ baseURL: webURL, apiURL, outDir: shots, repoRoot, worktree: wt.dir })) ?? [];
        findings.push(...extra);
        log(`flows: ${extra.length} finding(s)`);
      } catch (error) {
        findings.push(stepFinding("A flow threw", String(error.stack ?? error).split("\n").slice(0, 3).join(" / "), "high"));
      }
    }

    if (opt.tests) {
      const unit = step("affected-tests", "npx", ["nx", "affected", "-t", "test", `--base=${base}`, `--head=${sha}`, "--parallel=1"], { cwd: wt.dir, env });
      const f1 = testFinding({ name: "Affected unit tests", command: `npx nx affected -t test --base=${base.slice(0, 7)} --head=${sha.slice(0, 7)}`, code: unit.code, tail: unit.tail });
      if (f1) findings.push(f1);
      if (existsSync(join(wt.dir, "apps/web-e2e/playwright.config.mts"))) {
        const e2e = step("e2e", "npx", ["playwright", "test", "-c", "apps/web-e2e/playwright.config.mts", "--workers=1", "--reporter=line"], { cwd: wt.dir, env: { ...env, BASE_URL: webURL } });
        const f2 = testFinding({ name: "End-to-end suite", command: `BASE_URL=${webURL} npx playwright test -c apps/web-e2e/playwright.config.mts --workers=1`, code: e2e.code, tail: e2e.tail });
        if (f2) findings.push(f2);
      }
    } else notes.push("Tests not run (--no-tests).");

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
    const report = { pr: Number(opt.pr), repo: info.repo, sha, base: info.base, lap: opt.lap, verdict: v, summary, findings, booted, notes, screenshots: screenshots.map((s) => relative(out, s)) };
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

