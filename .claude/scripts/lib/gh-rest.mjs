// gh without GraphQL. A Claude Code cloud session (CLAUDE_CODE_REMOTE=true)
// reaches GitHub through a proxy that answers every GraphQL call with 403, and
// gh's `pr` commands are GraphQL. There, the commands the lifecycle scripts run
// (pr list|view|create|edit|ready|comment|checks, label create) are answered
// through `gh api` REST calls, in gh's own output shape: the GraphQL field names
// for --json, --jq/-q, the URL `pr create` prints, gh's exit codes. Every other
// command, and every command outside the cloud, is plain gh.
//
// `run(file, args, { input })` returns { code, stdout, stderr }; callers inject
// their own (lifecycle.mjs gates first), tests a fake GitHub.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = "repos/{owner}/{repo}/";

export const isCloud = (env = process.env) => env.CLAUDE_CODE_REMOTE === "true";

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A run that spawns the command with the given cwd, env and timeout. */
export const spawnRun =
  ({ cwd, env = process.env, timeout } = {}) =>
  (file, args, opts = {}) => {
    const r = spawnSync(file, args, { cwd, env, encoding: "utf8", input: opts.input, timeout });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
  };

class GhError extends Error {
  constructor(stderr, code = 1, stdout = "") {
    super(stderr);
    Object.assign(this, { code, stdout });
  }
}

/** Flags of a gh command line: repeated ones collect into arrays, bare ones are true. */
function flagsOf(args, bare) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) {
      flags._.push(a);
      continue;
    }
    const [key, inline] = a.replace(/^--?/, "").split(/=(.*)/s);
    const value = inline ?? (bare.has(key) ? true : args[++i]);
    flags[key] = key in flags ? [].concat(flags[key], value) : value;
  }
  return flags;
}

const list = (v) => (v === undefined ? [] : [].concat(v));

function rest(run, method, path, body) {
  const args = ["api", `${REPO}${path}`, "-X", method];
  if (body !== undefined) args.push("--input", "-");
  const r = run("gh", args, { input: body === undefined ? undefined : JSON.stringify(body) });
  if (r.code !== 0) throw new GhError((r.stderr || r.stdout).trim() || `gh api ${method} ${path} failed`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

/** Every page of a GET, as one array of pages. */
function pages(run, path) {
  const r = run("gh", ["api", `${REPO}${path}`, "-X", "GET", "--paginate", "--slurp"]);
  if (r.code !== 0) throw new GhError((r.stderr || r.stdout).trim() || `gh api GET ${path} failed`);
  return JSON.parse(r.stdout || "[]");
}

const all = (run, path) => pages(run, path).flat();

const upper = (v) => (v ? String(v).toUpperCase() : "");
const MERGEABLE = { true: "MERGEABLE", false: "CONFLICTING" };

/** The GraphQL fields gh prints for a pull, each read only when asked for. */
const FIELDS = {
  number: (p) => p.number,
  title: (p) => p.title,
  body: (p) => p.body ?? "",
  url: (p) => p.html_url,
  state: (p) => (p.merged_at ? "MERGED" : upper(p.state)),
  isDraft: (p) => Boolean(p.draft),
  headRefName: (p) => p.head?.ref,
  headRefOid: (p) => p.head?.sha,
  baseRefName: (p) => p.base?.ref,
  author: (p) => ({ login: p.user?.login ?? "" }),
  labels: (p) => (p.labels ?? []).map((l) => ({ name: l.name })),
  mergeable: (p) => MERGEABLE[p.mergeable] ?? "UNKNOWN",
  mergeCommit: (p) => (p.merge_commit_sha ? { oid: p.merge_commit_sha } : null),
  comments: (p, run) =>
    all(run, `issues/${p.number}/comments?per_page=100`).map((c) => ({ author: { login: c.user?.login ?? "" }, body: c.body, createdAt: c.created_at })),
  commits: (p, run) =>
    all(run, `pulls/${p.number}/commits?per_page=100`).map((c) => ({
      oid: c.sha,
      authors: [{ login: c.author?.login ?? "", name: c.commit?.author?.name ?? "", email: c.commit?.author?.email ?? "" }],
    })),
  statusCheckRollup: (p, run) => rollup(run, p.head.sha),
};

/** The head commit's check runs and commit statuses, as REST returns them. */
function headChecks(run, sha) {
  const runs = pages(run, `commits/${sha}/check-runs?per_page=100`).flatMap((page) => page.check_runs ?? []);
  const statuses = rest(run, "GET", `commits/${sha}/status`)?.statuses ?? [];
  return { runs, statuses };
}

/** headChecks as GraphQL's CheckRun and StatusContext. */
function rollup(run, sha) {
  const { runs, statuses } = headChecks(run, sha);
  return [
    ...runs.map((c) => ({ __typename: "CheckRun", name: c.name, status: upper(c.status), conclusion: upper(c.conclusion) })),
    ...statuses.map((s) => ({ __typename: "StatusContext", context: s.context, state: upper(s.state) })),
  ];
}

const pick = (pull, fields, run) => Object.fromEntries(fields.map((f) => [f, FIELDS[f] ? FIELDS[f](pull, run) : null]));

function currentBranch(run) {
  const r = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (r.code !== 0) throw new GhError("could not determine the current branch");
  return r.stdout.trim();
}

/** The PR number a selector names, read without a call when it is a number or a URL. */
function numberOf(run, selector) {
  const n = /^\d+$/.test(selector ?? "") ? selector : /\/pull\/(\d+)/.exec(selector ?? "")?.[1];
  return n ?? findPull(run, selector).number;
}

/** The pull a gh selector names: a number, a /pull/<n> URL, a branch (its open PR first), or the current branch. */
function findPull(run, selector) {
  const n = /^\d+$/.test(selector ?? "") ? selector : /\/pull\/(\d+)/.exec(selector ?? "")?.[1];
  if (n) return rest(run, "GET", `pulls/${n}`);
  const branch = selector ?? currentBranch(run);
  const pulls = all(run, `pulls?head={owner}:${branch}&state=all&per_page=100`);
  const found = pulls.find((p) => p.state === "open") ?? pulls[0];
  if (!found) throw new GhError(`no pull requests found for branch "${branch}"`);
  return rest(run, "GET", `pulls/${found.number}`);
}

const PLAIN_PATH = /^\.(?:[A-Za-z_]\w*|\[\d+\])?(?:\.[A-Za-z_]\w*|\[\d+\])*$/;

/** gh's --jq: a plain path is read here, printed raw like gh; anything else goes to the jq binary. */
function jq(run, value, expr) {
  if (PLAIN_PATH.test(expr)) {
    const keys = expr.match(/[A-Za-z_]\w*|\d+/g) ?? [];
    const v = keys.reduce((o, k) => (o == null ? undefined : o[k]), value);
    return `${v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)}\n`;
  }
  const r = run("jq", ["-r", expr], { input: JSON.stringify(value) });
  if (r.code !== 0) throw new GhError(`--jq needs the jq binary for "${expr}": ${(r.stderr || "jq failed").trim()}`);
  return r.stdout;
}

const print = (run, value, flags) => {
  const expr = flags.jq ?? flags.q;
  return expr ? jq(run, value, expr) : `${JSON.stringify(value, null, 2)}\n`;
};

const bodyOf = (flags) => (flags["body-file"] !== undefined ? readFileSync(flags["body-file"], "utf8") : flags.body);

const labelPath = (name) => `labels/${encodeURIComponent(name)}`;

function addLabels(run, n, names) {
  if (names.length) rest(run, "POST", `issues/${n}/labels`, { labels: names });
}

function removeLabel(run, n, name) {
  try {
    rest(run, "DELETE", `issues/${n}/${labelPath(name)}`);
  } catch (err) {
    if (!/HTTP 404/.test(err.message)) throw err;
  }
}

/** gh pr checks' bucket for a check run. */
function runBucket(c) {
  if (c.status !== "completed") return "pending";
  return { success: "pass", skipped: "skipping", neutral: "skipping", cancelled: "cancel" }[c.conclusion] ?? "fail";
}

const statusBucket = (s) => ({ success: "pass", pending: "pending" })[s.state] ?? "fail";

function checksOnce(run, flags, pull) {
  const { runs, statuses } = headChecks(run, pull.head.sha);
  const checks = [
    ...runs.map((c) => ({ name: c.name, bucket: runBucket(c), state: upper(c.conclusion || c.status), link: c.html_url ?? "" })),
    ...statuses.map((s) => ({ name: s.context, bucket: statusBucket(s), state: upper(s.state), link: s.target_url ?? "" })),
  ];
  if (checks.length === 0) throw new GhError(`no checks reported on the '${pull.head.ref}' branch`);
  const code = checks.some((c) => c.bucket === "pending") ? 8 : checks.some((c) => c.bucket === "fail" || c.bucket === "cancel") ? 1 : 0;
  const fields = flags.json ? String(flags.json).split(",") : null;
  const stdout = fields
    ? print(run, checks.map((c) => Object.fromEntries(fields.map((f) => [f, c[f]]))), flags)
    : checks.map((c) => `${c.name}\t${c.bucket}\t${c.link}\n`).join("");
  return { code, stdout };
}

const PR = {
  list(run, flags) {
    const head = flags.head ? `head={owner}:${flags.head}&` : "";
    const state = flags.state ?? "open";
    const pulls = all(run, `pulls?${head}state=${state === "merged" ? "closed" : state}&per_page=100`).filter((p) => state !== "merged" || p.merged_at);
    const fields = String(flags.json ?? "number,title,url").split(",");
    return { stdout: print(run, pulls.map((p) => pick(p, fields, run)), flags) };
  },
  view(run, flags) {
    const pull = findPull(run, flags._[0]);
    if (!flags.json) return { stdout: `${pull.title}\n${pull.html_url}\n` };
    return { stdout: print(run, pick(pull, String(flags.json).split(","), run), flags) };
  },
  create(run, flags) {
    const pull = rest(run, "POST", "pulls", {
      title: flags.title,
      head: flags.head ?? currentBranch(run),
      base: flags.base ?? "main",
      body: bodyOf(flags) ?? "",
      draft: flags.draft === true,
    });
    addLabels(run, pull.number, list(flags.label));
    return { stdout: `${pull.html_url}\n` };
  },
  edit(run, flags) {
    const n = numberOf(run, flags._[0]);
    const patch = {};
    const body = bodyOf(flags);
    if (body !== undefined) patch.body = body;
    if (flags.title !== undefined) patch.title = flags.title;
    if (Object.keys(patch).length) rest(run, "PATCH", `pulls/${n}`, patch);
    addLabels(run, n, list(flags["add-label"]));
    for (const name of list(flags["remove-label"])) removeLabel(run, n, name);
    return { stdout: "" };
  },
  ready(run, flags) {
    const n = numberOf(run, flags._[0]);
    rest(run, "POST", `pulls/${n}/ccr/ready_for_review`, {});
    return { stdout: "" };
  },
  comment(run, flags) {
    const n = numberOf(run, flags._[0]);
    const c = rest(run, "POST", `issues/${n}/comments`, { body: bodyOf(flags) ?? "" });
    return { stdout: `${c?.html_url ?? ""}\n` };
  },
  checks(run, flags, sleep) {
    const pull = findPull(run, flags._[0]);
    let result = checksOnce(run, flags, pull);
    while (flags.watch && result.code === 8) {
      sleep(Number(flags.interval ?? 10) * 1000);
      result = checksOnce(run, flags, pull);
    }
    return result;
  },
};

function labelCreate(run, flags) {
  const name = flags._[0];
  const props = { name, ...(flags.color ? { color: flags.color } : {}), ...(flags.description ? { description: flags.description } : {}) };
  try {
    rest(run, "POST", "labels", props);
  } catch (err) {
    if (!/HTTP 422/.test(err.message)) throw err;
    if (flags.force !== true) throw new GhError(`label with name "${name}" already exists; use \`--force\` to update its color and description`);
    rest(run, "PATCH", labelPath(name), props);
  }
  return { stdout: "" };
}

const BARE = new Set(["draft", "force", "watch", "fill"]);

/** The translation of one gh command, or null when it is not one the REST layer answers. */
function translate(args) {
  const [group, verb, ...rest_] = args;
  if (group === "pr" && Object.hasOwn(PR, verb)) return (run, sleep) => PR[verb](run, flagsOf(rest_, BARE), sleep);
  if (group === "label" && verb === "create") return (run) => labelCreate(run, flagsOf(rest_, BARE));
  return null;
}

/**
 * One gh command: through REST in a cloud session when it is one the lifecycle
 * scripts run, else plain gh. Returns { code, stdout, stderr }.
 */
export function ghRun(args, { run = spawnRun(), env = process.env, sleep = sleepSync } = {}) {
  const translated = isCloud(env) ? translate(args) : null;
  if (!translated) return run("gh", args);
  try {
    const out = translated(run, sleep);
    return { code: out.code ?? 0, stdout: out.stdout ?? "", stderr: "" };
  } catch (err) {
    // gh exits 1 on any failure; a garbled answer or an unreadable --body-file too.
    if (!(err instanceof GhError)) return { code: 1, stdout: "", stderr: `${err.message}\n` };
    return { code: err.code, stdout: err.stdout, stderr: `${err.message}\n` };
  }
}

/** ghRun with execFileSync's contract: stdout, or an Error carrying status, stdout and stderr. */
export function ghSync(args, { cwd, env = process.env, timeout, run = spawnRun({ cwd, env, timeout }), sleep } = {}) {
  const r = ghRun(args, { run, env, sleep });
  if (r.code !== 0) throw Object.assign(new Error(`gh ${args.join(" ")}: ${r.stderr.trim()}`), { status: r.code, stdout: r.stdout, stderr: r.stderr });
  return r.stdout;
}
