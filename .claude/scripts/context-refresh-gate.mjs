#!/usr/bin/env node
/**
 * Before phase 13 re-fires the org-researcher: has anything it read moved
 * since context.md was gathered? Prints `skip` or `dispatch <reason>` and
 * exits 0; reads only. Any read it cannot make is a `dispatch`, never a `skip`.
 *
 *   node .claude/scripts/context-refresh-gate.mjs <feature-dir>
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnRun } from "./lib/gh-rest.mjs";
import { cloneDir, SPECS_SLUG, TRUNK } from "./specs-repo.mjs";

const TIMEOUT_MS = 30_000;

class ReadError extends Error {}

function stamp(text) {
  const m = /^- \*\*Gathered\*\*: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) · specs trunk ([0-9a-f]{7,40})\s*$/m.exec(text);
  if (!m || Number.isNaN(Date.parse(m[1]))) throw new ReadError("Gathered has no UTC time and specs trunk sha");
  return { at: m[1], sha: m[2] };
}

function anchorIssue(text) {
  const line = /^- \*\*Anchor\*\*: (.*)$/m.exec(text)?.[1] ?? "";
  const n = new RegExp(`github\\.com/${SPECS_SLUG}/issues/(\\d+)`).exec(line)?.[1] ?? /\bST-(\d+)\b/.exec(line)?.[1];
  if (!n) throw new ReadError("no anchor issue in context.md");
  return Number(n);
}

function call(run, file, args) {
  const r = run(file, args);
  if (r.code !== 0) throw new ReadError(`${file} ${args[0] === "-C" ? args[2] : args[0]} failed: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
  return r.stdout;
}

function api(run, path) {
  const out = call(run, "gh", ["api", `repos/${SPECS_SLUG}/${path}`]);
  try {
    return JSON.parse(out);
  } catch {
    throw new ReadError(`gh api ${path} answered no JSON`);
  }
}

/** Whether `iso` is later than `at`; a date GitHub sent that cannot be read is a ReadError, never "not later". */
function after(iso, at, what) {
  const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) throw new ReadError(`${what} has no readable date`);
  return t > Date.parse(at);
}

function list(run, path) {
  const items = api(run, path);
  if (!Array.isArray(items)) throw new ReadError(`gh api ${path} answered no list`);
  return items;
}

function check({ featureDir, root, run }) {
  const file = join(featureDir, "context.md");
  if (!existsSync(file)) throw new ReadError("no context.md");
  const text = readFileSync(file, "utf8");
  const { at, sha } = stamp(text);
  const n = anchorIssue(text);

  const issue = api(run, `issues/${n}`);
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) throw new ReadError(`gh api issues/${n} answered no issue`);
  if (after(issue.updated_at, at, `story #${n}`)) return `story #${n} updated ${issue.updated_at}`;
  const ep = issue.labels?.map((l) => l.name).find((name) => /^EP-\d+$/.test(name));
  if (ep) {
    const epic = list(run, "issues?labels=epic&state=all&per_page=100").find((e) => !e.pull_request && e.title?.startsWith(`${ep} `));
    if (!epic) return `no epic for ${ep}`;
    if (after(epic.updated_at, at, `epic #${epic.number}`)) return `epic #${epic.number} updated ${epic.updated_at}`;
    const sibling = list(run, `issues?labels=${ep}&state=all&since=${at}&per_page=100`).find(
      (s) => !s.pull_request && s.number !== n && s.number !== epic.number && after(s.created_at, at, `issue #${s.number}`),
    );
    if (sibling) return `new sibling #${sibling.number}`;
  }

  const clone = cloneDir(root);
  if (!existsSync(clone)) throw new ReadError(`no specs clone at ${clone}`);
  call(run, "git", ["-C", clone, "fetch", "-q", "origin", TRUNK]);
  const commits = call(run, "git", ["-C", clone, "log", "--oneline", `${sha}..origin/${TRUNK}`, "--", "docs/"]).trim();
  if (commits) return `docs changed (${commits.split("\n").length} commits)`;
  return null;
}

export function gate({ featureDir, root = process.cwd(), run = spawnRun({ cwd: root, timeout: TIMEOUT_MS }) }) {
  try {
    const reason = check({ featureDir, root, run });
    return reason ? `dispatch ${reason}` : "skip";
  } catch (e) {
    return `dispatch ${e instanceof ReadError ? e.message : `read failed: ${e.message}`}`;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  console.log(dir ? gate({ featureDir: resolve(dir) }) : "dispatch no feature directory given");
}
