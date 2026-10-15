// Check a QA flows file before it is dispatched, with no browser.
//
//   node .claude/scripts/pr-test/precheck.mjs --flows <file.mjs> [--spec <spec.md>]
//
// Lap 1 failed on every PR measured, and most of its blocking findings were
// the flows' own: a `networkidle` wait, which never settles while live
// updates keep a connection open, and acceptance scenarios no flow drove.
// This names them before a run is spent on them: the module must load with a
// function as its default export, wait for no `networkidle`, and name every
// acceptance scenario of the spec (`US<k> scenario <m>`, the numbered
// Acceptance Scenarios of each user story), in a flow or in a
// `// not a flow: US<k> scenario <m> — <reason>` line. One line per problem;
// exit 0 clean, 1 on any problem, 64 on a usage error. dispatch.mjs --flows
// runs the same check and dispatches nothing while it fails.
// The flows file is the dispatching agent's own: loading it runs its top level
// here, in this process and its environment, not in the workflow's sandbox.
//
//   node .claude/scripts/pr-test/precheck.mjs --flows <file.mjs> --check [--base-url <url>] [--api-url <url>]
//
// --check also runs the flows, once, against the app and API already serving
// there (by default the dev server, http://localhost:4200, and the API,
// http://localhost:3000), with the arguments the run gives them and a real
// signIn as the seeded accounts. It prints one line per finding, thrown error
// and unhandled rejection, exit 1 on any; an address that does not answer is
// one line and exit 1, and the flows are not run; flows still running after
// ten minutes are one line too. It starts no server and dispatches nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isEntryPoint } from "../lib/entry.mjs";
import { seededSession } from "./endpoints.mjs";
import { collectRejections, flowArgs } from "./run.mjs";
import { HEALTH } from "./services.mjs";

export const CHECK_DEFAULTS = { baseURL: "http://localhost:4200", apiURL: "http://localhost:3000" };
// A flow awaiting what never settles would hold the check for ever; a lap's own bound is the job's 60 minutes.
const CHECK_MS = 10 * 60_000;

/** `US<k> scenario <m>` for every numbered acceptance scenario of every user story. */
export function scenarios(specText) {
  const out = [];
  let story = null;
  let inScenarios = false;
  for (const line of String(specText ?? "").split(/\r?\n/)) {
    const heading = line.match(/^#{2,3}\s+(.*)$/);
    if (heading) {
      story = heading[1].match(/^User Story (\d+)\b/)?.[1] ?? null;
      inScenarios = false;
      continue;
    }
    if (!story) continue;
    if (/^\*\*Acceptance Scenarios\*\*/.test(line)) inScenarios = true;
    else if (/^\*\*[^*]+\*\*/.test(line)) inScenarios = false;
    const n = inScenarios && line.match(/^(\d+)\.\s/);
    if (n) out.push(`US${story} scenario ${n[1]}`);
  }
  return out;
}

const NOT_A_FLOW = /not a flow:/;
const REASONED = /not a flow:\s*(?:US\d+ scenario \d+[,;\s]*)+\s*[—–-]\s*\S/;

/** The problems with a flows file, one line each; empty when it is fit to dispatch. */
export function precheck({ flowsText, specText, loaded, name = "flows" }) {
  const problems = [];
  if (!loaded.ok) problems.push(`${name} does not load: ${loaded.error}`);
  else if (!loaded.isFunction) problems.push(`${name}: the default export is not a function`);
  const lines = String(flowsText).split("\n");
  lines.forEach((line, i) => {
    if (/networkidle/.test(line)) problems.push(`${name}:${i + 1}: waits for networkidle, which never settles while live updates keep a connection open; wait for 'load' or a visible element`);
  });
  if (specText) {
    // A `not a flow` line covers its scenarios only with a reason.
    const text = lines.filter((l) => !NOT_A_FLOW.test(l) || REASONED.test(l)).join("\n");
    for (const s of scenarios(specText)) {
      if (!new RegExp(`\\b${s}(?!\\d)`).test(text)) problems.push(`scenario not covered: ${s} (name it in a flow, or add \`// not a flow: ${s} — <reason>\`)`);
    }
  }
  return problems;
}

// A flows file is imported once per content: its top level runs once for the static and the live check,
// and again only after the file changed.
const modules = new Map();
const importFlows = (file) => {
  const key = `${pathToFileURL(resolve(file)).href}?precheck=${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)}`;
  if (!modules.has(key)) modules.set(key, import(key));
  return modules.get(key);
};

/** Import the flows module and say whether it loaded with a function as its default export. */
async function load(file) {
  try {
    const mod = await importFlows(file);
    return { ok: true, isFunction: typeof mod.default === "function" };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).split("\n")[0] };
  }
}

/** The pre-check of a flows file on disk, against the spec at `spec` when there is one. */
export async function checkFlows({ flows, spec, specRequired = false }) {
  if (spec && specRequired && !existsSync(spec)) return [`spec not found: ${spec}`];
  const specText = spec && existsSync(spec) ? readFileSync(spec, "utf8") : null;
  return precheck({ flowsText: readFileSync(flows, "utf8"), specText, loaded: await load(flows), name: flows });
}

/** Why an address does not serve, or null when it answers below 500. */
async function unreachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    await res.body?.cancel();
    return res.status < 500 ? null : `HTTP ${res.status}`;
  } catch (error) {
    return String(error.cause?.code ?? error.message);
  }
}

/** Runs the flows once against the app and API at these addresses; one line per problem, empty when clean. */
export async function checkLive({ flows, baseURL = CHECK_DEFAULTS.baseURL, apiURL = CHECK_DEFAULTS.apiURL }) {
  const lines = [];
  for (const [name, url] of [
    ["app", `${baseURL}/`],
    ["API", apiURL + HEALTH.live],
  ]) {
    const why = await unreachable(url);
    if (why) lines.push(`${name} not serving at ${url}: ${why}`);
  }
  if (lines.length) return lines;
  const flow = await importFlows(flows);
  const outDir = mkdtempSync(join(tmpdir(), "mf-flows-check-"));
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const findings = [];
  try {
    const args = flowArgs({ webURL: baseURL, apiURL, outDir, repoRoot, worktree: repoRoot, session: seededSession(apiURL) });
    let timer;
    const bound = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the flows did not finish within ${CHECK_MS / 1000} s`)), CHECK_MS);
    });
    try {
      findings.push(...((await collectRejections(findings, () => Promise.race([flow.default(args), bound]))) ?? []));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    lines.push(`flows threw: ${String(error?.stack ?? error).split("\n").slice(0, 3).join(" / ")}`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  for (const f of findings) lines.push(`finding ${f.severity}: ${f.title}${f.steps?.length ? ` — ${f.steps.join(" / ")}` : ""}`);
  return lines;
}

if (isEntryPoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const flows = flag("flows");
  if (!flows || !existsSync(flows)) {
    console.error("usage: precheck.mjs --flows <file.mjs> [--spec <spec.md>] [--check [--base-url <url>] [--api-url <url>]]");
    process.exit(64);
  }
  const problems = await checkFlows({ flows, spec: flag("spec"), specRequired: true });
  if (argv.includes("--check") && !problems.some((p) => p.startsWith(`${flows} does not load`) || p.includes("default export")))
    problems.push(...(await checkLive({ flows, baseURL: flag("base-url"), apiURL: flag("api-url") })));
  for (const p of problems) console.log(p);
  process.exit(problems.length ? 1 : 0);
}
