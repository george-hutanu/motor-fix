// The PR tester's packet: one small file that says what changed, so the tester
// starts there instead of re-reading the whole diff, report and screenshot set.
//
// Written into the folder dispatch.mjs downloaded the run into (`--out`), it
// holds the PR's changed files with their stat, the requirements the change
// touches, the run's verdict and findings, the previous lap's findings marked
// new, persisting or resolved, and the screenshots that differ from the
// baseline run (the last tested commit of the PR, or a run already on the base
// branch), or, when the run diffed its shots against main's (visual.json), the
// changed ones with their regions and diff/<shot>.png. The tester then opens
// only the screenshots it names.
//
//   node .claude/scripts/pr-test/packet.mjs --pr <n> --out <dir> [--repo o/r] [--run <id>] [--baseline <run-id|dir>]
// exits 0 with packet.md written (a section gh could not answer says so), 2
// when the folder has no report.json. The feature's tasks.md, spec.md and lap
// reports are read from the private specs repository's trunk (specs-repo.mjs),
// where its folder sits at the root: motor-fix does not track specs/.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chooseBaseline, parseRunName, readReport } from "./baseline.mjs";
import { findingKey as keyOf, isBlocking, touchesWeb } from "./findings.mjs";
import { realGh } from "./post.mjs";
import { SPECS_SLUG, TRUNK } from "../specs-repo.mjs";

export { parseRunName };

/** Changed files listed one per line before the rest are only counted. */
const FILE_CAP = 100;
const MAX_RANGE = 999;
/** One line of Markdown: a newline in a title or evidence would start a heading of its own. */
const flat = (s) => String(s ?? "").replace(/\s*[\r\n]+\s*/g, " ");
const IMAGE = /\.png$/i;
const short = (sha) => String(sha ?? "").slice(0, 7);
const reason = (res) => (res.stderr || res.stdout || `exit ${res.code}`).trim().split("\n")[0];
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Every FR id on a line, ranges such as `FR-001–FR-003` expanded. */
export function frIds(line) {
  const ids = [];
  for (const m of line.matchAll(/FR-(\d+)(?:\s*[–—-]\s*FR-(\d+))?/g)) {
    const from = Number(m[1]);
    const to = m[2] ? Math.min(Number(m[2]), from + MAX_RANGE) : from;
    for (let n = from; n <= to; n++) ids.push(`FR-${String(n).padStart(m[1].length, "0")}`);
  }
  return [...new Set(ids)];
}


/** The previous lap's findings sorted against the current ones by the key mergeFindings uses. */
export function findingDelta(prev, cur) {
  const before = new Map(prev.map((f) => [keyOf(f), f]));
  const now = new Set(cur.map(keyOf));
  return {
    persisting: cur.filter((f) => before.has(keyOf(f))),
    new: cur.filter((f) => !before.has(keyOf(f))),
    resolved: prev.filter((f) => !now.has(keyOf(f))),
  };
}

/**
 * Screenshots by content: `current` and `baseline` map a file name to its hash; `look` is what the tester opens.
 * A change with no web file (`web` false) cannot be what moved a screen, so only the cited ones are named.
 */
export function shotDelta({ current, baseline, cited, web = true }) {
  const names = Object.keys(current).sort();
  const only = [...new Set(cited)].sort();
  if (!baseline) return { changed: [], added: [], removed: [], unchanged: 0, look: web ? names : only };
  const changed = names.filter((n) => n in baseline && baseline[n] !== current[n]);
  const added = names.filter((n) => !(n in baseline));
  const removed = Object.keys(baseline)
    .filter((n) => !(n in current))
    .sort();
  const unchanged = names.length - changed.length - added.length;
  const look = web ? [...new Set([...changed, ...added, ...cited])].sort() : only;
  return { changed, added, removed, unchanged, look };
}

/** `shots/<name>` → sha256 of the bytes, for every file under `<dir>/shots`. */
function shotHashes(dir) {
  const root = join(dir, "shots");
  const out = {};
  const walk = (rel) => {
    for (const name of readdirSync(join(root, rel))) {
      const path = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(root, path));
      if (st.isDirectory()) walk(path);
      else if (st.isFile() && IMAGE.test(name)) out[`shots/${path}`] = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
    }
  };
  if (existsSync(root)) walk("");
  return out;
}

/** A file at the PR head through the contents API: { text } or { error }. */
function contents(gh, repo, path, ref, raw = true) {
  const args = ["api", ...(raw ? ["-H", "Accept: application/vnd.github.raw"] : []), `repos/${repo}/contents/${path}?ref=${ref}`];
  const res = gh(args);
  return res.code === 0 ? { text: res.stdout } : { error: reason(res) };
}

/**
 * A file of the feature's folder in the specs repository: `feature` is `specs/<branch>`. A moved trunk keeps
 * it under specs/, an old one at the root, so a 404 at the first is asked again at the second.
 */
function specsFile(gh, feature, path, raw = true) {
  const name = `${feature.replace(/^specs\//, "")}${path}`;
  const moved = contents(gh, SPECS_SLUG, `specs/${name}`, TRUNK, raw);
  return moved.error && /404|not found/i.test(moved.error) ? contents(gh, SPECS_SLUG, name, TRUNK, raw) : moved;
}

/** The FR ids on tasks.md lines naming a changed file, with their text from spec.md; { lines } or { note }. */
function requirements(gh, feature, paths) {
  const tasks = specsFile(gh, feature, "/tasks.md");
  if (tasks.error) return { note: `${feature}/tasks.md not found on ${SPECS_SLUG} ${TRUNK} (${tasks.error})` };
  const ids = [
    ...new Set(
      tasks.text
        .split("\n")
        .filter((l) => paths.some((p) => l.includes(p)))
        .flatMap(frIds),
    ),
  ];
  if (ids.length === 0) return { note: `no line of ${feature}/tasks.md names a changed file` };
  const spec = specsFile(gh, feature, "/spec.md");
  const text = new Map();
  for (const m of (spec.text ?? "").matchAll(/\*\*(FR-\d+)\*\*:?\s*(.*)/g)) text.set(m[1], m[2].trim());
  const lines = ids.map((id) => `- ${id}: ${text.get(id) ?? (spec.error ? `(spec.md unavailable: ${spec.error})` : "(not in spec.md)")}`);
  return { lines };
}

/** The newest committed lap report in the specs repository; { label, findings } or null. */
function committedLap(gh, feature) {
  const dir = specsFile(gh, feature, "/pr-review", false);
  const laps = (parseJson(dir.text ?? "") ?? [])
    .map((e) => Number(String(e.name).match(/^lap(\d+)$/)?.[1]))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  for (const n of laps) {
    const path = `${feature}/pr-review/lap${n}/report.json`;
    const report = parseJson(specsFile(gh, feature, `/pr-review/lap${n}/report.json`).text ?? "");
    if (report) return { label: path, findings: report.findings ?? [] };
  }
  return null;
}

const where = (f) => [f.route, [f.viewport, f.scheme, f.lang].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
const fullFinding = (f) =>
  [`- **${f.severity}** ${f.kind}: ${flat(f.title)}`, where(f) && `  - where: ${flat(where(f))}`, f.evidence && `  - evidence: ${flat(f.evidence)}`, f.steps?.length && `  - steps: ${flat(f.steps.join(" → "))}`]
    .filter(Boolean)
    .join("\n");
const brief = (f) => `- ${f.severity} ${f.kind}: ${flat(f.title)}${f.route ? ` (${flat(f.route)})` : ""}`;

/** run.log's last `ready <service>: <status> <json>` line per service, as one line. */
function readiness(dir) {
  const log = join(dir, "run.log");
  const last = new Map();
  if (existsSync(log))
    for (const m of readFileSync(log, "utf8").matchAll(/\bready (\w+): (\d{3}) (.*)$/gm)) {
      const checks = parseJson(m[3])?.checks;
      const detail = checks && typeof checks === "object" ? ` (${Object.entries(checks).map(([k, v]) => `${k} ${v}`).join(", ")})` : "";
      last.set(m[1], `${m[1]} ${m[2]}${flat(detail)}`);
    }
  return last.size ? [...last.values()].join(" · ") : "not in run.log";
}

/** packet.md's text from its parts. */
function packetMarkdown({ pr, report, view, viewError, reqs, prev, baseline, delta, visual, cited = [], web = true, ready }) {
  const out = [`# Packet: PR #${pr} at ${short(view?.headRefOid ?? report.sha)}, lap ${report.lap ?? "?"}`, ""];
  if (view) out.push(`${flat(view.title)} · branch ${view.headRefName} · head ${view.headRefOid} · base ${view.baseRefName}`, "");
  out.push("## Changed files", "");
  if (viewError) out.push(`Unavailable: ${viewError}`);
  else {
    const files = view.files ?? [];
    const sum = (k) => files.reduce((n, f) => n + (f[k] ?? 0), 0);
    out.push(`${files.length} files, +${sum("additions")} −${sum("deletions")}`, "");
    for (const f of files.slice(0, FILE_CAP)) out.push(`- ${f.path} +${f.additions ?? 0} −${f.deletions ?? 0}`);
    if (files.length > FILE_CAP) out.push(`- … ${files.length - FILE_CAP} more files`);
  }
  out.push("", "## Requirements touched", "", ...(reqs.lines ?? [reqs.note]));
  const findings = report.findings ?? [];
  out.push("", "## Run", "", `Verdict: ${report.verdict} — ${flat(report.summary)}`.trim());
  for (const n of report.notes ?? []) out.push(`- note: ${flat(n)}`);
  out.push(`- readiness: ${ready}`);
  out.push("", "### Blocking findings", "");
  const blocking = findings.filter(isBlocking);
  out.push(...(blocking.length ? blocking.map(fullFinding) : ["None."]));
  const rest = findings.filter((f) => !isBlocking(f));
  if (rest.length) out.push("", "### Other findings", "", ...rest.map(brief));
  out.push("", "## Previous lap", "");
  if (!prev) out.push("None: no committed lap report and no baseline run of this PR.");
  else {
    out.push(`From ${prev.label}.`, "");
    const d = findingDelta(prev.findings, findings);
    for (const [label, list] of [
      ["persisting", d.persisting],
      ["new", d.new],
      ["resolved", d.resolved],
    ])
      for (const f of list) out.push(`- ${label}: ${f.severity} ${flat(f.title)}${f.route ? ` (${flat(f.route)})` : ""}`);
    if (!findings.length && !prev.findings.length) out.push("No findings on either lap.");
  }
  out.push("", "## Baseline", "");
  out.push(baseline.none ? `No baseline: ${baseline.none}.` : `Baseline: ${baseline.label}.`);
  for (const s of baseline.skipped ?? []) out.push(`- skipped ${s}`);
  out.push("", "## Screenshots", "");
  if (visual) {
    const shots = Object.entries(visual.shots ?? {});
    const of = (st) => shots.filter(([, v]) => v.status === st).map(([n]) => n);
    const changed = of("changed");
    out.push(
      `Pixel diff against run ${visual.baseline?.run} of ${short(visual.baseline?.sha)}: changed ${changed.length} · new ${of("new").length} · removed ${of("removed").length} · identical ${of("identical").length}`,
      "",
      "Look at only these:",
    );
    const others = cited.filter((n) => !changed.includes(n));
    const added = web ? of("new") : [];
    for (const n of changed) {
      const v = visual.shots[n];
      out.push(`- ${n}: ${v.regions.length} region(s) ${v.regions.map((r) => `${r.width}×${r.height}@${r.x},${r.y}`).join(" ")}; outlined in ${v.diff}`);
    }
    for (const n of [...new Set([...added, ...others])].sort()) out.push(`- ${n}`);
    if (!changed.length && !added.length && !others.length) out.push("- none");
    return `${out.join("\n")}\n`;
  }
  if (!baseline.none) {
    out.push(`changed ${delta.changed.length} · new ${delta.added.length} · removed ${delta.removed.length} · unchanged ${delta.unchanged}`);
    for (const n of delta.removed) out.push(`- removed: ${n}`);
    out.push("");
  }
  if (!web)
    out.push(
      "The change touches no web file, so a screenshot that differs comes from main or from what the screen shows at run time, not from this PR. Look at only these (the ones a finding cites):",
    );
  else out.push(baseline.none ? "No baseline, so look at every screenshot:" : "Look at only these:");
  out.push(...(delta.look.length ? delta.look.map((n) => `- ${n}`) : ["- none"]));
  return `${out.join("\n")}\n`;
}

/** Writes `<out>/packet.md`; { code, path }. */
export function buildPacket({ out, pr, repo, run, baseline: explicit, gh = realGh }) {
  const report = readReport(out);
  if (!report) return { code: 2, error: `${out} has no report.json` };
  repo ??= report.repo;
  const res = gh(["pr", "view", String(pr), "--repo", repo, "--json", "number,title,headRefName,headRefOid,baseRefName,files"]);
  const view = res.code === 0 ? parseJson(res.stdout) : null;
  const viewError = view ? null : `gh pr view failed: ${reason(res)}`;
  const head = view?.headRefOid ?? report.sha ?? "";
  const feature = view ? `specs/${view.headRefName}` : null;
  const reqs = feature ? requirements(gh, feature, (view.files ?? []).map((f) => f.path)) : { note: `Unavailable: ${viewError}` };
  const baseline = chooseBaseline({ gh, repo, pr: Number(pr), head, base: view?.baseRefName, run, explicit });
  try {
    const committed = feature ? committedLap(gh, feature) : null;
    const prev =
      committed ??
      (baseline.report?.pr === Number(pr) ? { label: `${baseline.label} (the workflow's findings only)`, findings: baseline.report.findings ?? [] } : null);
    const cited = (report.findings ?? []).flatMap((f) => String(f.evidence ?? "").match(/shots\/\S+?\.png/g) ?? []);
    const web = view?.files?.length ? touchesWeb(view.files.map((f) => f.path)) : true;
    const delta = shotDelta({ current: shotHashes(out), baseline: baseline.dir ? shotHashes(baseline.dir) : null, cited, web });
    // The run's own pixel diff (baseline.mjs), when the workflow had a baseline; the byte hashes otherwise.
    const visual = existsSync(join(out, "visual.json")) ? parseJson(readFileSync(join(out, "visual.json"), "utf8")) : null;
    const path = join(out, "packet.md");
    writeFileSync(path, packetMarkdown({ pr, report, view, viewError, reqs, prev, baseline, delta, visual, cited, web, ready: readiness(out) }));
    return { code: 0, path };
  } finally {
    if (baseline.temp) rmSync(baseline.dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!/^\d+$/.test(opt.pr ?? "") || !opt.out) {
    console.error("usage: packet.mjs --pr <n> --out <dir> [--repo o/r] [--run <id>] [--baseline <run-id|dir>]");
    return 2;
  }
  const res = buildPacket({ out: opt.out, pr: Number(opt.pr), repo: opt.repo, run: opt.run, baseline: opt.baseline });
  if (res.code) console.error(res.error);
  else console.log(res.path);
  return res.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
