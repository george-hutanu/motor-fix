// Check a QA flows file before it is dispatched, with no browser (ST-1171).
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
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isEntryPoint } from "../lib/entry.mjs";

/** `US<k> scenario <m>` for every numbered acceptance scenario of every user story. */
export function scenarios(specText) {
  const out = [];
  let story = null;
  let inScenarios = false;
  for (const line of String(specText ?? "").split("\n")) {
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

/** Import the flows module and say whether it loaded with a function as its default export. */
async function load(file) {
  try {
    const mod = await import(`${pathToFileURL(resolve(file)).href}?precheck=${Date.now()}`);
    return { ok: true, isFunction: typeof mod.default === "function" };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).split("\n")[0] };
  }
}

/** The pre-check of a flows file on disk, against the spec at `spec` when there is one. */
export async function checkFlows({ flows, spec }) {
  const specText = spec && existsSync(spec) ? readFileSync(spec, "utf8") : null;
  return precheck({ flowsText: readFileSync(flows, "utf8"), specText, loaded: await load(flows), name: flows });
}

if (isEntryPoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const flows = flag("flows");
  if (!flows || !existsSync(flows)) {
    console.error("usage: precheck.mjs --flows <file.mjs> [--spec <spec.md>]");
    process.exit(64);
  }
  const problems = await checkFlows({ flows, spec: flag("spec") });
  for (const p of problems) console.log(p);
  process.exit(problems.length ? 1 : 0);
}
