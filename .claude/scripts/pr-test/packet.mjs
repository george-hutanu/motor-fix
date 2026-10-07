// The PR tester's packet: one small file that says what changed, so the tester
// starts there instead of re-reading the whole diff, report and screenshot set.
//
// Written into the folder dispatch.mjs downloaded the run into (`--out`), it
// holds the PR's changed files with their stat, the requirements the change
// touches, the run's verdict and findings, the previous lap's findings marked
// new, persisting or resolved, and the screenshots that differ from the
// baseline run (the last tested commit of the PR, or a run already on the base
// branch). The tester then opens only the screenshots it names.
//
//   node .claude/scripts/pr-test/packet.mjs --pr <n> --out <dir> [--repo o/r] [--run <id>] [--baseline <run-id|dir>]
// exits 0 with packet.md written (a section gh could not answer says so), 2
// when the folder has no report.json. The feature's tasks.md, spec.md and lap
// reports are read from the private specs repository's trunk (specs-repo.mjs),
// where its folder sits at the root: motor-fix does not track specs/.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { artifactName, WORKFLOW } from "./dispatch.mjs";
import { findingKey as keyOf, isBlocking, touchesWeb } from "./findings.mjs";
import { realGh } from "./post.mjs";
import { SPECS_SLUG, TRUNK } from "../specs-repo.mjs";

/** Changed files listed one per line before the rest are only counted. */
const FILE_CAP = 100;
/** PR QA runs read when looking for a baseline, newest first. */
const RUN_LIMIT = 100;
const FINISHED = new Set(["success", "failure"]);
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

/** The tested PR, head and lap a PR QA run's title (`run-name`) carries. */
export function parseRunName(title) {
  const m = String(title ?? "").match(/PR QA #(\d+) at ([0-9a-f]{7,40}) lap (\d+)/);
  return m ? { pr: Number(m[1]), sha: m[2], lap: Number(m[3]) } : null;
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

const readReport = (dir) => (existsSync(join(dir, "report.json")) ? parseJson(readFileSync(join(dir, "report.json"), "utf8")) : null);

/** A file at the PR head through the contents API: { text } or { error }. */
function contents(gh, repo, path, ref, raw = true) {
  const args = ["api", ...(raw ? ["-H", "Accept: application/vnd.github.raw"] : []), `repos/${repo}/contents/${path}?ref=${ref}`];
  const res = gh(args);
  return res.code === 0 ? { text: res.stdout } : { error: reason(res) };
}

/** Downloads a run's artifact; { dir, report } or { error }. */
function download(gh, repo, id, pr) {
  const dir = mkdtempSync(join(tmpdir(), "packet-baseline-"));
  const res = gh(["run", "download", String(id), "--repo", repo, "-n", artifactName(pr), "-D", dir]);
  const report = res.code === 0 ? readReport(dir) : null;
  if (report) return { dir, report };
  rmSync(dir, { recursive: true, force: true });
  return { error: res.code === 0 ? "the artifact has no report.json" : `download failed (expired?): ${reason(res)}` };
}

/** The baseline run, by the order the spec gives; { id, dir, report, temp } or { none: reason }, plus the skipped candidates. */
function chooseBaseline({ gh, repo, pr, head, base, run, explicit }) {
  const skipped = [];
  if (explicit) {
    if (existsSync(explicit) && statSync(explicit).isDirectory()) {
      const report = readReport(explicit);
      return report ? { dir: explicit, report, label: `folder ${explicit} · PR #${report.pr} · commit ${short(report.sha)} · lap ${report.lap}`, skipped } : { none: `${explicit} has no report.json`, skipped };
    }
    const got = download(gh, repo, explicit, pr);
    return got.error ? { none: `run ${explicit}: ${got.error}`, skipped } : { ...got, temp: true, label: `run ${explicit} · PR #${got.report.pr} · commit ${short(got.report.sha)} · lap ${got.report.lap}`, skipped };
  }
  const list = gh(["run", "list", "--repo", repo, "--workflow", WORKFLOW, "--json", "databaseId,displayTitle,conclusion,createdAt", "--limit", String(RUN_LIMIT)]);
  if (list.code !== 0) return { none: `unavailable: gh run list failed: ${reason(list)}`, skipped };
  const runs = (parseJson(list.stdout) ?? [])
    .map((r) => ({ ...r, ...parseRunName(r.displayTitle) }))
    .filter((r) => r.pr)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const before = runs.find((r) => String(r.databaseId) === String(run))?.createdAt;
  const tried = new Set();
  const attempt = (r) => {
    tried.add(r.databaseId);
    const got = download(gh, repo, r.databaseId, r.pr);
    if (got.error) {
      skipped.push(`run ${r.databaseId}: ${got.error}`);
      return null;
    }
    return { ...got, temp: true, label: `run ${r.databaseId} · PR #${r.pr} · commit ${short(got.report.sha ?? r.sha)} · lap ${got.report.lap ?? r.lap}`, skipped };
  };
  const candidates = runs.filter((r) => {
    if (String(r.databaseId) === String(run)) return false;
    if (before && r.createdAt >= before) return false;
    if (!FINISHED.has(r.conclusion)) return false;
    return !head.startsWith(r.sha);
  });
  for (const r of candidates.filter((c) => c.pr === pr)) {
    const got = attempt(r);
    if (got) return got;
  }
  if (!base) return { none: "no earlier run of this PR, and the base branch is unknown", skipped };
  for (const r of candidates.filter((c) => !tried.has(c.databaseId))) {
    const cmp = gh(["api", `repos/${repo}/compare/${base}...${r.sha}`]);
    const status = cmp.code === 0 ? parseJson(cmp.stdout)?.status : null;
    if (status !== "behind" && status !== "identical") continue;
    const got = attempt(r);
    if (got) return got;
  }
  return { none: `no finished run of this PR at another head, nor of a commit on ${base}`, skipped };
}

/** The FR ids on tasks.md lines naming a changed file, with their text from spec.md; { lines } or { note }. */
/** A file of the feature's folder in the specs repository: `feature` is `specs/<branch>`. */
const specsFile = (gh, feature, path, raw = true) => contents(gh, SPECS_SLUG, `${feature.replace(/^specs\//, "")}${path}`, TRUNK, raw);

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

/**
 * Writes `<out>/review.diff`: the PR's diff without the feature's own records and the
 * capability files, which the packet already sums up, but with its `tasks.md`.
 * { files, lines } or { error }.
 */
function reviewDiff(gh, repo, pr, feature, out) {
  const res = gh(["pr", "diff", String(pr), "--repo", repo]);
  if (res.code !== 0) {
    rmSync(join(out, "review.diff"), { force: true });
    return { error: `gh pr diff failed: ${reason(res)}` };
  }
  const tasks = feature ? `${feature}/tasks.md` : null;
  const kept = res.stdout
    .split(/^(?=diff --git )/m)
    .filter((c) => c.startsWith("diff --git "))
    .filter((c) => {
      const path = c.match(/^diff --git a\/\S+ b\/(\S+)/)?.[1] ?? "";
      return path === tasks || !(path.startsWith("specs/") || path.startsWith(".specify/capabilities/"));
    });
  const text = kept.join("");
  writeFileSync(join(out, "review.diff"), text);
  return { files: kept.length, lines: text.split("\n").length - 1 };
}

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
function packetMarkdown({ pr, report, view, viewError, reqs, prev, baseline, delta, web = true, ready, diff }) {
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
  out.push("", "## Review diff", "");
  out.push(
    diff.error
      ? `Unavailable: ${flat(diff.error)}`
      : `review.diff: ${diff.files} files, ${diff.lines} lines (the code, its tests and tasks.md; not the feature's other records or the capability files)`,
  );
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
    const diff = view ? reviewDiff(gh, repo, pr, feature, out) : { error: viewError };
    const path = join(out, "packet.md");
    writeFileSync(path, packetMarkdown({ pr, report, view, viewError, reqs, prev, baseline, delta, web, ready: readiness(out), diff }));
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
