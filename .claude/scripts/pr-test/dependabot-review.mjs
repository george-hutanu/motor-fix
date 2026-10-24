#!/usr/bin/env node
// The agent-review a Dependabot-only PR gets without a tester run.
// GitHub requires agent-review on main; a PR Dependabot opened and alone
// committed to skips the PR tester (AGENTS.md step 6), so this writes its
// success instead, from .github/workflows/dependabot-review.yml.
//
// The workflow runs on pull_request_target, the base branch's copy of the file
// and of this script, and never checks out the PR, so a PR cannot change what
// decides its own status. The rule is the gates' (lib/dependabot.mjs); a head
// that already carries an agent-review of any state is left as it is.
//
//   node .claude/scripts/pr-test/dependabot-review.mjs <pr>
//
// Env: GITHUB_TOKEN (statuses: write), GITHUB_REPOSITORY, RUN_URL (the run,
// the status's target). Exit 0 posted or nothing to post (the reason
// printed), 1 GitHub could not be read or written, 64 usage.
import { dependabotCommit, isDependabot, openedByDependabot } from "../lib/dependabot.mjs";
import { isEntryPoint } from "../lib/entry.mjs";

export const DESCRIPTION = "Dependabot exemption: every commit is Dependabot's, no tester run (AGENTS.md step 6)";
const CONTEXT = "agent-review";
// One page of commits; a PR with more cannot be verified in one read and is left to the tester.
const PAGE = 100;
const short = (sha) => String(sha ?? "").slice(0, 7);

// GitHub keeps at most 1000 statuses per context on a commit; past ten pages the head is left to the tester.
const STATUS_PAGES = 10;

/** The head's agent-review of any state, read page by page so an old one under newer statuses is still found. */
async function findStatus(get, head) {
  for (let page = 1; page <= STATUS_PAGES; page++) {
    const rows = await get(`/commits/${head}/statuses?per_page=${PAGE}&page=${page}`);
    const hit = rows.find((s) => s?.context === CONTEXT);
    if (hit || rows.length < PAGE) return hit;
  }
  throw new Error(`statuses of ${short(head)}: more than ${STATUS_PAGES * PAGE}, not read`);
}

/** Run for `argv` ([pr]); returns the exit code. */
export async function main(argv, { fetch = globalThis.fetch, env = process.env, log = console.log } = {}) {
  const pr = argv[0];
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_REPOSITORY?.trim();
  if (!/^[1-9]\d*$/.test(pr ?? "") || !token || !repo) {
    log("usage: dependabot-review.mjs <pr>  (env GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_URL)");
    return 64;
  }
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const get = async (path) => {
    const res = await fetch(`${api}${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  };
  try {
    const p = await get(`/pulls/${pr}`);
    const head = p.head.sha;
    const rows = await get(`/pulls/${pr}/commits?per_page=${PAGE}`);
    const commits = rows.map((c) => ({
      oid: c.sha,
      authors: c.author?.login ? [{ login: c.author.login }] : [],
      committer: { login: c.committer?.login ?? "" },
      verified: c.commit?.verification?.verified === true,
    }));
    const pull = { author: { login: p.user?.login ?? "" }, commits };
    if (!isDependabot(pull)) {
      const bad = commits.find((c) => !dependabotCommit(c));
      const why = !openedByDependabot(pull)
        ? `opened by ${pull.author.login || "an unknown account"}, not Dependabot`
        : bad
          ? `commit ${short(bad.oid)} is not Dependabot's alone, committed by GitHub or Dependabot and signed`
          : "it has no commits";
      log(`#${pr}: no agent-review posted: ${why}; it needs the PR tester.`);
      return 0;
    }
    if (rows.length >= PAGE) {
      log(`#${pr}: no agent-review posted: ${rows.length} commits are more than one read can verify; it needs the PR tester.`);
      return 0;
    }
    const existing = await findStatus(get, head);
    if (existing) {
      log(`#${pr}: ${short(head)} already has agent-review ${existing.state}; left as it is.`);
      return 0;
    }
    const res = await fetch(`${api}/statuses/${head}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ state: "success", context: CONTEXT, description: DESCRIPTION, target_url: env.RUN_URL }),
    });
    if (!res.ok) throw new Error(`POST /statuses/${short(head)}: HTTP ${res.status} ${await res.text()}`);
    log(`#${pr}: agent-review success posted on ${short(head)} (Dependabot exemption).`);
    return 0;
  } catch (e) {
    log(`#${pr}: ${e.message}`);
    return 1;
  }
}

if (isEntryPoint(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
