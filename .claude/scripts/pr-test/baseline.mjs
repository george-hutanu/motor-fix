// The baseline a PR QA run is compared with, and the comparison.
//
// chooseBaseline finds an earlier PR QA run whose artifact is still there:
// with `prefer: "base"` (the visual diff) the newest finished run of a commit
// already on the base branch first, then this PR's earlier run; with
// `prefer: "pr"` (the tester's packet) the other way round. main is never
// booted a second time: a merge with --merge keeps every tested PR head on
// main, so the last run of one is main's picture of each screen.
//
// diffShots compares each screenshot with its baseline namesake on a grid of
// 16 px cells: a cell where any pixel moved by more than `tolerance` on a
// channel is changed, neighbouring changed cells join into one region, and a
// region of fewer than `minCells` cells is noise (anti-aliasing, a caret).
// A shot with regions gets diff/<shot>.png, the current shot with each region
// outlined; nothing else is written.
//
//   node .claude/scripts/pr-test/baseline.mjs --pr <n> --head <sha> --out <dir> [--repo o/r] [--base main]
// prints `baseline: run <id> · PR #n · commit <sha7> · lap <n>` or `no baseline: <reason>`,
// writes <out>/baseline.json either way, and exits 0 either way: a missing
// baseline is a note in the report, never a failed run.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { artifactName, WORKFLOW } from "./dispatch.mjs";

/** PR QA runs read when looking for a baseline, newest first. */
const RUN_LIMIT = 100;
const FINISHED = new Set(["success", "failure"]);
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

/** The tested PR, head and lap a PR QA run's title (`run-name`) carries. */
export function parseRunName(title) {
  const m = String(title ?? "").match(/PR QA #(\d+) at ([0-9a-f]{7,40}) lap (\d+)/);
  return m ? { pr: Number(m[1]), sha: m[2], lap: Number(m[3]) } : null;
}

export const readReport = (dir) => (existsSync(join(dir, "report.json")) ? parseJson(readFileSync(join(dir, "report.json"), "utf8")) : null);

/** The findings of the baseline run's report, or none. */
export const baselineFindings = (dir) => readReport(dir)?.findings ?? [];

/** Downloads a run's artifact; { dir, report } or { error }. */
function download(gh, repo, id, pr) {
  const dir = mkdtempSync(join(tmpdir(), "pr-qa-baseline-"));
  const res = gh(["run", "download", String(id), "--repo", repo, "-n", artifactName(pr), "-D", dir]);
  const report = res.code === 0 ? readReport(dir) : null;
  if (report) return { dir, report };
  rmSync(dir, { recursive: true, force: true });
  return { error: res.code === 0 ? "the artifact has no report.json" : `download failed (expired?): ${reason(res)}` };
}

/**
 * The baseline run; { id, dir, report, temp, label, skipped } or { none: reason, skipped }.
 * `explicit` is a run id or a folder already holding a report; `run` is the run being judged, never its own baseline.
 */
export function chooseBaseline({ gh, repo, pr, head, base, run, explicit, prefer = "pr" }) {
  const skipped = [];
  if (explicit) {
    if (existsSync(explicit) && statSync(explicit).isDirectory()) {
      const report = readReport(explicit);
      return report ? { dir: explicit, report, label: `folder ${explicit} · PR #${report.pr} · commit ${short(report.sha)} · lap ${report.lap}`, skipped } : { none: `${explicit} has no report.json`, skipped };
    }
    const got = download(gh, repo, explicit, pr);
    return got.error ? { none: `run ${explicit}: ${got.error}`, skipped } : { ...got, id: explicit, temp: true, label: `run ${explicit} · PR #${got.report.pr} · commit ${short(got.report.sha)} · lap ${got.report.lap}`, skipped };
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
    return { ...got, id: r.databaseId, temp: true, label: `run ${r.databaseId} · PR #${r.pr} · commit ${short(got.report.sha ?? r.sha)} · lap ${got.report.lap ?? r.lap}`, skipped };
  };
  const candidates = runs.filter((r) => {
    if (String(r.databaseId) === String(run)) return false;
    if (before && r.createdAt >= before) return false;
    if (!FINISHED.has(r.conclusion)) return false;
    return !head.startsWith(r.sha);
  });
  const ownRuns = () => {
    for (const r of candidates.filter((c) => c.pr === pr && !tried.has(c.databaseId))) {
      const got = attempt(r);
      if (got) return got;
    }
    return null;
  };
  const baseRuns = () => {
    if (!base) return null;
    for (const r of candidates.filter((c) => c.pr !== pr && !tried.has(c.databaseId))) {
      const cmp = gh(["api", `repos/${repo}/compare/${base}...${r.sha}`]);
      const status = cmp.code === 0 ? parseJson(cmp.stdout)?.status : null;
      if (status !== "behind" && status !== "identical") continue;
      const got = attempt(r);
      if (got) return got;
    }
    return null;
  };
  const order = prefer === "base" ? [baseRuns, ownRuns] : [ownRuns, baseRuns];
  for (const step of order) {
    const got = step();
    if (got) return got;
  }
  if (!base && prefer === "pr") return { none: "no earlier run of this PR, and the base branch is unknown", skipped };
  return { none: `no finished run of this PR at another head, nor of a commit on ${base ?? "the base branch"}`, skipped };
}

/** The workflow step: the chosen artifact copied into `out`, with baseline.json saying which run it is (or why none). */
export function fetchBaseline({ gh, repo, pr, head, base, out }) {
  mkdirSync(out, { recursive: true });
  const got = chooseBaseline({ gh, repo, pr, head, base, prefer: "base" });
  try {
    if (got.none) {
      writeFileSync(join(out, "baseline.json"), JSON.stringify({ none: got.none, skipped: got.skipped }, null, 2));
      return { line: `no baseline: ${got.none}` };
    }
    cpSync(got.dir, out, { recursive: true });
    const meta = { run: got.id, pr: got.report.pr, sha: got.report.sha, lap: got.report.lap };
    writeFileSync(join(out, "baseline.json"), JSON.stringify(meta, null, 2));
    return { line: `baseline: ${got.label}` };
  } finally {
    if (got.temp) rmSync(got.dir, { recursive: true, force: true });
  }
}

/** `shots/<path>` for every PNG under `<dir>/shots`. */
function shotNames(dir) {
  const root = join(dir, "shots");
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(root, rel))) {
      const path = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(root, path));
      if (st.isDirectory()) walk(path);
      else if (st.isFile() && IMAGE.test(name)) out.push(`shots/${path}`);
    }
  };
  if (existsSync(root)) walk("");
  return out.sort();
}

/** Changed cells of two RGBA buffers over their shared area, joined into regions of at least `minCells` cells. */
function regionsOf(a, b, { cell, tolerance, minCells }) {
  const width = Math.min(a.info.width, b.info.width);
  const height = Math.min(a.info.height, b.info.height);
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const changed = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const ra = y * a.info.width * 4;
    const rb = y * b.info.width * 4;
    for (let x = 0; x < width; x++) {
      const c = Math.floor(y / cell) * cols + Math.floor(x / cell);
      if (changed[c]) continue;
      const i = ra + x * 4;
      const j = rb + x * 4;
      for (let k = 0; k < 4; k++)
        if (Math.abs(a.data[i + k] - b.data[j + k]) > tolerance) {
          changed[c] = 1;
          break;
        }
    }
  }
  const regions = [];
  const seen = new Uint8Array(cols * rows);
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let cells = 0;
    let [x0, y0, x1, y1] = [cols, rows, -1, -1];
    while (stack.length) {
      const c = stack.pop();
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      cells++;
      [x0, y0, x1, y1] = [Math.min(x0, cx), Math.min(y0, cy), Math.max(x1, cx), Math.max(y1, cy)];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const n = ny * cols + nx;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && changed[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (cells < minCells) continue;
    const x = x0 * cell;
    const y = y0 * cell;
    regions.push({ x, y, width: Math.min((x1 + 1) * cell, width) - x, height: Math.min((y1 + 1) * cell, height) - y });
  }
  // A page that grew or shrank: the rows or columns only one side has.
  if (a.info.height !== b.info.height) regions.push({ x: 0, y: height, width: Math.max(a.info.width, b.info.width), height: Math.abs(a.info.height - b.info.height) });
  if (a.info.width !== b.info.width) regions.push({ x: width, y: 0, width: Math.abs(a.info.width - b.info.width), height });
  return regions;
}

/**
 * Every screenshot of `currentDir` against `baselineDir`, by name:
 * { "shots/x.png": { status: identical|changed|new|removed, regions?, diff? } }.
 */
export async function diffShots(currentDir, baselineDir, outDir, { cell = 16, tolerance = 24, minCells = 2 } = {}) {
  const sharp = createRequire(import.meta.url)("sharp");
  const current = shotNames(currentDir);
  const before = new Set(shotNames(baselineDir));
  const out = {};
  for (const name of current) {
    if (!before.has(name)) {
      out[name] = { status: "new" };
      continue;
    }
    const raw = (dir) => sharp(join(dir, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const [a, b] = await Promise.all([raw(currentDir), raw(baselineDir)]);
    const regions = regionsOf(a, b, { cell, tolerance, minCells });
    if (!regions.length) {
      out[name] = { status: "identical" };
      continue;
    }
    const diff = `diff/${name.replace(/^shots\//, "")}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${a.info.width}" height="${Math.max(a.info.height, b.info.height)}">${regions
      .map((r) => `<rect x="${r.x + 1}" y="${r.y + 1}" width="${Math.max(r.width - 2, 1)}" height="${Math.max(r.height - 2, 1)}" fill="rgba(255,0,0,0.12)" stroke="#e00" stroke-width="2"/>`)
      .join("")}</svg>`;
    mkdirSync(dirname(join(outDir, diff)), { recursive: true });
    await sharp(join(currentDir, name))
      .extend({ bottom: Math.max(0, b.info.height - a.info.height), background: "#ffffff" })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toFile(join(outDir, diff));
    out[name] = { status: "changed", regions, diff };
  }
  for (const name of before) if (!(name in out)) out[name] = { status: "removed" };
  return out;
}

/**
 * The report's notes and findings from the diff: `meta` is baseline.json, `shots` diffShots' answer (null without a baseline).
 * A changed screen on a PR that touches no web file was not meant: a medium finding citing its diff.
 */
export function visualOutcome({ meta, shots, web }) {
  if (!meta || meta.none || !shots) return { notes: [`No baseline: ${meta?.none ?? "none was downloaded"}; every shot is new.`], findings: [], visual: null };
  const by = (s) => Object.values(shots).filter((v) => v.status === s).length;
  const notes = [`Visual: ${by("changed")} changed, ${by("identical")} identical, ${by("new")} new against run ${meta.run} of ${short(meta.sha)}.`];
  const findings = web
    ? []
    : Object.entries(shots)
        .filter(([, v]) => v.status === "changed")
        .map(([name, v]) => ({ kind: "visual", severity: "medium", title: `Unintended visual change: ${name}, ${v.regions.length} region${v.regions.length === 1 ? "" : "s"}`, evidence: v.diff, key: `visual|${name}` }));
  return { notes, findings, visual: { baseline: meta, shots } };
}

async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!/^\d+$/.test(opt.pr ?? "") || !opt.out || !opt.head) {
    console.error("usage: baseline.mjs --pr <n> --head <sha> --out <dir> [--repo o/r] [--base main]");
    return 2;
  }
  const { realGh } = await import("./post.mjs");
  const res = fetchBaseline({ gh: realGh, repo: opt.repo ?? process.env.GITHUB_REPOSITORY, pr: Number(opt.pr), head: opt.head, base: opt.base ?? "main", out: opt.out });
  console.log(res.line);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
